const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { buildProfile, summarizeProfile } = require('../server/letterboxd');

// Made-up rows only. Real exports stay in data/ and out of Git.
const FILM_HEADER = 'Date,Name,Year,Letterboxd URI';
const RATING_HEADER = `${FILM_HEADER},Rating`;

function csvUpload(originalname, lines) {
  return { originalname, buffer: Buffer.from(lines.join('\n')) };
}

function zipUpload(files) {
  const zip = new AdmZip();
  for (const [name, lines] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(lines.join('\n')));
  }
  return { originalname: 'export.zip', buffer: zip.toBuffer() };
}

function exportFiles({ ratings = [], watched = [], watchlist = [] } = {}) {
  return {
    'ratings.csv': [RATING_HEADER, ...ratings],
    'watched.csv': [FILM_HEADER, ...watched],
    'watchlist.csv': [FILM_HEADER, ...watchlist],
  };
}

function rating(name, stars, date = '2026-01-01') {
  return `${date},${name},2001,https://boxd.it/x,${stars}`;
}

test('reads a ZIP export and ignores the deleted/ copies', () => {
  const files = exportFiles({
    ratings: [rating('Alpha', 5)],
    watched: ['2026-01-01,Alpha,2001,https://boxd.it/a'],
    watchlist: ['2026-01-01,Beta,2002,https://boxd.it/b'],
  });
  files['deleted/ratings.csv'] = [RATING_HEADER, rating('Deleted Film', 5)];

  const profile = buildProfile('Sam', [zipUpload(files)]);

  assert.deepEqual(profile.ratings.map((film) => film.name), ['Alpha']);
  assert.equal(profile.watchlist.length, 1);
});

test('reads loose CSV files as well as a ZIP', () => {
  const uploads = Object.entries(exportFiles({ ratings: [rating('Alpha', 4)] })).map(
    ([name, lines]) => csvUpload(name, lines),
  );

  assert.equal(buildProfile('Sam', uploads).ratings.length, 1);
});

test('keeps same-titled films from different years separate', () => {
  const watched = [
    '2026-01-01,The Thing,1951,https://boxd.it/a',
    '2026-01-01,The Thing,1982,https://boxd.it/b',
  ];

  assert.equal(buildProfile('Sam', [zipUpload(exportFiles({ watched }))]).watched.length, 2);
});

test('counts a repeated film once and keeps its newest rating', () => {
  const ratings = [rating('Alpha', 2, '2025-01-01'), rating('Alpha', 5, '2026-01-01')];
  const profile = buildProfile('Sam', [zipUpload(exportFiles({ ratings }))]);

  assert.equal(profile.ratings.length, 1);
  assert.equal(profile.ratings[0].rating, 5);
});

test('reads titles that contain commas', () => {
  const watched = ['2026-01-01,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/a'];
  const profile = buildProfile('Sam', [zipUpload(exportFiles({ watched }))]);

  assert.equal(profile.watched[0].name, 'Crouching Tiger, Hidden Dragon');
});

test('treats a rated film as watched even if watched.csv omits it', () => {
  const profile = buildProfile('Sam', [zipUpload(exportFiles({ ratings: [rating('Alpha', 3)] }))]);

  assert.deepEqual(profile.watched.map((film) => film.name), ['Alpha']);
});

test('top-rated uses the 4-star cutoff when at least 10 films qualify', () => {
  const ratings = [
    ...Array.from({ length: 12 }, (_, i) => rating(`Great ${i}`, 4)),
    rating('Okay', 3.5),
  ];
  const profile = buildProfile('Sam', [zipUpload(exportFiles({ ratings }))]);

  assert.equal(profile.topRated.length, 12);
  assert.ok(!profile.topRated.some((film) => film.name === 'Okay'));
});

test('top-rated falls back to the 10 highest when too few reach 4 stars', () => {
  const ratings = [
    rating('Best', 4.5),
    ...Array.from({ length: 14 }, (_, i) => rating(`Fine ${i}`, 3)),
  ];
  const profile = buildProfile('Sam', [zipUpload(exportFiles({ ratings }))]);

  assert.equal(profile.topRated.length, 10);
  assert.equal(profile.topRated[0].name, 'Best');
});

test('handles a byte order mark at the start of a file', () => {
  const files = exportFiles({ ratings: [rating('Alpha', 4)] });
  files['ratings.csv'][0] = `﻿${files['ratings.csv'][0]}`;

  assert.equal(buildProfile('Sam', [zipUpload(files)]).ratings.length, 1);
});

test('names the file when one is missing', () => {
  const files = exportFiles();
  delete files['watchlist.csv'];

  assert.throws(() => buildProfile('Sam', [zipUpload(files)]), /watchlist\.csv/);
});

test('names the column when a header is wrong', () => {
  const files = exportFiles();
  files['ratings.csv'] = [FILM_HEADER];

  assert.throws(() => buildProfile('Sam', [zipUpload(files)]), /ratings\.csv.*Rating/);
});

test('the summary sends at most 10 films to the browser', () => {
  const ratings = Array.from({ length: 15 }, (_, i) => rating(`Great ${i}`, 5));
  const summary = summarizeProfile(buildProfile('Sam', [zipUpload(exportFiles({ ratings }))]));

  assert.equal(summary.topRated.length, 10);
  assert.equal(summary.topRatedCount, 15);
});
