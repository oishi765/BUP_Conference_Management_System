import { hashToken } from './crypto.js';
import { pool } from '../db/pool.js';

export const AUTH_COOKIE = 'bup_session';
const isProduction = process.env.NODE_ENV === 'production';

function parseCookie(req, name) {
  const entry = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

export function setSessionCookie(res, rawToken) {
  const ttlDays = Math.min(Math.max(Number(process.env.SESSION_TTL_DAYS || 7), 1), 30);
  res.cookie(AUTH_COOKIE, rawToken, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api', maxAge: ttlDays * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookie(res) {
  res.clearCookie(AUTH_COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api' });
}

export async function loadSession(req, _res, next) {
  const rawToken = parseCookie(req, AUTH_COOKIE);
  if (!rawToken || !/^[a-f0-9]{64}$/i.test(rawToken) || !pool) return next();
  try {
    const { rows } = await pool.query(
      `select s.token_hash, s.csrf_token, u.id, u.email, u.full_name, u.institution, u.job_title, u.phone,
              u.email_verified_at, u.is_active
       from public.auth_sessions s join public.users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now() and u.is_active = true limit 1`,
      [hashToken(rawToken)],
    );
    if (!rows[0]) return next();
    if (process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true' && !rows[0].email_verified_at) return next();
    const roles = await pool.query(
      `select r.name from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = $1
       union select r.name from public.conference_memberships cm join public.roles r on r.id = cm.role_id where cm.user_id = $1`,
      [rows[0].id],
    );
    req.authSession = { tokenHash: rows[0].token_hash, csrfToken: rows[0].csrf_token.trim() };
    req.user = {
      id: rows[0].id, email: rows[0].email, fullName: rows[0].full_name,
      institution: rows[0].institution, jobTitle: rows[0].job_title, phone: rows[0].phone,
      emailVerifiedAt: rows[0].email_verified_at, roles: roles.rows.map((row) => row.name),
    };
    void pool.query('update public.auth_sessions set last_seen_at = now() where token_hash = $1', [rows[0].token_hash]).catch((error) => console.error('Failed to update auth session activity:', error.message));
    next();
  } catch (error) { next(error); }
}

export function requireAuth(req, res, next) {
  if (!req.user || !req.authSession) return res.status(401).json({ error: { message: 'Sign in is required.' } });
  next();
}

export async function hasConferenceRole(userId, conferenceId, ...roleNames) {
  if (!pool) return false;
  const { rows } = await pool.query(
    `select 1 from public.conference_memberships cm join public.roles r on r.id = cm.role_id
     where cm.user_id = $1 and cm.conference_id = $2 and r.name = any($3::text[]) limit 1`,
    [userId, conferenceId, roleNames],
  );
  return Boolean(rows[0]);
}

export async function canManageConference(user, conferenceId) {
  if (user.roles.includes('super_admin')) return true;
  if (await hasConferenceRole(user.id, conferenceId, 'conference_admin')) return true;
  if (!pool) return false;
  const { rows } = await pool.query('select 1 from public.conferences where id = $1 and organizer_user_id = $2 limit 1', [conferenceId, user.id]);
  return Boolean(rows[0]);
}
