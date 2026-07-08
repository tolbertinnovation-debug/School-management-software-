'use strict';
// Zero-dependency auth primitives: scrypt password hashing and HMAC-signed
// tokens (JWT-like, HS256). Avoiding native/npm deps keeps offline installs
// on low-end hardware trivial.
const crypto = require('crypto');
const config = require('../config');

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 32, SCRYPT_OPTS);
  return `s2$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifySecret(plain, stored) {
  if (!stored) return false;
  const [tag, saltHex, hashHex] = stored.split('$');
  if (tag !== 's2') return false;
  const hash = crypto.scryptSync(String(plain), Buffer.from(saltHex, 'hex'), 32, SCRYPT_OPTS);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signToken(payload, minutes = config.sessionMinutes) {
  const body = { ...payload, iat: Date.now(), exp: Date.now() + minutes * 60000 };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', config.authSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expect = crypto.createHmac('sha256', config.authSecret).update(data).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch { return null; }
}

const uuid = () => crypto.randomUUID();

module.exports = { hashSecret, verifySecret, signToken, verifyToken, uuid };
