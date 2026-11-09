const path = require('path');
const express = require('express');
const multer = require('multer');
const { buildProfile, summarizeProfile } = require('./letterboxd');
const { parseNetflixHistory } = require('./netflix');
const { loadProfiles, saveProfiles } = require('./store');

const PORT = process.env.PORT || 3000;
const MAX_NAME_LENGTH = 40;

const app = express();

// Uploads are held in memory just long enough to read them.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

// Everything in public/ is sent to the browser, so secrets must never go there.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Reports only whether each key is set, never the key itself.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    keys: {
      tmdb: Boolean(process.env.TMDB_API_TOKEN),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      model: Boolean(process.env.ANTHROPIC_MODEL),
    },
  });
});

function summarizeAll(profiles) {
  return profiles.map((profile) => (profile ? summarizeProfile(profile) : null));
}

function parseSlot(req, res) {
  const slot = Number(req.params.slot);
  if (slot === 0 || slot === 1) return slot;
  res.status(404).json({ error: 'Unknown person.' });
  return null;
}

app.get('/api/profiles', (req, res) => {
  res.json({ profiles: summarizeAll(loadProfiles()) });
});

app.post('/api/profiles/:slot', upload.array('files'), (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const name = (req.body.name || '').trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    res.status(400).json({ error: `Enter a name of 1 to ${MAX_NAME_LENGTH} characters.` });
    return;
  }
  if (!req.files || req.files.length === 0) {
    res.status(400).json({ error: 'Choose your Letterboxd ZIP or CSV files first.' });
    return;
  }

  let profile;
  try {
    profile = buildProfile(name, req.files);
  } catch (error) {
    res.status(400).json({ error: `Couldn't read that export. ${error.message}` });
    return;
  }

  const profiles = loadProfiles();
  profiles[slot] = profile;
  saveProfiles(profiles);
  res.json({ profiles: summarizeAll(profiles) });
});

app.post('/api/profiles/:slot/netflix', upload.single('file'), (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const profiles = loadProfiles();
  if (!profiles[slot]) {
    res.status(404).json({ error: 'Add a Letterboxd export for this person first.' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Choose your NetflixViewingHistory.csv file first.' });
    return;
  }

  try {
    profiles[slot].netflixTitles = parseNetflixHistory(req.file.buffer.toString('utf8'));
  } catch (error) {
    res.status(400).json({ error: `Couldn't read that file. ${error.message}` });
    return;
  }

  saveProfiles(profiles);
  res.json({ profiles: summarizeAll(profiles) });
});

app.delete('/api/profiles/:slot', (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const profiles = loadProfiles();
  profiles[slot] = null;
  saveProfiles(profiles);
  res.json({ profiles: summarizeAll(profiles) });
});

// Turns upload problems, such as an oversized file, into a readable message.
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: `Upload failed: ${error.message}` });
    return;
  }
  next(error);
});

// 127.0.0.1 means only this laptop can reach the app.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`The Shortlist is running at http://localhost:${PORT}`);
});
