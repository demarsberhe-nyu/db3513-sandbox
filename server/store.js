const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

// Always two slots: one filled is solo mode, two filled is blend mode.
function loadProfiles() {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [null, null];
    throw error;
  }
}

function saveProfiles(profiles) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles));
}

module.exports = { loadProfiles, saveProfiles };
