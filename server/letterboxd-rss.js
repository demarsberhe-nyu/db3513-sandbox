// Letterboxd's API is private, but every public profile has a diary feed.
// The feed only holds about the 50 most recent diary entries and never the watchlist,
// so it tops up a profile that started from a full export.

const FEED_TIMEOUT_MS = 10 * 1000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,40}$/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  const cdata = text.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])
    .trim();
}

function readTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1]) : '';
}

// Returns films in the same shape as the export's rows, with rating 0 for unrated watches.
function parseDiaryFeed(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items
    .map((item) => ({
      name: readTag(item, 'letterboxd:filmTitle'),
      year: readTag(item, 'letterboxd:filmYear'),
      date: readTag(item, 'letterboxd:watchedDate'),
      uri: readTag(item, 'link'),
      rating: Number.parseFloat(readTag(item, 'letterboxd:memberRating')) || 0,
    }))
    // Lists and reviews without a watch also appear in the feed, and have no film title.
    .filter((film) => film.name && film.date);
}

function normalizeUsername(input) {
  const username = String(input ?? '').trim().replace(/^@/, '');
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Enter a Letterboxd username using only letters, numbers and underscores.');
  }
  return username;
}

async function fetchDiary(username) {
  let response;
  try {
    response = await fetch(`https://letterboxd.com/${encodeURIComponent(username)}/rss/`, {
      headers: { Accept: 'application/rss+xml' },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error("Couldn't reach Letterboxd. Try again in a moment.");
  }

  if (response.status === 404) {
    throw new Error(`Couldn't find a public Letterboxd profile named ${username}.`);
  }
  if (!response.ok) throw new Error(`Letterboxd replied with status ${response.status}.`);

  const xml = await response.text();
  if (xml.length > MAX_FEED_BYTES) throw new Error('That Letterboxd feed is too large.');
  return parseDiaryFeed(xml);
}

module.exports = { parseDiaryFeed, normalizeUsername, fetchDiary };
