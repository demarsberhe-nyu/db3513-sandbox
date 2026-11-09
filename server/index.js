const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;

const app = express();

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

// 127.0.0.1 means only this laptop can reach the app.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`The Shortlist is running at http://localhost:${PORT}`);
});
