const test = require('node:test');
const assert = require('node:assert/strict');
const { createTmdbClient } = require('../server/tmdb');

// Replaces the network with canned replies, and records every request made.
function stubFetch(t, replies) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  });
  return requests;
}

function movie(title, releaseDate, originalTitle = title) {
  return { id: 1, title, original_title: originalTitle, release_date: releaseDate };
}

test('matches a film by both title and year', async (t) => {
  stubFetch(t, [{ body: { results: [movie('Alpha', '2001-05-01')] } }]);

  const match = await createTmdbClient('token', {}).searchMovie('Alpha', '2001');

  assert.equal(match.title, 'Alpha');
});

test('does not match when the year differs', async (t) => {
  stubFetch(t, [{ body: { results: [movie('Alpha', '2020-05-01')] } }]);

  assert.equal(await createTmdbClient('token', {}).searchMovie('Alpha', '2001'), null);
});

test('does not match a different title from the same year', async (t) => {
  stubFetch(t, [{ body: { results: [movie('Alpha Returns', '2001-05-01')] } }]);

  assert.equal(await createTmdbClient('token', {}).searchMovie('Alpha', '2001'), null);
});

test('ignores punctuation and case when comparing titles', async (t) => {
  stubFetch(t, [{ body: { results: [movie('WALL·E', '2008-06-22')] } }]);

  assert.ok(await createTmdbClient('token', {}).searchMovie('Wall-E', '2008'));
});

test('sends the token in a header and never in the URL', async (t) => {
  const requests = stubFetch(t, [{ body: { results: [] } }]);

  await createTmdbClient('secret-token', {}).searchMovie('Alpha', '2001');

  assert.ok(!requests[0].url.includes('secret-token'));
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-token');
});

test('a rejected token gives a clear error without repeating the token', async (t) => {
  stubFetch(t, [{ status: 401 }]);

  await assert.rejects(
    createTmdbClient('secret-token', {}).searchMovie('Alpha', '2001'),
    (error) => /TMDB_API_TOKEN/.test(error.message) && !error.message.includes('secret-token'),
  );
});

test('retries after being rate limited', async (t) => {
  const requests = stubFetch(t, [
    { status: 429, headers: { 'retry-after': '0' } },
    { body: { results: [movie('Alpha', '2001-05-01')] } },
  ]);

  assert.ok(await createTmdbClient('token', {}).searchMovie('Alpha', '2001'));
  assert.equal(requests.length, 2);
});

test('a repeat lookup is answered from the cache', async (t) => {
  const requests = stubFetch(t, [{ body: { results: [] } }]);
  const client = createTmdbClient('token', {});

  await client.getRecommendations(1);
  await client.getRecommendations(1);

  assert.equal(requests.length, 1);
});

test('a cache entry older than a day is fetched again', async (t) => {
  const requests = stubFetch(t, [{ body: { results: [] } }]);
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const client = createTmdbClient('token', { 'recommendations:1': { savedAt: twoDaysAgo, value: [] } });

  await client.getRecommendations(1);

  assert.equal(requests.length, 1);
});

test('keeps only subscription streaming, not rent or buy', async (t) => {
  stubFetch(t, [{
    body: {
      ...movie('Alpha', '2001-05-01'),
      status: 'Released',
      runtime: 100,
      genres: [{ name: 'Drama' }],
      'watch/providers': {
        results: { US: { flatrate: [{ provider_id: 8 }], rent: [{ provider_id: 2 }] } },
      },
    },
  }]);

  const details = await createTmdbClient('token', {}).getDetails(1);

  assert.deepEqual(details.providersByRegion, { US: [8] });
});
