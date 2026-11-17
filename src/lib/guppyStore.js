import { readDir, mkdir, exists, rename, writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import Database from '@tauri-apps/plugin-sql';

export const MEDIA_ROOT = "/Volumes/4TB0-SEAGATE/jelly/art-films";
export const TV_ROOT = '/Volumes/4TB0-SEAGATE/jelly/tv-shows';
export const TMDB_API_KEY = "dfb20686272aa46d95f96be6322a767b";
export const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm'];

function extractQuality(text) {
  const s = String(text || '');
  if (!s) return '';

  // 1. Honor explicit bracketed quality tag first (e.g. [WEBDL-1080p], [BluRay-720p])
  const bracketMatches = [...s.matchAll(/\[([^\]]+)\]/g)];
  for (const m of bracketMatches) {
    const inner = m.at(1).trim();
    if (!inner.toLowerCase().startsWith('imdbid-') && /\b(2160p|4k|1080p|720p|480p|360p|bluray|bdrip|brrip|web-?dl|webrip|dvd|hdtv|vhs|remux)\b/i.test(inner)) {
      return inner;
    }
  }

  // 2. Detect resolution + source anywhere in the folder/file name (including inside parentheses)
  const resMatch = s.match(/\b(2160p|4K|1080p|720p|480p|360p)\b/i);
  const res = resMatch
    ? (resMatch.at(1).toLowerCase() === '4k' ? '2160p' : resMatch.at(1).toLowerCase())
    : '';

  let src = '';
  if (/\bremux\b/i.test(s)) src = 'Remux';
  else if (/\bweb[\s._-]?dl\b/i.test(s)) src = 'WEBDL';
  else if (/\bweb[\s._-]?rip\b/i.test(s)) src = 'WEBRip';
  else if (/\bblu[\s._-]?ray\b|\bbd[\s._-]?rip\b|\bbr[\s._-]?rip\b/i.test(s)) src = 'BluRay';
  else if (/\bdvd[\s._-]?rip\b|\bdvd\b/i.test(s)) src = 'DVD';
  else if (/\bhdtv\b/i.test(s)) src = 'HDTV';
  else if (/\bvhs\b/i.test(s)) src = 'VHS';

  if (src && res) return `${src}-${res}`;
  if (res) return res;
  if (src) return src;
  return '';
}

export function inferMetadata(rawName) {
  let cleaned = rawName.replace(/\.[^/.]+$/, '');
  const imdbMatch = cleaned.match(/\[imdbid-(tt\d+)\]/i);
  const imdb_id = imdbMatch ? imdbMatch.at(1) : '';
  const quality = extractQuality(cleaned);

  cleaned = cleaned.replace(/\[[^\]]*\]/g, '').trim();

  const yearMatch = cleaned.match(/[\(\.\s_-]?(19\d{2}|20\d{2})[\)\.\s_-]?/);
  let year = yearMatch ? String(yearMatch.at(1)) : '';
  let rawTitle = cleaned;

  if (yearMatch) {
    const beforeYear = cleaned.slice(0, yearMatch.index).trim();
    const afterYear = cleaned.slice(yearMatch.index + yearMatch.at(0).length).trim();
    if (beforeYear.length > 0) rawTitle = beforeYear;
    else if (afterYear.length > 0) rawTitle = afterYear;
    else { rawTitle = year; year = ''; }
  }

  rawTitle = rawTitle.replace(/\b(2160p|4K|1080p|720p|480p|360p|BluRay|BDRip|BRRip|WEB-DL|WEBRip|DVDRip|DVD|HDTV|VHS|x264|x265|HEVC|AAC|AC3)\b.*$/i, '');
  const title = rawTitle.replace(/^[-\s._]+/, '').replace(/[-\s._]+$/, '').replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

  return { title, year, quality, poster_url: '', imdb_id, director: '', cast_list: '', overview: '' };
}

export async function inferFolder(folderPath, folderName) {
  const meta = inferMetadata(folderName);
  if (!meta.quality) {
    try {
      const innerFiles = await readDir(folderPath);
      for (const f of innerFiles) {
        if (!f.isDirectory && VIDEO_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))) {
          const q = extractQuality(f.name);
          if (q) { meta.quality = q; break; }
        }
      }
    } catch (_) {}
  }
  return meta;
}

export async function initDb() {
  const db = await Database.load("sqlite:local_media.db");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS wishlist_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_name TEXT UNIQUE,
      title TEXT,
      year INTEGER,
      quality TEXT,
      imdb_id TEXT,
      poster_url TEXT,
      director TEXT,
      cast_list TEXT,
      overview TEXT,
      status TEXT DEFAULT 'owned'
    )
  `);
  for (const col of [
    'quality TEXT',
    'imdb_id TEXT',
    'poster_url TEXT',
    'director TEXT',
    'cast_list TEXT',
    'overview TEXT',
    "status TEXT DEFAULT 'owned'",
    'tags TEXT',
    'clips TEXT',
    "watch_status TEXT DEFAULT ''",
    "media_type TEXT DEFAULT 'movie'",
    'season_number INTEGER DEFAULT 0',
    "episodes_json TEXT DEFAULT ''",
    'tmdb_id INTEGER DEFAULT 0'
  ]) {
    try { await db.execute(`ALTER TABLE wishlist_videos ADD COLUMN ${col}`); } catch (_) {}
  }
  return db;
}


export async function fetchEnrichedMovie(movie) {
  const host = ["api", "themoviedb", "org"].join(".");
  const path = ["3", "movie", movie.id].join("/");
  const url = new URL(`https://${host}/${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("append_to_response", "credits");

  const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  const details = await res.json();
  const directorObj = details.credits?.crew?.find(c => c.job === 'Director');
  const topCast = (details.credits?.cast || []).slice(0, 5).map(c => c.name).join(', ');
  const posterBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");

  return {
    ...movie,
    title: movie.title,
    year: movie.release_date ? movie.release_date.slice(0, 4) : '',
    poster_url: movie.poster_path ? posterBase + movie.poster_path : '',
    imdb_id: details.imdb_id || '',
    director: directorObj ? directorObj.name : '',
    cast_list: topCast,
    overview: details.overview || ''
  };
}

export async function searchTmdb(title, year = '', director = '') {
  const qTitle = (title || '').trim();
  const qYear = String(year || '').trim();
  const qDir = (director || '').trim().toLowerCase();
  if (!qTitle && !qYear && !qDir) return [];

  const host = ["api", "themoviedb", "org"].join(".");
  const imgBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");

  const fetchCandidates = async (withYear) => {
    const url = new URL(`https://${host}/3/search/movie`);
    url.searchParams.set("api_key", TMDB_API_KEY);
    url.searchParams.set("query", qTitle || qDir);
    url.searchParams.set("include_adult", "true");
    if (withYear && qYear) {
      url.searchParams.set("primary_release_year", qYear);
    }
    const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    return data.results || [];
  };

  // Always search by title broadly so ±1 year release discrepancies (like 1986 vs 1987) are never dropped
  const [broadResults, exactYearResults] = await Promise.all([
    qTitle ? fetchCandidates(false) : Promise.resolve([]),
    qYear ? fetchCandidates(true) : Promise.resolve([])
  ]);

  const seenIds = new Set();
  const combined = [...exactYearResults, ...broadResults].filter(m => {
    if (!m.id || seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  const norm = (s) => (s || '').toLowerCase().replace(/^the\s+|^a\s+|^an\s+/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const targetNorm = norm(qTitle);
  const targetExact = qTitle.toLowerCase();
  const targetYearNum = Number(qYear) || 0;

  const scoreCandidate = (m) => {
    const mExact = (m.title || '').toLowerCase();
    const mNorm = norm(m.title);
    const mOrigNorm = norm(m.original_title);
    const mYear = m.release_date ? Number(m.release_date.slice(0, 4)) : 0;
    const yearDiff = (targetYearNum && mYear) ? Math.abs(mYear - targetYearNum) : 99;

    let titleScore = 3;
    if (targetExact && (mExact === targetExact || (m.original_title || '').toLowerCase() === targetExact)) {
      titleScore = 0; // Exact title match
    } else if (targetNorm && (mNorm === targetNorm || mOrigNorm === targetNorm)) {
      titleScore = 1; // Exact normalized title match
    } else if (targetNorm && (mNorm.startsWith(targetNorm) || mNorm.includes(targetNorm))) {
      titleScore = 2; // Partial title match
    }

    let yearScore = 3;
    if (!targetYearNum) yearScore = 0;
    else if (yearDiff === 0) yearScore = 0;      // Exact year
    else if (yearDiff === 1) yearScore = 1;      // ±1 year (festival vs theatrical release)
    else if (yearDiff <= 3) yearScore = 2;       // Within 3 years

    return { titleScore, yearScore, yearDiff, pop: m.popularity || 0 };
  };

  const ranked = combined.sort((a, b) => {
    const sa = scoreCandidate(a);
    const sb = scoreCandidate(b);
    if (sa.titleScore !== sb.titleScore) return sa.titleScore - sb.titleScore;
    if (sa.yearScore !== sb.yearScore) return sa.yearScore - sb.yearScore;
    if (sa.yearDiff !== sb.yearDiff) return sa.yearDiff - sb.yearDiff;
    return sb.pop - sa.pop;
  });

  const rawTop = ranked.slice(0, 8).map(m => ({
    id: m.id,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : 0,
    release_date: m.release_date || '',
    poster_path: m.poster_path || '',
    poster_url: m.poster_path ? `${imgBase}${m.poster_path}` : '',
    overview: m.overview || '',
    director: '',
    cast_list: '',
    imdb_id: ''
  }));

  const enriched = await enrichFilmBatch(rawTop).catch(() => rawTop);
  const finalList = enriched.map((m, idx) => ({
    ...m,
    poster_path: m.poster_path || rawTop[idx]?.poster_path || '',
    poster_url: m.poster_url || rawTop[idx]?.poster_url || ''
  }));

  if (qDir) {
    return finalList.sort((a, b) => {
      const aDir = (a.director || '').toLowerCase().includes(qDir) ? 0 : 1;
      const bDir = (b.director || '').toLowerCase().includes(qDir) ? 0 : 1;
      return aDir - bDir;
    });
  }

  return finalList;
}


export async function saveToLibrary(item, entry) {
  const db = await initDb();
  const safeTitle = entry.title.replace(/[/\\:]/g, ' -').trim();
  const cleanFolderName = `${entry.year} - ${safeTitle} [${(entry.quality || '').trim()}]${entry.imdb_id?.trim() ? ` [imdbid-${entry.imdb_id.trim()}]` : ''}`;
  const destFolder = `${MEDIA_ROOT}/${cleanFolderName}`;

  if (item.sourcePath !== destFolder && await exists(destFolder)) {
    throw new Error(`Duplicate folder already exists: "${cleanFolderName}". Remove the old copy first or use a different quality label.`);
  }

  if (item.isDirectory) {
    if (item.sourcePath !== destFolder) await rename(item.sourcePath, destFolder);
  } else {
    await mkdir(destFolder, { recursive: true });
    await rename(item.sourcePath, `${destFolder}/${item.name}`);
  }
  await db.execute(
    `INSERT OR REPLACE INTO wishlist_videos (folder_name, title, year, quality, imdb_id, poster_url, director, cast_list, overview, watch_status, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owned')`,
    [
      cleanFolderName,
      entry.title.trim(),
      parseInt(entry.year),
      entry.quality?.trim() || '',
      entry.imdb_id || '',
      entry.poster_url || '',
      entry.director || '',
      entry.cast_list || '',
      entry.overview || '',
      entry.watch_status || ''
    ]
  );

  await writeJellyfinSidecars(`${MEDIA_ROOT}/${cleanFolderName}`, entry);
}

export async function saveWantedMovie(movie) {
  const db = await initDb();
  const title = (movie.title || '').trim();
  const year = Number(movie.year) || 0;
  if (!title) return;

  const existing = await db.select(
    `SELECT id FROM wishlist_videos WHERE LOWER(title) = LOWER(?) AND (year = ? OR ? = 0) AND (media_type IS NULL OR media_type = 'movie')`,
    [title, year, year]
  );
  if (existing.length > 0) return;

  const safeTitle = title.replace(/[/\\:]/g, ' -').trim();
  const folderName = `${year ? year + ' - ' : ''}${safeTitle}`;
  const watchStatus = movie.watch_status || '';

  await db.execute(
    `INSERT INTO wishlist_videos (
      folder_name, title, year, quality, imdb_id, poster_url, director, cast_list, overview, tags,
      watch_status, status, media_type, tmdb_id
    ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 'wanted', 'movie', ?)`,
    [
      folderName,
      title,
      year,
      movie.imdb_id || '',
      movie.poster_url || '',
      movie.director || '',
      movie.cast_list || '',
      movie.overview || '',
      movie.tags || '',
      watchStatus,
      Number(movie.id || movie.tmdb_id) || 0
    ]
  );
}


export async function updateExistingMovie(oldFolderName, existing, movie, onDisk) {
  const db = await initDb();
  const year = movie.year || existing?.year || '';
  const safeTitle = movie.title.replace(/[/\\:]/g, ' -').trim();
  const newFolderName = `${year} - ${safeTitle} [${(existing?.quality || '').trim()}]${movie.imdb_id?.trim() ? ` [imdbid-${movie.imdb_id.trim()}]` : ''}`;

  if (existing?.status !== 'wanted' && onDisk && oldFolderName !== newFolderName) {
    await rename(`${MEDIA_ROOT}/${oldFolderName}`, `${MEDIA_ROOT}/${newFolderName}`);
  }
  await db.execute(
    `UPDATE wishlist_videos SET folder_name=?, title=?, year=COALESCE(NULLIF(?,''),year), imdb_id=?, poster_url=?, director=?, cast_list=?, overview=? WHERE folder_name=?`,
    [newFolderName, movie.title, year, movie.imdb_id, movie.poster_url, movie.director, movie.cast_list, movie.overview, oldFolderName]
  );

  if (existing?.status !== 'wanted' && onDisk) {
    await writeJellyfinSidecars(`${MEDIA_ROOT}/${newFolderName}`, {
      ...movie,
      year,
      tags: existing?.tags || '',
      clips: existing?.clips || ''
    });
  }
}


export async function enrichFilmBatch(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 6) {
    const batch = list.slice(i, i + 6);
    const enrichedBatch = await Promise.all(
      batch.map(async (item) => {
        if (item.director || item.cast_list) return item;
        try {
          const full = await fetchEnrichedMovie({
            id: item.id,
            title: item.title,
            release_date: item.release_date,
            poster_path: item.poster_path,
            overview: item.overview
          });
          return { ...item, director: full.director, cast_list: full.cast_list, imdb_id: full.imdb_id };
        } catch (_) {
          return item;
        }
      })
    );
    out.push(...enrichedBatch);
  }
  return out;
}

export async function fetchPersonFilmography(personName, selectedPersonId = null) {
  const host = ["api", "themoviedb", "org"].join(".");
  const cleanName = String(personName || '').trim();
  if (!cleanName && !selectedPersonId) throw new Error("No person name provided.");

  let matches = [];
  let activePerson = null;

  if (cleanName) {
    const fetchPage = async (page) => {
      const u = new URL(`https://${host}/3/search/person`);
      u.searchParams.set("api_key", TMDB_API_KEY);
      u.searchParams.set("query", cleanName);
      u.searchParams.set("page", String(page));
      u.searchParams.set("include_adult", "true");
      const r = await tauriFetch(u.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
      const d = await r.json();
      return d.results || [];
    };

    const page1 = await fetchPage(1);
    const seenIds = new Set();

    matches = page1
      .filter(p => {
        if (!p.id || seenIds.has(p.id)) return false;
        seenIds.add(p.id);
        const hasFullName = p.name.trim().includes(' ');
        const hasCredits = Array.isArray(p.known_for) && p.known_for.length > 0;
        return hasFullName ? hasCredits : (hasCredits && p.popularity > 1.5);
      })
      .slice(0, 12)
      .map(p => {
        const topCredit = p.known_for?.at(0);
        const knownTitle = topCredit?.title || topCredit?.name || '';
        return {
          id: p.id,
          name: p.name,
          knownFor: p.known_for_department || '',
          knownTitle
        };
      });

    activePerson = selectedPersonId
      ? matches.find(p => p.id === selectedPersonId) || matches.at(0)
      : matches.at(0);
  } else if (selectedPersonId) {
    activePerson = { id: selectedPersonId, name: '', knownFor: '' };
  }

  if (!activePerson) return { name: cleanName, knownFor: '', matches: [], directed: [], acted: [], tvShows: [] };

  const creditsUrl = new URL(`https://${host}/3/person/${activePerson.id}/combined_credits`);
  creditsUrl.searchParams.set("api_key", TMDB_API_KEY);

  const cRes = await tauriFetch(creditsUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  const cData = await cRes.json();

  const posterBase = ["https:/", "image.tmdb.org", "t", "p", "w185"].join("/");
  const formatMovieCredit = (m, roleLabel = '') => ({
    id: m.id,
    media_type: 'movie',
    title: m.title,
    year: m.release_date ? m.release_date.slice(0, 4) : '',
    release_date: m.release_date || '',
    poster_path: m.poster_path || '',
    poster_url: m.poster_path ? posterBase + m.poster_path : '',
    overview: m.overview || '',
    role: roleLabel
  });

  const seenDir = new Set();
  const directed = (cData.crew || [])
    .filter(m => m.media_type === 'movie' && m.job === 'Director' && m.id && !seenDir.has(m.id) && seenDir.add(m.id))
    .map(m => formatMovieCredit(m, 'Director'))
    .sort((a, b) => b.release_date.localeCompare(a.release_date));

  const seenCast = new Set();
  const acted = (cData.cast || [])
    .filter(m => m.media_type === 'movie' && m.id && !seenCast.has(m.id) && seenCast.add(m.id))
    .map(m => formatMovieCredit(m, m.character || 'Cast'))
    .sort((a, b) => b.release_date.localeCompare(a.release_date));

  const tvMap = new Map();
  for (const item of [...(cData.cast || []), ...(cData.crew || [])]) {
    if (item.media_type !== 'tv' || !item.id) continue;
    const role = item.character || item.job || '';
    if (!tvMap.has(item.id)) {
      tvMap.set(item.id, {
        id: item.id,
        media_type: 'tv',
        title: item.name,
        year: item.first_air_date ? Number(item.first_air_date.slice(0, 4)) : 0,
        release_date: item.first_air_date || '',
        poster_path: item.poster_path || '',
        poster_url: item.poster_path ? posterBase + item.poster_path : '',
        overview: item.overview || '',
        role,
        episode_count: item.episode_count || 0,
        seasons: [1]
      });
    } else if (role && !tvMap.get(item.id).role.includes(role)) {
      tvMap.get(item.id).role = [tvMap.get(item.id).role, role].filter(Boolean).join(', ');
    }
  }

  const tvShows = [...tvMap.values()]
    .sort((a, b) => (b.episode_count || 0) - (a.episode_count || 0) || b.release_date.localeCompare(a.release_date))
    .slice(0, 18);

  return {
    id: activePerson.id,
    name: activePerson.name,
    knownFor: activePerson.knownFor,
    matches,
    directed,
    acted,
    tvShows
  };
}


export async function findTmdbByImdbId(imdbId) {
  const host = ["api", "themoviedb", "org"].join(".");
  const url = new URL(`https://${host}/3/find/${imdbId.trim()}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("external_source", "imdb_id");

  const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  const data = await res.json();
  const hits = data.movie_results || [];
  return await Promise.all(hits.slice(0, 3).map(m => fetchEnrichedMovie(m)));
}

export function parseBulkLines(rawText) {
  return rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      let working = line;

      // 1. Extract IMDb ID (tt1234567) anywhere on the line
      const imdbMatch = working.match(/\b(tt\d{6,9})\b/i);
      const imdbId = imdbMatch ? imdbMatch.at(1).toLowerCase() : '';
      if (imdbMatch) working = working.replace(imdbMatch.at(0), '');

      // 2. Split by comma, tab, or pipe if present; otherwise extract (Year)
      const parts = working.split(/[,|\t]+/).map(p => p.trim()).filter(Boolean);
      let title = '';
      let year = '';
      let director = '';

      if (parts.length >= 2) {
        title = parts.at(0);
        for (const part of parts.slice(1)) {
          const yMatch = part.match(/^(19\d{2}|20\d{2})$/);
          if (yMatch && !year) year = yMatch.at(1);
          else if (!director) director = part;
        }
      } else {
        const yMatch = working.match(/[\(\[]?(19\d{2}|20\d{2})[\)\]]?/);
        if (yMatch) {
          year = yMatch.at(1);
          title = working.slice(0, yMatch.index).replace(/[-–—\s]+$/, '').trim();
          director = working.slice(yMatch.index + yMatch.at(0).length).replace(/^[-–—\s]+/, '').trim();
        } else {
          title = working.trim();
        }
      }

      return {
        key: `bulk:${idx}:${Date.now()}`,
        raw: line,
        title,
        year,
        director,
        imdbId,
        matches: [],
        selected: null,
        status: 'pending'
      };
    });
}

export async function searchWikipediaMovie(title, year = '', director = '') {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error("Enter a movie title to search Wikipedia.");

  const wikiHost = ["en", "wikipedia", "org"].join(".");
  const apiPath = ["w", "api.php"].join("/");

  const runWikiSearch = async (srsearch) => {
    const searchUrl = new URL(`https://${wikiHost}/${apiPath}`);
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("list", "search");
    searchUrl.searchParams.set("srsearch", srsearch);
    searchUrl.searchParams.set("srlimit", "10");
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("origin", "*");

    const sRes = await tauriFetch(searchUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
    const sData = await sRes.json();
    return sData.query?.search || [];
  };

  const safeTitle = cleanTitle.replace(/"/g, '');
  const filmFilter = '(hastemplate:"Infobox film" OR hastemplate:"Infobox adult film" OR hastemplate:"Infobox television" OR intitle:"film")';

  let rawHits = await runWikiSearch(`intitle:"${safeTitle}" ${year} ${filmFilter}`.trim());
  if (rawHits.length === 0) {
    rawHits = await runWikiSearch(`intitle:"${safeTitle}" ${filmFilter}`);
  }
  if (rawHits.length === 0) {
    const keywords = safeTitle.split(/\s+/).filter(w => w.length > 2).map(w => `intitle:${w}`).join(' ');
    if (keywords) rawHits = await runWikiSearch(`${keywords} film`);
  }

  const hits = rawHits
    .filter(h => !/^\d{4}\s+in\s+film$/i.test(h.title) && !/^list\s+of\s+/i.test(h.title))
    .slice(0, 6);

  const enriched = await Promise.all(
    hits.map(async (hit) => {
      const pageTitle = hit.title;
      const encoded = encodeURIComponent(pageTitle.replace(/ /g, '_'));
      const summaryPath = ["api", "rest_v1", "page", "summary", encoded].join("/");

      let overview = '';
      let poster_url = '';
      try {
        const sumRes = await tauriFetch(`https://${wikiHost}/${summaryPath}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (sumRes.ok) {
          const sumData = await sumRes.json();
          overview = sumData.extract || '';
          poster_url = sumData.thumbnail?.source || '';
        }
      } catch (_) {}

      let isFilmArticle = /\(film\)|\(\d{4}\s+film\)|\(TV\s+film\)|\(miniseries\)/i.test(pageTitle);
      let parsedDirector = '';
      let parsedCast = '';
      let parsedYear = String(year || '').replace(/\D/g, '').slice(0, 4);
      let parsedImdb = '';

      try {
        const parseUrl = new URL(`https://${wikiHost}/${apiPath}`);
        parseUrl.searchParams.set("action", "parse");
        parseUrl.searchParams.set("page", pageTitle);
        parseUrl.searchParams.set("prop", "wikitext");
        parseUrl.searchParams.set("section", "0");
        parseUrl.searchParams.set("format", "json");
        parseUrl.searchParams.set("origin", "*");

        const pRes = await tauriFetch(parseUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
        const pData = await pRes.json();
        const wiki = pData.parse?.wikitext?.['*'] || '';

        if (/\{\{\s*Infobox\s+(?:film|adult\s+film|television|hollywood\s+cartoon|animanga)/i.test(wiki)) {
          isFilmArticle = true;
        }
        if (!isFilmArticle && /\bis\s+a(?:n)?\s+\d{4}\s+[^.]{0,60}\b(?:film|documentary|feature|movie)\b/i.test(overview)) {
          isFilmArticle = true;
        }

        const cleanWikiVal = (raw) =>
          raw
            .replace(/\{\{(?:plainlist|flatlist|unbulleted list|ubl|hlist)\s*\|?/gi, '')
            .replace(/\{\{small\s*\|([^}]*)\}\}/gi, '$1')
            .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
            .replace(/\{\{[^}]*\}\}/g, '')
            .replace(/\}\}/g, '')
            .replace(/<[^>]+>/g, ', ')
            .replace(/\s*\*\s*/g, ', ')
            .replace(/\|/g, ', ')
            .replace(/'''?/g, '')
            .replace(/\s+/g, ' ')
            .replace(/,\s*,+/g, ',')
            .replace(/^[\s,]+|[\s,]+$/g, '')
            .trim();

        const dirMatch = wiki.match(/\|\s*director\s*=\s*([\s\S]*?)(?=\n\s*\||\n\}\})/i);
        if (dirMatch) {
          parsedDirector = cleanWikiVal(dirMatch.at(1))
            .replace(/\s*\([^)]*\)/g, '')
            .replace(/,\s*,+/g, ',')
            .replace(/^[\s,]+|[\s,]+$/g, '')
            .trim();
        }

        const castMatch = wiki.match(/\|\s*starring\s*=\s*([\s\S]*?)(?=\n\s*\||\n\}\})/i);
        if (castMatch) {
          parsedCast = cleanWikiVal(castMatch.at(1))
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 5)
            .join(', ');
        }

        const yearMatch = wiki.match(/\|\s*released\s*=\s*[^\n]*?(19\d{2}|20\d{2})/i) || pageTitle.match(/\((19\d{2}|20\d{2})/);
        if (yearMatch) parsedYear = yearMatch.at(1);

        const imdbMatch = wiki.match(/\b(tt\d{6,9})\b/i);
        if (imdbMatch) parsedImdb = imdbMatch.at(1).toLowerCase();
      } catch (_) {}

      const cleanMovieTitle = pageTitle.replace(/\s*\([^)]*(?:film|miniseries|series)[^)]*\)\s*$/i, '').trim();

      return {
        id: `wiki:${hit.pageid}`,
        isFilmArticle,
        title: cleanMovieTitle,
        year: parsedYear,
        release_date: parsedYear ? `${parsedYear}-01-01` : '',
        poster_url,
        poster_path: '',
        imdb_id: parsedImdb,
        director: parsedDirector,
        cast_list: parsedCast,
        overview
      };
    })
  );

  return enriched.filter(m => m.isFilmArticle).slice(0, 5);
}

export async function updateMovieTagsAndClips(folderName, tags, clips) {
  const db = await initDb();
  const cleanTags = String(tags || '').trim();
  const cleanClips = String(clips || '').trim();

  await db.execute(
    `UPDATE wishlist_videos SET tags = ?, clips = ? WHERE folder_name = ?`,
    [cleanTags, cleanClips, folderName]
  );

  const rows = await db.select("SELECT * FROM wishlist_videos WHERE folder_name = ?", [folderName]);
  const entry = rows.at(0);
  if (entry && entry.status !== 'wanted') {
    try {
      await writeJellyfinSidecars(`${MEDIA_ROOT}/${folderName}`, entry);
    } catch (_) {}
  }
}

export async function writeJellyfinSidecars(folderPath, entry) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const directors = (entry.director || '').split(',').map(s => s.trim()).filter(Boolean);
  const actors = (entry.cast_list || '').split(',').map(s => s.trim()).filter(Boolean);
  const tags = [
    ...(entry.tags || '').split(',').map(s => s.trim()),
    ...(entry.clips || '').split(',').map(s => s.trim())
  ].filter(Boolean);

  const nfoXml = [
    '<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
    '<movie>',
    `  <title>${esc(entry.title)}</title>`,
    entry.year ? `  <year>${esc(entry.year)}</year>` : '',
    entry.overview ? `  <plot>${esc(entry.overview)}</plot>` : '',
    entry.imdb_id ? `  <imdbid>${esc(entry.imdb_id)}</imdbid>` : '',
    entry.imdb_id ? `  <uniqueid type="imdb" default="true">${esc(entry.imdb_id)}</uniqueid>` : '',
    ...directors.map(d => `  <director>${esc(d)}</director>`),
    ...actors.map(a => `  <actor><name>${esc(a)}</name></actor>`),
    ...tags.map(t => `  <tag>${esc(t)}</tag>`),
    '</movie>'
  ].filter(Boolean).join('\n');

  await writeTextFile(`${folderPath}/movie.nfo`, nfoXml);

  if (entry.poster_url) {
    const imgRes = await tauriFetch(entry.poster_url, {
      method: 'GET',
      headers: { 'User-Agent': 'GuppyMediaCatalog/1.0' }
    });
    if (!imgRes.ok) {
      throw new Error(`Poster HTTP ${imgRes.status} for ${entry.poster_url}`);
    }
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    await writeFile(`${folderPath}/poster.jpg`, bytes);
  }
}

export async function syncAllJellyfinSidecars(diskFolders, onProgress) {
  const db = await initDb();
  const rows = await db.select("SELECT * FROM wishlist_videos WHERE status != 'wanted' ORDER BY title ASC");
  const onDisk = rows.filter(r => diskFolders.includes(r.folder_name));

  let done = 0;
  let written = 0;
  let firstError = '';

  for (let i = 0; i < onDisk.length; i += 5) {
    const batch = onDisk.slice(i, i + 5);
    await Promise.all(
      batch.map(async (entry) => {
        try {
          await writeJellyfinSidecars(`${MEDIA_ROOT}/${entry.folder_name}`, entry);
          written += 1;
        } catch (err) {
          if (!firstError) firstError = `${entry.folder_name}: ${err}`;
        }
        done += 1;
        onProgress?.(done, onDisk.length);
      })
    );
  }

  if (firstError && written === 0) throw new Error(firstError);
  return { written, total: onDisk.length, firstError };
}

async function resolveTmdbId(movie) {
  if (!movie) return null;
  if (Number(movie.tmdb_id)) return Number(movie.tmdb_id);

  const host = ["api", "themoviedb", "org"].join(".");
  const isTv = movie.media_type === 'tv';

  if (movie.imdb_id) {
    try {
      const findRes = await tauriFetch(
        `https://${host}/3/find/${encodeURIComponent(movie.imdb_id)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
        { method: 'GET', headers: { 'Accept': 'application/json' } }
      );
      if (findRes.ok) {
        const findData = await findRes.json();
        const hit = isTv
          ? (findData.tv_results?.at(0) || findData.movie_results?.at(0))
          : (findData.movie_results?.at(0) || findData.tv_results?.at(0));
        if (hit?.id) return Number(hit.id);
      }
    } catch (_) {}
  }

  if (movie.title) {
    try {
      const kind = isTv ? 'tv' : 'movie';
      const url = new URL(`https://${host}/3/search/${kind}`);
      url.searchParams.set("api_key", TMDB_API_KEY);
      url.searchParams.set("query", movie.title);
      if (movie.year) {
        url.searchParams.set(isTv ? "first_air_date_year" : "primary_release_year", String(movie.year));
      }
      const searchRes = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const hit = searchData.results?.at(0);
        if (hit?.id) return Number(hit.id);
      }
    } catch (_) {}
  }

  return null;
}

export async function fetchMovieDetails(movie) {
  const isTv = movie?.media_type === 'tv';
  const kind = isTv ? 'tv' : 'movie';
  const id = isTv ? (movie.tmdb_id || movie.id || await resolveTmdbId(movie)) : (movie.tmdb_id || movie.id || await resolveTmdbId(movie));
  if (!id) return null;

  const host = ["api", "themoviedb", "org"].join(".");
  const res = await tauriFetch(
    `https://${host}/3/${kind}/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits,release_dates,content_ratings`,
    { method: 'GET', headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) return null;
  const d = await res.json();

  const crew = d.credits?.crew || [];
  const cast = d.credits?.cast || [];
  const directors = isTv
    ? (d.created_by || []).map(c => c.name)
    : crew.filter(c => c.job === 'Director').map(c => c.name);
  const writers = [...new Set(crew.filter(c => ['Writer', 'Screenplay', 'Story'].includes(c.job)).map(c => c.name))].slice(0, 3).join(', ');
  const cinematographer = crew.find(c => c.job === 'Director of Photography')?.name || '';
  const fullCast = cast.slice(0, 16).map(c => ({ name: c.name, character: c.character || '' }));

  if (isTv) {
    const usRating = (d.content_ratings?.results || []).find(r => r.iso_3166_1 === 'US')?.rating || '';
    const epRuntime = Array.isArray(d.episode_run_time) && d.episode_run_time.length > 0 ? d.episode_run_time[0] : null;
    return {
      tagline: d.tagline || '',
      original_title: d.original_name && d.original_name !== d.name ? d.original_name : '',
      overview: d.overview || '',
      director: directors.join(', '),
      writers,
      cinematographer,
      fullCast,
      runtime: epRuntime,
      certification: usRating,
      countries: (d.origin_country || []).join(', '),
      languages: d.original_language || '',
      genres: (d.genres || []).map(g => g.name).join(', '),
      studios: (d.networks || d.production_companies || []).map(c => c.name).slice(0, 3)
    };
  }

  const usRelease = (d.release_dates?.results || []).find(r => r.iso_3166_1 === 'US');
  const cert = (usRelease?.release_dates || []).find(rd => rd.certification)?.certification || '';
  return {
    tagline: d.tagline || '',
    original_title: d.original_title && d.original_title !== d.title ? d.original_title : '',
    overview: d.overview || '',
    director: directors.join(', '),
    writers,
    cinematographer,
    fullCast,
    runtime: d.runtime || null,
    certification: cert,
    countries: (d.production_countries || []).map(c => c.name).join(', '),
    languages: d.original_language || '',
    genres: (d.genres || []).map(g => g.name).join(', '),
    studios: (d.production_companies || []).map(c => c.name).slice(0, 3)
  };
}


export async function fetchMovieKeywords(movie) {
  const isTv = movie?.media_type === 'tv';
  const kind = isTv ? 'tv' : 'movie';
  const id = isTv ? (movie.tmdb_id || await resolveTmdbId(movie)) : await resolveTmdbId(movie);
  if (!id) return [];

  const host = ["api", "themoviedb", "org"].join(".");
  const [detailsRes, kwRes] = await Promise.all([
    tauriFetch(`https://${host}/3/${kind}/${id}?api_key=${TMDB_API_KEY}`, { method: 'GET', headers: { 'Accept': 'application/json' } }),
    tauriFetch(`https://${host}/3/${kind}/${id}/keywords?api_key=${TMDB_API_KEY}`, { method: 'GET', headers: { 'Accept': 'application/json' } })
  ]);

  const details = detailsRes.ok ? await detailsRes.json().catch(() => ({})) : {};
  const kwData = kwRes.ok ? await kwRes.json().catch(() => ({})) : {};

  const genres = (details.genres || []).map(g => g.name.toLowerCase());
  // TMDb uses `keywords` for movies and `results` for TV shows
  const rawKeywords = kwData.keywords || kwData.results || [];
  const keywords = rawKeywords.map(k => k.name.toLowerCase());

  return [...new Set([...genres, ...keywords])];
}


export async function getMovieFolderFiles(folderName, root = MEDIA_ROOT) {
  try {
    const entries = await readDir(`${root}/${folderName}`);
    return entries.filter(e => e.isFile && !e.name.startsWith('.')).map(e => e.name).sort();
  } catch (_) {
    return [];
  }
}


export const DELETED_ROOT = "/Volumes/4TB0-SEAGATE/jelly/deleted";

export async function removeMovieFromLibrary(folderName, isOnDisk = false) {
  const db = await initDb();
  const rows = await db.select("SELECT media_type FROM wishlist_videos WHERE folder_name = ?", [folderName]);
  const rootDir = rows.at(0)?.media_type === 'tv' ? TV_ROOT : MEDIA_ROOT;
  const sourcePath = `${rootDir}/${folderName}`;

  if (isOnDisk && folderName && await exists(sourcePath).catch(() => false)) {
    try {
      await mkdir(DELETED_ROOT, { recursive: true });
    } catch (_) {}

    let destPath = `${DELETED_ROOT}/${folderName}`;
    try {
      const existingDeleted = await readDir(DELETED_ROOT);
      if (existingDeleted.some(e => e.name === folderName)) {
        destPath = `${DELETED_ROOT}/${folderName} (${Date.now()})`;
      }
    } catch (_) {}

    await rename(sourcePath, destPath);
  }

  await db.execute("DELETE FROM wishlist_videos WHERE folder_name = ?", [folderName]);
}

export async function updateMovieWatchStatus(folderName, watchStatus) {
  const db = await initDb();
  await db.execute(
    `UPDATE wishlist_videos SET watch_status = ? WHERE folder_name = ?`,
    [watchStatus || '', folderName]
  );
}

export async function searchUniversal(query) {
  console.log('[Guppy Search] 1. Start query:', query);
  const q = (query || '').trim();
  if (!q) return { queryName: '', people: [], movies: [], tvShows: [] };

  const host = ["api", "themoviedb", "org"].join(".");
  const imgBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");

  const fetchJson = async (label, url) => {
    try {
      console.log(`[Guppy Search] fetching ${label}:`, url.toString());
      const res = await tauriFetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      const json = await res.json();
      console.log(`[Guppy Search] ${label} done, count:`, json.results?.length ?? 'ok');
      return json;
    } catch (err) {
      console.error(`[Guppy Search] ${label} FAILED:`, err);
      return { results: [] };
    }
  };

  const personUrl = new URL(`https://${host}/3/search/person`);
  personUrl.searchParams.set("api_key", TMDB_API_KEY);
  personUrl.searchParams.set("query", q);
  personUrl.searchParams.set("include_adult", "true");

  const movieUrl = new URL(`https://${host}/3/search/movie`);
  movieUrl.searchParams.set("api_key", TMDB_API_KEY);
  movieUrl.searchParams.set("query", q);
  movieUrl.searchParams.set("include_adult", "true");

  const tvUrl = new URL(`https://${host}/3/search/tv`);
  tvUrl.searchParams.set("api_key", TMDB_API_KEY);
  tvUrl.searchParams.set("query", q);
  tvUrl.searchParams.set("include_adult", "true");

  const [pData, mData, tData] = await Promise.all([
    fetchJson('person-search', personUrl),
    fetchJson('movie-search', movieUrl),
    fetchJson('tv-search', tvUrl)
  ]);

  console.log('[Guppy Search] 2. Initial 3 searches finished');

  const rawPeople = (pData.results || []).slice(0, 8);
  const people = await Promise.all(
    rawPeople.map(async (p) => {
      const pDetailUrl = new URL(`https://${host}/3/person/${p.id}`);
      pDetailUrl.searchParams.set("api_key", TMDB_API_KEY);
      const pd = await fetchJson(`person-${p.id}`, pDetailUrl);
      const birthYear = pd.birthday ? pd.birthday.slice(0, 4) : '';
      const deathYear = pd.deathday ? pd.deathday.slice(0, 4) : '';
      const profileUrl = p.profile_path
        ? `${imgBase}${p.profile_path}`
        : (pd.profile_path ? `${imgBase}${pd.profile_path}` : '');

      const yearSpan = birthYear
        ? (deathYear ? `${birthYear}–${deathYear}` : `${birthYear}–`)
        : '';

      return {
        id: p.id,
        name: p.name,
        yearSpan,
        poster_url: profileUrl,
        department: p.known_for_department || '',
        knownFor: (p.known_for || []).slice(0, 4).map(k => k.title || k.name).filter(Boolean).join(', ')
      };
    })
  );

  console.log('[Guppy Search] 3. People enriched:', people.length);

  const rawMovies = (mData.results || []).slice(0, 12).map(m => ({
    id: m.id,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : 0,
    poster_path: m.poster_path || '',
    poster_url: m.poster_path ? `${imgBase}${m.poster_path}` : '',
    overview: m.overview || '',
    director: '',
    cast_list: '',
    imdb_id: ''
  }));

  console.log('[Guppy Search] 4. Running enrichFilmBatch on', rawMovies.length, 'movies');
  const enriched = await enrichFilmBatch(rawMovies).catch((err) => {
    console.error('[Guppy Search] enrichFilmBatch FAILED:', err);
    return rawMovies;
  });
  console.log('[Guppy Search] 5. enrichFilmBatch finished');

  const movies = enriched.map((m, idx) => {
    const pPath = m.poster_path || rawMovies[idx]?.poster_path || '';
    const pUrl = m.poster_url || rawMovies[idx]?.poster_url || (pPath ? `${imgBase}${pPath}` : '');
    return { ...m, poster_path: pPath, poster_url: pUrl };
  });

  let rawTv = (tData.results || []).slice(0, 6);
  if (rawTv.length === 0 && rawPeople.length > 0) {
    const topPersonId = rawPeople.at(0).id;
    const pTvUrl = new URL(`https://${host}/3/person/${topPersonId}/tv_credits`);
    pTvUrl.searchParams.set("api_key", TMDB_API_KEY);
    const pTvData = await fetchJson(`person-tv-${topPersonId}`, pTvUrl);
    const seenTv = new Set();
    rawTv = [...(pTvData.cast || []), ...(pTvData.crew || [])]
      .filter(s => s.id && !seenTv.has(s.id) && seenTv.add(s.id))
      .sort((a, b) => (b.episode_count || 0) - (a.episode_count || 0))
      .slice(0, 6);
  }

  const tvShows = await Promise.all(
    rawTv.map(async (show) => {
      let seasons = Array.of(1);
      const startYear = show.first_air_date ? show.first_air_date.slice(0, 4) : '';
      const dUrl = new URL(`https://${host}/3/tv/${show.id}`);
      dUrl.searchParams.set("api_key", TMDB_API_KEY);
      const dData = await fetchJson(`tv-${show.id}`, dUrl);

      const valid = (dData.seasons || [])
        .filter(s => Number(s.season_number) > 0)
        .map(s => Number(s.season_number));
      if (valid.length > 0) seasons = valid;
      const endYear = dData.last_air_date ? dData.last_air_date.slice(0, 4) : '';
      const inProduction = Boolean(dData.in_production);

      const yearSpan = startYear
        ? (inProduction ? `${startYear}–` : (endYear && endYear !== startYear ? `${startYear}–${endYear}` : startYear))
        : '';

      return {
        id: show.id,
        media_type: 'tv',
        title: show.name,
        year: Number(startYear) || 0,
        yearSpan,
        poster_path: show.poster_path || '',
        poster_url: show.poster_path ? `${imgBase}${show.poster_path}` : '',
        overview: show.overview || '',
        seasons
      };
    })
  );

  console.log('[Guppy Search] 6. Returning results:', { people: people.length, movies: movies.length, tvShows: tvShows.length });
  return { queryName: q, people, movies, tvShows };
}

export async function searchTmdbTv(title, year = '') {
  const rawInput = (title || '').trim();
  if (!rawInput) return [];

  let parsedSeason = null;
  const seasonMatch = rawInput.match(/(?:^|\s|[-–:])(?:season|s)\s*0*(\d{1,2})\b/i);
  if (seasonMatch) {
    parsedSeason = Number(seasonMatch[1]);
  }
  const cleanTitle = rawInput
    .replace(/(?:^|\s|[-–:])(?:season|s)\s*0*\d{1,2}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanTitle) return [];

  const host = ["api", "themoviedb", "org"].join(".");
  const imgBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");

  const url = new URL(`https://${host}/3/search/tv`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("query", cleanTitle);
  url.searchParams.set("include_adult", "true");

  const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  const data = await res.json();
  const target = cleanTitle.toLowerCase();

  const sorted = (data.results || []).sort((a, b) => {
    const aExact = (a.name || '').toLowerCase() === target ? 0 : 1;
    const bExact = (b.name || '').toLowerCase() === target ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aStarts = (a.name || '').toLowerCase().startsWith(target) ? 0 : 1;
    const bStarts = (b.name || '').toLowerCase().startsWith(target) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    const aYear = year && a.first_air_date?.startsWith(String(year)) ? 0 : 1;
    const bYear = year && b.first_air_date?.startsWith(String(year)) ? 0 : 1;
    if (aYear !== bYear) return aYear - bYear;
    return (b.popularity || 0) - (a.popularity || 0);
  });

  const topShows = sorted.slice(0, 6);
  return await Promise.all(
    topShows.map(async (show) => {
      let seasons = Array.of(1);
      try {
        const dUrl = new URL(`https://${host}/3/tv/${show.id}`);
        dUrl.searchParams.set("api_key", TMDB_API_KEY);
        const dRes = await tauriFetch(dUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
        const dData = await dRes.json();
        const valid = (dData.seasons || [])
          .filter(s => Number(s.season_number) > 0)
          .map(s => Number(s.season_number));
        if (valid.length > 0) seasons = valid;
      } catch (_) {}

      return {
        id: show.id,
        media_type: 'tv',
        title: show.name,
        season_number: parsedSeason,
        seasons,
        release_date: show.first_air_date || '',
        poster_path: show.poster_path || '',
        poster_url: show.poster_path ? `${imgBase}${show.poster_path}` : '',
        overview: show.overview || '',
        director: '',
        cast_list: '',
        imdb_id: ''
      };
    })
  );
}


export async function fetchTvSeasonDetails(tvId, seasonNumber) {
  const host = ["api", "themoviedb", "org"].join(".");
  const imgBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");

  const seasonUrl = new URL(`https://${host}/3/tv/${tvId}/season/${seasonNumber}`);
  seasonUrl.searchParams.set("api_key", TMDB_API_KEY);
  seasonUrl.searchParams.set("append_to_response", "credits,external_ids");

  const showUrl = new URL(`https://${host}/3/tv/${tvId}`);
  showUrl.searchParams.set("api_key", TMDB_API_KEY);

  const [sRes, showRes] = await Promise.all([
    tauriFetch(seasonUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } }),
    tauriFetch(showUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } })
  ]);

  const [data, showData] = await Promise.all([sRes.json(), showRes.json()]);

  const posterPath = data.poster_path || showData.poster_path || '';
  const castList = (data.credits?.cast || showData.credits?.cast || []).slice(0, 8).map(c => c.name).join(', ');
  const episodes = (data.episodes || []).map(ep => ({
    episode_number: ep.episode_number,
    name: ep.name || `Episode ${ep.episode_number}`,
    air_date: ep.air_date || '',
    overview: ep.overview || ''
  }));

  return {
    season_number: Number(seasonNumber),
    air_date: data.air_date || showData.first_air_date || '',
    poster_url: posterPath ? `${imgBase}${posterPath}` : '',
    overview: data.overview || showData.overview || '',
    cast_list: castList,
    imdb_id: data.external_ids?.imdb_id || '',
    episodes
  };
}

export function parseLooseTvFilename(fileName) {
  const noExt = fileName.replace(/\.[^.]+$/, '');
  const clean = noExt.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Matches: "S02E03", "s02 e03", "2x03", or "season 1 episode 1" / "season1 ep01"
  const m = clean.match(/^(.*?)\b(?:s(\d{1,2})\s*e(\d{1,3})|(\d{1,2})x(\d{1,3})|season\s*0*(\d{1,2})\s*(?:episode|ep|e)\s*0*(\d{1,3}))\b/i);
  if (!m) return null;

  const rawTitle = (m[1] || '').replace(/[-–:\s]+$/, '').trim();
  const seasonNum = Number(m[2] || m[4] || m[6]) || 1;
  const epNum = Number(m[3] || m[5] || m[7]) || 1;
  if (!rawTitle) return null;

  const yearMatch = rawTitle.match(/\(?((?:19|20)\d{2})\)?$/);
  const year = yearMatch ? yearMatch[1] : '';
  const title = yearMatch
    ? rawTitle.replace(/\(?((?:19|20)\d{2})\)?$/, '').replace(/[-–:\s]+$/, '').trim()
    : rawTitle;

  return {
    title,
    year,
    season_number: seasonNum,
    episode_number: epNum,
    normKey: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '')}::s${seasonNum}`
  };
}


export async function saveTvSeasonToLibrary(item, entry) {
  const db = await initDb();
  const seasonNum = Number(entry.season_number) || 1;
  const sPad = String(seasonNum).padStart(2, '0');
  const safeShow = entry.title.replace(/[/\\:]/g, ' -').trim();
  const seasonYear = entry.year || (entry.air_date ? entry.air_date.slice(0, 4) : '');
  const cleanFolderName = `${seasonYear ? seasonYear + ' - ' : ''}${safeShow} - s${sPad}`;
  const destFolder = `${TV_ROOT}/${cleanFolderName}`;

  await mkdir(destFolder, { recursive: true });

  const videoExts = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'ts', 'webm']);
  const incomingEpisodes = Array.isArray(entry.episodes) ? entry.episodes.map(e => ({ ...e })) : [];
  const epMap = new Map(incomingEpisodes.map(e => [Number(e.episode_number), e]));
  const movedEpNums = new Set();

  // Move files from grouped loose files (item.files), single file, or season directory into destFolder
  if (Array.isArray(item.files) && item.files.length > 0) {
    for (const f of item.files) {
      if (f.sourcePath && f.sourcePath !== `${destFolder}/${f.name}`) {
        await rename(f.sourcePath, `${destFolder}/${f.name}`);
      }
    }
  } else if (item.sourcePath && item.sourcePath !== destFolder) {
    if (item.isDirectory) {
      const srcEntries = await readDir(item.sourcePath).catch(() => []);
      for (const f of srcEntries) {
        if (f.isFile && !f.name.startsWith('.')) {
          await rename(`${item.sourcePath}/${f.name}`, `${destFolder}/${f.name}`);
        }
      }
      const leftover = await readDir(item.sourcePath).catch(() => []);
      if (leftover.filter(e => !e.name.startsWith('.')).length === 0) {
        await remove(item.sourcePath, { recursive: true }).catch(() => {});
      }
    } else {
      await rename(item.sourcePath, `${destFolder}/${item.name}`);
    }
  }

  // Rename episode video files inside destFolder to: Show Name - s03e02 - Episode Title.ext
  const dirEntries = await readDir(destFolder).catch(() => []);
  for (const file of dirEntries) {
    if (!file.isFile || file.name.startsWith('.')) continue;
    const dotIdx = file.name.lastIndexOf('.');
    if (dotIdx === -1) continue;
    const ext = file.name.slice(dotIdx + 1).toLowerCase();
    if (!videoExts.has(ext)) continue;

    const match = file.name.match(/s\d{1,2}\s*e(\d{1,3})/i)
      || file.name.match(/\b\d{1,2}x(\d{1,3})\b/i)
      || file.name.match(/\b(?:episode|ep|e)\s*0*(\d{1,3})\b/i);
    if (!match) continue;

    const epNum = Number(match[1]);
    const epMeta = epMap.get(epNum);
    const ePad = String(epNum).padStart(2, '0');
    const safeEpTitle = (epMeta?.name || `Episode ${epNum}`).replace(/[/\\:*?"<>|]/g, ' -').trim();
    const newFileName = `${safeShow} - s${sPad}e${ePad} - ${safeEpTitle}.${ext}`;

    if (file.name !== newFileName) {
      await rename(`${destFolder}/${file.name}`, `${destFolder}/${newFileName}`);
    }
    if (epMeta) epMeta.file_name = newFileName;
    movedEpNums.add(epNum);
  }

  // Merge with any existing DB row (e.g. partial season or wanted season) so existing progress isn't lost
  const existingRows = await db.select(`SELECT * FROM wishlist_videos WHERE folder_name = ?`, [cleanFolderName]);
  const existing = existingRows.at(0);
  const prevEpisodes = (() => {
    try {
      return existing?.episodes_json ? JSON.parse(existing.episodes_json) : [];
    } catch (_) {
      return [];
    }
  })();
  const prevByNum = new Map(prevEpisodes.map(ep => [Number(ep.episode_number), ep]));

  const bulkWatch = (entry.watch_status === 'liked' || entry.watch_status === 'disliked')
    ? entry.watch_status
    : '';

  const allEpNums = [...new Set([
    ...incomingEpisodes.map(e => Number(e.episode_number)),
    ...prevEpisodes.map(e => Number(e.episode_number)),
    ...movedEpNums
  ])].sort((a, b) => a - b);

  const mergedEpisodes = allEpNums.map(epNum => {
    const fresh = epMap.get(epNum) || {};
    const old = prevByNum.get(epNum) || {};
    const finalFile = fresh.file_name || old.file_name || '';

    const epWatch = movedEpNums.has(epNum)
      ? (bulkWatch || old.watch_status || '')
      : (old.watch_status || '');

    return {
      episode_number: epNum,
      name: fresh.name || old.name || `Episode ${epNum}`,
      air_date: fresh.air_date || old.air_date || '',
      overview: fresh.overview || old.overview || '',
      file_name: finalFile,
      watch_status: epWatch,
      tags: old.tags || '',
      clips: old.clips || ''
    };
  });

  const rolledWatch = computeSeasonWatchStatus(mergedEpisodes);
  const mergedTags = [...new Set([
    ...(existing?.tags || '').split(',').map(s => s.trim()).filter(Boolean),
    ...(entry.tags || '').split(',').map(s => s.trim()).filter(Boolean)
  ])].join(', ');

  const totalEps = mergedEpisodes.length;
  const ownedEps = mergedEpisodes.filter(ep => Boolean(ep.file_name)).length;
  const seasonStatus = (totalEps > 0 && ownedEps >= totalEps) ? 'owned' : 'wanted';

  await db.execute(
    `INSERT OR REPLACE INTO wishlist_videos (
      folder_name, title, year, quality, imdb_id, poster_url, director, cast_list, overview, tags,
      watch_status, status, media_type, season_number, episodes_json, tmdb_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tv', ?, ?, ?)`,
    [
      cleanFolderName,
      entry.title.trim(),
      Number(seasonYear) || 0,
      entry.quality?.trim() || existing?.quality || '',
      entry.imdb_id || existing?.imdb_id || '',
      entry.poster_url || existing?.poster_url || '',
      entry.director || existing?.director || '',
      entry.cast_list || existing?.cast_list || '',
      entry.overview || existing?.overview || '',
      mergedTags,
      rolledWatch,
      seasonStatus,
      seasonNum,
      JSON.stringify(mergedEpisodes),
      Number(entry.tmdb_id) || existing?.tmdb_id || 0
    ]
  );


  await writeJellyfinTvSidecars(destFolder, {
    ...entry,
    season_number: seasonNum,
    year: seasonYear
  }, mergedEpisodes);
}


export async function saveWantedTvSeason(show, seasonNumber = 1) {
  const db = await initDb();
  const seasonNum = Number(seasonNumber) || 1;
  const sPad = String(seasonNum).padStart(2, '0');
  const seasonData = await fetchTvSeasonDetails(show.id, seasonNum).catch(() => ({}));
  const safeShow = show.title.replace(/[/\\:]/g, ' -').trim();
  const seasonYear = seasonData.air_date
    ? Number(seasonData.air_date.slice(0, 4))
    : (Number(show.year) || 0);
  const cleanFolderName = `${seasonYear ? seasonYear + ' - ' : ''}${safeShow} - s${sPad}`;

  await db.execute(
    `INSERT OR REPLACE INTO wishlist_videos (
      folder_name, title, year, quality, imdb_id, poster_url, director, cast_list, overview,
      watch_status, status, media_type, season_number, episodes_json, tmdb_id
    ) VALUES (?, ?, ?, '', ?, ?, '', ?, ?, '', 'wanted', 'tv', ?, ?, ?)`,
    [
      cleanFolderName,
      show.title.trim(),
      seasonYear,
      seasonData.imdb_id || '',
      seasonData.poster_url || show.poster_url || '',
      seasonData.cast_list || '',
      seasonData.overview || show.overview || '',
      seasonNum,
      JSON.stringify(seasonData.episodes || []),
      Number(show.id) || 0
    ]
  );
}
export async function writeJellyfinTvSidecars(folderPath, entry, episodes = []) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const seasonNum = Number(entry.season_number) || 1;
  const seasonTags = (entry.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  const seasonClips = (entry.clips || '').split(',').map(s => s.trim()).filter(Boolean);

  const seasonXml = [
    `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`,
    `<season>`,
    `  <title>Season ${seasonNum}</title>`,
    `  <seasonnumber>${seasonNum}</seasonnumber>`,
    entry.year ? `  <year>${esc(entry.year)}</year>` : '',
    entry.overview ? `  <plot>${esc(entry.overview)}</plot>` : '',
    ...seasonTags.map(t => `  <tag>${esc(t)}</tag>`),
    ...seasonClips.map(c => `  <tag>clip: ${esc(c)}</tag>`),
    `</season>`
  ].filter(Boolean).join('\n');

  await writeTextFile(`${folderPath}/season.nfo`, seasonXml);

  if (entry.poster_url) {
    try {
      const imgRes = await tauriFetch(entry.poster_url, { method: 'GET' });
      const buf = await imgRes.arrayBuffer();
      await writeFile(`${folderPath}/poster.jpg`, new Uint8Array(buf));
    } catch (_) {}
  }

  for (const ep of episodes) {
    if (!ep.file_name) continue;
    const baseName = ep.file_name.replace(/\.[^/.]+$/, '');
    const epTags = (ep.tags || '').split(',').map(s => s.trim()).filter(Boolean);
    const epClips = (ep.clips || '').split(',').map(s => s.trim()).filter(Boolean);
    const watched = ep.watch_status === 'liked' || ep.watch_status === 'disliked' ? 'true' : 'false';

    const epXml = [
      `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`,
      `<episodedetails>`,
      `  <title>${esc(ep.name)}</title>`,
      `  <season>${seasonNum}</season>`,
      `  <episode>${Number(ep.episode_number)}</episode>`,
      ep.air_date ? `  <aired>${esc(ep.air_date)}</aired>` : '',
      ep.overview ? `  <plot>${esc(ep.overview)}</plot>` : '',
      `  <watched>${watched}</watched>`,
      ...epTags.map(t => `  <tag>${esc(t)}</tag>`),
      ...epClips.map(c => `  <tag>clip: ${esc(c)}</tag>`),
      `</episodedetails>`
    ].filter(Boolean).join('\n');

    await writeTextFile(`${folderPath}/${baseName}.nfo`, epXml);
  }
}
export async function updateSeasonEpisodes(folderName, episodes) {
  const db = await initDb();
  const rolledWatch = computeSeasonWatchStatus(episodes);
  await db.execute(
    `UPDATE wishlist_videos SET episodes_json = ?, watch_status = ? WHERE folder_name = ?`,
    [JSON.stringify(episodes), rolledWatch, folderName]
  );

  const rows = await db.select(`SELECT * FROM wishlist_videos WHERE folder_name = ?`, [folderName]);
  const entry = rows.at(0);
  if (entry && entry.status !== 'wanted') {
    const destFolder = `${TV_ROOT}/${folderName}`;
    if (await exists(destFolder)) {
      await writeJellyfinTvSidecars(destFolder, entry, episodes);
    }
  }
}

export function computeSeasonWatchStatus(episodes = []) {
  if (!Array.isArray(episodes) || episodes.length === 0) return '';
  const statuses = episodes.map(ep => ep.watch_status || '');
  if (statuses.every(s => s === '')) return '';
  if (statuses.every(s => s === 'disliked')) return 'disliked';
  if (statuses.every(s => s === 'liked' || s === 'disliked')) return 'liked';
  return 'unfinished';
}

export async function exportCatalogToJson() {
  const db = await initDb();
  const rows = await db.select(`SELECT * FROM wishlist_videos ORDER BY title ASC, year ASC, season_number ASC`);

  const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'ts', 'webm']);
  const exportedItems = [];

  for (const row of rows) {
    const isTv = row.media_type === 'tv';
    const rootDir = isTv ? TV_ROOT : MEDIA_ROOT;
    const folderPath = row.folder_name ? `${rootDir}/${row.folder_name}` : '';
    const onDisk = row.status !== 'wanted' && folderPath ? await exists(folderPath).catch(() => false) : false;

    let filesOnDisk = [];
    if (onDisk) {
      const dirEntries = await readDir(folderPath).catch(() => []);
      filesOnDisk = dirEntries
        .filter(e => e.isFile && VIDEO_EXTS.has((e.name.split('.').pop() || '').toLowerCase()))
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    const baseRecord = {
      media_type: isTv ? 'tv' : 'movie',
      status: row.status || 'owned',
      on_disk: onDisk,
      title: row.title || '',
      year: Number(row.year) || null,
      quality: row.quality || '',
      watch_status: row.watch_status || 'unseen',
      tags: (row.tags || '').split(',').map(s => s.trim()).filter(Boolean),
      clips: row.clips || '',
      director: row.director || '',
      cast: (row.cast_list || '').split(',').map(s => s.trim()).filter(Boolean),
      overview: row.overview || '',
      imdb_id: row.imdb_id || '',
      tmdb_id: Number(row.tmdb_id) || null,
      poster_url: row.poster_url || '',
      folder_name: row.folder_name || '',
      folder_path: onDisk ? folderPath : ''
    };

    if (isTv) {
      let parsedEpisodes = [];
      try {
        parsedEpisodes = row.episodes_json ? JSON.parse(row.episodes_json) : [];
      } catch (_) {}

      const filesSet = new Set(filesOnDisk);
      const episodes = parsedEpisodes.map(ep => {
        const epFile = ep.file_name || '';
        const epOnDisk = Boolean(epFile && filesSet.has(epFile));
        return {
          episode_number: Number(ep.episode_number) || 0,
          name: ep.name || '',
          air_date: ep.air_date || '',
          overview: ep.overview || '',
          watch_status: ep.watch_status || 'unseen',
          tags: (ep.tags || '').split(',').map(s => s.trim()).filter(Boolean),
          clips: ep.clips || '',
          file_name: epFile,
          file_path: epOnDisk ? `${folderPath}/${epFile}` : '',
          on_disk: epOnDisk
        };
      });

      exportedItems.push({
        ...baseRecord,
        season_number: Number(row.season_number) || 1,
        files_on_disk: filesOnDisk,
        episodes
      });
    } else {
      const primaryFile = filesOnDisk.at(0) || '';
      exportedItems.push({
        ...baseRecord,
        file_name: primaryFile,
        file_path: primaryFile ? `${folderPath}/${primaryFile}` : '',
        files_on_disk: filesOnDisk
      });
    }
  }

  return {
    exported_at: new Date().toISOString(),
    total_entries: exportedItems.length,
    movies_count: exportedItems.filter(i => i.media_type === 'movie').length,
    tv_seasons_count: exportedItems.filter(i => i.media_type === 'tv').length,
    items: exportedItems
  };
}
