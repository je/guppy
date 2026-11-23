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
