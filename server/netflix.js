const { parse } = require('csv-parse/sync');

// Netflix gives no year, so these titles can only be matched by name.
function normalizeTitle(title) {
  return title.normalize('NFC').trim().toLowerCase();
}

// Keeps only unique titles. Dates aren't used, so they are never saved.
function parseNetflixHistory(text) {
  const [header = [], ...rows] = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  const titleColumn = header.indexOf('Title');
  if (titleColumn === -1) {
    throw new Error("It has no Title column, so it doesn't look like NetflixViewingHistory.csv.");
  }

  const titles = new Set(rows.map((row) => normalizeTitle(row[titleColumn] ?? '')));
  titles.delete('');
  if (titles.size === 0) throw new Error('It has no titles in it.');

  return [...titles];
}

module.exports = { parseNetflixHistory, normalizeTitle };
