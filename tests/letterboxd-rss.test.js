const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDiaryFeed, normalizeUsername, fetchDiary } = require('../server/letterboxd-rss');
const { mergeDiary } = require('../server/letterboxd');

// Same structure as a real feed checked on 2026-11-09, with made-up films.
function diaryItem({ title, year, date, rating }) {
  const ratingTag = rating ? `<letterboxd:memberRating>${rating}</letterboxd:memberRating>` : '';
  return `<item> <title>${title}, ${year}</title> <link>https://letterboxd.com/sam/film/x/</link>
    <letterboxd:watchedDate>${date}</letterboxd:watchedDate> <letterboxd:rewatch>No</letterboxd:rewatch>
    <letterboxd:filmTitle>${title}</letterboxd:filmTitle> <letterboxd:filmYear>${year}</letterboxd:filmYear>
    ${ratingTag} <tmdb:movieId>1</tmdb:movieId>
    <description><![CDATA[ <p>Watched on ${date}.</p> ]]></description> </item>`;
}

function feed(...items) {
  return `<?xml version='1.0' encoding='utf-8'?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org">
  <channel><title>Letterboxd - Sam</title>${items.join('\n')}</channel></rss>`;
}

const LIST_ITEM = `<item> <title>Favourite heist films</title>
  <link>https://letterboxd.com/sam/list/heists/</link>
  <description><![CDATA[ <p>A list.</p> ]]></description> </item>`;

function film(name, date, rating) {
  const entry = { name, year: '2001', date, uri: 'https://boxd.it/x' };
  return rating === undefined ? entry : { ...entry, rating };
}

function profileWith({ ratings = [], watched = [], watchlist = [] }) {
  return { name: 'Sam', ratings, watched, watchlist, topRated: ratings };
}

test('reads title, year, date and rating from diary entries', () => {
  const diary = parseDiaryFeed(feed(diaryItem({ title: 'Alpha', year: '2001', date: '2026-11-01', rating: '3.5' })));

  assert.deepEqual(diary, [{
    name: 'Alpha',
    year: '2001',
    date: '2026-11-01',
    uri: 'https://letterboxd.com/sam/film/x/',
    rating: 3.5,
  }]);
});

test('gives unrated watches a rating of 0 and skips lists', () => {
  const diary = parseDiaryFeed(feed(diaryItem({ title: 'Alpha', year: '2001', date: '2026-11-01' }), LIST_ITEM));

  assert.equal(diary.length, 1);
  assert.equal(diary[0].rating, 0);
});

test('decodes escaped characters in titles', () => {
  const diary = parseDiaryFeed(feed(diaryItem({ title: 'Fast &amp; Loud &#233;t&#xE9;', year: '2001', date: '2026-11-01' })));

  assert.equal(diary[0].name, 'Fast & Loud été');
});

test('returns no entries for an empty feed', () => {
  assert.deepEqual(parseDiaryFeed(feed()), []);
});

test('accepts a username with or without @ and rejects anything else', () => {
  assert.equal(normalizeUsername(' @sam_99 '), 'sam_99');
  assert.throws(() => normalizeUsername('sam/../admin'), /letters, numbers and underscores/);
  assert.throws(() => normalizeUsername(''), /letters, numbers and underscores/);
});

test('explains when the profile does not exist', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));

  await assert.rejects(fetchDiary('nobody'), /Couldn't find a public Letterboxd profile named nobody/);
});

test('fetches the feed for the given username', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    return new Response(feed(diaryItem({ title: 'Alpha', year: '2001', date: '2026-11-01' })));
  });

  const diary = await fetchDiary('sam');

  assert.deepEqual(requests, ['https://letterboxd.com/sam/rss/']);
  assert.equal(diary[0].name, 'Alpha');
});

test('adds new diary watches and ratings to the profile', () => {
  const profile = profileWith({ ratings: [film('Alpha', '2026-01-01', 4)], watched: [film('Alpha', '2026-01-01')] });

  const merged = mergeDiary(profile, [film('Beta', '2026-11-01', 5), film('Gamma', '2026-11-02', 0)]);

  assert.deepEqual(merged.watched.map((f) => f.name).sort(), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(merged.ratings.map((f) => f.name).sort(), ['Alpha', 'Beta']);
  assert.equal(merged.topRated[0].name, 'Beta');
});

test('a newer diary rating replaces the export rating', () => {
  const profile = profileWith({ ratings: [film('Alpha', '2026-01-01', 2)], watched: [film('Alpha', '2026-01-01')] });

  const merged = mergeDiary(profile, [film('Alpha', '2026-11-01', 4.5)]);

  assert.equal(merged.ratings.length, 1);
  assert.equal(merged.ratings[0].rating, 4.5);
});

test('logging a film takes it off the watchlist', () => {
  const profile = profileWith({ watchlist: [film('Alpha', '2026-01-01'), film('Beta', '2026-01-01')] });

  const merged = mergeDiary(profile, [film('Alpha', '2026-11-01', 0)]);

  assert.deepEqual(merged.watchlist.map((f) => f.name), ['Beta']);
});

test('syncing the same diary twice changes nothing', () => {
  const diary = [film('Beta', '2026-11-01', 5)];
  const once = mergeDiary(profileWith({ watchlist: [film('Beta', '2026-01-01')] }), diary);

  assert.deepEqual(mergeDiary(once, diary), once);
});
