import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compile } from 'svelte/compiler';
import { createServer } from 'vite';
import { runDbMigrations } from '../src/lib/dbMigrations.js';

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent'
});

const store = await vite.ssrLoadModule('/src/lib/guppyStore.js');
const importDiscovery = await vite.ssrLoadModule('/src/lib/importDiscovery.js');
const libraryScan = await vite.ssrLoadModule('/src/lib/libraryScan.js');

test.after(async () => {
  await vite.close();
});

function createTestDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    sqlite,
    db: {
      execute: async (sql, params = []) => sqlite.prepare(sql).run(...params),
      select: async (sql, params = []) => sqlite.prepare(sql).all(...params)
    }
  };
}

test('database migrations initialize the current schema on an empty database', async () => {
  const { sqlite, db } = createTestDatabase();
  await runDbMigrations(db);

  const videoColumns = sqlite.prepare("SELECT name FROM pragma_table_info('wishlist_videos')").all().map(row => row.name);
  const activityColumns = sqlite.prepare("SELECT name FROM pragma_table_info('activity_log')").all().map(row => row.name);
  assert.ok(videoColumns.includes('imdb_id'));
  assert.ok(videoColumns.includes('imdb_id_source'));
  assert.ok(videoColumns.includes('genres'));
  assert.ok(activityColumns.includes('undo_payload'));
  sqlite.close();
});

test('database migrations upgrade legacy tables, preserve rows, and run idempotently', async () => {
  const { sqlite, db } = createTestDatabase();
  sqlite.exec(`
    CREATE TABLE wishlist_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_name TEXT UNIQUE,
      title TEXT,
      year INTEGER
    );
    INSERT INTO wishlist_videos (folder_name, title, year)
      VALUES ('1971 - Cannon Fodder [imdbid-tt37545848]', 'Cannon Fodder', 1971);
    CREATE TABLE activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT,
      action TEXT,
      title TEXT,
      detail TEXT
    );
  `);

  await runDbMigrations(db);
  await runDbMigrations(db);

  const title = sqlite.prepare('SELECT title, year, imdb_id, imdb_id_source FROM wishlist_videos').get();
  const videoColumns = sqlite.prepare("SELECT name FROM pragma_table_info('wishlist_videos')").all().map(row => row.name);
  const activityColumns = sqlite.prepare("SELECT name FROM pragma_table_info('activity_log')").all().map(row => row.name);
  const versions = sqlite.prepare('SELECT version FROM schema_migrations').all();
  assert.equal(title.title, 'Cannon Fodder');
  assert.equal(title.year, 1971);
  assert.equal(title.imdb_id, 'tt37545848');
  assert.equal(title.imdb_id_source, 'folder-name');
  assert.ok(videoColumns.includes('imdb_id'));
  assert.ok(videoColumns.includes('imdb_id_source'));
  assert.ok(videoColumns.includes('episodes_json'));
  assert.ok(activityColumns.includes('undo_payload'));
  assert.equal(versions.length, 2);
  assert.deepEqual(versions.map(row => row.version), [1, 2]);
  sqlite.close();
});

test('database migration errors are reported and not recorded as applied', async () => {
  const { sqlite, db } = createTestDatabase();
  const failingDb = {
    ...db,
    execute: async (sql, params = []) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS activity_log')) {
        throw new Error('simulated migration failure');
      }
      return db.execute(sql, params);
    }
  };

  await assert.rejects(
    runDbMigrations(failingDb),
    /Database migration 1 \(baseline-catalog-schema\) failed: simulated migration failure/
  );
  assert.equal(sqlite.prepare('SELECT version FROM schema_migrations').all().length, 0);
  sqlite.close();
});

test('library scan reconciles local TV folders and reports movie orphans with their roots', async () => {
  const roots = { movies: '/movies', media: '/media', tv: '/tv' };
  const entries = {
    '/movies': [
      { name: 'Known', isDirectory: true },
      { name: 'New Movie', isDirectory: true },
      { name: '.hidden', isDirectory: true },
      { name: 'deleted', isDirectory: true },
      { name: 'not-a-folder.mkv', isDirectory: false }
    ],
    '/media': [
      { name: 'New Movie', isDirectory: true },
      { name: 'Art Movie', isDirectory: true }
    ],
    '/tv': [
      { name: 'Series', isDirectory: true },
      { name: 'deleted', isDirectory: true }
    ]
  };
  let selectCount = 0;
  let reconcileCount = 0;
  const snapshot = await libraryScan.scanLibrary({
    initDb: async () => ({
      select: async () => {
        selectCount += 1;
        return selectCount === 1
          ? [{ folder_name: 'Before reconciliation' }]
          : [{ folder_name: 'Known' }, { folder_name: 'Series' }];
      }
    }),
    readDir: async path => entries[path],
    roots,
    isRemote: false,
    reconcileTvEpisodesOnDisk: async () => { reconcileCount += 1; }
  });

  assert.equal(selectCount, 2);
  assert.equal(reconcileCount, 1);
  assert.deepEqual(snapshot.databaseEntries, [{ folder_name: 'Known' }, { folder_name: 'Series' }]);
  assert.deepEqual(snapshot.diskFolders, ['Art Movie', 'Known', 'New Movie', 'Series']);
  assert.deepEqual(snapshot.orphans, ['Art Movie', 'New Movie']);
  assert.deepEqual(snapshot.orphanRoots, {
    'Art Movie': roots.media,
    'New Movie': roots.movies
  });
});

test('remote library scan skips local media roots and TV reconciliation', async () => {
  const roots = { movies: '/movies', media: '/media', tv: '/tv' };
  const snapshot = await libraryScan.scanLibrary({
    initDb: async () => ({ select: async () => [{ folder_name: 'Present' }] }),
    readDir: async path => {
      if (path === roots.movies) return [{ name: 'Present', isDirectory: true }];
      if (path === roots.tv) return [{ name: 'Series', isDirectory: true }];
      assert.fail(`Unexpected folder scan: ${path}`);
    },
    roots,
    isRemote: true,
    reconcileTvEpisodesOnDisk: async () => assert.fail('Remote scan should not reconcile local episodes')
  });

  assert.deepEqual(snapshot.diskFolders, ['Present', 'Series']);
  assert.deepEqual(snapshot.orphans, []);
  assert.deepEqual(snapshot.orphanRoots, {});
});

test('inferMetadata parses release codes, bare 1080 resolution, and year', () => {
  const res = store.inferMetadata('Blondes Have More Fun RET_BHMF_1080_1979.mp4');
  assert.equal(res.title, 'Blondes Have More Fun');
  assert.equal(res.year, '1979');
  assert.equal(res.quality, '1080p');

  const res2 = store.inferMetadata('2001 - A Space Odyssey (1968) [1080p] [imdbid-tt0062622].mkv');
  assert.equal(res2.year, '2001');
  assert.equal(res2.quality, '1080p');
  assert.equal(res2.imdb_id, 'tt0062622');
  assert.equal(res2.imdb_id_source, 'folder-name');
});

test('computeSeasonWatchStatus rolls up episode watch states', () => {
  assert.equal(store.computeSeasonWatchStatus([]), '');
  assert.equal(store.computeSeasonWatchStatus([{ watch_status: '' }, { watch_status: '' }]), '');
  assert.equal(store.computeSeasonWatchStatus([{ watch_status: 'liked' }, { watch_status: 'liked' }]), 'liked');
  assert.equal(store.computeSeasonWatchStatus([{ watch_status: 'liked' }, { watch_status: '' }]), 'unfinished');
  assert.equal(store.computeSeasonWatchStatus([{ watch_status: 'disliked' }, { watch_status: 'disliked' }]), 'disliked');
});

test('TV metadata updates retain episode files, watch states, tags, and clips', () => {
  const previous = [
    { episode_number: 1, name: 'Old name', file_name: 'episode-1.mkv', watch_status: 'liked', tags: 'favorite', clips: 'intro' },
    { episode_number: 2, file_name: '', watch_status: '', tags: '', clips: '' }
  ];
  const fresh = [
    { episode_number: 1, name: 'Updated name', overview: 'New metadata' },
    { episode_number: 2, name: 'Second episode' },
    { episode_number: 3, name: 'New episode' }
  ];

  assert.deepEqual(store.mergeTvSeasonEpisodes(previous, fresh), [
    { ...fresh[0], file_name: 'episode-1.mkv', watch_status: 'liked', tags: 'favorite', clips: 'intro' },
    { ...fresh[1], file_name: '', watch_status: '', tags: '', clips: '' },
    { ...fresh[2], file_name: '', watch_status: '', tags: '', clips: '' }
  ]);
  assert.deepEqual(store.mergeTvSeasonEpisodes(previous, []), previous);
});

test('parseLooseTvFilename extracts show, season, and episode', () => {
  const ep = store.parseLooseTvFilename('Star Trek S01E05 The Enemy Within 1080p.mkv');
  assert.ok(ep);
  assert.equal(ep.season_number, 1);
  assert.equal(ep.episode_number, 5);
});

test('import discovery filters files, groups TV episodes, and preserves existing input edits', async () => {
  const root = '/media';
  const directories = {
    [root]: [
      { name: '.hidden.mkv', isDirectory: false },
      { name: 'notes.txt', isDirectory: false },
      { name: 'Nested', isDirectory: true },
      { name: 'Loose Show S01E01 Pilot.mkv', isDirectory: false },
      { name: 'Loose Show S01E02 Return.mkv', isDirectory: false },
      { name: 'Standalone.mkv', isDirectory: false }
    ],
    [`${root}/Nested`]: [
      { name: 'Nested Show S02E01 Premiere.mkv', isDirectory: false },
      { name: '.hidden.mkv', isDirectory: false }
    ]
  };
  const parseLooseTvFilename = (name) => {
    const match = name.match(/^(.*?) S(\d{2})E(\d{2})/i);
    if (!match) return null;
    return {
      title: match[1],
      year: '2024',
      season_number: Number(match[2]),
      normKey: `${match[1].toLowerCase().replaceAll(' ', '-')}-s${match[2]}`
    };
  };
  const result = await importDiscovery.discoverImportFolder(root, {
    'import:Standalone.mkv': { title: 'Manually edited title' }
  }, {
    readDir: async path => directories[path],
    videoExts: ['.mkv', '.mp4'],
    inferMetadata: name => ({ title: name }),
    inferFolder: async (_path, name) => ({ title: name }),
    parseLooseTvFilename
  });

  assert.deepEqual(result.items.map(item => item.key), [
    'import:tv:loose-show-s01',
    'import:Nested',
    'import:Standalone.mkv'
  ]);
  assert.equal(result.items[0].files.length, 2);
  assert.equal(result.items[0].sourcePath, `${root}/Loose Show S01E01 Pilot.mkv`);
  assert.deepEqual(result.items[1].files.map(file => file.name), ['Nested Show S02E01 Premiere.mkv']);
  assert.equal(result.inputs['import:tv:loose-show-s01'].media_type, 'tv');
  assert.equal(result.inputs['import:Nested'].season_number, 2);
  assert.equal(result.inputs['import:Standalone.mkv'].title, 'Manually edited title');
});

test('All Svelte components compile cleanly without syntax or template errors', () => {
  const components = [
    'src/lib/Icon.svelte',
    'src/lib/MovieDetailView.svelte',
    'src/lib/AuditorView.svelte',
    'src/lib/CollectionView.svelte',
    'src/lib/LoggedCard.svelte',
    'src/lib/MovieCard.svelte',
    'src/lib/SearchResultsView.svelte',
    'src/lib/PersonView.svelte',
    'src/routes/+page.svelte'
  ];
  for (const file of components) {
    const src = fs.readFileSync(file, 'utf8');
    const out = compile(src, { filename: file, generate: 'client' });
    assert.ok(out.js?.code, `Expected compiled output for ${file}`);
  }
});

test('Critical regressions stay guarded across components', () => {
  const md = fs.readFileSync('src/lib/MovieDetailView.svelte', 'utf8');
  assert.ok(md.includes('ownedEpCount ='), 'MovieDetailView must define ownedEpCount for TV seasons');
  assert.ok(md.includes('<Icon '), 'MovieDetailView must render shared <Icon>');

  const av = fs.readFileSync('src/lib/AuditorView.svelte', 'utf8');
  assert.ok(av.includes('loadActivityLog(activityLimit)'), 'AuditorView must pass activityLimit to loadActivityLog');
  assert.ok(!av.includes('targetKey.includes(k)'), 'AuditorView findLogEntry must not use loose substring matching');

  const cv = fs.readFileSync('src/lib/CollectionView.svelte', 'utf8');
  assert.ok(cv.includes('requiredTags'), 'CollectionView must support [tag1, tag2] multi-tag filter');
  assert.ok(cv.includes('yearMin'), 'CollectionView must support YYYY-YYYY year range filter');
});

test('CollectionView imports fuzzyTextIncludes and has no undefined helpers', () => {
  const cv = fs.readFileSync('src/lib/CollectionView.svelte', 'utf8');
  assert.ok(cv.includes("import { fuzzyTextIncludes } from '$lib/guppyStore.js';"), 'CollectionView must import fuzzyTextIncludes');
  assert.ok(cv.includes('fuzzyTextIncludes(v, textQuery)'), 'CollectionView must call fuzzyTextIncludes');
});

test('searchUniversal builds valid image.tmdb.org poster URLs and resolves missing IMDb IDs', async () => {
  const origWindow = globalThis.window;
  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes('/3/search/movie')) {
      return new Response(JSON.stringify({
        results: [{ id: 999111, title: 'Cannon Fodder', release_date: '2025-05-01', poster_path: '/cf.jpg', overview: 'Test' }]
      }), { status: 200 });
    }
    if (u.includes('/3/movie/999111')) {
      return new Response(JSON.stringify({
        id: 999111, title: 'Cannon Fodder', release_date: '2025-05-01', poster_path: '/cf.jpg', imdb_id: null, credits: { crew: [], cast: [] }
      }), { status: 200 });
    }
    if (u.includes('list=search')) {
      return new Response(JSON.stringify({
        query: { search: [{ title: 'Q123456' }] }
      }), { status: 200 });
    }
    if (u.includes('wbgetentities')) {
      return new Response(JSON.stringify({
        entities: { Q123456: { claims: { P345: [{ mainsnak: { datavalue: { value: 'tt37545848' } } }] } } }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  globalThis.window = { fetch: mockFetch };
  try {
    const res = await store.searchUniversal('Cannon Fodder');
    assert.equal(res.movies.length, 1);
    assert.equal(res.movies.at(0).poster_url, ["https:/", "image.tmdb.org", "t", "p", "w300", "cf.jpg"].join("/"));
    assert.equal(res.movies.at(0).imdb_id, 'tt37545848');
  } finally {
    globalThis.window = origWindow;
  }
});

test('fetchEnrichedMovie resolves missing IMDb ID via IMDb suggestion first-letter bucket', async () => {
  const origWindow = globalThis.window;
  globalThis.window = {
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('/3/movie/888222')) {
        return new Response(JSON.stringify({
          id: 888222, title: 'Cannon Fodder', release_date: '2025-05-01', poster_path: '/cf.jpg', imdb_id: null, credits: { crew: [], cast: [] }
        }), { status: 200 });
      }
      if (u.includes('/suggestion/c/Cannon%20Fodder.json')) {
        return new Response(JSON.stringify({
          d: [{ id: 'tt37545848', l: 'Cannon Fodder', y: 2025 }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }
  };
  try {
    const enriched = await store.fetchEnrichedMovie({ id: 888222, title: 'Cannon Fodder', release_date: '2025-05-01' });
    assert.equal(enriched.imdb_id, 'tt37545848');
  } finally {
    globalThis.window = origWindow;
  }
});

test('fetchEnrichedMovie prefers TMDB external IMDb ID for Cannon Fodder', async () => {
  const origWindow = globalThis.window;
  globalThis.window = {
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('/3/movie/777333/external_ids')) {
        return new Response(JSON.stringify({ imdb_id: 'tt37545848' }), { status: 200 });
      }
      if (u.includes('/3/movie/777333')) {
        return new Response(JSON.stringify({
          id: 777333,
          title: 'Cannon Fodder',
          release_date: '1971-01-01',
          poster_path: '/cf71.jpg',
          imdb_id: null,
          external_ids: {},
          credits: { crew: [{ job: 'Director', name: 'Vera Neubauer' }], cast: [] }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }
  };
  try {
    const enriched = await store.fetchEnrichedMovie({
      id: 777333,
      title: 'Cannon Fodder',
      release_date: '1971-01-01'
    });
    assert.equal(enriched.imdb_id, 'tt37545848');
    assert.equal(enriched.imdb_id_source, 'tmdb');
  } finally {
    globalThis.window = origWindow;
  }
});

test('fetchEnrichedMovie resolves the 1971 Cannon Fodder IMDb ID from the title-year suggestion', async () => {
  const origWindow = globalThis.window;
  const suggestionQueries = [];
  globalThis.window = {
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('/3/movie/959521/external_ids')) {
        return new Response(JSON.stringify({ imdb_id: null }), { status: 200 });
      }
      if (u.includes('/3/movie/959521')) {
        return new Response(JSON.stringify({
          id: 959521,
          title: 'Cannon Fodder',
          release_date: '1971-01-01',
          imdb_id: null,
          external_ids: {},
          credits: { crew: [{ job: 'Director', name: 'Vera Neubauer' }], cast: [] }
        }), { status: 200 });
      }
      if (u.includes('/suggestion/')) {
        const query = decodeURIComponent(u.slice(u.lastIndexOf('/') + 1).replace(/\.json$/, ''));
        suggestionQueries.push(query);
        return new Response(JSON.stringify({
          d: query === 'Cannon Fodder 1971'
            ? [{ id: 'tt37545848', l: 'Cannon fodder', y: 1971 }]
            : []
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }
  };
  try {
    const enriched = await store.fetchEnrichedMovie({
      id: 959521,
      title: 'Cannon Fodder',
      release_date: '1971-01-01'
    });
    assert.equal(enriched.imdb_id, 'tt37545848');
    assert.equal(enriched.imdb_id_source, 'imdb-suggestion');
    assert.ok(suggestionQueries.includes('Cannon Fodder 1971'));
  } finally {
    globalThis.window = origWindow;
  }
});

test('IMDb fallback prefers an exact title and closest year over similar-title collisions', async () => {
  const origWindow = globalThis.window;
  globalThis.window = {
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('/3/movie/959522/external_ids')) {
        return new Response(JSON.stringify({ imdb_id: null }), { status: 200 });
      }
      if (u.includes('/3/movie/959522')) {
        return new Response(JSON.stringify({
          id: 959522,
          title: 'Cannon Fodder',
          release_date: '1971-01-01',
          external_ids: {},
          credits: { crew: [{ job: 'Director', name: 'Vera Neubauer' }], cast: [] }
        }), { status: 200 });
      }
      if (u.includes('/suggestion/')) {
        return new Response(JSON.stringify({
          d: [
            { id: 'tt9000001', l: 'Cannon Fodder', y: 2018 },
            { id: 'tt9000002', l: 'Cannon Fodder: The Sequel', y: 1971 },
            { id: 'tt37545848', l: 'Cannon fodder', y: 1971 }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 });
    }
  };
  try {
    const enriched = await store.fetchEnrichedMovie({
      id: 959522,
      title: 'Cannon Fodder',
      release_date: '1971-01-01'
    });
    assert.equal(enriched.imdb_id, 'tt37545848');
    assert.equal(enriched.imdb_id_source, 'imdb-suggestion');
  } finally {
    globalThis.window = origWindow;
  }
});

test('IMDb fallback distinguishes service failures from a successful no-match result', async () => {
  const origWindow = globalThis.window;
  const makeFetch = (fail) => async (url) => {
    const u = String(url);
    if (u.includes('/3/movie/959523/external_ids')) {
      return new Response(JSON.stringify({ imdb_id: null }), { status: 200 });
    }
    if (u.includes('/3/movie/959523')) {
      return new Response(JSON.stringify({
        id: 959523,
        title: 'Unknown Obscure Film',
        release_date: '1971-01-01',
        external_ids: {},
        credits: { crew: [], cast: [] }
      }), { status: 200 });
    }
    if (fail && (u.includes('/suggestion/') || u.includes('wikidata.org'))) {
      return new Response('unavailable', { status: 503 });
    }
    if (u.includes('/suggestion/')) return new Response(JSON.stringify({ d: [] }), { status: 200 });
    if (u.includes('wikidata.org')) return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  };

  try {
    globalThis.window = { fetch: makeFetch(false) };
    const noMatch = await store.fetchEnrichedMovie({
      id: 959523,
      title: 'Unknown Obscure Film',
      release_date: '1971-01-01'
    });
    assert.equal(noMatch.imdb_lookup_status, 'no_match');
    assert.equal(noMatch.imdb_lookup_error, '');

    globalThis.window = { fetch: makeFetch(true) };
    const failed = await store.fetchEnrichedMovie({
      id: 959523,
      title: 'Unknown Obscure Film',
      release_date: '1971-01-01'
    });
    assert.equal(failed.imdb_lookup_status, 'failed');
    assert.match(failed.imdb_lookup_error, /503/);
  } finally {
    globalThis.window = origWindow;
  }
});

test('Tauri HTTP capability allows IMDb suggestion and Wikidata fallback endpoints', () => {
  const capabilities = JSON.parse(fs.readFileSync('src-tauri/capabilities/default.json', 'utf8'));
  const http = capabilities.permissions.find(permission => permission.identifier === 'http:default');
  const allowedUrls = http.allow.map(entry => entry.url);
  assert.ok(allowedUrls.includes('https://v2.sg.media-imdb.com/**'));
  assert.ok(allowedUrls.includes('https://www.wikidata.org/**'));
});

test('searchUniversal enforces strict [adult] filtering and title + date range + keyword filtering', async () => {
  const origWindow = globalThis.window;
  globalThis.window = {
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('/3/search/keyword')) {
        return new Response(JSON.stringify({ results: [{ id: 555, name: 'comedy' }] }), { status: 200 });
      }
      if (u.includes('/3/search/movie')) {
        return new Response(JSON.stringify({
          results: [
            { id: 101, title: 'Some Like It Hot', release_date: '1959-03-29', adult: false, poster_path: '/slih.jpg' },
            { id: 102, title: 'Some Adult Title', release_date: '1975-06-01', adult: true, poster_path: '/sat.jpg' },
            { id: 103, title: 'Some Later Comedy', release_date: '1962-04-10', adult: false, poster_path: '/slc.jpg' }
          ]
        }), { status: 200 });
      }
      if (u.includes('/3/movie/101/keywords')) {
        return new Response(JSON.stringify({ keywords: [{ id: 555, name: 'comedy' }] }), { status: 200 });
      }
      if (u.includes('/3/movie/103/keywords')) {
        return new Response(JSON.stringify({ keywords: [] }), { status: 200 });
      }
      if (u.includes('/3/movie/')) {
        return new Response(JSON.stringify({ id: 101, credits: { crew: [], cast: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
  };
  try {
    const adultRes = await store.searchUniversal('some [adult]');
    assert.deepEqual(adultRes.movies.map(m => m.title), ['Some Adult Title']);

    const safeRes = await store.searchUniversal('some');
    assert.deepEqual(safeRes.movies.map(m => m.title), ['Some Like It Hot', 'Some Later Comedy']);

    const comboRes = await store.searchUniversal('some (1955-1965) [comedy]');
    assert.deepEqual(comboRes.movies.map(m => m.title), ['Some Like It Hot']);
  } finally {
    globalThis.window = origWindow;
  }
});
