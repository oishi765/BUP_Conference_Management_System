import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = 'bup_csrf';
const secret = process.env.CSRF_SECRET || randomBytes(48).toString('hex');
const isProduction = process.env.NODE_ENV === 'production';

function sign(value) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function cookieValue(req, name) {
  const cookies = req.headers.cookie || '';
  const pair = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function issueCsrfToken(req, res, sessionCsrfToken = null) {
  const nonce = randomBytes(32).toString('hex');
  // The anonymous token signature binds the double-submit value to this server.
  const value = sessionCsrfToken || `${nonce}.${sign(nonce)}`;
  res.cookie(CSRF_COOKIE, value, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api',
    maxAge: 2 * 60 * 60 * 1000,
  });
  return value;
}

export function requireCsrf(req, res, next) {
  const origin = req.get('origin');
  const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  if (origin && origin !== allowedOrigin) return res.status(403).json({ error: { message: 'Request origin is not allowed.' } });
  const cookie = cookieValue(req, CSRF_COOKIE);
  const header = req.get('x-csrf-token') || '';
  const valid = req.authSession
    ? safeEqual(cookie, req.authSession.csrfToken) && safeEqual(header, req.authSession.csrfToken)
    : (() => {
        const [nonce, signature, extra] = cookie.split('.');
        return !extra && /^[a-f0-9]{64}$/i.test(nonce || '') && safeEqual(signature || '', sign(nonce)) && safeEqual(header, cookie);
      })();
  if (!valid) return res.status(403).json({ error: { message: 'CSRF validation failed. Refresh the page and try again.' } });
  next();
}
