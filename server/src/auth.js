const { randomBytes, randomUUID, createHash, timingSafeEqual, scrypt: scryptCallback } = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'pagepulse_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
function cookieValue(header, name) {
  const item = (header || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return null; }
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function passwordMatches(password, encoded) {
  const [, cost, saltHex, hashHex] = String(encoded || '').split('$');
  if (cost !== '32768' || !/^[a-f0-9]{32}$/.test(saltHex || '') || !/^[a-f0-9]{128}$/.test(hashHex || '')) {
    await scrypt(password, Buffer.alloc(16), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return false;
  }
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hashHex, 'hex');
  return timingSafeEqual(derived, expected);
}

function cookieOptions(isProduction) {
  const sameSite = process.env.COOKIE_SAME_SITE || (isProduction ? 'None' : 'Lax');
  if (!['Lax', 'Strict', 'None'].includes(sameSite)) throw new Error('COOKIE_SAME_SITE must be Lax, Strict, or None.');
  if (sameSite === 'None' && !isProduction) throw new Error('SameSite=None cookies require production HTTPS.');
  return `Path=/; HttpOnly; SameSite=${sameSite}${isProduction ? '; Secure' : ''}`;
}

async function newSession(repository, userId, isProduction) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await repository.createSession({ tokenHash: hashToken(token), userId, csrfToken, expiresAt });
  return { token, csrfToken, expiresAt, cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieOptions(isProduction)}; Expires=${new Date(expiresAt).toUTCString()}` };
}

function makeAuth({ repository, isProduction, authLimiter }) {
  const session = async (req, res) => {
    let token = cookieValue(req.headers.cookie, SESSION_COOKIE);
    let record = token ? await repository.getSession(hashToken(token)) : null;
    if (!record) {
      const created = await newSession(repository, null, isProduction);
      token = created.token;
      record = { userId: null, csrfToken: created.csrfToken, expiresAt: created.expiresAt };
      res.setHeader('Set-Cookie', created.cookie);
    }
    req.authSession = { token, tokenHash: hashToken(token), ...record };
    if (record.userId) req.user = { id: record.userId, email: record.email };
    return record;
  };

  const requireCsrf = (req, res) => {
    const origin = req.get('Origin');
    if (origin && !req.app.locals.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: { code: 'CSRF_REJECTED', message: 'The request origin is not allowed.' } });
      return false;
    }
    if (!req.authSession || req.get('X-CSRF-Token') !== req.authSession.csrfToken) {
      res.status(403).json({ error: { code: 'CSRF_REJECTED', message: 'Refresh the page and try again.' } });
      return false;
    }
    return true;
  };

  const attach = async (req, _res, next) => {
    try {
      let token = cookieValue(req.headers.cookie, SESSION_COOKIE);
      if (!token) return next();
      const record = await repository.getSession(hashToken(token));
      if (record) {
        req.authSession = { token, tokenHash: hashToken(token), ...record };
        if (record.userId) req.user = { id: record.userId, email: record.email };
      }
      next();
    } catch (error) { next(error); }
  };

  return {
    attach,
    session: async (req, res, next) => { try { const current = await session(req, res); res.json({ authenticated: Boolean(current.userId), user: current.userId ? { id: current.userId, email: current.email } : null, csrfToken: current.csrfToken }); } catch (error) { next(error); } },
    signIn: [authLimiter, async (req, res, next) => {
      try {
        await session(req, res);
        if (!requireCsrf(req, res)) return;
        const parsed = require('zod').z.object({ email: require('zod').z.string().trim().email().max(254), password: require('zod').z.string().min(12).max(256) }).strict().safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Enter a valid email and password.' } });
        const email = parsed.data.email.toLowerCase();
        const user = await repository.getUserByEmail(email);
        if (!user || !(await passwordMatches(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: { code: 'SIGN_IN_FAILED', message: 'Email or password is incorrect.' } });
        await repository.deleteSession(req.authSession.tokenHash);
        const created = await newSession(repository, user.id, isProduction);
        res.setHeader('Set-Cookie', created.cookie);
        res.json({ authenticated: true, user: { id: user.id, email: user.email }, csrfToken: created.csrfToken });
      } catch (error) { next(error); }
    }],
    signOut: async (req, res, next) => {
      try {
        await session(req, res);
        if (!requireCsrf(req, res)) return;
        if (req.authSession.userId) await repository.deleteSession(req.authSession.tokenHash);
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieOptions(isProduction)}; Max-Age=0`);
        res.json({ authenticated: false });
      } catch (error) { next(error); }
    },
    verifyCsrf: requireCsrf,
  };
}

async function provisionUser(repository, email, password) {
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) throw new Error('Provide a valid email address.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Password must contain 12 to 256 characters.');
  const user = { id: randomUUID(), email: normalizedEmail, passwordHash: await hashPassword(password) };
  await repository.createUser(user);
  return { id: user.id, email: user.email };
}

module.exports = { SESSION_COOKIE, hashPassword, passwordMatches, makeAuth, provisionUser, hashToken };
