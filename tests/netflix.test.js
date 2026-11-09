const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNetflixHistory } = require('../server/netflix');
const { summarizeProfile } = require('../server/letterboxd');

// Made-up rows only. Real exports stay in data/ and out of Git.
function history(lines) {
  return ['Title,Date', ...lines].join('\n');
}

const EMPTY_PROFILE = { name: 'Sam', ratings: [], watched: [], watchlist: [], topRated: [] };

test('counts a title watched more than once as one title', () => {
  const text = history(['Alpha,1/2/26', 'Alpha,1/3/26', 'ALPHA ,1/4/26']);

  assert.deepEqual(parseNetflixHistory(text), ['alpha']);
});

test('reads titles that contain commas', () => {
  const text = history(['"Crouching Tiger, Hidden Dragon",1/2/26']);

  assert.deepEqual(parseNetflixHistory(text), ['crouching tiger, hidden dragon']);
});

test('keeps colons in a title intact', () => {
  const text = history(['Mission: Impossible,1/2/26']);

  assert.deepEqual(parseNetflixHistory(text), ['mission: impossible']);
});

test('saves titles only, never dates', () => {
  const titles = parseNetflixHistory(history(['Alpha,1/2/26']));

  assert.ok(!JSON.stringify(titles).includes('1/2/26'));
});

test('handles a byte order mark at the start of the file', () => {
  assert.deepEqual(parseNetflixHistory(`﻿${history(['Alpha,1/2/26'])}`), ['alpha']);
});

test('rejects a file without a Title column', () => {
  const letterboxdFile = 'Date,Name,Year,Letterboxd URI\n2026-01-01,Alpha,2001,u';

  assert.throws(() => parseNetflixHistory(letterboxdFile), /Title column/);
});

test('rejects a file with no titles', () => {
  assert.throws(() => parseNetflixHistory(history([])), /no titles/);
});

test('the summary reports the Netflix title count', () => {
  const profile = { ...EMPTY_PROFILE, netflixTitles: ['alpha', 'beta'] };

  assert.equal(summarizeProfile(profile).netflixTitleCount, 2);
});

test('the summary reports zero for a profile saved before Netflix existed', () => {
  assert.equal(summarizeProfile(EMPTY_PROFILE).netflixTitleCount, 0);
});
