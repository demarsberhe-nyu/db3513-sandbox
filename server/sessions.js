const crypto = require('crypto');

const COOKIE_NAME = 'shortlist_session';
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const VALID_SESSION_ID = /^[0-9a-f]{64}$/;

// The ID becomes a file name, so anything but the exact format is thrown away.
function readSessionId(cookieHeader = '') {
  for (const pair of cookieHeader.split(';')) {
    const [name, value] = pair.trim().split('=');
    if (name === COOKIE_NAME && VALID_SESSION_ID.test(value)) return value;
  }
  return null;
}

// Gives each browser its own private profiles on the public site.
function withSession(req, res, next) {
  req.sessionId = readSessionId(req.headers.cookie) ?? crypto.randomBytes(32).toString('hex');
  res.cookie(COOKIE_NAME, req.sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: SESSION_LIFETIME_MS,
  });
  next();
}

module.exports = { withSession, SESSION_LIFETIME_MS };
