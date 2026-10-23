import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { createOpaqueToken, hashPassword, hashToken, verifyPassword } from './crypto.js';
import { emailIsConfigured, sendPasswordResetEmail, sendVerificationEmail } from './email.js';
import { issueCsrfToken, requireCsrf } from './csrf.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from './middleware.js';

const router = Router();
const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const nameSchema = z.string().trim().min(2).max(160);
const passwordSchema = z.string().min(12).max(128);
const registerSchema = z.object({ fullName: nameSchema, email: emailSchema, password: passwordSchema, institution: z.string().trim().max(200).optional().default('') }).strict();
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
const resetSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i), password: passwordSchema }).strict();
const verificationSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
const profileSchema = z.object({ fullName: nameSchema, institution: z.string().trim().max(200).optional().default(''), jobTitle: z.string().trim().max(160).optional().default(''), phone: z.string().trim().max(40).optional().default('') }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
const resetMinutes = Math.min(Math.max(Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30), 5), 120);
const sessionDays = Math.min(Math.max(Number(process.env.SESSION_TTL_DAYS || 7), 1), 30);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Too many sign-in attempts. Try again in 15 minutes.' } } });
const accountLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Too many account requests. Try again later.' } } });

function dbRequired(_req, res, next) {
  if (!pool) return res.status(503).json({ error: { message: 'Authentication is unavailable until DATABASE_URL is configured.' } });
  next();
}

function invalid(res, parsed) {
  return res.status(400).json({ error: { message: 'Check the submitted fields.', fields: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) } });
}

function publicUser(user, roles = []) {
  return { id: user.id, email: user.email, fullName: user.full_name ?? user.fullName, institution: user.institution || '', jobTitle: user.job_title ?? user.jobTitle ?? '', phone: user.phone || '', emailVerified: Boolean(user.email_verified_at ?? user.emailVerifiedAt), roles };
}

async function inTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function insertSession(client, userId, req) {
  const token = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await client.query(
    `insert into public.auth_sessions(token_hash, user_id, csrf_token, expires_at, user_agent, ip_address)
     values($1, $2, $3, $4, $5, $6)`,
    [tokenHash, userId, csrfToken, expiresAt, String(req.get('user-agent') || '').slice(0, 500) || null, req.ip || null],
  );
  return { token, csrfToken };
}

function setAuthenticatedCookies(res, session) {
  setSessionCookie(res, session.token);
  issueCsrfToken(null, res, session.csrfToken);
}

const dummyHash = `scrypt$32768$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;

router.get('/csrf', (req, res) => {
  const csrfToken = issueCsrfToken(req, res, req.authSession?.csrfToken || null);
  res.json({ data: { csrfToken } });
});

router.post('/register', dbRequired, accountLimiter, requireCsrf, async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed);
  const requireVerification = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true';
  if (requireVerification && !emailIsConfigured()) return res.status(503).json({ error: { message: 'Registration requires email verification, but no email provider is configured. No account was created.' } });
  const { fullName, email, password, institution } = parsed.data;
  const rawVerificationToken = requireVerification ? createOpaqueToken() : null;
  try {
    const passwordHash = await hashPassword(password);
    const created = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `insert into public.users(email, full_name, institution, password_hash, email_verified_at)
         values($1, $2, $3, $4, case when $5 then null else now() end)
         returning id, email, full_name, institution, job_title, phone, email_verified_at`,
        [email, fullName, institution, passwordHash, requireVerification],
      );
      const user = rows[0];
      await client.query(
        `insert into public.user_roles(user_id, role_id)
         select $1, id from public.roles where name = 'attendee' on conflict do nothing`, [user.id]);
      if (requireVerification) {
        await client.query(
          `insert into public.email_verification_tokens(token_hash, user_id, expires_at)
           values($1, $2, now() + interval '24 hours')`, [hashToken(rawVerificationToken), user.id]);
        const sent = await sendVerificationEmail({ email, name: fullName, token: rawVerificationToken });
        if (!sent) throw Object.assign(new Error('Email verification could not be sent. No account was created.'), { status: 503 });
      }
      await client.query('insert into public.audit_logs(actor_user_id, action, entity_type, entity_id) values($1, $2, $3, $4)', [user.id, 'account.registered', 'user', user.id]);
      const session = requireVerification ? null : await insertSession(client, user.id, req);
      return { user, session };
    });
    if (created.session) setAuthenticatedCookies(res, created.session);
    res.status(201).json({ data: { user: publicUser(created.user, ['attendee']), authenticated: Boolean(created.session), message: requireVerification ? 'Account created. Check your email to verify it before signing in.' : 'Account created.' } });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: { message: 'An account with this email may already exist.' } });
    next(error);
  }
});

router.post('/login', dbRequired, loginLimiter, requireCsrf, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed);
  try {
    const { rows } = await pool.query(
      `select id, email, full_name, institution, job_title, phone, password_hash, email_verified_at, is_active
       from public.users where email = $1 limit 1`, [parsed.data.email]);
    const user = rows[0];
    const passwordMatches = await verifyPassword(parsed.data.password, user?.password_hash || dummyHash);
    if (!user || !user.is_active || !passwordMatches) return res.status(401).json({ error: { message: 'Email or password is incorrect.' } });
    if (process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true' && !user.email_verified_at) return res.status(403).json({ error: { message: 'Verify your email address before signing in.' } });
    const session = await inTransaction(async (client) => {
      if (req.authSession) await client.query('delete from public.auth_sessions where token_hash = $1', [req.authSession.tokenHash]);
      const created = await insertSession(client, user.id, req);
      await client.query('insert into public.audit_logs(actor_user_id, action, entity_type, entity_id) values($1, $2, $3, $4)', [user.id, 'account.login', 'user', user.id]);
      return created;
    });
    const roles = await pool.query(
      `select r.name from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = $1
       union select r.name from public.conference_memberships cm join public.roles r on r.id = cm.role_id where cm.user_id = $1`, [user.id]);
    setAuthenticatedCookies(res, session);
    res.json({ data: { user: publicUser(user, roles.rows.map((row) => row.name)) } });
  } catch (error) { next(error); }
});

router.get('/session', dbRequired, (req, res) => {
  res.json({ data: { user: req.user ? publicUser(req.user, req.user.roles) : null } });
});

router.post('/logout', dbRequired, requireAuth, requireCsrf, async (req, res, next) => {
  try {
    await pool.query('delete from public.auth_sessions where token_hash = $1', [req.authSession.tokenHash]);
    await pool.query('insert into public.audit_logs(actor_user_id, action, entity_type, entity_id) values($1, $2, $3, $4)', [req.user.id, 'account.logout', 'user', req.user.id]);
    clearSessionCookie(res);
    const csrfToken = issueCsrfToken(req, res);
    res.json({ data: { user: null, csrfToken } });
  } catch (error) { next(error); }
});

router.patch('/profile', dbRequired, requireAuth, requireCsrf, async (req, res, next) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed);
  try {
    const { fullName, institution, jobTitle, phone } = parsed.data;
    const { rows } = await pool.query(
      `update public.users set full_name = $1, institution = $2, job_title = $3, phone = $4,
       profile_updated_at = now(), updated_at = now() where id = $5
       returning id, email, full_name, institution, job_title, phone, email_verified_at`,
      [fullName, institution, jobTitle, phone, req.user.id]);
    res.json({ data: { user: publicUser(rows[0], req.user.roles) } });
  } catch (error) { next(error); }
});

router.post('/change-password', dbRequired, requireAuth, requireCsrf, async (req, res, next) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed);
  try {
    const { rows } = await pool.query('select password_hash from public.users where id = $1', [req.user.id]);
    if (!rows[0]?.password_hash || !await verifyPassword(parsed.data.currentPassword, rows[0].password_hash)) return res.status(400).json({ error: { message: 'Current password is incorrect.' } });
    const newHash = await hashPassword(parsed.data.newPassword);
    const nextSession = await inTransaction(async (client) => {
      await client.query('update public.users set password_hash = $1, updated_at = now() where id = $2', [newHash, req.user.id]);
      await client.query('delete from public.auth_sessions where user_id = $1', [req.user.id]);
      await client.query('update public.password_reset_tokens set consumed_at = now() where user_id = $1 and consumed_at is null', [req.user.id]);
      await client.query('insert into public.audit_logs(actor_user_id, action, entity_type, entity_id) values($1, $2, $3, $4)', [req.user.id, 'account.password_changed', 'user', req.user.id]);
      return insertSession(client, req.user.id, req);
    });
    setAuthenticatedCookies(res, nextSession);
    res.json({ data: { message: 'Password changed. Other sessions have been signed out.' } });
  } catch (error) { next(error); }
});

router.post('/forgot-password', dbRequired, accountLimiter, requireCsrf, async (req, res, next) => {
  const parsed = z.object({ email: emailSchema }).strict().safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed);
  if (!emailIsConfigured()) return res.status(503).json({ error: { message: 'Email delivery is not configured. No password reset email was sent.' } });
  try {
    const { rows } = await pool.query('select id, email, full_name from public.users where email = $1 and is_active = true limit 1', [parsed.data.email]);
    if (rows[0]) {
      const rawToken = createOpaqueToken();
      await pool.query('update public.password_reset_tokens set consumed_at = now() where user_id = $1 and consumed_at is null', [rows[0].id]);
      await pool.query(
        `insert into public.password_reset_tokens(token_hash, user_id, expires_at)
         values($1, $2, $3)`,
        [hashToken(rawToken), rows[0].id, new Date(Date.now() + resetMinutes * 60 * 1000)]);
      try { await sendPasswordResetEmail({ email: rows[0].email, name: rows[0].full_name, token: rawToken }); }
      catch (mailError) { console.error('Password reset email delivery failed; no delivery is claimed:', mailError.message); }
    }
    res.json({ data: { message: 'If the address belongs to an active account and the email provider accepts the request, a reset link will arrive.' } });
  } catch (error) { next(error); }
});

router.post('/reset-password', dbRequired, accountLimiter, requireCsrf, async (req, res, next) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed);
  try {
    const newHash = await hashPassword(parsed.data.password);
    const changed = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `select user_id from public.password_reset_tokens where token_hash = $1 and consumed_at is null and expires_at > now() for update`, [hashToken(parsed.data.token)]);
      if (!rows[0]) return false;
      await client.query('update public.password_reset_tokens set consumed_at = now() where token_hash = $1', [hashToken(parsed.data.token)]);
      await client.query('update public.users set password_hash = $1, updated_at = now() where id = $2', [newHash, rows[0].user_id]);
      await client.query('delete from public.auth_sessions where user_id = $1', [rows[0].user_id]);
      await client.query('update public.email_verification_tokens set consumed_at = now() where user_id = $1 and consumed_at is null', [rows[0].user_id]);
      await client.query('insert into public.audit_logs(actor_user_id, action, entity_type, entity_id) values($1, $2, $3, $4)', [rows[0].user_id, 'account.password_reset', 'user', rows[0].user_id]);
      return true;
    });
    if (!changed) return res.status(400).json({ error: { message: 'This reset link is invalid, expired, or already used.' } });
    clearSessionCookie(res);
    res.json({ data: { message: 'Password reset. Sign in with your new password.' } });
  } catch (error) { next(error); }
});

router.post('/verify-email', dbRequired, accountLimiter, requireCsrf, async (req, res, next) => {
  const parsed = verificationSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed);
  try {
    const user = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `select user_id from public.email_verification_tokens where token_hash = $1 and consumed_at is null and expires_at > now() for update`, [hashToken(parsed.data.token)]);
      if (!rows[0]) return null;
      await client.query('update public.email_verification_tokens set consumed_at = now() where token_hash = $1', [hashToken(parsed.data.token)]);
      const updated = await client.query('update public.users set email_verified_at = now(), updated_at = now() where id = $1 returning id, email', [rows[0].user_id]);
      return updated.rows[0] || null;
    });
    if (!user) return res.status(400).json({ error: { message: 'This verification link is invalid, expired, or already used.' } });
    res.json({ data: { message: 'Email verified. You can now sign in.' } });
  } catch (error) { next(error); }
});

router.post('/resend-verification', dbRequired, accountLimiter, requireCsrf, async (req, res, next) => {
  const parsed = z.object({ email: emailSchema }).strict().safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed);
  if (!emailIsConfigured()) return res.status(503).json({ error: { message: 'Email delivery is not configured. No verification email was sent.' } });
  try {
    const { rows } = await pool.query('select id, email, full_name, email_verified_at from public.users where email = $1 and is_active = true limit 1', [parsed.data.email]);
    if (rows[0] && !rows[0].email_verified_at) {
      const token = createOpaqueToken();
      await pool.query('update public.email_verification_tokens set consumed_at = now() where user_id = $1 and consumed_at is null', [rows[0].id]);
      await pool.query("insert into public.email_verification_tokens(token_hash, user_id, expires_at) values($1, $2, now() + interval '24 hours')", [hashToken(token), rows[0].id]);
      try { await sendVerificationEmail({ email: rows[0].email, name: rows[0].full_name, token }); }
      catch (mailError) { console.error('Verification email delivery failed; no delivery is claimed:', mailError.message); }
    }
    res.json({ data: { message: 'If the address belongs to an unverified account and delivery succeeds, a verification link will arrive.' } });
  } catch (error) { next(error); }
});

router.get('/dashboard', dbRequired, requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cards = [];
    if (req.user.roles.includes('super_admin')) {
      const { rows } = await pool.query('select (select count(*)::int from public.users) as users, (select count(*)::int from public.conferences) as conferences');
      cards.push({ role: 'super_admin', title: 'Platform administration', users: rows[0].users, conferences: rows[0].conferences, href: '/admin/users' });
    }
    if (req.user.roles.includes('conference_admin')) {
      const { rows } = await pool.query(
        `select c.id, c.title from public.conference_memberships cm join public.roles r on r.id = cm.role_id join public.conferences c on c.id = cm.conference_id where cm.user_id = $1 and r.name = 'conference_admin' order by c.start_date nulls last`, [userId]);
      cards.push({ role: 'conference_admin', title: 'Conference administration', conferences: rows, href: '/conferences' });
    }
    if (req.user.roles.includes('author')) {
      const { rows } = await pool.query(`select s.id, s.title, s.status from public.submissions s where s.submitted_by = $1 or exists(select 1 from public.authors a where a.submission_id = s.id and a.user_id = $1) order by s.updated_at desc limit 20`, [userId]);
      cards.push({ role: 'author', title: 'My submissions', submissions: rows, href: '/submission-guidelines' });
    }
    if (req.user.roles.includes('reviewer')) {
      const { rows } = await pool.query(`select rv.id, rv.status, rv.due_at, s.title as submission_title from public.reviews rv join public.submissions s on s.id = rv.submission_id where rv.reviewer_id = $1 order by rv.due_at nulls last limit 20`, [userId]);
      cards.push({ role: 'reviewer', title: 'My reviews', reviews: rows, href: '/dashboard' });
    }
    if (req.user.roles.includes('attendee')) {
      const { rows } = await pool.query(`select r.id, r.status, c.id as conference_id, c.title from public.registrations r join public.conferences c on c.id = r.conference_id where r.user_id = $1 order by c.start_date nulls last limit 20`, [userId]);
      cards.push({ role: 'attendee', title: 'My registrations', registrations: rows, href: '/conferences' });
    }
    if (req.user.roles.includes('session_chair')) {
      const { rows } = await pool.query(
        `select distinct c.id as conference_id, c.title, s.id as session_id, s.title as session_title, s.starts_at, s.ends_at
         from public.conference_memberships cm join public.roles r on r.id = cm.role_id
         join public.conferences c on c.id = cm.conference_id left join public.sessions s on s.conference_id = c.id
         where cm.user_id = $1 and r.name = 'session_chair' and s.id is not null order by s.starts_at nulls last limit 40`, [userId]);
      cards.push({ role: 'session_chair', title: 'My chaired sessions', sessions: rows, href: '/schedule' });
    }
    res.json({ data: { user: publicUser(req.user, req.user.roles), cards } });
  } catch (error) { next(error); }
});

router.get('/admin/users', dbRequired, requireAuth, async (req, res, next) => {
  if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: { message: 'Super Admin access is required.' } });
  try {
    const { rows } = await pool.query(
      `with assigned_roles as (
         select ur.user_id, r.name as role_name from public.user_roles ur join public.roles r on r.id = ur.role_id
         union select cm.user_id, r.name as role_name from public.conference_memberships cm join public.roles r on r.id = cm.role_id
       ), roles_by_user as (select user_id, array_agg(distinct role_name) as roles from assigned_roles group by user_id)
       select u.id, u.email, u.full_name, u.institution, u.email_verified_at, u.is_active, u.created_at,
       coalesce(ru.roles, '{}'::text[]) as roles from public.users u left join roles_by_user ru on ru.user_id = u.id
       order by u.created_at desc limit 200`);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

export default router;
