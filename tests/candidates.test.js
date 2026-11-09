const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCandidates,
  MAX_CANDIDATES_CHECKED,
  TOP_RATED_PER_PERSON,
} = require('../server/candidates');

// Made-up films and a pretend TMDB, so these tests never touch the network.
const NETFLIX = 8;
const HULU = 15;

function fakeTmdb(movies, recommendations = {}) {
  const calls = { recommendations: [], details: [] };
  const summary = ({ id, title, originalTitle = title, year }) => ({ id, title, originalTitle, year });

  return {
    calls,
    async searchMovie(name, year) {
      const movie = movies.find((m) => m.title === name && m.year === year);
      return movie ? summary(movie) : null;
    },
    async getRecommendations(id) {
      calls.recommendations.push(id);
      return (recommendations[id] ?? []).map((movieId) =>
        summary(movies.find((m) => m.id === movieId)),
      );
    },
    async getDetails(id) {
      calls.details.push(id);
      const movie = movies.find((m) => m.id === id);
      return {
        ...summary(movie),
        status: movie.status ?? 'Released',
        runtime: 100,
        posterPath: '/p.jpg',
        overview: '',
        genres: [],
        providersByRegion: movie.providers ?? { US: [NETFLIX] },
      };
    },
  };
}

function film(name, year) {
  return { name, year };
}

function person(name, overrides = {}) {
  return { name, watched: [], watchlist: [], topRated: [], ...overrides };
}

function run(tmdb, people, options = {}) {
  return buildCandidates({
    profiles: people,
    serviceIds: ['netflix'],
    region: 'US',
    tmdb,
    ...options,
  });
}

const alpha = { id: 1, title: 'Alpha', year: '2001' };
const beta = { id: 2, title: 'Beta', year: '2002' };

test('keeps a watchlist film that is on a selected service', async () => {
  const { candidates } = await run(fakeTmdb([alpha]), [person('Sam', { watchlist: [film('Alpha', '2001')] })]);

  assert.deepEqual(candidates.map((c) => c.title), ['Alpha']);
  assert.deepEqual(candidates[0].services, ['Netflix']);
});

test('drops a film that is only on a service nobody selected', async () => {
  const movie = { ...alpha, providers: { US: [HULU] } };
  const { candidates, stats } = await run(fakeTmdb([movie]), [person('Sam', { watchlist: [film('Alpha', '2001')] })]);

  assert.equal(candidates.length, 0);
  assert.equal(stats.notAvailable, 1);
});

test('drops a film that is only available in another region', async () => {
  const movie = { ...alpha, providers: { GB: [NETFLIX] } };
  const { candidates } = await run(fakeTmdb([movie]), [person('Sam', { watchlist: [film('Alpha', '2001')] })]);

  assert.equal(candidates.length, 0);
});

test('drops a film that has not been released', async () => {
  const movie = { ...alpha, status: 'Post Production' };
  const { candidates } = await run(fakeTmdb([movie]), [person('Sam', { watchlist: [film('Alpha', '2001')] })]);

  assert.equal(candidates.length, 0);
});

test('never recommends a film the other person in the blend has watched', async () => {
  const people = [
    person('Sam', { watchlist: [film('Alpha', '2001')] }),
    person('Kai', { watched: [film('Alpha', '2001')] }),
  ];
  const { candidates, stats } = await run(fakeTmdb([alpha]), people);

  assert.equal(candidates.length, 0);
  assert.equal(stats.watchedOnLetterboxd, 1);
});

test('never recommends a watched film that arrives as a recommendation', async () => {
  const favorite = { id: 3, title: 'Favorite', year: '2000' };
  const people = [
    person('Sam', { topRated: [film('Favorite', '2000')], watched: [film('Alpha', '2001')] }),
  ];
  const { candidates } = await run(fakeTmdb([alpha, beta, favorite], { 3: [1, 2] }), people);

  assert.deepEqual(candidates.map((c) => c.title), ['Beta']);
});

test('a same-titled film from a different year is not treated as watched', async () => {
  const remake = { id: 4, title: 'Alpha', year: '2020' };
  const people = [
    person('Sam', { watchlist: [film('Alpha', '2020')], watched: [film('Alpha', '2001')] }),
  ];
  const { candidates } = await run(fakeTmdb([remake]), people);

  assert.deepEqual(candidates.map((c) => c.year), ['2020']);
});

test('a Netflix title rules out the film in any year', async () => {
  const people = [
    person('Sam', { watchlist: [film('Alpha', '2001')], netflixTitles: ['alpha'] }),
  ];
  const { candidates, stats } = await run(fakeTmdb([alpha]), people);

  assert.equal(candidates.length, 0);
  assert.equal(stats.watchedOnNetflix, 1);
});

test('a Netflix title also matches a film by its original title', async () => {
  const movie = { id: 5, title: 'English Name', originalTitle: 'Nom Original', year: '2010' };
  const favorite = { id: 3, title: 'Favorite', year: '2000' };
  const people = [person('Sam', { topRated: [film('Favorite', '2000')], netflixTitles: ['nom original'] })];
  const { candidates } = await run(fakeTmdb([movie, favorite], { 3: [5] }), people);

  assert.equal(candidates.length, 0);
});

test('TV episode rows in Netflix history do not rule out a movie', async () => {
  const people = [
    person('Sam', { watchlist: [film('Alpha', '2001')], netflixTitles: ['alpha: season 1: pilot'] }),
  ];
  const { candidates } = await run(fakeTmdb([alpha]), people);

  assert.equal(candidates.length, 1);
});

test('counts films TMDB could not match', async () => {
  const { stats } = await run(fakeTmdb([]), [person('Sam', { watchlist: [film('Unknown', '1999')] })]);

  assert.equal(stats.unmatched, 1);
});

test('a film on both watchlists appears once and credits both people', async () => {
  const people = [
    person('Sam', { watchlist: [film('Alpha', '2001')] }),
    person('Kai', { watchlist: [film('Alpha', '2001')] }),
  ];
  const { candidates } = await run(fakeTmdb([alpha]), people);

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].sources.map((s) => s.person), ['Sam', 'Kai']);
});

test('uses at most 15 top-rated films per person', async () => {
  assert.equal(TOP_RATED_PER_PERSON, 15);
  const movies = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Film ${i}`, year: '2000' }));
  const tmdb = fakeTmdb(movies);
  await run(tmdb, [person('Sam', { topRated: movies.map((m) => film(m.title, m.year)) })]);

  assert.equal(tmdb.calls.recommendations.length, 15);
});

test('checks at most 100 candidates, with watchlist films first', async () => {
  assert.equal(MAX_CANDIDATES_CHECKED, 100);
  const onWatchlist = Array.from({ length: 95 }, (_, i) => ({ id: i + 1, title: `Listed ${i}`, year: '2000' }));
  const others = Array.from({ length: 20 }, (_, i) => ({ id: 200 + i, title: `Other ${i}`, year: '2000' }));
  const favorite = { id: 500, title: 'Favorite', year: '1999' };
  const tmdb = fakeTmdb([...onWatchlist, ...others, favorite], { 500: others.map((m) => m.id) });
  const people = [
    person('Sam', {
      watchlist: onWatchlist.map((m) => film(m.title, m.year)),
      topRated: [film('Favorite', '1999')],
    }),
  ];
  const { stats } = await run(tmdb, people);

  assert.equal(stats.checked, 100);
  assert.equal(onWatchlist.filter((m) => tmdb.calls.details.includes(m.id)).length, 95);
});
