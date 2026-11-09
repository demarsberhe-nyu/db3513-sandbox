const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

// Always two slots: one filled is solo mode, two filled is blend mode.
function loadProfiles() {
  return readJson(PROFILES_FILE, [null, null]);
}

function saveProfiles(profiles) {
  writeJson(PROFILES_FILE, profiles);
}

function loadTmdbCache() {
  return readJson(TMDB_CACHE_FILE, {});
}

function saveTmdbCache(cache) {
  writeJson(TMDB_CACHE_FILE, cache);
}

module.exports = { loadProfiles, saveProfiles, loadTmdbCache, saveTmdbCache };
