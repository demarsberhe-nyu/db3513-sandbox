const test = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const { buildShortlist, MOODS } = require('../server/shortlist');

// Made-up films and a pretend Claude, so these tests never touch the network or cost money.
function film(id, sources = [{ type: 'watchlist', person: 'Sam' }]) {
  return { id, title: `Film ${id}`, year: '2001', genres: ['Drama'], runtime: 100, overview: 'Text', sources };
}

const CANDIDATES = Array.from({ length: 12 }, (_, index) => film(index + 1));
const SAM = { name: 'Sam', topRated: [{ name: 'Alpha', year: '1999', rating: 5, date: '2026-01-01', uri: 'x' }] };
const ALEX = { name: 'Alex', topRated: [] };

function slotNames(count) {
  return Array.from({ length: count }, (_, index) => `pick${index + 1}`);
}

function slots(picks) {
  const names = slotNames(picks.length);
  return Object.fromEntries(picks.map((pick, index) => [names[index], pick]));
}

function reply(picks, overrides = {}) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(slots(picks)) }],
    ...overrides,
  };
}

function fakeClaude(response) {
  const claude = {
    requests: [],
    beta: {
      messages: {
        async create(request) {
          claude.requests.push(request);
          const next = Array.isArray(response) ? response.shift() : response;
          if (next instanceof Error) throw next;
          return next;
        },
      },
    },
  };
  return claude;
}

function pick(id) {
  return { id, why: `A reason for film ${id}.` };
}

// Ranked in reverse, so the tests can tell Claude's order from the candidates' order.
const SIX_PICKS = [6, 5, 4, 3, 2, 1].map(pick);
const MADE_UP = { id: 999, why: 'A made up film.' };
const PLACEHOLDER = { id: 11, why: 'x' };

function shortlist(claude, overrides = {}) {
  return buildShortlist({
    candidates: CANDIDATES,
    people: [SAM],
    mood: 'light',
    model: 'test-model',
    claude,
    ...overrides,
  });
}

test('returns six picks in the order Claude ranked them', async () => {
  const picks = await shortlist(fakeClaude(reply(SIX_PICKS)));

  assert.deepEqual(picks.map(({ id }) => id), [6, 5, 4, 3, 2, 1]);
  assert.equal(picks[0].title, 'Film 6');
  assert.equal(picks[0].why, 'A reason for film 6.');
});

test('sends the mood, taste and candidates, and asks for six structured picks', async () => {
  const claude = fakeClaude(reply(SIX_PICKS));
  await shortlist(claude);

  const [request] = claude.requests;
  const { content } = request.messages[0];
  const sent = JSON.parse(content.slice(content.indexOf('{')));
  assert.match(content, /exactly 6 films/);
  assert.equal(request.model, 'test-model');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.deepEqual(request.output_config.format.schema.required, slotNames(6));
  assert.equal(sent.mood, MOODS.find(({ id }) => id === 'light').name);
  assert.deepEqual(sent.viewers[0].topRated, [{ name: 'Alpha', year: '1999', rating: 5 }]);
  assert.equal(sent.candidates.length, 12);
});

test('asks for at least two films from outside the watchlist', async () => {
  const claude = fakeClaude(reply(SIX_PICKS));
  await shortlist(claude);

  assert.match(claude.requests[0].system, /at least 2 films whose sources are all "recommended"/);
});

test('drops a film that was not in the candidate list and keeps the rest', async () => {
  const claude = fakeClaude(reply([MADE_UP, ...SIX_PICKS.slice(1)]));
  const picks = await shortlist(claude);

  assert.equal(picks.length, 5);
  assert.ok(picks.every(({ id }) => id !== 999));
  assert.equal(claude.requests.length, 1);
});

test('drops a repeated film and keeps its first appearance', async () => {
  const picks = await shortlist(fakeClaude(reply([...SIX_PICKS.slice(0, 5), SIX_PICKS[0]])));

  assert.equal(picks.length, 5);
  assert.equal(picks.filter(({ id }) => id === 6).length, 1);
});

test('drops a placeholder reason', async () => {
  const picks = await shortlist(fakeClaude(reply([PLACEHOLDER, ...SIX_PICKS.slice(0, 5)])));

  assert.deepEqual(picks.map(({ id }) => id), [6, 5, 4, 3, 2]);
});

test('drops a blank reason', async () => {
  const blank = { id: 12, why: '   ' };
  const picks = await shortlist(fakeClaude(reply([blank, ...SIX_PICKS.slice(0, 5)])));

  assert.deepEqual(picks.map(({ id }) => id), [6, 5, 4, 3, 2]);
});

test('retries when fewer than five picks are valid', async () => {
  const bad = reply([MADE_UP, PLACEHOLDER, ...SIX_PICKS.slice(0, 4)]);
  const claude = fakeClaude([bad, reply(SIX_PICKS)]);
  const picks = await shortlist(claude);

  assert.equal(claude.requests.length, 2);
  assert.equal(picks.length, 6);
});

test('accepts exactly five valid picks without retrying', async () => {
  const claude = fakeClaude(reply([MADE_UP, ...SIX_PICKS.slice(0, 5)]));
  const picks = await shortlist(claude);

  assert.equal(claude.requests.length, 1);
  assert.equal(picks.length, 5);
});

test('gives up after two answers with too few valid picks', async () => {
  const claude = fakeClaude(reply(SIX_PICKS.slice(0, 4)));

  await assert.rejects(shortlist(claude), /invalid shortlist/);
  assert.equal(claude.requests.length, 2);
});

test('with few candidates, asks for all of them and needs all of them', async () => {
  const candidates = [film(1), film(2), film(3)];
  const good = fakeClaude(reply([pick(1), pick(2), pick(3)]));

  assert.equal((await shortlist(good, { candidates })).length, 3);
  assert.deepEqual(good.requests[0].output_config.format.schema.required, slotNames(3));

  const bad = fakeClaude(reply([pick(1), pick(2), MADE_UP]));
  await assert.rejects(shortlist(bad, { candidates }), /invalid shortlist/);
});

test('asks for one pick when there is one candidate', async () => {
  const claude = fakeClaude(reply([{ id: 1, why: 'The only option.' }]));
  const picks = await shortlist(claude, { candidates: [film(1)] });

  assert.equal(picks.length, 1);
  assert.match(claude.requests[0].system, /pick the 1 /);
  assert.match(claude.requests[0].system, /at least 1 films/);
});

test('does not call Claude when there are no candidates', async () => {
  const claude = fakeClaude(reply([]));

  assert.deepEqual(await shortlist(claude, { candidates: [] }), []);
  assert.equal(claude.requests.length, 0);
});

test('a rejected key is not retried', async () => {
  const error = new Anthropic.AuthenticationError(401, {}, 'invalid', new Headers());
  const claude = fakeClaude(error);

  await assert.rejects(shortlist(claude), /ANTHROPIC_API_KEY/);
  assert.equal(claude.requests.length, 1);
});

test('solo mode has no yours-or-mine label', async () => {
  const [first] = await shortlist(fakeClaude(reply(SIX_PICKS)));

  assert.equal(first.label, null);
});

test('blend mode labels a pick by whose taste it came from', async () => {
  const shared = [
    { type: 'watchlist', person: 'Sam' },
    { type: 'recommended', person: 'Alex', because: 'Beta' },
  ];
  const candidates = [film(1), film(2, shared), film(3, [{ type: 'watchlist', person: 'Alex' }])];
  const picks = await shortlist(fakeClaude(reply([pick(1), pick(2), pick(3)])), {
    candidates,
    people: [SAM, ALEX],
  });

  assert.deepEqual(picks.map(({ label }) => label), ["Sam's pick", 'Both of you', "Alex's pick"]);
});

test('a refusal gives a clear error instead of an empty shortlist', async () => {
  const response = reply([], { stop_reason: 'refusal', content: [] });

  await assert.rejects(shortlist(fakeClaude(response)), /couldn't finish/);
});

test('a cut-off answer gives a clear error', async () => {
  const response = { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"pick1":' }] };

  await assert.rejects(shortlist(fakeClaude(response)), /couldn't finish/);
});

test('an unreadable answer gives a clear error', async () => {
  const response = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] };

  await assert.rejects(shortlist(fakeClaude(response)), /unreadable/);
});

test('a rejected key gives a clear error without repeating the API message', async () => {
  const error = new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key secret-detail', new Headers());

  await assert.rejects(shortlist(fakeClaude(error)), (thrown) => {
    assert.match(thrown.message, /ANTHROPIC_API_KEY/);
    assert.doesNotMatch(thrown.message, /secret-detail/);
    return true;
  });
});

test('a rate limit asks the user to try again', async () => {
  const error = new Anthropic.RateLimitError(429, {}, 'slow down', new Headers());

  await assert.rejects(shortlist(fakeClaude(error)), /Try again in a minute/);
});
