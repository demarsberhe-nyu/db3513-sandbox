const { filmKey } = require('./letterboxd');
const { normalizeTitle } = require('./netflix');

const TOP_RATED_PER_PERSON = 15;
const MAX_CANDIDATES_CHECKED = 100;
const CHECKS_RESERVED_FOR_RECOMMENDATIONS = 40;
const MAX_TMDB_REQUESTS_AT_ONCE = 8;

const REGIONS = ['US', 'CA', 'GB', 'AU'];

// providerIds are TMDB's numbers for each service.
const SERVICES = [
  { id: 'netflix', name: 'Netflix', providerIds: [8] },
  { id: 'hulu', name: 'Hulu', providerIds: [15] },
  { id: 'max', name: 'Max', providerIds: [1899] },
  { id: 'prime', name: 'Prime Video', providerIds: [9] },
  { id: 'disney', name: 'Disney+', providerIds: [337] },
  { id: 'apple', name: 'Apple TV+', providerIds: [350] },
];

// Runs work on every item, a few at a time, and keeps the results in order.
async function mapWithLimit(items, limit, work) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await work(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Anyone in the blend having seen a film rules it out for everyone.
function createWatchedFilter(people) {
  const letterboxdKeys = new Set(people.flatMap((person) => person.watched.map(filmKey)));
  const netflixTitles = new Set(people.flatMap((person) => person.netflixTitles ?? []));
  const excluded = { letterboxd: new Set(), netflix: new Set() };

  function isWatched(film) {
    const names = [film.title, film.originalTitle].filter(Boolean);
    const key = filmKey({ name: film.title, year: film.year });

    if (names.some((name) => letterboxdKeys.has(filmKey({ name, year: film.year })))) {
      excluded.letterboxd.add(key);
      return true;
    }
    // Netflix history has no years, so a matching title is enough to rule a film out.
    if (names.some((name) => netflixTitles.has(normalizeTitle(name)))) {
      excluded.netflix.add(key);
      return true;
    }
    return false;
  }

  return { isWatched, excluded };
}

function isOnWatchlist(film) {
  return film.sources.some((source) => source.type === 'watchlist');
}

function bySourceCount(a, b) {
  return b.sources.length - a.sources.length;
}

// A long watchlist can't use up every check, or taste-based picks never get looked at.
// Whichever side has too few films passes its unused checks to the other.
function chooseFilmsToCheck(pool) {
  const sorted = [...pool].sort(bySourceCount);
  const watchlist = sorted.filter(isOnWatchlist);
  const recommended = sorted.filter((film) => !isOnWatchlist(film));

  const reserved = Math.min(CHECKS_RESERVED_FOR_RECOMMENDATIONS, recommended.length);
  const watchlistChecks = watchlist.slice(0, MAX_CANDIDATES_CHECKED - reserved);
  return [...watchlistChecks, ...recommended.slice(0, MAX_CANDIDATES_CHECKED - watchlistChecks.length)];
}

async function buildCandidates({ profiles, serviceIds, region, tmdb }) {
  const people = profiles.filter(Boolean);
  const services = SERVICES.filter((service) => serviceIds.includes(service.id));
  const { isWatched, excluded } = createWatchedFilter(people);
  const pool = new Map();
  let unmatched = 0;

  function addToPool(film, source) {
    if (!pool.has(film.id)) pool.set(film.id, { ...film, sources: [] });
    pool.get(film.id).sources.push(source);
  }

  async function matchFilms(entries) {
    const matches = await mapWithLimit(entries, MAX_TMDB_REQUESTS_AT_ONCE, async (entry) => ({
      ...entry,
      match: await tmdb.searchMovie(entry.film.name, entry.film.year),
    }));
    unmatched += matches.filter((entry) => !entry.match).length;
    return matches.filter((entry) => entry.match);
  }

  const watchlistEntries = people
    .flatMap((person) => person.watchlist.map((film) => ({ person, film })))
    .filter(({ film }) => !isWatched({ title: film.name, year: film.year }));

  for (const { person, match } of await matchFilms(watchlistEntries)) {
    addToPool(match, { type: 'watchlist', person: person.name });
  }

  const favoriteEntries = people.flatMap((person) =>
    person.topRated.slice(0, TOP_RATED_PER_PERSON).map((film) => ({ person, film })),
  );
  const favorites = await matchFilms(favoriteEntries);
  const recommendationLists = await mapWithLimit(favorites, MAX_TMDB_REQUESTS_AT_ONCE, (entry) =>
    tmdb.getRecommendations(entry.match.id),
  );

  favorites.forEach(({ person, film }, index) => {
    for (const recommendation of recommendationLists[index]) {
      if (isWatched(recommendation)) continue;
      addToPool(recommendation, { type: 'recommended', person: person.name, because: film.name });
    }
  });

  const toCheck = chooseFilmsToCheck(pool.values());
  const allDetails = await mapWithLimit(toCheck, MAX_TMDB_REQUESTS_AT_ONCE, (film) =>
    tmdb.getDetails(film.id),
  );

  const candidates = [];
  let notAvailable = 0;

  allDetails.forEach((details, index) => {
    if (details.status !== 'Released' || isWatched(details)) return;

    const providerIds = details.providersByRegion[region] ?? [];
    const available = services.filter((service) =>
      service.providerIds.some((id) => providerIds.includes(id)),
    );
    if (available.length === 0) {
      notAvailable += 1;
      return;
    }

    const { providersByRegion, status, ...film } = details;
    candidates.push({
      ...film,
      services: available.map((service) => service.name),
      sources: toCheck[index].sources,
    });
  });

  return {
    candidates,
    stats: {
      checked: toCheck.length,
      notAvailable,
      unmatched,
      watchedOnLetterboxd: excluded.letterboxd.size,
      watchedOnNetflix: excluded.netflix.size,
    },
  };
}

module.exports = { buildCandidates, SERVICES, REGIONS, MAX_CANDIDATES_CHECKED, TOP_RATED_PER_PERSON };
