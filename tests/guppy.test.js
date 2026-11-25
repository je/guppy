import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile } from 'svelte/compiler';
import { createServer } from 'vite';

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent'
});

const store = await vite.ssrLoadModule('/src/lib/guppyStore.js');

test.after(async () => {
  await vite.close();
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
});

test('computeSeasonWatchStatus rolls up episode watch states', () => {
  assert.equal(store.computeSeasonWatchStatus([]), '');
  assert.equal(store.computeSeasonWatchStatus([{ watch_status: '' }, { watch_status: '' }]), '');
  assert.equal(store.computeSeasonWatchStatus([{ watch_status: 'liked' }, { watch_status: 'liked' }]), 'liked');
  assert.equal(store.computeSeasonWatchStatus([{ watch_status: 'liked' }, { watch_status: '' }]), 'unfinished');
  assert.equal(store.computeSeasonWatchStatus([{ watch_status: 'disliked' }, { watch_status: 'disliked' }]), 'disliked');
});

test('parseLooseTvFilename extracts show, season, and episode', () => {
  const ep = store.parseLooseTvFilename('Star Trek S01E05 The Enemy Within 1080p.mkv');
  assert.ok(ep);
  assert.equal(ep.season_number, 1);
  assert.equal(ep.episode_number, 5);
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
