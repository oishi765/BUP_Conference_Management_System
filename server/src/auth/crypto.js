import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const N = 32_768;
const r = 8;
const p = 1;
const keyLength = 64;

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string') return false;
  const [algorithm, nText, rText, pText, saltHex, keyHex, extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || extra !== undefined || nText !== String(N) || rText !== String(r) || pText !== String(p) ||
      !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(keyHex || '')) return false;
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }));
  return timingSafeEqual(actual, Buffer.from(keyHex, 'hex'));
}
