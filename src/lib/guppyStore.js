import { GUPPY_CONFIG } from '$lib/guppyConfig.js';
import { runDbMigrations } from '$lib/dbMigrations.js';
export { GUPPY_CONFIG };
export const TMDB_API_KEY = GUPPY_CONFIG.tmdbApiKey;

export const MEDIA_ROOT = GUPPY_CONFIG.artFilmsRoot;
export const THE_MOVIES_ROOT = GUPPY_CONFIG.theMoviesRoot;
export const TV_ROOT = GUPPY_CONFIG.tvRoot;
export const DELETED_ROOT = GUPPY_CONFIG.deletedRoot;
export const VIDEO_EXTS = GUPPY_CONFIG.videoExts;

export function notifyRemoteClients() {
  window.fetch(`${GUPPY_CONFIG.serverUrl}/api/notify`, {
    method: 'POST',
    headers: { 'X-Guppy-Token': GUPPY_CONFIG.lanApiToken }
  }).catch(() => {});
}

import * as tauriFs from '@tauri-apps/plugin-fs';
import { fetch as pluginFetch } from '@tauri-apps/plugin-http';
import TauriDatabase from '@tauri-apps/plugin-sql';

let resolvedRemoteServer = null;

function getLanFetcher() {
  return window.fetch.bind(window);
}

async function getRemoteServer() {
  if (resolvedRemoteServer !== null) return resolvedRemoteServer;

  if (typeof window !== 'undefined') {
    if (window.__GUPPY_FORCE_HOST__) { resolvedRemoteServer = ''; return ''; }
    if (!window.__TAURI_INTERNALS__) {
      resolvedRemoteServer = `${window.location.protocol}//${window.location.hostname}:${GUPPY_CONFIG.hostPort}`;
      return resolvedRemoteServer;
    }
    const isHostMac = await tauriFs.exists(GUPPY_CONFIG.hostJellyRoot).catch(() => false);
    if (!isHostMac) {
      const fetcher = getLanFetcher();
      const ipBase = GUPPY_CONFIG.serverUrl;
      const mdnsBase = `http://${GUPPY_CONFIG.hostMdns}:${GUPPY_CONFIG.hostPort}`;

      for (const lanBase of [ipBase, mdnsBase]) {
        try {
          const probe = await fetcher(`${lanBase}/health`, { method: 'GET' });
          if (probe.ok) {
            resolvedRemoteServer = lanBase;
            return resolvedRemoteServer;
          }
        } catch (_) {}
      }

      resolvedRemoteServer = ipBase;
      return resolvedRemoteServer;
    }
  }

  resolvedRemoteServer = '';
  return resolvedRemoteServer;
}

export async function getConnectionStatus() {
  resolvedRemoteServer = null;
  const remote = await getRemoteServer();
  const isRemote = Boolean(remote);
  let serverOk = false;

  if (isRemote) {
    try {
      const fetcher = getLanFetcher();
      const res = await fetcher(`${remote}/health`, { method: 'GET' });
      serverOk = res.ok;
    } catch (_) {
      serverOk = false;
    }
  } else {
    try {
      const fetcher = getLanFetcher();
      const localHealth = `${GUPPY_CONFIG.serverUrl}/health`;
      const res = await fetcher(localHealth, { method: 'GET' });
      serverOk = res.ok;
    } catch (_) {
      serverOk = false;
    }
  }

  let driveMounted = false;
  if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) {
    driveMounted = serverOk;
  } else {
    try {
      driveMounted =
        (await tauriFs.exists(GUPPY_CONFIG.hostJellyRoot).catch(() => false)) ||
        (await tauriFs.exists(`${GUPPY_CONFIG.localShareMount}/the-movies`).catch(() => false)) ||
        (await tauriFs.exists(`${GUPPY_CONFIG.localShareMount}/tv-shows`).catch(() => false));
    } catch (_) {
      driveMounted = false;
    }
  }

  return {
    mode: isRemote ? 'remote' : 'host',
    serverUrl: remote || GUPPY_CONFIG.serverUrl,
    serverOk,
    driveMounted
  };
}

export async function isRemoteClient() {
  const remote = await getRemoteServer();
  return Boolean(remote);
}

const tauriFetch = (url, opts) => (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__ ? window.fetch(url, opts) : pluginFetch(url, opts));

async function callRemote(endpoint, payload) {
  const remote = await getRemoteServer();
  const fetcher = getLanFetcher();
  const res = await fetcher(`${remote}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Guppy-Client': 'remote',
      'X-Guppy-Token': GUPPY_CONFIG.lanApiToken
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

const Database = {
  load: async (connStr) => {
    if ((await getRemoteServer()) || (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__)) {
      return {
        select: async (sql, params = []) => (await callRemote('/api/sql/select', { sql, params })).rows,
        execute: async (sql, params = []) => await callRemote('/api/sql/execute', { sql, params })
      };
    }
    return await TauriDatabase.load(connStr);
  }
};

export const readDir = async (path) =>
  (await getRemoteServer()) ? (await callRemote('/api/fs/readDir', { path })).entries : tauriFs.readDir(path);

const exists = async (path) =>
  (await getRemoteServer()) ? (await callRemote('/api/fs/exists', { path })).exists : tauriFs.exists(path);

const mkdir = async (path, opts = {}) =>
  (await getRemoteServer()) ? void (await callRemote('/api/fs/mkdir', { path, ...opts })) : tauriFs.mkdir(path, opts);

const rename = async (oldPath, newPath) =>
  (await getRemoteServer()) ? void (await callRemote('/api/fs/rename', { oldPath, newPath })) : tauriFs.rename(oldPath, newPath);

const remove = async (path, opts = {}) =>
  (await getRemoteServer()) ? void (await callRemote('/api/fs/remove', { path, ...opts })) : tauriFs.remove(path, opts);

export const writeTextFile = async (path, contents) =>
  (await getRemoteServer()) ? void (await callRemote('/api/fs/writeTextFile', { path, contents })) : tauriFs.writeTextFile(path, contents);

const writeFile = async (path, bytes) => {
  if (await getRemoteServer()) {
    let binary = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    await callRemote('/api/fs/writeFile', { path, bytesBase64: btoa(binary) });
    return;
  }
  return tauriFs.writeFile(path, bytes);
};

import { openPath } from '@tauri-apps/plugin-opener';

export function isAdultEntry(item) {
  return (item?.tags || '')
    .toLowerCase()
    .split(',')
    .map(t => t.trim())
    .includes('adult');
}

export function getMediaRoot(itemOrMeta) {
  if (!itemOrMeta) return THE_MOVIES_ROOT;
  if (itemOrMeta.media_type === "tv") return TV_ROOT;
  return isAdultEntry(itemOrMeta) ? MEDIA_ROOT : THE_MOVIES_ROOT;
}

export async function migrateNonAdultMovies() {
  const db = await initDb();
  await mkdir(THE_MOVIES_ROOT, { recursive: true }).catch(() => {});
  const rows = await db.select(
    `SELECT folder_name, tags FROM wishlist_videos
     WHERE (media_type IS NULL OR media_type = 'movie')
       AND COALESCE(status, 'owned') != 'wanted'
       AND folder_name IS NOT NULL AND folder_name != ''`
  );
  let movedCount = 0;
  for (const row of rows) {
    if (isAdultEntry(row)) continue;
    const src = `${MEDIA_ROOT}/${row.folder_name}`;
    const dst = `${THE_MOVIES_ROOT}/${row.folder_name}`;
    if ((await exists(src).catch(() => false)) && !(await exists(dst).catch(() => false))) {
      try {
        await rename(src, dst);
        movedCount += 1;
      } catch (err) {
        console.warn(`Could not migrate ${row.folder_name} to the-movies:`, err);
      }
    }
  }
  return movedCount;
}

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
  const resMatch = s.match(/(?:^|[^0-9a-z])(2160p?|4k|1080p?|720p?|576p?|480p?|360p?)(?:$|[^0-9a-z])/i);
  const res = resMatch
    ? (() => {
        const rawR = resMatch.at(1).toLowerCase();
        if (rawR === '4k' || rawR === '2160' || rawR === '2160p') return '2160p';
        return rawR.endsWith('p') ? rawR : `${rawR}p`;
      })()
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


export function editDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const dp = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = dp[j];
      dp[j] = s.charCodeAt(i - 1) === t.charCodeAt(j - 1)
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[t.length];
}

export function fuzzyTextIncludes(haystack, query) {
  const h = String(haystack || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const q = String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (!q) return true;
  if (!h) return false;
  if (h.includes(q)) return true;
  const qTokens = q.split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  if (qTokens.length === 0) return false;
  const hTokens = h.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  return qTokens.every(qt => {
    const maxEdits = qt.length >= 7 ? 2 : 1;
    return hTokens.some(ht => ht.includes(qt) || (Math.abs(ht.length - qt.length) <= maxEdits && editDistance(ht, qt) <= maxEdits));
  });
}

export function inferMetadata(rawName) {
  let cleaned = rawName.replace(/\.[^/.]+$/, '');
  const imdbMatch = cleaned.match(/\[imdbid-(tt\d+)\]/i);
  const imdb_id = imdbMatch ? imdbMatch.at(1) : '';
  const quality = extractQuality(cleaned);

  cleaned = cleaned.replace(/\[[^\]]*\]/g, '').replace(/^(?:\d{1,2}[._-]\d{1,2}[._-](?:19|20)\d{2}|(?:19|20)\d{2}[._-]\d{1,2}[._-]\d{1,2})[\s._-]+/, '').trim();

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

  rawTitle = rawTitle
    .replace(/(?:^|[\s._-])(?:RET_[A-Z0-9_]+|2160p?|4K|1080p?|720p?|576p?|480p?|360p?|BluRay|BDRip|BRRip|WEB-?DL|WEBRip|DVDRip|DVD|HDTV|VHS|x264|x265|HEVC|AAC|AC3)(?:$|[\s._-]).*$/i, '');
  const title = rawTitle.replace(/^[-\s._]+/, '').replace(/[-\s._]+$/, '').replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    title,
    year,
    quality,
    poster_url: '',
    imdb_id,
    imdb_id_source: imdb_id ? 'folder-name' : '',
    director: '',
    cast_list: '',
    overview: ''
  };
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

let initDbPromise = null;

async function initializeDb() {
  const db = await Database.load("sqlite:local_media.db");
  await runDbMigrations(db);
  const origExecute = db.execute.bind(db);
  db.execute = async (...args) => {
    const res = await origExecute(...args);
    notifyRemoteClients();
    return res;
  };

  return db;
}

export async function initDb() {
  if (!initDbPromise) {
    initDbPromise = initializeDb().catch(err => {
      initDbPromise = null;
      throw err;
    });
  }
  return initDbPromise;
}

function formatWatchLabel(status) {
  if (status === 'liked') return 'Seen & Liked';
  if (status === 'unfinished') return 'Unfinished';
  if (status === 'disliked') return 'Seen & Disliked';
  return 'Unseen';
}

export async function logActivity(action, title, detail = '', undoPayload = null) {
  try {
    const remote = await getRemoteServer();
    const isRemote = Boolean(remote);
    const fullDetail = ['__SOURCE__', detail].filter(Boolean).join(' · ');
    const fetcher = getLanFetcher();
    const insertRes = await fetcher(`${GUPPY_CONFIG.serverUrl}/api/sql/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Guppy-Client': isRemote ? 'remote' : 'host',
        'X-Guppy-Token': GUPPY_CONFIG.lanApiToken
      },
      body: JSON.stringify({
        sql: `INSERT INTO activity_log (action, title, detail, undo_payload) VALUES (?, ?, ?, ?)`,
        params: [String(action || ''), String(title || ''), fullDetail, undoPayload ? JSON.stringify(undoPayload) : '']
      })
    });
    if (!insertRes.ok) throw new Error(`Activity log write failed (${insertRes.status})`);
    const inserted = await insertRes.json();
    await fetcher(`${GUPPY_CONFIG.serverUrl}/api/sql/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Guppy-Client': isRemote ? 'remote' : 'host',
        'X-Guppy-Token': GUPPY_CONFIG.lanApiToken
      },
      body: JSON.stringify({
        sql: `DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 500)`,
        params: []
      })
    });
    return undoPayload ? Number(inserted.lastInsertRowid) || null : null;
  } catch (_) {}
}

export async function loadActivityLog(limit = 40) {
  const db = await initDb();
  return await db.select(
    `SELECT id, created_at, action, title, detail, undo_payload FROM activity_log ORDER BY id DESC LIMIT ?`,
    [Number(limit) || 40]
  );
}

const libraryEntryColumns = [
  'id', 'folder_name', 'title', 'year', 'quality', 'imdb_id', 'imdb_id_source', 'poster_url', 'director',
  'cast_list', 'overview', 'status', 'tags', 'clips', 'watch_status', 'media_type',
  'season_number', 'episodes_json', 'tmdb_id', 'runtime', 'countries', 'genres'
];

function matchesLibraryEntry(row, expected) {
  return Boolean(expected) &&
    libraryEntryColumns.every(column => (row[column] ?? null) === (expected[column] ?? null));
}

async function restoreLibraryEntry(db, entry) {
  const placeholders = libraryEntryColumns.map(() => '?').join(', ');
  await db.execute(
    `INSERT INTO wishlist_videos (${libraryEntryColumns.join(', ')}) VALUES (${placeholders})`,
    libraryEntryColumns.map(column => entry[column] ?? null)
  );
}

export async function undoActivity(activityId) {
  const db = await initDb();
  const logs = await db.select(
    `SELECT id, action, title, undo_payload FROM activity_log WHERE id = ?`,
    [Number(activityId)]
  );
  const log = logs.at(0);
  if (!log?.undo_payload) throw new Error('This activity can no longer be undone.');

  let payload;
  try {
    payload = JSON.parse(log.undo_payload);
  } catch {
    throw new Error('The saved undo data is invalid.');
  }

  let undoDetail = '';
  if (payload.type === 'watch-status') {
    const rows = await db.select(
      `SELECT watch_status FROM wishlist_videos WHERE folder_name = ?`,
      [payload.folder_name]
    );
    if (!rows.length) throw new Error('The title no longer exists in the catalog.');
    if ((rows[0].watch_status || '') !== payload.after) {
      throw new Error('Watch status changed since this action; refusing to overwrite the newer value.');
    }
    await db.execute(
      `UPDATE wishlist_videos SET watch_status = ? WHERE folder_name = ?`,
      [payload.before, payload.folder_name]
    );
  } else if (payload.type === 'tags-clips') {
    const rows = await db.select(
      `SELECT tags, clips FROM wishlist_videos WHERE folder_name = ?`,
      [payload.folder_name]
    );
    if (!rows.length) throw new Error('The title no longer exists in the catalog.');
    if ((rows[0].tags || '') !== payload.afterTags || (rows[0].clips || '') !== payload.afterClips) {
      throw new Error('Tags or clips changed since this action; refusing to overwrite the newer values.');
    }
    await db.execute(
      `UPDATE wishlist_videos SET tags = ?, clips = ? WHERE folder_name = ?`,
      [payload.beforeTags, payload.beforeClips, payload.folder_name]
    );
    const restoredRows = await db.select(`SELECT * FROM wishlist_videos WHERE folder_name = ?`, [payload.folder_name]);
    const restored = restoredRows.at(0);
    if (restored && restored.status !== 'wanted') {
      try {
        const targetRoot = getMediaRoot(restored);
        const otherRoot = targetRoot === MEDIA_ROOT ? THE_MOVIES_ROOT : MEDIA_ROOT;
        const targetPath = `${targetRoot}/${restored.folder_name}`;
        const otherPath = `${otherRoot}/${restored.folder_name}`;
        if (await exists(otherPath).catch(() => false) && !(await exists(targetPath).catch(() => false))) {
          await mkdir(targetRoot, { recursive: true });
          await rename(otherPath, targetPath);
        }
        if (await exists(targetPath).catch(() => false)) await writeEntrySidecars(restored);
      } catch (err) {
        undoDetail = `Sidecar update failed: ${String(err)}`;
      }
    }
  } else if (payload.type === 'delete-created-entry') {
    const rows = await db.select(
      `SELECT * FROM wishlist_videos WHERE id = ?`,
      [payload.entry_id]
    );
    if (!rows.length || rows[0].folder_name !== payload.folder_name ||
        rows[0].status !== 'wanted' || !matchesLibraryEntry(rows[0], payload.expectedEntry)) {
      throw new Error('The wanted title changed since it was added; refusing to delete the newer entry.');
    }
    await db.execute(`DELETE FROM wishlist_videos WHERE id = ?`, [payload.entry_id]);
  } else if (payload.type === 'replace-entry') {
    const rows = await db.select(
      `SELECT * FROM wishlist_videos WHERE id = ?`,
      [payload.entry_id]
    );
    if (!rows.length || rows[0].folder_name !== payload.entry.folder_name ||
        rows[0].status !== 'wanted' || !matchesLibraryEntry(rows[0], payload.expectedEntry)) {
      throw new Error('The wanted title changed since it was added; refusing to replace the newer entry.');
    }
    const assignments = libraryEntryColumns.map(column => `${column} = ?`).join(', ');
    await db.execute(
      `UPDATE wishlist_videos SET ${assignments} WHERE id = ?`,
      [...libraryEntryColumns.map(column => payload.entry[column] ?? null), payload.entry_id]
    );
  } else if (payload.type === 'restore-entry') {
    const conflicts = await db.select(
      `SELECT id FROM wishlist_videos WHERE folder_name = ? OR id = ?`,
      [payload.entry.folder_name, payload.entry.id]
    );
    if (conflicts.length) throw new Error('A catalog entry now conflicts with the original title.');

    if (payload.trashPath) {
      if (!(await exists(payload.trashPath).catch(() => false))) {
        throw new Error('The removed folder is no longer in the Deleted folder.');
      }
      if (await exists(payload.sourcePath).catch(() => false)) {
        throw new Error('The original folder path is occupied; move that folder before undoing.');
      }
      const sourceParent = payload.sourcePath.split('/').slice(0, -1).join('/');
      await mkdir(sourceParent, { recursive: true });
      await rename(payload.trashPath, payload.sourcePath);
      try {
        await restoreLibraryEntry(db, payload.entry);
      } catch (err) {
        await rename(payload.sourcePath, payload.trashPath);
        throw err;
      }
    } else {
      await restoreLibraryEntry(db, payload.entry);
    }
  } else {
    throw new Error('This activity type does not support undo.');
  }

  await db.execute(`UPDATE activity_log SET undo_payload = '' WHERE id = ?`, [Number(activityId)]);
  await logActivity(`Undid ${log.action}`, log.title, undoDetail);
  return true;
}

export async function clearActivityLog() {
  const db = await initDb();
  await db.execute(`DELETE FROM activity_log`);
}

async function fetchImdbSuggestion(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { d: [] };

  const browserOrigin = typeof window !== 'undefined' && !window.__TAURI_INTERNALS__
    ? window.location?.origin
    : '';
  let url;
  if (browserOrigin) {
    url = new URL('/api/imdb-suggest', browserOrigin);
    url.searchParams.set('q', cleanQuery);
  } else {
    const firstChar = cleanQuery.toLowerCase().replace(/[^a-z0-9]/g, '').charAt(0) || 'x';
    url = `${GUPPY_CONFIG.imdbSuggestBase}/${firstChar}/${encodeURIComponent(cleanQuery)}.json`;
  }

  const response = await tauriFetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`IMDb suggestion lookup failed (${response.status}).`);
  return response.json();
}

async function lookupImdbTtFallback(title, year, director = '') {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return { imdb_id: '', imdb_id_source: '', imdb_lookup_status: 'not_attempted', imdb_lookup_error: '' };
  const failures = [];
  const cleanDir = String(director || '').split(',').at(0).trim();
  const norm = (s) => String(s || '')
    .replace(/\s*\((?:[IVX]+|(?:19|20)\d{2})\)\s*$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const targetNorm = norm(cleanTitle);
  const targetYear = Number(year) || 0;
  let lookupSucceeded = false;

  // 1. Query IMDb public suggestion endpoint with Title + Director, Title + Year, and Title
  const suggestQueries = [
    ...(cleanDir ? [`${cleanTitle} ${cleanDir}`] : []),
    ...(targetYear ? [`${cleanTitle} ${targetYear}`] : []),
    cleanTitle
  ];
  for (const sq of suggestQueries) {
    try {
      const data = await fetchImdbSuggestion(sq);
      lookupSucceeded = true;
      const list = Array.isArray(data?.d) ? data.d : [];
      const exactTitleHits = list
        .filter(entry => entry?.id && /^tt\d{6,9}$/i.test(entry.id) && norm(entry.l) === targetNorm)
        .sort((a, b) => {
          if (!targetYear) return 0;
          const da = a.y ? Math.abs(Number(a.y) - targetYear) : 50;
          const db = b.y ? Math.abs(Number(b.y) - targetYear) : 50;
          return da - db;
        });
      if (exactTitleHits.length > 0) {
        const best = exactTitleHits.at(0);
        if (!targetYear || !best.y || Math.abs(Number(best.y) - targetYear) <= 5) {
          return {
            imdb_id: best.id.toLowerCase(),
            imdb_id_source: 'imdb-suggestion',
            imdb_lookup_status: 'matched',
            imdb_lookup_error: ''
          };
        }
      }
    } catch (err) {
      failures.push(err);
    }
  }

  // 2. Fallback to Wikidata film search + P345 (IMDb ID)
  const srQueries = [
    ...(cleanDir ? [`"${cleanTitle}" "${cleanDir}"`] : []),
    ...(targetYear ? [`"${cleanTitle}" film ${targetYear}`] : []),
    `"${cleanTitle}" film`
  ];
  const qIdSet = new Set();
  for (const srq of srQueries) {
    try {
      const wdSearch = new URL(GUPPY_CONFIG.wikidataApiBase);
      wdSearch.searchParams.set('action', 'query');
      wdSearch.searchParams.set('list', 'search');
      wdSearch.searchParams.set('srsearch', srq);
      wdSearch.searchParams.set('srlimit', '8');
      wdSearch.searchParams.set('format', 'json');
      const sRes = await tauriFetch(wdSearch.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
      if (!sRes.ok) throw new Error(`Wikidata search failed (${sRes.status}).`);
      const sData = await sRes.json();
      lookupSucceeded = true;
      for (const item of (sData?.query?.search || [])) {
        if (/^Q\d+$/.test(item.title)) qIdSet.add(item.title);
      }
      if (qIdSet.size > 0) break;
    } catch (err) {
      failures.push(err);
    }
  }
  const qIds = [...qIdSet];
  if (qIds.length > 0) {
    try {
      const wdGet = new URL(GUPPY_CONFIG.wikidataApiBase);
      wdGet.searchParams.set('action', 'wbgetentities');
      wdGet.searchParams.set('ids', qIds.join('|'));
      wdGet.searchParams.set('props', 'claims');
      wdGet.searchParams.set('format', 'json');
      const gRes = await tauriFetch(wdGet.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
      if (!gRes.ok) throw new Error(`Wikidata entity lookup failed (${gRes.status}).`);
      const gData = await gRes.json();
      for (const qId of qIds) {
        const ttVal = gData?.entities?.[qId]?.claims?.P345?.at(0)?.mainsnak?.datavalue?.value;
        if (ttVal && /^tt\d{6,9}$/i.test(ttVal)) {
          return {
            imdb_id: ttVal.toLowerCase(),
            imdb_id_source: 'wikidata',
            imdb_lookup_status: 'matched',
            imdb_lookup_error: ''
          };
        }
      }
    } catch (err) {
      failures.push(err);
    }
  }

  const error = failures.map(err => String(err?.message || err)).filter(Boolean).join(' ');
  return {
    imdb_id: '',
    imdb_id_source: '',
    imdb_lookup_status: failures.length
      ? (lookupSucceeded ? 'incomplete' : 'failed')
      : (lookupSucceeded ? 'no_match' : 'failed'),
    imdb_lookup_error: error || (!lookupSucceeded ? 'IMDb ID lookup services did not respond.' : '')
  };
}

const enrichedMovieCache = new Map();
export async function fetchEnrichedMovie(movie) {
  if (movie?.id && enrichedMovieCache.has(movie.id) && enrichedMovieCache.get(movie.id)?.imdb_id) return enrichedMovieCache.get(movie.id);
  const host = ["api", "themoviedb", "org"].join(".");
  const path = ["3", "movie", movie.id].join("/");
  const url = new URL(`https://${host}/${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("append_to_response", "credits,external_ids");

  const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`TMDb metadata lookup failed (${res.status}).`);
  const details = await res.json();
  const directorObj = details.credits?.crew?.find(c => c.job === 'Director');
  const topCast = (details.credits?.cast || []).slice(0, 5).map(c => c.name).join(', ');
  const runtime = details.runtime ? String(details.runtime) : '';
  const countries = (details.production_countries || []).map(c => c.name).filter(Boolean).join(', ');
  const genres = (details.genres || []).map(g => g.name).filter(Boolean).join(', ');
  const posterBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");
  let tmdbExternalImdb = details.external_ids?.imdb_id || details.imdb_id || '';
  tmdbExternalImdb = /^tt\d{6,9}$/i.test(tmdbExternalImdb) ? tmdbExternalImdb.toLowerCase() : '';

  if (!tmdbExternalImdb && movie?.id) {
    try {
      const externalUrl = `https://${host}/3/movie/${movie.id}/external_ids`;
      const externalRes = await tauriFetch(`${externalUrl}?api_key=${encodeURIComponent(TMDB_API_KEY)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
      const external = await externalRes.json();
      if (/^tt\d{6,9}$/i.test(external?.imdb_id || '')) {
        tmdbExternalImdb = external.imdb_id.toLowerCase();
      }
    } catch {}
  }

  const suppliedImdb = /^tt\d{6,9}$/i.test(movie?.imdb_id || '') ? movie.imdb_id.toLowerCase() : '';
  const fallback = tmdbExternalImdb || suppliedImdb
    ? { imdb_id: '', imdb_id_source: '', imdb_lookup_status: 'matched', imdb_lookup_error: '' }
    : await lookupImdbTtFallback(movie.title, movie.release_date?.slice(0, 4), directorObj ? directorObj.name : '');
  const imdbId = tmdbExternalImdb || suppliedImdb || fallback.imdb_id;
  const enrichedObj = {
    ...movie,
    title: movie.title,
    year: movie.release_date ? movie.release_date.slice(0, 4) : '',
    poster_url: movie.poster_path ? posterBase + movie.poster_path : '',
    imdb_id: imdbId,
    imdb_id_source: tmdbExternalImdb ? 'tmdb' : (movie?.imdb_id_source || (suppliedImdb ? 'provided' : fallback.imdb_id_source)),
    imdb_lookup_status: imdbId ? 'matched' : fallback.imdb_lookup_status,
    imdb_lookup_error: imdbId ? '' : fallback.imdb_lookup_error,
    director: directorObj ? directorObj.name : '',
    cast_list: topCast,
    overview: details.overview || '',
    runtime,
    countries,
    genres
  };
  if (movie?.id) enrichedMovieCache.set(movie.id, enrichedObj);
  return enrichedObj;
}

export async function searchTmdb(title, year = '', director = '', limit = 8) {
  const rawTitle = (title || '').trim();
  const inlineYearMatch = rawTitle.match(/\s*[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]\s*$/);
  const qTitle = inlineYearMatch ? rawTitle.replace(inlineYearMatch.at(0), '').trim() : rawTitle;
  const qYear = String(year || (inlineYearMatch ? inlineYearMatch.at(1) : '') || '').trim();
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
    if (!res.ok) throw new Error(`TMDb movie search failed (${res.status}).`);
    const data = await res.json();
    return data.results || [];
  };

  // When searching by Director + Year without a Title, look up the director via /3/search/person and pull their directed credits
  const fetchDirectorCandidates = async () => {
    if (!qDir) return [];
    const searchPerson = async (nameQuery) => {
      const pUrl = new URL(`https://${host}/3/search/person`);
      pUrl.searchParams.set("api_key", TMDB_API_KEY);
      pUrl.searchParams.set("query", nameQuery);
      pUrl.searchParams.set("include_adult", "true");
      const pRes = await tauriFetch(pUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!pRes.ok) throw new Error(`TMDb person search failed (${pRes.status}).`);
      const pData = await pRes.json();
      return pData.results || [];
    };

    let people = await searchPerson(qDir);
    if (people.length === 0 && qDir.includes(' ')) {
      const lastName = qDir.split(/\s+/).filter(Boolean).pop();
      if (lastName && lastName.length >= 2) people = await searchPerson(lastName);
    }

    const sortedPeople = [...people].sort((a, b) => {
      const aDir = a.known_for_department === 'Directing' ? 0 : 1;
      const bDir = b.known_for_department === 'Directing' ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return (b.popularity || 0) - (a.popularity || 0);
    }).slice(0, 3);

    const creditLists = await Promise.all(
      sortedPeople.map(async (p) => {
        const cUrl = new URL(`https://${host}/3/person/${p.id}/movie_credits`);
        cUrl.searchParams.set("api_key", TMDB_API_KEY);
        const cRes = await tauriFetch(cUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!cRes.ok) throw new Error(`TMDb director credits lookup failed (${cRes.status}).`);
        const cData = await cRes.json();
        return (cData.crew || []).filter(c => c.job === 'Director');
      })
    );
    return creditLists.flat();
  };

  // Always search by title broadly so ±1 year release discrepancies (like 1986 vs 1987) are never dropped
  const [broadResults, exactYearResults, directorOnlyResults] = await Promise.all([
    qTitle ? fetchCandidates(false) : Promise.resolve([]),
    (qTitle && qYear) ? fetchCandidates(true) : Promise.resolve([]),
    (!qTitle && qDir) ? fetchDirectorCandidates() : Promise.resolve([])
  ]);

  let rawCombined = [...exactYearResults, ...broadResults, ...directorOnlyResults];
  if (rawCombined.length === 0 && qTitle.length >= 5) {
    const trimmedTitle = qTitle.slice(0, -1);
    const retryUrl = new URL(`https://${host}/3/search/movie`);
    retryUrl.searchParams.set("api_key", TMDB_API_KEY);
    retryUrl.searchParams.set("query", trimmedTitle);
    retryUrl.searchParams.set("include_adult", "true");
    if (qYear) retryUrl.searchParams.set("primary_release_year", qYear);
    const retryRes = await tauriFetch(retryUrl.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (!retryRes.ok) throw new Error(`TMDb movie search failed (${retryRes.status}).`);
    const retryData = await retryRes.json();
    rawCombined = retryData.results || [];
  }
  const seenIds = new Set();
  const combined = rawCombined.filter(m => {
    if (!m.id || seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  const norm = (s) => (s || '').toLowerCase().replace(/^the\s+|^a\s+|^an\s+/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const targetNorm = norm(qTitle);
  const targetExact = qTitle.toLowerCase();
  const targetYearNum = Number(qYear) || 0;

  const targetWords = targetNorm ? targetNorm.split(' ').filter(Boolean) : [];

  const scoreCandidate = (m) => {
    const mExact = (m.title || '').toLowerCase();
    const mOrigExact = (m.original_title || '').toLowerCase();
    const mNorm = norm(m.title);
    const mOrigNorm = norm(m.original_title);
    const mYear = m.release_date ? Number(m.release_date.slice(0, 4)) : 0;
    const yearDiff = (targetYearNum && mYear) ? Math.abs(mYear - targetYearNum) : 99;

    const isExactTitle = Boolean(
      (targetExact && (mExact === targetExact || mOrigExact === targetExact)) ||
      (targetNorm && (mNorm === targetNorm || mOrigNorm === targetNorm))
    );

    const hasAllWords = targetWords.length > 0 && targetWords.every(w =>
      mNorm.includes(w) || mOrigNorm.includes(w)
    );
    const isCloseTitle = !isExactTitle && Boolean(
      targetNorm && (
        mNorm.startsWith(targetNorm) ||
        mNorm.includes(targetNorm) ||
        mOrigNorm.includes(targetNorm) ||
        hasAllWords ||
        fuzzyTextIncludes(mNorm, targetNorm) ||
        fuzzyTextIncludes(mOrigNorm, targetNorm)
      )
    );

    let tier = 5;
    if (!targetYearNum) {
      tier = isExactTitle ? 1 : (isCloseTitle ? 2 : 5);
    } else if (yearDiff === 0 && isExactTitle) {
      tier = 1;
    } else if (yearDiff === 0 && isCloseTitle) {
      tier = 2;
    } else if (yearDiff > 0 && isExactTitle) {
      tier = 3;
    } else if (yearDiff <= 5 && isCloseTitle) {
      tier = 4;
    } else if (yearDiff === 0) {
      tier = 5;
    }

    return { tier, yearDiff, pop: m.popularity || 0 };
  };

  const ranked = combined.sort((a, b) => {
    const sa = scoreCandidate(a);
    const sb = scoreCandidate(b);
    if (sa.tier !== sb.tier) return sa.tier - sb.tier;
    if (sa.yearDiff !== sb.yearDiff) return sa.yearDiff - sb.yearDiff;
    return sb.pop - sa.pop;
  });

  const cap = Math.max(8, Number(limit) || 8);
  const rawTop = ranked.slice(0, cap).map(m => ({
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

  finalList.hasMoreMatches = ranked.length > cap;
  finalList.totalRankedCount = ranked.length;

  if (qDir) {
    const sortedByDir = finalList.sort((a, b) => {
      const aDir = (a.director || '').toLowerCase().includes(qDir) ? 0 : 1;
      const bDir = (b.director || '').toLowerCase().includes(qDir) ? 0 : 1;
      return aDir - bDir;
    });
    sortedByDir.hasMoreMatches = finalList.hasMoreMatches;
    sortedByDir.totalRankedCount = finalList.totalRankedCount;
    return sortedByDir;
  }

  return finalList;
}

export async function saveToLibrary(item, entry) {
  const db = await initDb();
  const safeTitle = entry.title.replace(/[/\\:]/g, " -").trim();
  const cleanFolderName = `${entry.year} - ${safeTitle} [${(entry.quality || "").trim()}]${entry.imdb_id?.trim() ? ` [imdbid-${entry.imdb_id.trim()}]` : ""}`;
  const targetRoot = getMediaRoot(entry);
  await mkdir(targetRoot, { recursive: true }).catch(() => {});
  const destFolder = `${targetRoot}/${cleanFolderName}`;

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
    `INSERT OR REPLACE INTO wishlist_videos (folder_name, title, year, quality, imdb_id, imdb_id_source, poster_url, director, cast_list, overview, tags, clips, runtime, countries, genres, watch_status, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owned')`,
    [
      cleanFolderName,
      entry.title.trim(),
      parseInt(entry.year),
      entry.quality?.trim() || "",
      entry.imdb_id || "",
      entry.imdb_id_source || (entry.imdb_id ? 'provided' : ''),
      entry.poster_url || "",
      entry.director || "",
      entry.cast_list || "",
      entry.overview || "",
      String(entry.tags || "").trim(),
      String(entry.clips || "").trim(),
      String(entry.runtime || "").trim(),
      String(entry.countries || "").trim(),
      String(entry.genres || "").trim(),
      entry.watch_status || ""
    ]
  );
  await writeJellyfinSidecars(destFolder, entry);
  await logActivity("Imported Movie", entry.title || cleanFolderName, entry.quality || "");
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

  let tmdbId = Number(movie.tmdb_id || movie.movie_id || movie.id) || 0;
  if (!tmdbId) {
    try {
      const hits = await searchTmdb(title, year ? String(year) : '', movie.director || '');
      if (hits.length > 0) tmdbId = Number(hits.at(0).id) || 0;
    } catch (_) {}
  }

  let enriched = movie;
  if (tmdbId && (!movie.imdb_id || !movie.cast_list || !movie.director)) {
    try {
      enriched = await fetchEnrichedMovie({ ...movie, id: tmdbId });
    } catch (_) {}
  }

  const safeTitle = title.replace(/[/\\:]/g, ' -').trim();
  const folderName = `${year ? year + ' - ' : ''}${safeTitle}`;
  const watchStatus = movie.watch_status || '';

  await db.execute(
    `INSERT INTO wishlist_videos (
      folder_name, title, year, quality, imdb_id, imdb_id_source, poster_url, director, cast_list, overview, tags, clips, runtime, countries, genres,
      watch_status, status, media_type, tmdb_id
    ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wanted', 'movie', ?)`,
    [
      folderName,
      title,
      year,
      enriched.imdb_id || movie.imdb_id || '',
      enriched.imdb_id_source || movie.imdb_id_source || ((enriched.imdb_id || movie.imdb_id) ? 'provided' : ''),
      enriched.poster_url || movie.poster_url || '',
      enriched.director || movie.director || '',
      enriched.cast_list || movie.cast_list || '',
      enriched.overview || movie.overview || '',
      movie.tags || '',
      movie.clips || '',
      enriched.runtime || movie.runtime || '',
      enriched.countries || movie.countries || '',
      enriched.genres || movie.genres || '',
      watchStatus,
      tmdbId
    ]
  );
  const savedRows = await db.select(
    `SELECT * FROM wishlist_videos WHERE folder_name = ?`,
    [folderName]
  );
  const saved = savedRows.at(0);
  return await logActivity(
    'Added Wanted',
    title,
    year ? String(year) : '',
    saved ? {
      type: 'delete-created-entry',
      entry_id: saved.id,
      folder_name: saved.folder_name,
      expectedEntry: saved
    } : null
  );
}

export async function updateExistingMovie(oldFolderName, existing, movie, onDisk) {
  const db = await initDb();
  const current = existing || (await db.select(
    `SELECT * FROM wishlist_videos WHERE folder_name = ?`,
    [oldFolderName]
  )).at(0);
  if (!current) throw new Error(`Catalog entry "${oldFolderName}" no longer exists.`);

  let enriched = { ...movie };
  const tmdbId = Number(movie.tmdb_id || movie.id) || 0;
  let fetchedMetadata = false;
  let metadataError = '';
  if (tmdbId) {
    try {
      const full = await fetchEnrichedMovie({ ...movie, id: tmdbId });
      fetchedMetadata = true;
      enriched = {
        ...enriched,
        imdb_id: movie.imdb_id || full.imdb_id || '',
        imdb_id_source: movie.imdb_id_source || full.imdb_id_source || '',
        imdb_lookup_status: movie.imdb_id ? 'matched' : full.imdb_lookup_status,
        imdb_lookup_error: movie.imdb_id ? '' : full.imdb_lookup_error,
        director: movie.director || full.director || '',
        cast_list: movie.cast_list || full.cast_list || '',
        overview: movie.overview || full.overview || '',
        poster_url: movie.poster_url || full.poster_url || ''
      };
    } catch (err) {
      metadataError = String(err?.message || err);
    }
  }
  if (!enriched.imdb_id && !fetchedMetadata && (enriched.title || current.title)) {
    const fallback = await lookupImdbTtFallback(
      enriched.title || current.title,
      enriched.year || current.year,
      enriched.director || current.director
    );
    enriched = { ...enriched, ...fallback };
    if (metadataError && fallback.imdb_lookup_status === 'failed') {
      enriched.imdb_lookup_error = [metadataError, fallback.imdb_lookup_error].filter(Boolean).join(' ');
    }
  }

  const year = enriched.year || current.year || '';
  const safeTitle = String(enriched.title || current.title || oldFolderName).replace(/[/\\:]/g, ' -').trim();
  enriched.title = safeTitle;
  const isSameTitle = String(enriched.title || '').trim().toLowerCase() ===
    String(current.title || '').trim().toLowerCase();
  const isSameYear = !enriched.year || !current.year ||
    Number(enriched.year) === Number(current.year);
  const finalImdb = enriched.imdb_id || (isSameTitle && isSameYear ? current.imdb_id : '') || '';
  const finalImdbSource = enriched.imdb_id
    ? (enriched.imdb_id_source || 'provided')
    : (isSameTitle && isSameYear ? current.imdb_id_source || '' : '');
  const newFolderName = `${year} - ${safeTitle} [${(current.quality || '').trim()}]${finalImdb ? ` [imdbid-${finalImdb.trim()}]` : ''}`;
  const oldRoot = getMediaRoot(current);
  const newRoot = getMediaRoot({ ...current, ...enriched });

  if (current.status !== 'wanted' && onDisk) {
    const actualOldPath = (await exists(`${oldRoot}/${oldFolderName}`).catch(() => false))
      ? `${oldRoot}/${oldFolderName}`
      : `${MEDIA_ROOT}/${oldFolderName}`;
    const targetNewPath = `${newRoot}/${newFolderName}`;
    if (actualOldPath !== targetNewPath && (await exists(actualOldPath).catch(() => false))) {
      await mkdir(newRoot, { recursive: true }).catch(() => {});
      await rename(actualOldPath, targetNewPath);
    }
  }
  const updateResult = await db.execute(
    `UPDATE wishlist_videos SET folder_name=?, title=?, year=COALESCE(NULLIF(?,''),year), imdb_id=?, poster_url=?, director=?, cast_list=?, overview=?, runtime=COALESCE(NULLIF(?,''),runtime), countries=COALESCE(NULLIF(?,''),countries), genres=COALESCE(NULLIF(?,''),genres), tmdb_id=COALESCE(NULLIF(?,0),tmdb_id), imdb_id_source=? WHERE folder_name=?`,
    [newFolderName, enriched.title, year, finalImdb, enriched.poster_url || '', enriched.director || '', enriched.cast_list || '', enriched.overview || '', enriched.runtime || '', enriched.countries || '', enriched.genres || '', tmdbId, finalImdbSource, oldFolderName]
  );
  const rowsAffected = updateResult?.changes ?? updateResult?.rowsAffected;
  if (rowsAffected === 0) throw new Error(`Catalog entry "${oldFolderName}" was not updated.`);
  const metaLabel = `${enriched.title || oldFolderName}${year ? ` (${year})` : ''}`;
  await logActivity('Updated Metadata', metaLabel, enriched.director || '');

  if (current.status !== 'wanted' && onDisk) {
    await writeJellyfinSidecars(`${newRoot}/${newFolderName}`, {
      ...enriched,
      imdb_id: finalImdb,
      year,
      tags: current.tags || '',
      clips: current.clips || ''
    });
  }
  return {
    ...current,
    ...enriched,
    folder_name: newFolderName,
    year,
    imdb_id: finalImdb,
    imdb_id_source: finalImdbSource,
    imdb_lookup_status: finalImdb ? 'matched' : (enriched.imdb_lookup_status || 'no_match')
  };
}

export async function enrichFilmBatch(list) {
  let localRows = [];
  try {
    const db = await initDb();
    localRows = await db.select("SELECT tmdb_id, title, year, director, cast_list, imdb_id, imdb_id_source, runtime, countries, genres, tags FROM wishlist_videos");
  } catch (_) {}

  const findLocalMeta = (item) => {
    const yr = item.year ? String(item.year) : (item.release_date ? item.release_date.slice(0, 4) : '');
    return localRows.find(d =>
      (item.id && Number(d.tmdb_id) === Number(item.id)) ||
      (d.title?.toLowerCase() === item.title?.toLowerCase() && (!yr || String(d.year) === yr))
    );
  };

  const out = [];
  for (let i = 0; i < list.length; i += 6) {
    const batch = list.slice(i, i + 6);
    const enrichedBatch = await Promise.all(
      batch.map(async (item) => {
        const local = findLocalMeta(item);
        const merged = {
          ...item,
          director: item.director || local?.director || '',
          cast_list: item.cast_list || local?.cast_list || '',
          imdb_id: item.imdb_id || local?.imdb_id || '',
          imdb_id_source: item.imdb_id_source || local?.imdb_id_source || '',
          runtime: item.runtime || local?.runtime || '',
          countries: item.countries || local?.countries || '',
          genres: item.genres || local?.genres || ''
        };
        if ((merged.director || merged.cast_list) && (merged.runtime || merged.countries || merged.genres) && merged.imdb_id) return merged;
        try {
          const full = await fetchEnrichedMovie({
            id: item.id,
            title: item.title,
            release_date: item.release_date,
            poster_path: item.poster_path,
            overview: item.overview
          });
          return {
            ...merged,
            director: full.director || merged.director,
            cast_list: full.cast_list || merged.cast_list,
            imdb_id: full.imdb_id || merged.imdb_id,
            imdb_id_source: full.imdb_id_source || merged.imdb_id_source,
            imdb_lookup_status: full.imdb_lookup_status,
            imdb_lookup_error: full.imdb_lookup_error
          };
        } catch (err) {
          return {
            ...merged,
            imdb_lookup_status: 'failed',
            imdb_lookup_error: String(err?.message || err)
          };
        }
      })
    );
    out.push(...enrichedBatch);
  }
  return out;
}

export async function fetchPersonFilmography(personName, selectedPersonId = null) {
  const host = ["api", "themoviedb", "org"].join(".");
  const titleHint = (String(personName || '').match(/\(([^)]+)\)/)?.[1] || '').toLowerCase().trim();
  const cleanName = String(personName || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
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
        const exactName = (p.name || '').toLowerCase() === cleanName.toLowerCase();
        return exactName || (hasFullName ? hasCredits : (hasCredits && p.popularity > 1.5));
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

    const hintedMatch = titleHint
      ? matches.find(p => (p.knownTitle || '').toLowerCase().includes(titleHint))
      : null;
    activePerson = selectedPersonId
      ? matches.find(p => p.id === selectedPersonId) || hintedMatch || matches.at(0)
      : hintedMatch || matches.at(0);
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
  const rawDirected = (cData.crew || [])
    .filter(m => m.media_type === 'movie' && m.job === 'Director' && m.id && !seenDir.has(m.id) && seenDir.add(m.id))
    .map(m => formatMovieCredit(m, 'Director'))
    .sort((a, b) => b.release_date.localeCompare(a.release_date));

  const seenCast = new Set();
  const rawActed = (cData.cast || [])
    .filter(m => m.media_type === 'movie' && m.id && !seenCast.has(m.id) && seenCast.add(m.id))
    .map(m => formatMovieCredit(m, m.character || 'Cast'))
    .sort((a, b) => b.release_date.localeCompare(a.release_date));

  const [enrichedDirHead, enrichedActHead] = await Promise.all([
    enrichFilmBatch(rawDirected.slice(0, 60)).catch(() => rawDirected.slice(0, 60)),
    enrichFilmBatch(rawActed.slice(0, 60)).catch(() => rawActed.slice(0, 60))
  ]);
  const directed = [...enrichedDirHead, ...rawDirected.slice(60)];
  const acted = [...enrichedActHead, ...rawActed.slice(60)];

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

    const rawTvList = [...tvMap.values()]
    .sort((a, b) => (b.episode_count || 0) - (a.episode_count || 0) || b.release_date.localeCompare(a.release_date))
    .slice(0, 60);

  const tvShows = await Promise.all(
    rawTvList.map(async (show, idx) => {
      if (idx >= 8) return { ...show, seasons: Array.of(1) };
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
      return { ...show, seasons };
    })
  );

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
  const mTt = String(imdbId || '').match(/\b(tt\d{6,9})\b/i);
  if (!mTt) return [];
  const cleanTt = mTt.at(1).toLowerCase();
  const host = ["api", "themoviedb", "org"].join(".");
  const url = new URL(`https://${host}/3/find/${cleanTt}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("external_source", "imdb_id");

  const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`TMDb IMDb-ID lookup failed (${res.status}).`);
  const data = await res.json();
  const movieHits = await Promise.all((data.movie_results || []).slice(0, 3).map(m => fetchEnrichedMovie(m)));
  const tvHits = await Promise.all((data.tv_results || []).slice(0, 3).map(t => fetchEnrichedTvShow(t)));
  return [...movieHits, ...tvHits].map(hit => ({
    ...hit,
    imdb_id: hit.imdb_id || cleanTt,
    imdb_id_source: hit.imdb_id ? hit.imdb_id_source : 'imdb-id-lookup'
  }));
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
  const previousRows = await db.select(
    `SELECT tags, clips FROM wishlist_videos WHERE folder_name = ?`,
    [folderName]
  );
  const previous = previousRows.at(0);

  await db.execute(
    `UPDATE wishlist_videos SET tags = ?, clips = ? WHERE folder_name = ?`,
    [cleanTags, cleanClips, folderName]
  );

  const rows = await db.select("SELECT * FROM wishlist_videos WHERE folder_name = ?", [folderName]);
  const entry = rows.at(0);
  const tagLabel = entry ? `${entry.title}${entry.year ? ` (${entry.year})` : ''}` : folderName;
  const tagSummary = [cleanTags ? `Tags: ${cleanTags}` : '', cleanClips ? `Clips: ${cleanClips}` : ''].filter(Boolean).join(' · ') || 'Cleared';
  const activityId = await logActivity(
    'Updated Tags',
    tagLabel,
    tagSummary,
    previous ? {
      type: 'tags-clips',
      folder_name: folderName,
      beforeTags: previous.tags || '',
      beforeClips: previous.clips || '',
      afterTags: cleanTags,
      afterClips: cleanClips
    } : null
  );
  if (entry && entry.status !== 'wanted') {
    const targetRoot = getMediaRoot(entry);
    const otherRoot = targetRoot === MEDIA_ROOT ? THE_MOVIES_ROOT : MEDIA_ROOT;
    if ((await exists(`${otherRoot}/${folderName}`).catch(() => false)) && !(await exists(`${targetRoot}/${folderName}`).catch(() => false))) {
      await mkdir(targetRoot, { recursive: true }).catch(() => {});
      await rename(`${otherRoot}/${folderName}`, `${targetRoot}/${folderName}`).catch(() => {});
    }
    try {
      await writeJellyfinSidecars(`${targetRoot}/${folderName}`, entry);
    } catch (_) {}
  }
  return activityId;
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

async function writeEntrySidecars(entry) {
  const isTv = entry.media_type === 'tv';
  if (isTv) {
    let eps = [];
    try {
      eps = entry.episodes_json ? JSON.parse(entry.episodes_json) : [];
    } catch (_) {}
    await writeJellyfinTvSidecars(`${TV_ROOT}/${entry.folder_name}`, entry, eps);
  } else {
    await writeJellyfinSidecars(`${getMediaRoot(entry)}/${entry.folder_name}`, entry);
  }
}

export async function scanMissingSidecarsOnDisk(databaseEntries, diskFolders) {
  const onDiskEntries = (databaseEntries || []).filter(
    e => e.folder_name && diskFolders.includes(e.folder_name)
  );
  const missing = [];

  for (let i = 0; i < onDiskEntries.length; i += 10) {
    const batch = onDiskEntries.slice(i, i + 10);
    await Promise.all(
      batch.map(async (entry) => {
        try {
          const base = getMediaRoot(entry);
          const entries = await readDir(`${base}/${entry.folder_name}`);
          const names = entries.map(f => f.name.toLowerCase());
          const hasPoster = names.includes('poster.jpg') || names.includes('poster.png');
          const hasNfo = names.some(n => n.endsWith('.nfo'));
          if (!hasPoster || !hasNfo) {
            missing.push({
              ...entry,
              missingFiles: [!hasPoster ? 'poster.jpg' : '', !hasNfo ? '.nfo' : ''].filter(Boolean).join(', ')
            });
          }
        } catch (_) {}
      })
    );
  }
  return missing;
}

export async function syncMissingJellyfinSidecars(entries, onProgress) {
  const list = entries || [];
  let done = 0;
  let written = 0;
  let firstError = '';

  for (let i = 0; i < list.length; i += 5) {
    const batch = list.slice(i, i + 5);
    await Promise.all(
      batch.map(async (entry) => {
        try {
          await writeEntrySidecars(entry);
          written += 1;
        } catch (err) {
          if (!firstError) firstError = `${entry.folder_name}: ${err}`;
        }
        done += 1;
        onProgress?.(done, list.length);
      })
    );
  }

  if (firstError && written === 0) throw new Error(firstError);
  await logActivity('Wrote Missing Metafiles', written + ' folders updated', '');
  return { written, total: list.length, firstError };
}

export async function syncAllJellyfinSidecars(diskFolders, onProgress) {
  const db = await initDb();
  const rows = await db.select("SELECT * FROM wishlist_videos ORDER BY title ASC");
  const onDisk = rows.filter(r => r.folder_name && diskFolders.includes(r.folder_name));

  let done = 0;
  let written = 0;
  let firstError = '';

  for (let i = 0; i < onDisk.length; i += 5) {
    const batch = onDisk.slice(i, i + 5);
    await Promise.all(
      batch.map(async (entry) => {
        try {
          await writeEntrySidecars(entry);
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
  await logActivity('Rewrote Metafiles', written + ' folders updated', '');
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
  const rawTmdbId = movie.tmdb_id || (!movie.folder_name && movie.status !== 'wanted' ? movie.id : 0);
  const id = rawTmdbId || await resolveTmdbId(movie);
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

export async function getMovieFolderFiles(folderName, root = THE_MOVIES_ROOT) {
  try {
    let entries = await readDir(`${root}/${folderName}`).catch(() => null);
    if (!entries && root !== MEDIA_ROOT) {
      entries = await readDir(`${MEDIA_ROOT}/${folderName}`).catch(() => null);
    }
    return (entries || []).filter(e => e.isFile && !e.name.startsWith('.')).map(e => e.name).sort();
  } catch (_) {
    return [];
  }
}

export async function removeMovieFromLibrary(folderName, isOnDisk = false) {
  const db = await initDb();
  const rows = await db.select("SELECT * FROM wishlist_videos WHERE folder_name = ?", [folderName]);
  const info = rows.at(0);
  const rootDir = getMediaRoot(rows.at(0) || {});
  const candidatePaths = [rootDir, THE_MOVIES_ROOT, TV_ROOT, MEDIA_ROOT].map(r => `${r}/${folderName}`);
  let sourcePath = `${rootDir}/${folderName}`;
  let trashPath = '';
  for (const p of candidatePaths) {
    if (await exists(p).catch(() => false)) { sourcePath = p; break; }
  }

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
    trashPath = destPath;
  }
  await db.execute("DELETE FROM wishlist_videos WHERE folder_name = ?", [folderName]);
  const cleanLabel = info?.title
    ? (info.media_type === 'tv' && info.season_number ? `${info.title} · Season ${info.season_number}` : info.title)
    : folderName;
  const yearNote = info?.year ? String(info.year) : '';
  return await logActivity(
    'Removed',
    cleanLabel,
    yearNote,
    info ? {
      type: 'restore-entry',
      entry: info,
      sourcePath: trashPath ? sourcePath : '',
      trashPath
    } : null
  );
}

export async function updateMovieWatchStatus(folderName, watchStatus) {
  const db = await initDb();
  const prevRows = await db.select(`SELECT title, year, watch_status FROM wishlist_videos WHERE folder_name = ?`, [folderName]);
  const prev = prevRows.at(0);
  const nextStatus = watchStatus || '';
  await db.execute(
    `UPDATE wishlist_videos SET watch_status = ? WHERE folder_name = ?`,
    [nextStatus, folderName]
  );
  const label = prev ? `${prev.title}${prev.year ? ` (${prev.year})` : ''}` : folderName;
  return await logActivity(
    'Watch Status',
    label,
    `${formatWatchLabel(prev?.watch_status || '')} → ${formatWatchLabel(nextStatus)}`,
    prev ? {
      type: 'watch-status',
      folder_name: folderName,
      before: prev.watch_status || '',
      after: nextStatus
    } : null
  );
}

export async function searchUniversal(query) {
  const rawQ = (query || '').trim();
  if (!rawQ) return { queryName: '', people: [], movies: [], tvShows: [] };
  const host = 'api.themoviedb.org';
  const imgBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");
  const fetchJson = async (a, b) => {
    const u = b || a;
    try { const r = await tauriFetch(u.toString(), { method: 'GET', headers: { Accept: 'application/json' } }); return await r.json(); }
    catch { return { results: [] }; }
  };
  let work = rawQ;
  const kws = [];
  work = work.replace(/\[([^\]]+)\]/g, (_, s) => { s.split(',').map(x => x.trim()).filter(Boolean).forEach(x => kws.push(x)); return ' '; });
  const hasAdult = kws.some(k => k.toLowerCase() === 'adult');
  const terms = kws.filter(k => k.toLowerCase() !== 'adult');
  const adultFlag = hasAdult ? 'true' : 'false';
  let y1 = null, y2 = null;
  work = work.replace(/\(\s*((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?\s*\)/g, (_, a, b) => { y1 = +a; y2 = b ? +b : +a; return ' '; });
  if (y1 === null) work = work.replace(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/g, (_, a, b) => { y1 = +a; y2 = +b; return ' '; });
  const q = work.replace(/\s+/g, ' ').trim();
  const kwIds = (await Promise.all(terms.map(async kw => {
    const u = new URL(`https://${host}/3/search/keyword`);
    u.searchParams.set('api_key', TMDB_API_KEY); u.searchParams.set('query', kw);
    const d = await fetchJson(u);
    return (d.results || []).find(r => r.name?.toLowerCase() === kw.toLowerCase())?.id || d.results?.at(0)?.id || null;
  }))).filter(Boolean);
  let pData = { results: [] }, mData = { results: [] }, tData = { results: [] };
  if (q) {
    const mk = (p) => { const u = new URL(`https://${host}/3/search/${p}`); u.searchParams.set('api_key', TMDB_API_KEY); u.searchParams.set('query', q); u.searchParams.set('include_adult', adultFlag); return u; };
    const mu = mk('movie'), tu = mk('tv');
    if (y1 !== null && y1 === y2) { mu.searchParams.set('primary_release_year', String(y1)); tu.searchParams.set('first_air_date_year', String(y1)); }
    [pData, mData, tData] = await Promise.all([fetchJson(mk('person')), fetchJson(mu), fetchJson(tu)]);
    if (y1 !== null && y2 !== null) {
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      mData.results = (mData.results || []).filter(m => { const y = +(m.release_date || '').slice(0, 4); return y >= lo && y <= hi; });
      tData.results = (tData.results || []).filter(t => { const y = +(t.first_air_date || '').slice(0, 4); return y >= lo && y <= hi; });
    }
  } else if (y1 !== null || kwIds.length > 0 || hasAdult) {
    const mkD = (p, f) => {
      const u = new URL(`https://${host}/3/discover/${p}`);
      u.searchParams.set('api_key', TMDB_API_KEY); u.searchParams.set('include_adult', adultFlag); u.searchParams.set('sort_by', 'popularity.desc');
      if (y1 !== null && y2 !== null) { u.searchParams.set(`${f}.gte`, `${Math.min(y1, y2)}-01-01`); u.searchParams.set(`${f}.lte`, `${Math.max(y1, y2)}-12-31`); }
      if (kwIds.length) u.searchParams.set('with_keywords', kwIds.join(','));
      return u;
    };
    [mData, tData] = await Promise.all([fetchJson(mkD('movie', 'primary_release_date')), fetchJson(mkD('tv', 'first_air_date'))]);
  }
  if (q && kwIds.length > 0) {
    const hasKw = async (kind, id) => {
      const ku = new URL(`https://${host}/3/${kind}/${id}/keywords`);
      ku.searchParams.set('api_key', TMDB_API_KEY);
      const kd = await fetchJson(ku);
      const list = kd.keywords || kd.results || [];
      return kwIds.every(targetId => list.some(k => Number(k.id) === Number(targetId)));
    };
    const [mFlags, tFlags] = await Promise.all([
      Promise.all((mData.results || []).slice(0, 20).map(m => hasKw('movie', m.id))),
      Promise.all((tData.results || []).slice(0, 12).map(t => hasKw('tv', t.id)))
    ]);
    mData.results = (mData.results || []).slice(0, 20).filter((_, idx) => mFlags[idx]);
    tData.results = (tData.results || []).slice(0, 12).filter((_, idx) => tFlags[idx]);
  }
  if (!hasAdult) {
    pData.results = (pData.results || []).filter(p => !p.adult);
    mData.results = (mData.results || []).filter(m => !m.adult);
    tData.results = (tData.results || []).filter(t => !t.adult);
  } else {
    pData.results = (pData.results || []).filter(p => Boolean(p.adult));
    mData.results = (mData.results || []).filter(m => Boolean(m.adult));
    tData.results = (tData.results || []).filter(t => Boolean(t.adult));
  }
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
      dUrl.searchParams.set("append_to_response", "credits,external_ids");
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

      const tvCast = (dData.credits?.cast || []).slice(0, 4).map(c => c.name).join(', ');
      const tvImdb = dData.external_ids?.imdb_id || '';
      return {
        id: show.id,
        media_type: 'tv',
        title: show.name,
        year: Number(startYear) || 0,
        yearSpan,
        poster_path: show.poster_path || '',
        poster_url: show.poster_path ? `${imgBase}${show.poster_path}` : '',
        overview: show.overview || '',
        cast_list: tvCast,
        imdb_id: tvImdb,
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
  if (!res.ok) throw new Error(`TMDb TV search failed (${res.status}).`);
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
    imdb_id_source: data.external_ids?.imdb_id ? 'tmdb' : '',
    episodes
  };
}

function parseFallbackShowFolder(folderName) {
  const cleanFolder = String(folderName || '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanFolder) return null;
  const generic = new Set(['downloads', 'desktop', 'documents', 'movies', 'videos', 'tv', 'tv shows', 'incoming', 'media', 'temp', 'tmp']);
  if (generic.has(cleanFolder.toLowerCase())) return null;

  let seasonNum = 1;
  let working = cleanFolder;
  const seasonMatch = working.match(/(?:[-–:]\s*)?(?:season|series|s)\s*0*(\d{1,2})\b/i);
  if (seasonMatch) {
    seasonNum = Number(seasonMatch.at(1)) || 1;
    working = working.replace(seasonMatch, ' ').replace(/[-–:\s]+$/, '').trim();
  }
  const yearMatch = working.match(/\(?((?:19|20)\d{2})(?:\s*series)?\)?$/i);
  const year = yearMatch ? yearMatch.at(1) : '';
  const title = yearMatch
    ? working.replace(/\(?((?:19|20)\d{2})(?:\s*series)?\)?$/i, '').replace(/[-–:\s]+$/, '').trim()
    : working;
  if (!title) return null;
  return { title, year, season_number: seasonNum };
}

export function parseLooseTvFilename(fileName, fallbackFolderName = '') {
  const noExt = fileName.replace(/\.[^.]+$/, '');
  const clean = noExt.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const fallback = parseFallbackShowFolder(fallbackFolderName);

  const m = clean.match(/^(.*?)\b(?:s(\d{1,2})\s*e(\d{1,3})|(\d{1,2})x(\d{1,3})|season\s*0*(\d{1,2})\s*(?:episode|ep|e)\s*0*(\d{1,3})|(?:episode|ep)\.?\s*0*(\d{1,3}))\b/i);
  if (m) {
    const rawTitle = (m.at(1) || '').replace(/[-–:\s]+$/, '').trim();
    const seasonNum = Number(m.at(2) || m.at(4) || m.at(6)) || fallback?.season_number || 1;
    const epNum = Number(m.at(3) || m.at(5) || m.at(7) || m.at(8)) || 1;
    const resolvedRaw = rawTitle || (fallback ? `${fallback.title}${fallback.year ? ` (${fallback.year})` : ''}` : '');
    if (!resolvedRaw) return null;

    const yearMatch = resolvedRaw.match(/\(?((?:19|20)\d{2})(?:\s*series)?\)?$/i);
    const year = yearMatch ? yearMatch.at(1) : (fallback?.year || '');
    const title = yearMatch
      ? resolvedRaw.replace(/\(?((?:19|20)\d{2})(?:\s*series)?\)?$/i, '').replace(/[-–:\s]+$/, '').trim()
      : resolvedRaw;

    return {
      title,
      year,
      season_number: seasonNum,
      episode_number: epNum,
      normKey: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '')}::s${seasonNum}`
    };
  }

  if (fallback) {
    const leadMatch = clean.match(/^0*(\d{1,2})(?:\s*[-–.)]\s*|\s+)(.+)$/);
    if (leadMatch) {
      const epNum = Number(leadMatch.at(1));
      const rest = (leadMatch.at(2) || '').trim();
      if (epNum >= 1 && epNum <= 99 && rest && !/^(?:19|20)\d{2}\b/.test(clean)) {
        return {
          title: fallback.title,
          year: fallback.year,
          season_number: fallback.season_number,
          episode_number: epNum,
          normKey: `${fallback.title.toLowerCase().replace(/[^a-z0-9]+/g, '')}::s${fallback.season_number}`
        };
      }
    }
  }

  return null;
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

  const videoExts = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'ts', 'webm', 'mpg', 'mpeg']);
  const incomingEpisodes = Array.isArray(entry.episodes) ? entry.episodes.map(e => ({ ...e })) : [];
  const epMap = new Map(incomingEpisodes.map(e => [Number(e.episode_number), e]));
  const movedEpNums = new Set();

  // Move files from grouped loose files (item.files), single file, or season directory into destFolder
  if (Array.isArray(item.files) && item.files.length > 0) {
    for (const f of item.files) {
      const targetPath = `${destFolder}/${f.name}`;
      if (f.sourcePath && f.sourcePath !== targetPath && !(await exists(targetPath))) {
        await rename(f.sourcePath, targetPath);
      }
    }
  } else if (item.sourcePath && item.sourcePath !== destFolder) {
    if (item.isDirectory) {
      const srcEntries = await readDir(item.sourcePath).catch(() => []);
      for (const f of srcEntries) {
        const targetPath = `${destFolder}/${f.name}`;
        if (f.isFile && !f.name.startsWith('.') && !(await exists(targetPath))) {
          await rename(`${item.sourcePath}/${f.name}`, targetPath);
        }
      }
      const leftover = await readDir(item.sourcePath).catch(() => []);
      if (leftover.filter(e => !e.name.startsWith('.')).length === 0) {
        await remove(item.sourcePath, { recursive: true }).catch(() => {});
      }
    } else {
      const targetPath = `${destFolder}/${item.name}`;
      if (!(await exists(targetPath))) {
        await rename(item.sourcePath, targetPath);
      }
    }
  }

  // Rename episode video files inside destFolder to: Show Name - s03e02 - Episode Title.ext
  const renamedFilesByEp = new Map();
  const dirEntries = await readDir(destFolder).catch(() => []);
  for (const file of dirEntries) {
    if (!file.isFile || file.name.startsWith('.')) continue;
    const dotIdx = file.name.lastIndexOf('.');
    if (dotIdx === -1) continue;
    const ext = file.name.slice(dotIdx + 1).toLowerCase();
    if (!videoExts.has(ext)) continue;

    const match = file.name.match(/s\d{1,2}[\s._-]*e(\d{1,3})/i)
      || file.name.match(/\b\d{1,2}x(\d{1,3})\b/i)
      || file.name.match(/\b(?:episode|ep|e)\.?\s*0*(\d{1,3})\b/i)
      || file.name.match(/^0*(\d{1,2})(?:[\s._-]+|$)/);
    if (!match) continue;

    const epNum = Number(match.at(1));
    if (!Number.isInteger(epNum) || epNum <= 0) continue;

    const epMeta = epMap.get(epNum);
    const ePad = String(epNum).padStart(2, '0');
    const safeEpTitle = (epMeta?.name || `Episode ${epNum}`).replace(/[/\\:*?"<>|]/g, ' -').trim();
    const newFileName = `${safeShow} - s${sPad}e${ePad} - ${safeEpTitle}.${ext}`;

    if (file.name !== newFileName) {
      const targetPath = `${destFolder}/${newFileName}`;
      if (await exists(targetPath)) {
        // Never overwrite an existing episode file on disk
        continue;
      }
      await rename(`${destFolder}/${file.name}`, targetPath);
    }
    if (epMeta) epMeta.file_name = newFileName;
    renamedFilesByEp.set(epNum, newFileName);
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
    const alreadyOwned = Boolean(old.file_name);
    const finalFile = renamedFilesByEp.get(epNum) || fresh.file_name || old.file_name || '';

    const epWatch = alreadyOwned
      ? (old.watch_status || '')
      : (fresh.watch_status || (movedEpNums.has(epNum) ? (bulkWatch || old.watch_status || '') : (old.watch_status || '')));

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
  const imdbId = entry.imdb_id || existing?.imdb_id || '';
  const imdbIdSource = entry.imdb_id_source || existing?.imdb_id_source || (imdbId ? 'provided' : '');

  await db.execute(
    `INSERT OR REPLACE INTO wishlist_videos (
      folder_name, title, year, quality, imdb_id, imdb_id_source, poster_url, director, cast_list, overview, tags,
      watch_status, status, media_type, season_number, episodes_json, tmdb_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tv', ?, ?, ?)`,
    [
      cleanFolderName,
      entry.title.trim(),
      Number(seasonYear) || 0,
      entry.quality?.trim() || existing?.quality || '',
      imdbId,
      imdbIdSource,
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
  const epCount = mergedEpisodes.filter(e => e.file_name).length;
  await logActivity('Imported TV Season', entry.title + ' · Season ' + seasonNum, epCount + ' episode files');
  await writeJellyfinTvSidecars(destFolder, {
    ...entry,
    season_number: seasonNum,
    year: seasonYear
  }, mergedEpisodes);
}

export async function fetchEnrichedTvShow(tvId) {
  const host = ["api", "themoviedb", "org"].join(".");
  const path = ["3", "tv", tvId].join("/");
  const url = new URL(`https://${host}/${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("append_to_response", "aggregate_credits,credits,external_ids");

  const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`TMDb TV metadata lookup failed (${res.status}).`);
  const d = await res.json();
  const aggCast = d.aggregate_credits?.cast || d.credits?.cast || [];
  const posterBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");
  return {
    imdb_id: d.external_ids?.imdb_id || '',
    imdb_id_source: d.external_ids?.imdb_id ? 'tmdb' : '',
    cast_list: aggCast.slice(0, 6).map(c => c.name).join(', '),
    director: Array.isArray(d.created_by) ? d.created_by.map(c => c.name).join(', ') : '',
    overview: d.overview || '',
    poster_url: d.poster_path ? posterBase + d.poster_path : ''
  };
}

export async function saveWantedTvSeason(show, seasonNumber = 1, opts = {}) {
  const db = await initDb();
  const seasonNum = Number(seasonNumber) || 1;
  let tvId = Number(show.tmdb_id || show.show_id || show.id) || 0;

  if (!tvId && show.title) {
    try {
      const tvHits = await searchTmdbTv(show.title, show.year ? String(show.year) : '');
      if (tvHits.length > 0) tvId = Number(tvHits.at(0).id) || 0;
    } catch (_) {}
  }

  const sPad = String(seasonNum).padStart(2, '0');
  const seasonData = tvId ? await fetchTvSeasonDetails(tvId, seasonNum).catch(() => ({})) : {};
  const tvMeta = tvId ? await fetchEnrichedTvShow(tvId).catch(() => ({})) : {};

  const safeShow = show.title.replace(/[/\\:]/g, ' -').trim();
  const seasonYear = seasonData.air_date
    ? Number(seasonData.air_date.slice(0, 4))
    : (Number(show.year) || 0);
  const cleanFolderName = `${seasonYear ? seasonYear + ' - ' : ''}${safeShow} - s${sPad}`;
  const previousRows = await db.select(
    `SELECT * FROM wishlist_videos WHERE folder_name = ?`,
    [cleanFolderName]
  );
  const previousEntry = previousRows.at(0) || null;

  const initWatch = opts.watch_status ?? show.watch_status ?? '';
  const initTags = opts.tags ?? show.tags ?? '';
  const imdbId = seasonData.imdb_id || show.imdb_id || tvMeta.imdb_id || '';
  const imdbIdSource = seasonData.imdb_id
    ? 'tmdb'
    : (show.imdb_id_source || tvMeta.imdb_id_source || (imdbId ? 'provided' : ''));
  const episodes = (seasonData.episodes || []).map(ep => ({
    ...ep,
    file_name: '',
    watch_status: initWatch,
    tags: '',
    clips: ''
  }));

  await db.execute(
    `INSERT OR REPLACE INTO wishlist_videos (
      folder_name, title, year, quality, imdb_id, imdb_id_source, poster_url, director, cast_list, overview, tags,
      watch_status, status, media_type, season_number, episodes_json, tmdb_id
    ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 'wanted', 'tv', ?, ?, ?)`,
    [
      cleanFolderName,
      show.title.trim(),
      seasonYear,
      imdbId,
      imdbIdSource,
      seasonData.poster_url || show.poster_url || tvMeta.poster_url || '',
      show.director || tvMeta.director || '',
      seasonData.cast_list || show.cast_list || tvMeta.cast_list || '',
      seasonData.overview || show.overview || tvMeta.overview || '',
      initTags,
      initWatch,
      seasonNum,
      JSON.stringify(episodes),
      tvId
    ]
  );
  const savedRows = await db.select(
    `SELECT * FROM wishlist_videos WHERE folder_name = ?`,
    [cleanFolderName]
  );
  const saved = savedRows.at(0);
  const undoPayload = saved
    ? previousEntry
      ? { type: 'replace-entry', entry_id: saved.id, entry: previousEntry, expectedEntry: saved }
      : {
        type: 'delete-created-entry',
        entry_id: saved.id,
        folder_name: saved.folder_name,
        expectedEntry: saved
      }
    : null;
  return await logActivity(
    'Added Wanted TV',
    show.title.trim() + ' · Season ' + seasonNum,
    seasonYear ? String(seasonYear) : '',
    undoPayload
  );
}

export async function backfillMissingTvMetadata() {
  const db = await initDb();
  const missingRows = await db.select(
    `SELECT id, tmdb_id, title, year, imdb_id, imdb_id_source, cast_list, director, tags FROM wishlist_videos
     WHERE media_type = 'tv' AND (imdb_id IS NULL OR imdb_id = '' OR cast_list IS NULL OR cast_list = '')`
  );
  if (missingRows.length === 0) return false;

  const cache = new Map();
  let updatedAny = false;
  const lookupErrors = [];

  for (const row of missingRows) {
    let tvId = Number(row.tmdb_id) || 0;
    if (!tvId && row.title) {
      try {
        const hits = await searchTmdbTv(row.title, row.year ? String(row.year) : '');
        if (hits.length > 0) tvId = Number(hits.at(0).id) || 0;
      } catch (err) {
        lookupErrors.push(`${row.title}: ${String(err?.message || err)}`);
        continue;
      }
    }
    if (!tvId) continue;

    let meta = cache.get(tvId);
    if (!meta) {
      try {
        meta = await fetchEnrichedTvShow(tvId);
      } catch (err) {
        lookupErrors.push(`${row.title}: ${String(err?.message || err)}`);
      }
      if (meta) cache.set(tvId, meta);
    }
    if (!meta) continue;

    const nextImdb = row.imdb_id || meta.imdb_id || '';
    const nextImdbSource = row.imdb_id_source || meta.imdb_id_source || (nextImdb ? 'tmdb' : '');
    const nextCast = row.cast_list || meta.cast_list || '';
    const nextDir = row.director || meta.director || '';
    if (nextImdb !== (row.imdb_id || '') || nextImdbSource !== (row.imdb_id_source || '') || nextCast !== (row.cast_list || '') || tvId !== Number(row.tmdb_id || 0)) {
      await db.execute(
        `UPDATE wishlist_videos SET tmdb_id = ?, imdb_id = ?, imdb_id_source = ?, cast_list = ?, director = ? WHERE id = ?`,
        [tvId, nextImdb, nextImdbSource, nextCast, nextDir, row.id]
      );
      updatedAny = true;
    }
  }
  if (lookupErrors.length > 0) {
    throw new Error(`${lookupErrors.length} TV metadata lookup(s) failed. ${lookupErrors.slice(0, 3).join(' | ')}`);
  }
  return updatedAny;
}

export async function backfillMissingMovieMetadata() {
  const db = await initDb();
  const missingRows = await db.select(
    `SELECT id, tmdb_id, title, year, imdb_id, imdb_id_source, cast_list, director, overview, poster_url, runtime, countries, genres, tags FROM wishlist_videos
     WHERE (media_type IS NULL OR media_type = 'movie')
       AND (imdb_id IS NULL OR imdb_id = '' OR cast_list IS NULL OR cast_list = '' OR genres IS NULL OR genres = '')`
  );
  if (missingRows.length === 0) return false;

  let updatedAny = false;
  const lookupErrors = [];
  for (const row of missingRows) {
    let tmdbId = Number(row.tmdb_id) || 0;
    if (!tmdbId && row.title) {
      try {
        const hits = await searchTmdb(row.title, row.year ? String(row.year) : '', row.director || '');
        if (hits.length > 0) tmdbId = Number(hits.at(0).id) || 0;
      } catch (err) {
        lookupErrors.push(`${row.title}: ${String(err?.message || err)}`);
        continue;
      }
    }
    if (!tmdbId) continue;

    let meta;
    try {
      meta = await fetchEnrichedMovie({
        id: tmdbId,
        title: row.title,
        release_date: row.year ? `${row.year}-01-01` : '',
        poster_path: ''
      });
    } catch (err) {
      lookupErrors.push(`${row.title}: ${String(err?.message || err)}`);
      continue;
    }
    if (['failed', 'incomplete'].includes(meta.imdb_lookup_status)) {
      lookupErrors.push(`${row.title}: ${meta.imdb_lookup_error || 'IMDb lookup service unavailable.'}`);
    }

    const nextImdb = row.imdb_id || meta.imdb_id || '';
    const nextImdbSource = row.imdb_id_source || meta.imdb_id_source || (nextImdb ? 'tmdb' : '');
    const nextCast = row.cast_list || meta.cast_list || '';
    const nextDir = row.director || meta.director || '';
    const nextOver = row.overview || meta.overview || '';
    const nextPoster = row.poster_url || meta.poster_url || '';
    const nextRuntime = row.runtime || meta.runtime || '';
    const nextCountries = row.countries || meta.countries || '';
    const nextGenres = row.genres || meta.genres || '';

    if (
      nextImdb !== (row.imdb_id || '') ||
      nextImdbSource !== (row.imdb_id_source || '') ||
      nextCast !== (row.cast_list || '') ||
      nextGenres !== (row.genres || '') ||
      nextRuntime !== (row.runtime || '') ||
      nextCountries !== (row.countries || '') ||
      tmdbId !== Number(row.tmdb_id || 0)
    ) {
      await db.execute(
        `UPDATE wishlist_videos SET tmdb_id = ?, imdb_id = ?, imdb_id_source = ?, cast_list = ?, director = ?, overview = ?, poster_url = ?, runtime = ?, countries = ?, genres = ? WHERE id = ?`,
        [tmdbId, nextImdb, nextImdbSource, nextCast, nextDir, nextOver, nextPoster, nextRuntime, nextCountries, nextGenres, row.id]
      );
      updatedAny = true;
    }
  }
  if (lookupErrors.length > 0) {
    throw new Error(`${lookupErrors.length} movie metadata lookup(s) failed. ${lookupErrors.slice(0, 3).join(' | ')}`);
  }
  return updatedAny;
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
  const prevRows = await db.select(`SELECT * FROM wishlist_videos WHERE folder_name = ?`, [folderName]);
  const prevEntry = prevRows.at(0);
  let prevEps = [];
  try {
    prevEps = prevEntry?.episodes_json ? JSON.parse(prevEntry.episodes_json) : [];
  } catch (_) {}

  const rolledWatch = computeSeasonWatchStatus(episodes);
  await db.execute(
    `UPDATE wishlist_videos SET episodes_json = ?, watch_status = ? WHERE folder_name = ?`,
    [JSON.stringify(episodes), rolledWatch, folderName]
  );

  const changedDetails = [];
  for (const ep of episodes) {
    const oldEp = prevEps.find(p => Number(p.episode_number) === Number(ep.episode_number));
    const oldWs = oldEp?.watch_status || '';
    const newWs = ep.watch_status || '';
    if (oldWs !== newWs) {
      changedDetails.push(`Ep ${ep.episode_number}: ${formatWatchLabel(oldWs)} → ${formatWatchLabel(newWs)}`);
    }
  }
  if (changedDetails.length > 0) {
    const showLabel = prevEntry
      ? `${prevEntry.title}${prevEntry.season_number ? ` S${String(prevEntry.season_number).padStart(2, '0')}` : ''}`
      : folderName;
    await logActivity('Episode Status', showLabel, changedDetails.join(', '));
  }

  try {
    const entry = prevEntry ? { ...prevEntry, episodes_json: JSON.stringify(episodes), watch_status: rolledWatch } : null;
    if (entry && entry.status !== 'wanted') {
      const destFolder = `${TV_ROOT}/${folderName}`;
      if (await exists(destFolder)) {
        await writeJellyfinTvSidecars(destFolder, entry, episodes);
      }
    }
  } catch (err) {
    console.warn('TV sidecar sync warning:', err);
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

export async function reconcileTvEpisodesOnDisk() {
  const db = await initDb();
  const tvRows = await db.select(`SELECT * FROM wishlist_videos WHERE media_type = 'tv'`);
  const videoExts = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'ts', 'webm', 'mpg', 'mpeg']);

  for (const row of tvRows) {
    if (!row.folder_name) continue;
    let episodes = [];
    try {
      episodes = row.episodes_json ? JSON.parse(row.episodes_json) : [];
    } catch (_) {
      episodes = [];
    }
    if (!Array.isArray(episodes) || episodes.length === 0) continue;

    const folderPath = `${TV_ROOT}/${row.folder_name}`;
    const dirEntries = await readDir(folderPath).catch(() => null);
    const actualFilesByEp = new Map();

    if (Array.isArray(dirEntries)) {
      for (const f of dirEntries) {
        if (!f.isFile || f.name.startsWith('.')) continue;
        const dotIdx = f.name.lastIndexOf('.');
        if (dotIdx === -1) continue;
        const ext = f.name.slice(dotIdx + 1).toLowerCase();
        if (!videoExts.has(ext)) continue;

        const noExt = f.name.replace(/\.[^.]+$/, '');
        const m = noExt.match(/s\d{1,2}[\s._-]*e(\d{1,3})/i)
          || noExt.match(/\b\d{1,2}x(\d{1,3})\b/i)
          || noExt.match(/\b(?:episode|ep|e)\.?\s*0*(\d{1,3})\b/i)
          || (!/^(?:19|20)\d{2}\b/.test(noExt.trim()) && noExt.trim().match(/^0*(\d{1,3})(?:[\s._-]+|$)/));
        const epNum = m ? Number(m.at(1)) : 0;
        if (Number.isInteger(epNum) && epNum > 0 && !actualFilesByEp.has(epNum)) {
          actualFilesByEp.set(epNum, f.name);
        }
      }
    }

    let changed = false;
    const updatedEpisodes = episodes.map(ep => {
      const num = Number(ep.episode_number);
      const diskFile = actualFilesByEp.get(num) || '';
      if ((ep.file_name || '') !== diskFile) {
        changed = true;
        return { ...ep, file_name: diskFile };
      }
      return ep;
    });

    const totalEps = updatedEpisodes.length;
    const ownedEps = updatedEpisodes.filter(ep => Boolean(ep.file_name)).length;
    const nextStatus = (totalEps > 0 && ownedEps >= totalEps) ? 'owned' : 'wanted';

    if (changed || row.status !== nextStatus) {
      await db.execute(
        `UPDATE wishlist_videos SET episodes_json = ?, status = ? WHERE folder_name = ?`,
        [JSON.stringify(updatedEpisodes), nextStatus, row.folder_name]
      );
    }
  }
}

export async function exportCatalogToJson() {
  const db = await initDb();
  const rows = await db.select(`SELECT * FROM wishlist_videos ORDER BY title ASC, year ASC, season_number ASC`);

  const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'ts', 'webm', 'mpg', 'mpeg']);
  const exportedItems = [];

  for (const row of rows) {
    const isTv = row.media_type === 'tv';
    const rootDir = getMediaRoot(row);
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

export async function resolveLocalMediaPath(fullPath) {
  if (!fullPath) return fullPath;
  if (fullPath.startsWith(GUPPY_CONFIG.hostJellyRoot)) {
    const remote = await getRemoteServer();
    if (remote) {
      return fullPath.replace(GUPPY_CONFIG.hostJellyRoot, GUPPY_CONFIG.localShareMount);
    }
  }
  return fullPath;
}

export async function mountSharedDrive() {
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke('mount_shared_drive');
}

export async function playInVlc(folderName, specificFileName = '', isTv = false) {
  if (!folderName) return;
  try {
    let rootDir = isTv ? TV_ROOT : THE_MOVIES_ROOT;
    if (!isTv && !(await exists(`${rootDir}/${folderName}`).catch(() => false))) {
      rootDir = MEDIA_ROOT;
    }
    const folderPath = `${rootDir}/${folderName}`;
    let targetPath = '';

    if (specificFileName) {
      targetPath = `${folderPath}/${specificFileName}`;
    } else {
      const entries = await readDir(folderPath);
      const videoFile = entries
        .filter(e => {
          if (!e.isFile) return false;
          const lower = e.name.toLowerCase();
          return VIDEO_EXTS.some(ext => lower.endsWith(ext)) && !/trailer|sample/i.test(lower);
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .at(0);
      if (!videoFile) {
        throw new Error(`No video file found in ${folderName}`);
      }
      targetPath = `${folderPath}/${videoFile.name}`;
    }

    if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) {
      const streamUrl = `${GUPPY_CONFIG.serverUrl}/stream?path=${encodeURIComponent(targetPath)}`;
      const fileName = targetPath.split('/').pop() || folderName;
      window.dispatchEvent(new CustomEvent('guppy:stream', { detail: { url: streamUrl, title: fileName } }));
      return;
    }

    targetPath = await resolveLocalMediaPath(targetPath);

    try {
      await openPath(targetPath, 'VLC');
    } catch (_) {
      try {
        await openPath(targetPath);
      } catch (err) {
        alert(`Could not play video: ${err}`);
      }
    }
  } catch (err) {
    alert(`Could not start playback: ${err?.message || err}`);
  }
}

const videoExtCache = new Map();
let activeExtRequests = 0;
const extQueue = [];
function enqueueExtTask(fn) {
  return new Promise((resolve) => {
    const run = () => {
      activeExtRequests++;
      fn().then(resolve).finally(() => {
        activeExtRequests--;
        const next = extQueue.shift();
        if (next) next();
      });
    };
    if (activeExtRequests < 4) run();
    else extQueue.push(run);
  });
}
export async function getPrimaryVideoExt(item) {
  if (!item?.folder_name) return '';
  if (item.media_type === 'tv' && item.episodes_json) {
    try {
      const eps = JSON.parse(item.episodes_json);
      const owned = Array.isArray(eps) ? eps.find(e => e.file_name) : null;
      if (owned?.file_name && owned.file_name.includes('.')) {
        return owned.file_name.split('.').pop().toUpperCase();
      }
    } catch (_) {}
  }
  const cacheKey = `${item.media_type || 'movie'}:${item.folder_name}`;
  if (videoExtCache.has(cacheKey)) return videoExtCache.get(cacheKey);
  return enqueueExtTask(async () => {
    if (videoExtCache.has(cacheKey)) return videoExtCache.get(cacheKey);
    try {
      const root = getMediaRoot(item);
      const files = await getMovieFolderFiles(item.folder_name, root);
    const vid = (Array.isArray(files) ? files : [])
      .filter(f => /\.(mp4|mkv|avi|mov|m4v|wmv|webm)$/i.test(f) && !/trailer|sample/i.test(f))
      .sort((a, b) => a.localeCompare(b))
      .at(0);
    const ext = vid ? vid.split('.').pop().toUpperCase() : '';
    videoExtCache.set(cacheKey, ext);
      return ext;
    } catch (_) {
      return '';
    }
  });
}

