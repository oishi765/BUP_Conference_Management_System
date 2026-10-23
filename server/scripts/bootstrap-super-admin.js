import 'dotenv/config';
import readline from 'node:readline';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/crypto.js';

if (!pool) {
  console.error('DATABASE_URL is not configured. Copy server/.env.example to server/.env and set the Supabase connection URI.');
  process.exit(1);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this command interactively in a private terminal so the password can be entered without echo.');
  await pool.end();
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
function question(prompt) { return new Promise((resolve) => rl.question(prompt, resolve)); }
function secret(prompt) {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const original = rl._writeToOutput.bind(rl);
    let masking = true;
    rl._writeToOutput = (value) => {
      if (!masking) return original(value);
      if (/\r?\n$/.test(value)) process.stdout.write(value);
      else if (value.length) process.stdout.write('*'.repeat(value.length));
    };
    rl.question('', (answer) => {
      masking = false;
      rl._writeToOutput = original;
      resolve(answer);
    });
  });
}

let client;
try {
  console.log('Create the first platform Super Admin. This command is disabled after a Super Admin exists.');
  const email = (await question('Admin email: ')).trim().toLowerCase();
  const fullName = (await question('Full name: ')).trim();
  const password = await secret('Password (12+ characters): ');
  process.stdout.write('\n');
  const confirm = await secret('Confirm password: ');
  process.stdout.write('\n');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  if (fullName.length < 2 || fullName.length > 160) throw new Error('Name must be between 2 and 160 characters.');
  if (password.length < 12 || password.length > 128) throw new Error('Password must be between 12 and 128 characters.');
  if (password !== confirm) throw new Error('Passwords do not match.');
  const passwordHash = await hashPassword(password);
  client = await pool.connect();
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtext('bup_auth_initial_super_admin_v1'))");
  const exists = await client.query(
    `select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where r.name = 'super_admin' limit 1`);
  if (exists.rows[0]) throw new Error('A Super Admin already exists. No changes were made.');
  const inserted = await client.query(
    `insert into public.users(email, full_name, password_hash, email_verified_at)
     values($1, $2, $3, now()) returning id`, [email, fullName, passwordHash]);
  await client.query(
    `insert into public.user_roles(user_id, role_id) select $1, id from public.roles where name = 'super_admin'`, [inserted.rows[0].id]);
  await client.query(
    `insert into public.audit_logs(actor_user_id, action, entity_type, entity_id)
     values($1, 'account.initial_super_admin_created', 'user', $1)`, [inserted.rows[0].id]);
  await client.query('commit');
  console.log(`Super Admin account created for ${email}. Sign in using the password you entered.`);
} catch (error) {
  if (client) await client.query('rollback').catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rl.close();
  if (client) client.release();
  await pool.end();
}
