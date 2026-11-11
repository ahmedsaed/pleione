// Deterministic synthetic catalog for the demo Xtream server: live channels,
// movies, series, and a wall-clock EPG schedule. Pure data — no I/O — so the
// API layer and the tests share one source of truth.

export const SIZES = {
  small: {
    liveCategories: 8, channels: 150,
    // Named groups of uneven size: a few past the 20-title rail (so they end
    // in See all), a few with one or two titles, and more than the pill row's
    // ten, so All categories has something to open.
    vodCategories: 24, movies: 360,
    seriesCategories: 24, series: 180,
    namedGroups: true,
    epgPastDays: 3, epgFutureDays: 2, archiveDays: 3,
    programmeMinutes: [15, 30, 30, 45, 60, 60, 90],
  },
  // The engine smoke suite (scripts/engines): enough for scrolling lists
  // and full rails, small enough for Chromium 53 to load in seconds.
  smoke: {
    liveCategories: 6, channels: 60,
    vodCategories: 3, movies: 66,
    seriesCategories: 2, series: 24,
    epgPastDays: 1, epgFutureDays: 2, archiveDays: 1,
    programmeMinutes: [30, 30, 45, 60, 60, 90],
  },
  large: {
    liveCategories: 40, channels: 2000,
    vodCategories: 260, movies: 3000,
    seriesCategories: 240, series: 1200,
    namedGroups: true,
    // Two guide days keep the full XMLTV under the app's retained-programme cap.
    epgPastDays: 1, epgFutureDays: 1, archiveDays: 1,
    programmeMinutes: [30, 45, 60, 60, 90, 120],
  },
};

const DAY_SECONDS = 86400;
// Fixed reference for `added`/`last_modified` so catalog output never depends on the clock.
const CATALOG_EPOCH = Date.UTC(2026, 0, 1) / 1000;
const GENRES = ['Drama', 'Comedy', 'Documentary', 'Adventure', 'Mystery', 'Family'];

export const LONG_NAME_CHANNEL = 4;
export const NO_EPG_CHANNEL = 6;
export const SUBTITLED_MOVIE_INDEX = 0;
export const SEASONLESS_SERIES_INDEX = 3;

// Higher-resolution items for checking SD/HD/FHD/UHD playback. They sit in
// their own group with ids far above every generated one, so adding them never
// shifts the generated catalog. `renditions` names entries of RENDITIONS in
// media.mjs; more than one makes an adaptive HLS ladder.
export const HD_CATEGORY = { id: '100', name: 'Group HD' };
export const HD_CHANNELS = [
  { streamId: 9001, name: 'HD 720p', logo: 'HD', renditions: ['720p'] },
  { streamId: 9002, name: 'Full HD 1080p', logo: 'FHD', renditions: ['1080p'] },
  { streamId: 9003, name: 'Adaptive 360p-1080p', logo: 'ABR', renditions: ['360p', '720p', '1080p'] },
];
export const HD_MOVIES = [
  { streamId: 19001, name: 'HD Movie 720p', clip: 'movie-720p' },
  { streamId: 19002, name: 'Full HD Movie 1080p', clip: 'movie-1080p' },
  { streamId: 19003, name: 'UHD Movie 2160p', clip: 'movie-2160p' },
];

// 32-bit integer mix of any number of integer inputs; stable across runs.
export function hash(...values) {
  let h = 0x2545f491;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca77);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

// 0 -> A, 25 -> Z, 26 -> AA: spreadsheet-style letter codes for item names.
export function letterCode(index) {
  let code = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    code = String.fromCharCode(65 + rem) + code;
    n = Math.floor((n - 1) / 26);
  }
  return code;
}

function channelName(n) {
  if (n === 1) return 'Alpha';
  if (n === 2) return 'Bravo';
  if (n === 3) return 'Charlie';
  if (n === LONG_NAME_CHANNEL) {
    return `Channel ${n} with an exceptionally long synthetic name that keeps going to test truncation`;
  }
  return `Channel ${n}`;
}

function spread(count, buckets) {
  const per = Math.ceil(count / buckets);
  return (index) => Math.floor(index / per);
}

// Short and long names, so pills and grid cells both fit and truncate. The
// tiny and large slots of `groupSizes` line up with names that suit them.
const VOD_GROUP_NAMES = [
  'New Releases', 'Action', 'Comedy', 'Drama', 'Documentaries and Nature Specials', 'Sci-Fi',
  'Kids & Family', 'War', 'Award-Winning International Dramas from Around the World', 'Horror',
  'Romance', 'Animation', 'Thriller', 'Westerns', 'Musicals and Concert Films', 'Short Films',
  'Mystery', 'Classic Black and White Cinema', 'Crime', 'Adventure', 'Independent and Festival Favorites',
  'Sports', 'History', 'Silent Era',
];
const SERIES_GROUP_NAMES = [
  'Popular Now', 'Comedy', 'Reality', 'Drama Series', 'Crime and Investigation Series', 'Kids',
  'Anime', 'Stand-Up', 'Limited Series and Miniseries from Every Decade', 'Talk Shows', 'Sitcoms',
  'Documentary Series', 'Mystery', 'Cooking and Home Improvement', 'Travel', 'Soaps', 'Medical Dramas',
  'Legal Dramas', 'Teen', 'Sci-Fi & Fantasy', 'Period Pieces and Costume Dramas', 'Game Shows',
  'Nature', 'Puppet Shows',
];
// Past the base names (the large catalog): every genre with every qualifier.
const GROUP_GENRES = [
  'Action', 'Comedy', 'Drama', 'Horror', 'Romance', 'Thriller', 'Mystery', 'Crime', 'Fantasy',
  'Animation', 'Documentary', 'Family', 'Adventure', 'Western', 'Musical', 'War', 'History',
  'Sports', 'Sci-Fi', 'Biography', 'Teen', 'Noir',
];
const GROUP_QUALIFIERS = [
  'Classics', 'Hidden Gems', 'from the 1970s', 'from the 1980s', 'from the 1990s', 'Award Winners',
  "Director's Cuts and Extended Editions", 'for Late Night Viewing', 'Box Sets', 'Fan Favorites',
  'Remastered in High Definition', 'Double Features',
];

function groupNames(base, count) {
  const names = base.slice(0, count);
  for (let q = 0; names.length < count && q < GROUP_QUALIFIERS.length; q++) {
    for (let g = 0; names.length < count && g < GROUP_GENRES.length; g++) {
      names.push(`${GROUP_GENRES[g]} ${GROUP_QUALIFIERS[q]}`);
    }
  }
  if (names.length < count) throw new Error(`Only ${names.length} group names for ${count} groups`);
  return names;
}

// Titles per group, summing to `total`: one or two in every eighth group,
// many in the first and in every eighth from the fourth, a hashed few elsewhere.
export function groupSizes(total, count, salt) {
  const sizes = new Array(count).fill(0);
  const weights = [];
  let left = total;
  for (let k = 0; k < count; k++) {
    if (k % 8 === 7) {
      sizes[k] = 1 + ((k >> 3) % 2);
      left -= sizes[k];
      weights.push(0);
    } else {
      weights.push(k === 0 ? 10 : k % 8 === 3 ? 8 : 1 + (hash(k, salt) % 3));
    }
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map(weight => (left * weight) / weightSum);
  shares.forEach((share, k) => { sizes[k] += Math.floor(share); });
  // Largest remainders take the titles flooring left over.
  const order = shares.map((share, k) => [share - Math.floor(share), k])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  let spare = left - shares.reduce((sum, share) => sum + Math.floor(share), 0);
  for (let r = 0; spare > 0; r++, spare--) sizes[order[r][1]]++;
  return sizes;
}

// Item index -> group index for consecutive runs of the given sizes.
function runs(sizes) {
  const bucket = [];
  sizes.forEach((size, k) => { for (let i = 0; i < size; i++) bucket.push(k); });
  return index => bucket[index];
}

// Generated groups, then the HD group if asked, then one empty group last.
// Generated ids skip the HD group's id in every list.
function categories(count, withHd, names) {
  const list = [];
  let id = 0;
  const nextId = () => {
    id++;
    if (String(id) === HD_CATEGORY.id) id++;
    return String(id);
  };
  for (let i = 1; i <= count; i++) {
    list.push({ id: nextId(), name: names ? names[i - 1] : `Group ${i}`, empty: false });
  }
  if (withHd) list.push({ ...HD_CATEGORY, empty: false });
  list.push({ id: nextId(), name: names ? 'Coming Soon' : `Group ${count + 1}`, empty: true });
  return list;
}

function rating(seed) {
  return (5 + (seed % 45) / 10).toFixed(1);
}

export function createCatalog(size = 'small') {
  const spec = SIZES[size];
  if (!spec) throw new Error(`Unknown catalog size: ${size}`);

  const liveCategories = categories(spec.liveCategories, true);
  const liveBucket = spread(spec.channels, spec.liveCategories);
  const channels = [];
  for (let n = 1; n <= spec.channels; n++) {
    const archive = n === 1 || n % 3 === 0;
    channels.push({
      num: n,
      streamId: n,
      name: channelName(n),
      categoryId: liveCategories[liveBucket(n - 1)].id,
      epgId: n === NO_EPG_CHANNEL ? '' : `ch${n}`,
      archive,
      archiveDays: archive ? spec.archiveDays : 0,
      hue: (n * 47) % 360,
      added: CATALOG_EPOCH - n * 3600,
    });
  }
  HD_CHANNELS.forEach((item, k) => {
    channels.push({
      num: spec.channels + k + 1,
      streamId: item.streamId,
      name: item.name,
      logo: item.logo,
      categoryId: HD_CATEGORY.id,
      epgId: `ch${item.streamId}`,
      archive: false,
      archiveDays: 0,
      hue: (k * 47) % 360,
      added: CATALOG_EPOCH + (k + 1) * 3600,
      renditions: item.renditions,
    });
  });

  const vodCategories = categories(spec.vodCategories, true,
    spec.namedGroups ? groupNames(VOD_GROUP_NAMES, spec.vodCategories) : null);
  const vodBucket = spec.namedGroups
    ? runs(groupSizes(spec.movies, spec.vodCategories, 31))
    : spread(spec.movies, spec.vodCategories);
  const movies = [];
  for (let i = 0; i < spec.movies; i++) {
    const seed = hash(i, 11);
    const subtitled = i === SUBTITLED_MOVIE_INDEX;
    movies.push({
      num: i + 1,
      streamId: 10001 + i,
      name: `Movie ${letterCode(i)}`,
      categoryId: vodCategories[vodBucket(i)].id,
      clip: subtitled ? 'feature' : (i % 2 ? 'movie-b' : 'movie-a'),
      subtitled,
      rating: rating(seed),
      year: 1990 + (seed % 36),
      // Spread over ~2 years with a per-item jitter, so "Recently added" sorting is meaningful.
      added: CATALOG_EPOCH - ((i * 7919) % (spec.movies * 2)) * 21600 - (seed % 3600),
      genre: GENRES[seed % GENRES.length],
      hue: (i * 67 + 20) % 360,
    });
  }
  HD_MOVIES.forEach((item, k) => {
    const seed = hash(item.streamId, 11);
    movies.push({
      num: spec.movies + k + 1,
      streamId: item.streamId,
      name: item.name,
      categoryId: HD_CATEGORY.id,
      clip: item.clip,
      subtitled: false,
      rating: rating(seed),
      year: 2026,
      // Newest in the catalog, so they lead "Recently added".
      added: CATALOG_EPOCH + (k + 1) * 3600,
      genre: 'Documentary',
      hue: (k * 67 + 180) % 360,
    });
  });

  const seriesCategories = categories(spec.seriesCategories, false,
    spec.namedGroups ? groupNames(SERIES_GROUP_NAMES, spec.seriesCategories) : null);
  const seriesBucket = spec.namedGroups
    ? runs(groupSizes(spec.series, spec.seriesCategories, 37))
    : spread(spec.series, spec.seriesCategories);
  const series = [];
  let episodeId = 200001;
  for (let i = 0; i < spec.series; i++) {
    const seed = hash(i, 23);
    const seasonCount = 1 + (seed % 3);
    const seasons = [];
    for (let s = 1; s <= seasonCount; s++) {
      const episodeCount = 3 + (hash(i, s, 29) % 6);
      const episodes = [];
      for (let e = 1; e <= episodeCount; e++) {
        episodes.push({ id: episodeId++, season: s, episode: e, title: `Episode ${e}` });
      }
      seasons.push({ number: s, episodes });
    }
    series.push({
      num: i + 1,
      seriesId: 5001 + i,
      name: `Series ${letterCode(i)}`,
      categoryId: seriesCategories[seriesBucket(i)].id,
      rating: rating(seed),
      year: 2000 + (seed % 26),
      lastModified: CATALOG_EPOCH - ((i * 4241) % (spec.series * 3)) * 43200,
      genre: GENRES[seed % GENRES.length],
      hue: (i * 83 + 200) % 360,
      seasonless: i === SEASONLESS_SERIES_INDEX,
      // The first episode of the first series carries the sidecar subtitles.
      subtitledEpisodeId: i === 0 ? seasons[0].episodes[0].id : 0,
      seasons,
    });
  }

  const byStreamId = new Map(channels.map(channel => [channel.streamId, channel]));
  const movieById = new Map(movies.map(movie => [movie.streamId, movie]));
  const seriesById = new Map(series.map(item => [item.seriesId, item]));
  const episodeById = new Map();
  for (const item of series) {
    for (const season of item.seasons) {
      for (const episode of season.episodes) episodeById.set(episode.id, { series: item, episode });
    }
  }

  return {
    size,
    spec,
    liveCategories,
    channels,
    vodCategories,
    movies,
    seriesCategories,
    series,
    channel: id => byStreamId.get(Number(id)),
    movie: id => movieById.get(Number(id)),
    seriesItem: id => seriesById.get(Number(id)),
    episode: id => episodeById.get(Number(id)),
  };
}

// One UTC day of programmes for a channel. Programmes tile the day exactly and
// never straddle midnight, so any window is just the union of whole days.
export function programmesForDay(catalog, channel, day) {
  const durations = catalog.spec.programmeMinutes;
  const start = day * DAY_SECONDS;
  const end = start + DAY_SECONDS;
  const list = [];
  let t = start;
  for (let k = 0; t < end; k++) {
    const h = hash(channel.streamId, day, k);
    const stop = Math.min(end, t + durations[h % durations.length] * 60);
    const number = 1 + (hash(channel.streamId, day, k, 7) % 400);
    list.push({
      id: `${channel.streamId}-${day}-${k}`,
      start: t,
      stop,
      title: `Program ${number}`,
      description: `Synthetic description for Program ${number} on ${channel.name}.`,
      category: GENRES[h % GENRES.length],
    });
    t = stop;
  }
  return list;
}

export function guideRange(catalog, nowSeconds) {
  const today = Math.floor(nowSeconds / DAY_SECONDS);
  return {
    firstDay: today - catalog.spec.epgPastDays,
    lastDay: today + catalog.spec.epgFutureDays - 1,
  };
}

// Programmes overlapping [from, to) inside the guide range; empty for a channel without EPG.
export function programmesBetween(catalog, channel, from, to, nowSeconds) {
  if (!channel.epgId) return [];
  const { firstDay, lastDay } = guideRange(catalog, nowSeconds);
  const result = [];
  const startDay = Math.max(firstDay, Math.floor(from / DAY_SECONDS));
  const endDay = Math.min(lastDay, Math.floor((to - 1) / DAY_SECONDS));
  for (let day = startDay; day <= endDay; day++) {
    for (const programme of programmesForDay(catalog, channel, day)) {
      if (programme.stop > from && programme.start < to) result.push(programme);
    }
  }
  return result;
}

export function hasArchive(channel, programme, nowSeconds) {
  return channel.archive
    && programme.stop <= nowSeconds
    && programme.start >= nowSeconds - channel.archiveDays * DAY_SECONDS;
}
