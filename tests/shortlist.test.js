const test = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const { buildShortlist, MOODS } = require('../server/shortlist');

// Made-up films and a pretend Claude, so these tests never touch the network or cost money.
function film(id, sources = [{ type: 'watchlist', person: 'Sam' }]) {
  return { id, title: `Film ${id}`, year: '2001', genres: ['Drama'], runtime: 100, overview: 'Text', sources };
}

const CANDIDATES = [film(1), film(2), film(3), film(4)];
const SAM = { name: 'Sam', topRated: [{ name: 'Alpha', year: '1999', rating: 5, date: '2026-01-01', uri: 'x' }] };
const ALEX = { name: 'Alex', topRated: [] };

function slots(picks) {
  return Object.fromEntries(picks.map((pick, index) => [['first', 'second', 'third'][index], pick]));
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

const THREE_PICKS = [
  { id: 3, why: 'Because you loved Alpha.' },
  { id: 1, why: 'It is on your watchlist.' },
  { id: 2, why: 'A quiet drama like Alpha.' },
];

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

test('returns three picks in the order Claude ranked them', async () => {
  const picks = await shortlist(fakeClaude(reply(THREE_PICKS)));

  assert.deepEqual(picks.map((pick) => pick.id), [3, 1, 2]);
  assert.equal(picks[0].title, 'Film 3');
  assert.equal(picks[0].why, 'Because you loved Alpha.');
});

test('sends the mood, taste and candidates, and asks for structured output', async () => {
  const claude = fakeClaude(reply(THREE_PICKS));
  await shortlist(claude);

  const [request] = claude.requests;
  const { content } = request.messages[0];
  const sent = JSON.parse(content.slice(content.indexOf('{')));
  assert.match(content, /exactly 3 films/);
  assert.equal(request.model, 'test-model');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.deepEqual(request.output_config.format.schema.required, ['first', 'second', 'third']);
  assert.equal(sent.mood, MOODS.find(({ id }) => id === 'light').name);
  assert.deepEqual(sent.viewers[0].topRated, [{ name: 'Alpha', year: '1999', rating: 5 }]);
  assert.deepEqual(sent.candidates.map(({ id }) => id), [1, 2, 3, 4]);
});

test('rejects a film that was not in the candidate list', async () => {
  const picks = [...THREE_PICKS.slice(0, 2), { id: 999, why: 'Made up.' }];

  await assert.rejects(shortlist(fakeClaude(reply(picks))), /invalid shortlist/);
});

test('rejects the same film picked twice', async () => {
  const picks = [THREE_PICKS[0], THREE_PICKS[0], THREE_PICKS[1]];

  await assert.rejects(shortlist(fakeClaude(reply(picks))), /invalid shortlist/);
});

test('rejects a pick with a blank reason', async () => {
  const picks = [...THREE_PICKS.slice(0, 2), { id: 2, why: '   ' }];

  await assert.rejects(shortlist(fakeClaude(reply(picks))), /invalid shortlist/);
});

test('rejects a placeholder reason', async () => {
  const picks = [...THREE_PICKS.slice(0, 2), { id: 2, why: 'x' }];

  await assert.rejects(shortlist(fakeClaude(reply(picks))), /invalid shortlist/);
});

test('rejects the wrong number of picks', async () => {
  await assert.rejects(shortlist(fakeClaude(reply(THREE_PICKS.slice(0, 2)))), /invalid shortlist/);
});

test('asks for fewer picks when there are fewer than three candidates', async () => {
  const claude = fakeClaude(reply([{ id: 1, why: 'The only option.' }]));
  const picks = await shortlist(claude, { candidates: [film(1)] });

  assert.equal(picks.length, 1);
  assert.match(claude.requests[0].system, /pick the 1 /);
  assert.deepEqual(claude.requests[0].output_config.format.schema.required, ['first']);
});

test('does not call Claude when there are no candidates', async () => {
  const claude = fakeClaude(reply([]));

  assert.deepEqual(await shortlist(claude, { candidates: [] }), []);
  assert.equal(claude.requests.length, 0);
});

test('a bad answer is retried once and the good answer is used', async () => {
  const bad = reply([{ id: 999, why: 'A made up film.' }, THREE_PICKS[0], THREE_PICKS[1]]);
  const claude = fakeClaude([bad, reply(THREE_PICKS)]);
  const picks = await shortlist(claude);

  assert.equal(claude.requests.length, 2);
  assert.deepEqual(picks.map((pick) => pick.id), [3, 1, 2]);
});

test('gives up after two bad answers', async () => {
  const claude = fakeClaude(reply(THREE_PICKS.slice(0, 1)));

  await assert.rejects(shortlist(claude), /invalid shortlist/);
  assert.equal(claude.requests.length, 2);
});

test('a rejected key is not retried', async () => {
  const error = new Anthropic.AuthenticationError(401, {}, 'invalid', new Headers());
  const claude = fakeClaude(error);

  await assert.rejects(shortlist(claude), /ANTHROPIC_API_KEY/);
  assert.equal(claude.requests.length, 1);
});

test('solo mode has no yours-or-mine label', async () => {
  const [pick] = await shortlist(fakeClaude(reply(THREE_PICKS)));

  assert.equal(pick.label, null);
});

test('blend mode labels a pick by whose taste it came from', async () => {
  const shared = [
    { type: 'watchlist', person: 'Sam' },
    { type: 'recommended', person: 'Alex', because: 'Beta' },
  ];
  const candidates = [film(1), film(2, shared), film(3, [{ type: 'watchlist', person: 'Alex' }])];
  const picks = await shortlist(fakeClaude(reply([
    { id: 1, why: 'Reason number one.' },
    { id: 2, why: 'Reason number two.' },
    { id: 3, why: 'Reason number three.' },
  ])), { candidates, people: [SAM, ALEX] });

  assert.deepEqual(picks.map((pick) => pick.label), ["Sam's pick", 'Both of you', "Alex's pick"]);
});

test('a refusal gives a clear error instead of an empty shortlist', async () => {
  const response = reply([], { stop_reason: 'refusal', content: [] });

  await assert.rejects(shortlist(fakeClaude(response)), /couldn't finish/);
});

test('a cut-off answer gives a clear error', async () => {
  const response = { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"picks":[' }] };

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
