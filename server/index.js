const path = require('path');
const express = require('express');
const multer = require('multer');
const { buildProfile, summarizeProfile } = require('./letterboxd');
const { parseNetflixHistory } = require('./netflix');
const { loadProfiles, saveProfiles, deleteExpiredSessions } = require('./store');
const { withSession, SESSION_LIFETIME_MS } = require('./sessions');
const { createTmdbClient } = require('./tmdb');
const { buildCandidates, SERVICES, REGIONS } = require('./candidates');

const PORT = process.env.PORT || 3000;
const MAX_NAME_LENGTH = 40;
const IS_PUBLIC = process.env.PUBLIC_DEPLOY === 'true';
const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

const app = express();

// Uploads are held in memory just long enough to read them.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
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

if (IS_PUBLIC) app.use(['/api/profiles', '/api/candidates'], withSession);

// One counter for the whole app, which caps the load no matter who is sending.
function limitPerMinute(maxRequests) {
  let windowStart = 0;
  let count = 0;

  return (req, res, next) => {
    const now = Date.now();
    if (now - windowStart >= ONE_MINUTE_MS) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    if (count > maxRequests) {
      res.status(429).json({ error: 'The app is busy right now. Try again in a minute.' });
      return;
    }
    next();
  };
}

const limitUploads = limitPerMinute(60);
const limitSearches = limitPerMinute(20);

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
  res.json({ profiles: summarizeAll(loadProfiles(req.sessionId)) });
});

app.post('/api/profiles/:slot', limitUploads, upload.array('files'), (req, res) => {
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

  const profiles = loadProfiles(req.sessionId);
  profiles[slot] = profile;
  saveProfiles(profiles, req.sessionId);
  res.json({ profiles: summarizeAll(profiles) });
});

app.post('/api/profiles/:slot/netflix', limitUploads, upload.single('file'), (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const profiles = loadProfiles(req.sessionId);
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

  saveProfiles(profiles, req.sessionId);
  res.json({ profiles: summarizeAll(profiles) });
});

app.delete('/api/profiles/:slot', (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;

  const profiles = loadProfiles(req.sessionId);
  profiles[slot] = null;
  saveProfiles(profiles, req.sessionId);
  res.json({ profiles: summarizeAll(profiles) });
});

app.get('/api/options', (req, res) => {
  res.json({
    services: SERVICES.map(({ id, name }) => ({ id, name })),
    regions: REGIONS,
  });
});

app.post('/api/candidates', limitSearches, express.json(), async (req, res) => {
  const { services: serviceIds, region } = req.body ?? {};
  const profiles = loadProfiles(req.sessionId);

  if (!profiles.some(Boolean)) {
    res.status(400).json({ error: 'Add a Letterboxd export first.' });
    return;
  }
  if (!Array.isArray(serviceIds) || !SERVICES.some(({ id }) => serviceIds.includes(id))) {
    res.status(400).json({ error: 'Pick at least one streaming service.' });
    return;
  }
  if (!REGIONS.includes(region)) {
    res.status(400).json({ error: 'Pick a region from the list.' });
    return;
  }
  if (!process.env.TMDB_API_TOKEN) {
    res.status(503).json({ error: 'TMDB_API_TOKEN is not set in .env yet.' });
    return;
  }

  const tmdb = createTmdbClient(process.env.TMDB_API_TOKEN);
  try {
    res.json(await buildCandidates({ profiles, serviceIds, region, tmdb }));
  } catch (error) {
    res.status(502).json({ error: error.message });
  } finally {
    tmdb.saveCache();
  }
});

// Turns upload problems, such as an oversized file, into a readable message.
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: `Upload failed: ${error.message}` });
    return;
  }
  next(error);
});

// 127.0.0.1 means only this laptop can reach the app. The public host needs 0.0.0.0.
if (require.main === module) {
  app.listen(PORT, IS_PUBLIC ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`The Shortlist is running on port ${PORT}`);
  });

  if (IS_PUBLIC) {
    deleteExpiredSessions(SESSION_LIFETIME_MS);
    setInterval(() => deleteExpiredSessions(SESSION_LIFETIME_MS), ONE_HOUR_MS);
  }
}

module.exports = app;
