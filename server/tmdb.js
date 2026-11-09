const { loadTmdbCache, saveTmdbCache } = require('./store');

const BASE_URL = 'https://api.themoviedb.org/3';
const CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

// Ignores case and punctuation, so "WALL·E" and "WALL-E" count as the same title.
function comparableTitle(title) {
  const lowered = title.normalize('NFC').toLowerCase();
  return lowered.replace(/[^\p{L}\p{N}]/gu, '') || lowered;
}

function yearOf(releaseDate) {
  return (releaseDate || '').slice(0, 4);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function trimRecommendation(movie) {
  return {
    id: movie.id,
    title: movie.title,
    originalTitle: movie.original_title,
    year: yearOf(movie.release_date),
  };
}

// Only subscription streaming counts, so rent and buy options are dropped here.
function trimProviders(watchProviders) {
  return Object.fromEntries(
    Object.entries(watchProviders?.results ?? {}).map(([region, options]) => [
      region,
      (options.flatrate ?? []).map((provider) => provider.provider_id),
    ]),
  );
}

function createTmdbClient(token, cache = loadTmdbCache()) {
  async function request(endpoint, params = {}) {
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.search = new URLSearchParams(params).toString();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
      } catch (error) {
        throw new Error("Couldn't reach TMDB. Check your internet connection.");
      }

      if (response.ok) return response.json();
      if (response.status === 401) {
        throw new Error('TMDB rejected the token. Check TMDB_API_TOKEN in .env.');
      }

      const isTemporary = response.status === 429 || response.status >= 500;
      if (!isTemporary || attempt === MAX_ATTEMPTS) {
        throw new Error(`TMDB request failed with status ${response.status}.`);
      }
      await wait(Number(response.headers.get('retry-after') ?? 1) * 1000);
    }
  }

  async function cached(key, load) {
    const entry = cache[key];
    if (entry && Date.now() - entry.savedAt < CACHE_LIFETIME_MS) return entry.value;

    const value = await load();
    cache[key] = { savedAt: Date.now(), value };
    return value;
  }

  // Returns a film only when both the title and the year match.
  function searchMovie(name, year) {
    return cached(`search:${name}|${year}`, async () => {
      if (!year) return null;

      const { results } = await request('/search/movie', {
        query: name,
        primary_release_year: year,
        include_adult: 'false',
      });
      const wanted = comparableTitle(name);
      const match = results.find(
        (movie) =>
          yearOf(movie.release_date) === year &&
          (comparableTitle(movie.title) === wanted ||
            comparableTitle(movie.original_title) === wanted),
      );
      return match ? trimRecommendation(match) : null;
    });
  }

  function getRecommendations(id) {
    return cached(`recommendations:${id}`, async () => {
      const { results } = await request(`/movie/${id}/recommendations`);
      return results.map(trimRecommendation);
    });
  }

  function getDetails(id) {
    return cached(`details:${id}`, async () => {
      const movie = await request(`/movie/${id}`, { append_to_response: 'watch/providers' });
      return {
        ...trimRecommendation(movie),
        status: movie.status,
        runtime: movie.runtime,
        posterPath: movie.poster_path,
        overview: movie.overview,
        genres: movie.genres.map((genre) => genre.name),
        providersByRegion: trimProviders(movie['watch/providers']),
      };
    });
  }

  return {
    searchMovie,
    getRecommendations,
    getDetails,
    saveCache: () => saveTmdbCache(cache),
  };
}

module.exports = { createTmdbClient };
