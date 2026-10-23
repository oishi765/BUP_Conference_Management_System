import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { canManageConference, requireAuth } from './middleware.js';
import { requireCsrf } from './csrf.js';

const router = Router();
const idSchema = z.string().uuid();
const membershipSchema = z.object({ userId: z.string().uuid(), role: z.enum(['conference_admin', 'reviewer', 'session_chair']) }).strict();
const submissionSchema = z.object({ title: z.string().trim().min(5).max(300).optional(), abstract: z.string().trim().min(20).max(20000).optional(), keywords: z.array(z.string().trim().min(1).max(60)).max(12).optional() }).strict().refine((value) => Object.keys(value).length > 0);

function dbRequired(_req, res, next) {
  if (!pool) return res.status(503).json({ error: { message: 'This feature is unavailable until DATABASE_URL is configured.' } });
  next();
}

function badInput(res) { return res.status(400).json({ error: { message: 'Check the submitted fields.' } }); }

async function transaction(callback) {
  const client = await pool.connect();
  try { await client.query('begin'); const value = await callback(client); await client.query('commit'); return value; }
  catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}

router.get('/conferences/:conferenceId/members', dbRequired, requireAuth, async (req, res, next) => {
  if (!idSchema.safeParse(req.params.conferenceId).success) return badInput(res);
  try {
    if (!await canManageConference(req.user, req.params.conferenceId)) return res.status(403).json({ error: { message: 'Conference Admin access for this conference is required.' } });
    const { rows } = await pool.query(
      `select u.id as user_id, u.full_name, u.email, r.name as role, cm.created_at, assigner.full_name as assigned_by
       from public.conference_memberships cm join public.users u on u.id = cm.user_id
       join public.roles r on r.id = cm.role_id left join public.users assigner on assigner.id = cm.assigned_by
       where cm.conference_id = $1 order by r.name, u.full_name`, [req.params.conferenceId]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/conferences/:conferenceId/members', dbRequired, requireAuth, requireCsrf, async (req, res, next) => {
  if (!idSchema.safeParse(req.params.conferenceId).success) return badInput(res);
  const parsed = membershipSchema.safeParse(req.body);
  if (!parsed.success) return badInput(res);
  try {
    if (!await canManageConference(req.user, req.params.conferenceId)) return res.status(403).json({ error: { message: 'Conference Admin access for this conference is required.' } });
    const result = await transaction(async (client) => {
      const { rows } = await client.query(
        `insert into public.conference_memberships(conference_id, user_id, role_id, assigned_by)
         select $1, $2, roles.id, $3 from public.roles where roles.name = $4
         on conflict(conference_id, user_id, role_id) do nothing returning id`,
        [req.params.conferenceId, parsed.data.userId, req.user.id, parsed.data.role]);
      if (!rows[0]) return false;
      await client.query(
        `insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, details)
         values($1, 'conference.member_assigned', 'conference', $2, $3::jsonb)`,
        [req.user.id, req.params.conferenceId, JSON.stringify({ userId: parsed.data.userId, role: parsed.data.role })]);
      return true;
    });
    if (!result) return res.status(409).json({ error: { message: 'This user already has that role for the conference.' } });
    res.status(201).json({ data: { userId: parsed.data.userId, conferenceId: req.params.conferenceId, role: parsed.data.role } });
  } catch (error) { if (error.code === '23503') return res.status(404).json({ error: { message: 'Conference or user was not found.' } }); next(error); }
});

router.delete('/conferences/:conferenceId/members/:userId/:role', dbRequired, requireAuth, requireCsrf, async (req, res, next) => {
  if (!idSchema.safeParse(req.params.conferenceId).success || !idSchema.safeParse(req.params.userId).success || !membershipSchema.shape.role.safeParse(req.params.role).success) return badInput(res);
  try {
    if (!await canManageConference(req.user, req.params.conferenceId)) return res.status(403).json({ error: { message: 'Conference Admin access for this conference is required.' } });
    const { rows } = await pool.query(
      `delete from public.conference_memberships cm using public.roles r
       where cm.role_id = r.id and cm.conference_id = $1 and cm.user_id = $2 and r.name = $3 returning cm.id`,
      [req.params.conferenceId, req.params.userId, req.params.role]);
    if (!rows[0]) return res.status(404).json({ error: { message: 'Conference membership not found.' } });
    await pool.query(
      `delete from public.user_roles ur using public.roles r where ur.role_id = r.id and ur.user_id = $1 and r.name = $2
       and not exists(select 1 from public.conference_memberships cm join public.roles mr on mr.id = cm.role_id where cm.user_id = $1 and mr.name = $2)`,
      [req.params.userId, req.params.role]);
    await pool.query(
      `insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, details)
       values($1, 'conference.member_removed', 'conference', $2, $3::jsonb)`,
      [req.user.id, req.params.conferenceId, JSON.stringify({ userId: req.params.userId, role: req.params.role })]);
    res.json({ data: { removed: true } });
  } catch (error) { next(error); }
});

router.post('/admin/users/:userId/roles', dbRequired, requireAuth, requireCsrf, async (req, res, next) => {
  if (!req.user.roles.includes('super_admin')) return res.status(403).json({ error: { message: 'Super Admin access is required.' } });
  if (!idSchema.safeParse(req.params.userId).success) return badInput(res);
  const parsed = z.object({ role: z.enum(['author', 'attendee']) }).strict().safeParse(req.body);
  if (!parsed.success) return badInput(res);
  try {
    const { rows } = await pool.query(
      `insert into public.user_roles(user_id, role_id) select $1, id from public.roles where name = $2
       on conflict do nothing returning user_id`, [req.params.userId, parsed.data.role]);
    if (!rows[0]) {
      const user = await pool.query('select id from public.users where id = $1', [req.params.userId]);
      if (!user.rows[0]) return res.status(404).json({ error: { message: 'User not found.' } });
    }
    await pool.query('insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, details) values($1, $2, $3, $4, $5::jsonb)', [req.user.id, 'user.role_assigned', 'user', req.params.userId, JSON.stringify({ role: parsed.data.role })]);
    res.status(201).json({ data: { userId: req.params.userId, role: parsed.data.role } });
  } catch (error) { next(error); }
});

router.get('/submissions/:submissionId', dbRequired, requireAuth, async (req, res, next) => {
  if (!idSchema.safeParse(req.params.submissionId).success) return badInput(res);
  try {
    const { rows } = await pool.query(
      `select id, conference_id, track_id, submitted_by, title, abstract, keywords, paper_url, submission_type, status, submitted_at, created_at, updated_at
       from public.submissions where id = $1 limit 1`, [req.params.submissionId]);
    const submission = rows[0];
    if (!submission) return res.status(404).json({ error: { message: 'Submission not found.' } });
    const [author, reviewer, chair] = await Promise.all([
      pool.query('select 1 from public.authors where submission_id = $1 and user_id = $2 limit 1', [submission.id, req.user.id]),
      pool.query('select 1 from public.reviews where submission_id = $1 and reviewer_id = $2 limit 1', [submission.id, req.user.id]),
      pool.query(`select 1 from public.session_submissions ss join public.sessions se on se.id = ss.session_id
        join public.conference_memberships cm on cm.conference_id = se.conference_id join public.roles r on r.id = cm.role_id
        where ss.submission_id = $1 and cm.user_id = $2 and r.name = 'session_chair' limit 1`, [submission.id, req.user.id]),
    ]);
    const conferenceAdmin = await canManageConference(req.user, submission.conference_id);
    const isOwner = submission.submitted_by === req.user.id || Boolean(author.rows[0]);
    const allowed = req.user.roles.includes('super_admin') || isOwner || Boolean(reviewer.rows[0]) || conferenceAdmin || Boolean(chair.rows[0]);
    if (!allowed) return res.status(403).json({ error: { message: 'You do not have access to this submission.' } });
    const { submitted_by, ...safeSubmission } = submission;
    res.json({ data: safeSubmission });
  } catch (error) { next(error); }
});

router.patch('/submissions/:submissionId', dbRequired, requireAuth, requireCsrf, async (req, res, next) => {
  if (!idSchema.safeParse(req.params.submissionId).success) return badInput(res);
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) return badInput(res);
  try {
    const { rows: ownership } = await pool.query('select status, submitted_by from public.submissions where id = $1', [req.params.submissionId]);
    if (!ownership[0]) return res.status(404).json({ error: { message: 'Submission not found.' } });
    const author = await pool.query('select 1 from public.authors where submission_id = $1 and user_id = $2 limit 1', [req.params.submissionId, req.user.id]);
    if (ownership[0].submitted_by !== req.user.id && !author.rows[0]) return res.status(403).json({ error: { message: 'Only a submission author can edit this record.' } });
    if (ownership[0].status !== 'draft') return res.status(409).json({ error: { message: 'A submitted paper can no longer be edited here.' } });
    const { title, abstract, keywords } = parsed.data;
    const { rows } = await pool.query(
      `update public.submissions set title = coalesce($1, title), abstract = coalesce($2, abstract), keywords = coalesce($3::text[], keywords), updated_at = now()
       where id = $4 and status = 'draft' and (submitted_by = $5 or id in (select submission_id from public.authors where user_id = $5))
       returning id, conference_id, track_id, title, abstract, keywords, paper_url, submission_type, status, updated_at`,
      [title ?? null, abstract ?? null, keywords ?? null, req.params.submissionId, req.user.id]);
    if (!rows[0]) return res.status(409).json({ error: { message: 'This submission is no longer editable by your account.' } });
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
});

export default router;
