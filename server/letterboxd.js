const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');

const TOP_RATED_CUTOFF = 4;
const TOP_RATED_MINIMUM = 10;

// Confirmed against a real Letterboxd export on 2026-11-08.
const EXPECTED_COLUMNS = {
  'ratings.csv': ['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'],
  'watched.csv': ['Date', 'Name', 'Year', 'Letterboxd URI'],
  'watchlist.csv': ['Date', 'Name', 'Year', 'Letterboxd URI'],
};

// Accepts the ZIP, the loose CSVs, or a mix, and ignores every other file.
function collectCsvText(uploads) {
  const csvText = {};

  for (const upload of uploads) {
    const fileName = path.basename(upload.originalname).toLowerCase();

    if (fileName.endsWith('.zip')) {
      const zip = new AdmZip(upload.buffer);
      for (const expectedName of Object.keys(EXPECTED_COLUMNS)) {
        // Top-level entries only, so deleted/ and orphaned/ copies are skipped.
        const entry = zip.getEntry(expectedName);
        if (entry) csvText[expectedName] = entry.getData().toString('utf8');
      }
    } else if (Object.hasOwn(EXPECTED_COLUMNS, fileName)) {
      csvText[fileName] = upload.buffer.toString('utf8');
    }
  }

  return csvText;
}

function readRows(text, fileName) {
  const [header = [], ...rows] = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  const missing = EXPECTED_COLUMNS[fileName].filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`${fileName} is missing the column(s): ${missing.join(', ')}`);
  }

  return rows.map((row) => Object.fromEntries(header.map((column, i) => [column, row[i] ?? ''])));
}

// Two films can share a title, so a film is always identified by title + year.
function filmKey(film) {
  return `${film.name.normalize('NFC').toLowerCase()}|${film.year}`;
}

function toFilm(row) {
  return {
    name: row.Name.trim(),
    year: row.Year.trim(),
    date: row.Date.trim(),
    uri: row['Letterboxd URI'].trim(),
  };
}

// Repeated rows count once, and the most recent row wins.
function dedupeFilms(films) {
  const byKey = new Map();
  for (const film of films) {
    const existing = byKey.get(filmKey(film));
    if (!existing || film.date >= existing.date) byKey.set(filmKey(film), film);
  }
  return [...byKey.values()];
}

function pickTopRated(ratings) {
  const sorted = [...ratings].sort(
    (a, b) => b.rating - a.rating || b.date.localeCompare(a.date),
  );
  const aboveCutoff = sorted.filter((film) => film.rating >= TOP_RATED_CUTOFF);
  return aboveCutoff.length >= TOP_RATED_MINIMUM
    ? aboveCutoff
    : sorted.slice(0, TOP_RATED_MINIMUM);
}

function buildProfile(name, uploads) {
  const csvText = collectCsvText(uploads);

  const missingFiles = Object.keys(EXPECTED_COLUMNS).filter((fileName) => !(fileName in csvText));
  if (missingFiles.length > 0) {
    throw new Error(`Couldn't find ${missingFiles.join(', ')} in what you uploaded.`);
  }

  const filmsFrom = (fileName) =>
    readRows(csvText[fileName], fileName)
      .filter((row) => row.Name.trim())
      .map((row) => ({ ...toFilm(row), rating: Number.parseFloat(row.Rating) }));

  const ratings = dedupeFilms(filmsFrom('ratings.csv').filter((film) => film.rating > 0));
  const stripRating = ({ rating, ...film }) => film;
  const watchlist = dedupeFilms(filmsFrom('watchlist.csv').map(stripRating));

  // Rating a film means you've seen it, even if watched.csv doesn't list it.
  const watched = dedupeFilms([
    ...filmsFrom('watched.csv').map(stripRating),
    ...ratings.map(stripRating),
  ]);

  return { name, ratings, watched, watchlist, topRated: pickTopRated(ratings) };
}

// The small version of a profile that the browser needs for the setup screen.
function summarizeProfile(profile) {
  return {
    name: profile.name,
    ratedCount: profile.ratings.length,
    watchedCount: profile.watched.length,
    watchlistCount: profile.watchlist.length,
    topRatedCount: profile.topRated.length,
    netflixTitleCount: profile.netflixTitles?.length ?? 0,
    topRated: profile.topRated.slice(0, TOP_RATED_MINIMUM).map(({ name, year, rating }) => ({
      name,
      year,
      rating,
    })),
  };
}

module.exports = { buildProfile, summarizeProfile, filmKey };
