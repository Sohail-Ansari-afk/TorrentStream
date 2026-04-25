const axios = require('axios');

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

// ─── Get Catalog ─────────────────────────────────────────
async function getCatalog(type, id, search) {
  if (type === 'anime') {
    return getAnimeCatalog(search);
  }

  const tmdbType = type === 'movie' ? 'movie' : 'tv';

  let url;
  if (search) {
    url = `${TMDB_BASE}/search/${tmdbType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(search)}`;
  } else {
    url = `${TMDB_BASE}/${tmdbType}/popular?api_key=${TMDB_KEY}`;
  }

  const response = await axios.get(url);
  const results = response.data.results || [];

  const metas = results.map(item => ({
    id: `tt${item.id}`,
    type,
    name: item.title || item.name,
    poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
    description: item.overview,
    year: (item.release_date || item.first_air_date || '').split('-')[0],
    imdbRating: item.vote_average?.toFixed(1)
  })).filter(m => m.poster);

  return { metas };
}

// ─── Get Meta (single item detail) ───────────────────────
async function getMeta(type, id) {
  if (type === 'anime') {
    return getAnimeMeta(id);
  }

  // Extract TMDB id from our prefixed id
  const tmdbId = id.replace('tt', '');
  const tmdbType = type === 'movie' ? 'movie' : 'tv';

  const response = await axios.get(
    `${TMDB_BASE}/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=external_ids,seasons`
  );

  const item = response.data;
  const imdbId = item.external_ids?.imdb_id;

  const meta = {
    id,
    type,
    name: item.title || item.name,
    poster: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
    description: item.overview,
    year: (item.release_date || item.first_air_date || '').split('-')[0],
    imdbRating: item.vote_average?.toFixed(1),
    genres: item.genres?.map(g => g.name) || [],
    runtime: item.runtime || item.episode_run_time?.[0]
  };

  // Add episodes for TV shows
  if (type === 'series' && item.seasons) {
    meta.videos = [];
    for (const season of item.seasons) {
      if (season.season_number === 0) continue;
      try {
        const seasonData = await axios.get(
          `${TMDB_BASE}/tv/${tmdbId}/season/${season.season_number}?api_key=${TMDB_KEY}`
        );
        for (const ep of seasonData.data.episodes || []) {
          meta.videos.push({
            id: `${id}:${season.season_number}:${ep.episode_number}`,
            title: ep.name,
            season: season.season_number,
            episode: ep.episode_number,
            thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
            overview: ep.overview,
            released: ep.air_date
          });
        }
      } catch (e) {
        console.error(`Season fetch error: ${e.message}`);
      }
    }
  }

  return { meta };
}

// ─── Anime via Kitsu ──────────────────────────────────────
async function getAnimeCatalog(search) {
  let url = 'https://kitsu.io/api/edge/anime?page[limit]=20&sort=-averageRating';
  if (search) {
    url = `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(search)}`;
  }

  const response = await axios.get(url, {
    headers: { 'Accept': 'application/vnd.api+json' }
  });

  const metas = (response.data.data || []).map(item => ({
    id: `kitsu:${item.id}`,
    type: 'anime',
    name: item.attributes.canonicalTitle,
    poster: item.attributes.posterImage?.medium || null,
    background: item.attributes.coverImage?.large || null,
    description: item.attributes.synopsis,
    year: item.attributes.startDate?.split('-')[0]
  })).filter(m => m.poster);

  return { metas };
}

async function getAnimeMeta(id) {
  const kitsuId = id.replace('kitsu:', '');
  const response = await axios.get(
    `https://kitsu.io/api/edge/anime/${kitsuId}?include=episodes`,
    { headers: { 'Accept': 'application/vnd.api+json' } }
  );

  const item = response.data.data;
  const episodes = response.data.included || [];

  const meta = {
    id,
    type: 'anime',
    name: item.attributes.canonicalTitle,
    poster: item.attributes.posterImage?.medium,
    background: item.attributes.coverImage?.large,
    description: item.attributes.synopsis,
    year: item.attributes.startDate?.split('-')[0],
    videos: episodes
      .filter(e => e.type === 'episodes')
      .map(ep => ({
        id: `${id}:${ep.attributes.number}`,
        title: ep.attributes.canonicalTitle || `Episode ${ep.attributes.number}`,
        episode: ep.attributes.number,
        season: 1,
        thumbnail: ep.attributes.thumbnail?.original,
        released: ep.attributes.airdate
      }))
      .sort((a, b) => a.episode - b.episode)
  };

  return { meta };
}

module.exports = { getCatalog, getMeta };
