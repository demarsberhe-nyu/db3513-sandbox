const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before the server loads. Made-up rows only.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlist-sessions-'));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_DEPLOY = 'true';

const app = require('../server/index');
const { deleteExpiredSessions, saveProfiles, loadProfiles } = require('../server/store');

const FILM_HEADER = 'Date,Name,Year,Letterboxd URI';
const FILE_TEXT = {
  'ratings.csv': `${FILM_HEADER},Rating\n2026-01-01,Alpha,2001,https://boxd.it/a,5`,
  'watched.csv': `${FILM_HEADER}\n2026-01-01,Alpha,2001,https://boxd.it/a`,
  'watchlist.csv': `${FILM_HEADER}\n2026-01-01,Beta,2002,https://boxd.it/b`,
};

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function send(url, cookie, options = {}) {
  return fetch(`${baseUrl}${url}`, { ...options, headers: { ...options.headers, cookie } });
}

function cookieFrom(response) {
  return response.headers.get('set-cookie').split(';')[0];
}

async function newVisitor() {
  return cookieFrom(await send('/api/profiles', ''));
}

function uploadForm(name) {
  const form = new FormData();
  form.append('name', name);
  for (const [fileName, text] of Object.entries(FILE_TEXT)) {
    form.append('files', new Blob([text]), fileName);
  }
  return form;
}

function addProfile(cookie, name) {
  return send('/api/profiles/0', cookie, { method: 'POST', body: uploadForm(name) });
}

async function profilesOf(cookie) {
  const { profiles } = await (await send('/api/profiles', cookie)).json();
  return profiles;
}

test('a visitor cannot see another visitor\'s profile', async () => {
  const alice = await newVisitor();
  const bob = await newVisitor();

  assert.equal((await addProfile(alice, 'Alice')).status, 200);

  assert.equal((await profilesOf(alice))[0].name, 'Alice');
  assert.deepEqual(await profilesOf(bob), [null, null]);
});

test('a visitor cannot delete another visitor\'s profile', async () => {
  const alice = await newVisitor();
  const bob = await newVisitor();
  await addProfile(alice, 'Alice');

  await send('/api/profiles/0', bob, { method: 'DELETE' });

  assert.equal((await profilesOf(alice))[0].name, 'Alice');
});

test('the session cookie is hidden from scripts and only sent over HTTPS', async () => {
  const header = (await send('/api/profiles', '')).headers.get('set-cookie').toLowerCase();

  assert.match(header, /httponly/);
  assert.match(header, /secure/);
  assert.match(header, /samesite=lax/);
});

test('a forged session ID is replaced and cannot reach other files', async () => {
  const response = await send('/api/profiles', 'shortlist_session=../../secrets');

  assert.doesNotMatch(cookieFrom(response), /secrets/);
  assert.deepEqual((await response.json()).profiles, [null, null]);
});

test('sessions past their lifetime are deleted and recent ones are kept', () => {
  const lifetime = 1000;
  saveProfiles(['recent', null], 'a'.repeat(64));

  deleteExpiredSessions(lifetime);
  assert.deepEqual(loadProfiles('a'.repeat(64)), ['recent', null]);

  deleteExpiredSessions(lifetime, Date.now() + lifetime + 1000);
  assert.deepEqual(loadProfiles('a'.repeat(64)), [null, null]);
});

test('searches over the limit are turned away', async () => {
  const cookie = await newVisitor();
  const search = () => send('/api/candidates', cookie, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  for (let i = 0; i < 20; i += 1) await search();

  assert.equal((await search()).status, 429);
});
