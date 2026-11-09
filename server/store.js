const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const TMDB_CACHE_FILE = path.join(DATA_DIR, 'tmdb-cache.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

// Local runs have no session, so they keep using the single profiles file.
function profilesFile(sessionId) {
  return sessionId ? path.join(SESSIONS_DIR, `${sessionId}.json`) : PROFILES_FILE;
}

// Always two slots: one filled is solo mode, two filled is blend mode.
function loadProfiles(sessionId) {
  return readJson(profilesFile(sessionId), [null, null]);
}

function saveProfiles(profiles, sessionId) {
  writeJson(profilesFile(sessionId), profiles);
}

function deleteExpiredSessions(lifetimeMs, now = Date.now()) {
  if (!fs.existsSync(SESSIONS_DIR)) return;

  for (const name of fs.readdirSync(SESSIONS_DIR)) {
    const file = path.join(SESSIONS_DIR, name);
    if (now - fs.statSync(file).mtimeMs > lifetimeMs) fs.rmSync(file, { force: true });
  }
}

function loadTmdbCache() {
  return readJson(TMDB_CACHE_FILE, {});
}

function saveTmdbCache(cache) {
  writeJson(TMDB_CACHE_FILE, cache);
}

module.exports = {
  loadProfiles,
  saveProfiles,
  deleteExpiredSessions,
  loadTmdbCache,
  saveTmdbCache,
};
