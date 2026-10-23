import nodemailer from 'nodemailer';

function configuration() {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!host || !from) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' } : undefined,
    from,
  };
}

export function emailIsConfigured() { return Boolean(configuration()); }

async function send({ to, subject, text, html }) {
  const config = configuration();
  if (!config) return false;
  const transporter = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
  await transporter.sendMail({ from: config.from, to, subject, text, html });
  return true;
}

function link(path, token) {
  const base = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail({ email, name, token }) {
  const url = link('/verify-email', token);
  return send({
    to: email,
    subject: 'Verify your BUP Conference Management account',
    text: `Hello ${name},\n\nVerify your email address using this one-time link (expires in 24 hours):\n${url}\n\nIf you did not create this account, ignore this message.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p><a href="${url}">Verify your email address</a>. This one-time link expires in 24 hours.</p><p>If you did not create this account, ignore this message.</p>`,
  });
}

export async function sendPasswordResetEmail({ email, name, token }) {
  const url = link('/reset-password', token);
  return send({
    to: email,
    subject: 'Reset your BUP Conference Management password',
    text: `Hello ${name},\n\nReset your password using this one-time link (expires in ${process.env.PASSWORD_RESET_TTL_MINUTES || 30} minutes):\n${url}\n\nIf you did not request this, ignore this message.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p><a href="${url}">Reset your password</a>. This one-time link expires in ${process.env.PASSWORD_RESET_TTL_MINUTES || 30} minutes.</p><p>If you did not request this, ignore this message.</p>`,
  });
}

export async function sendWorkflowEmail({ email, subject, text }) {
  return send({ to: email, subject, text, html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>` });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
