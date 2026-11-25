import { test, expect } from '@playwright/test';

const INITIAL_ROWS = [
  {
    folder_name: 'Miroir (1947)',
    title: 'Miroir',
    year: 1947,
    quality: '1080p',
    imdb_id: 'tt0039629',
    poster_url: '',
    director: 'Raymond Lamy',
    cast_list: 'Jean Gabin, Daniel Gélin',
    overview: 'French crime drama.',
    tags: 'noir, french',
    clips: '',
    runtime: '95',
    countries: 'France',
    genres: 'Crime, Drama',
    watch_status: 'liked',
    status: 'owned',
    media_type: 'movie',
    season_number: null,
    episodes_json: '',
    tmdb_id: 12345
  },
  {
    folder_name: 'Star Crash (1978)',
    title: 'Star Crash',
    year: 1978,
    quality: '1080p',
    imdb_id: 'tt0079946',
    poster_url: '',
    director: 'Luigi Cozzi',
    cast_list: 'Caroline Munro, Marjoe Gortner',
    overview: 'Space opera adventure.',
    tags: 'outer space, gorilla suit',
    clips: '',
    runtime: '92',
    countries: 'Italy',
    genres: 'Action, Science Fiction',
    watch_status: '',
    status: 'owned',
    media_type: 'movie',
    season_number: null,
    episodes_json: '',
    tmdb_id: 22191
  },
  {
    folder_name: 'Happy Days - s02',
    title: 'Happy Days',
    year: 1975,
    quality: '720p',
    imdb_id: 'tt0070992',
    poster_url: '',
    director: 'Jerry Paris',
    cast_list: 'Ron Howard, Henry Winkler',
    overview: 'Season 2.',
    tags: 'sitcom',
    clips: '',
    runtime: '',
    countries: 'United States',
    genres: 'Comedy',
    watch_status: 'liked',
    status: 'owned',
    media_type: 'tv',
    season_number: 2,
    episodes_json: JSON.stringify([
      { episode_number: 1, name: 'Richie Moves Out', file_name: 'Happy Days S02E01.mp4', watch_status: 'liked' }
    ]),
    tmdb_id: 2557
  }
];

function setupMockBackend(page) {
  let rows = INITIAL_ROWS.map(r => ({ ...r }));
  let schemaVersions = [];
  let executeStatements = [];
  let executeCalls = [];
  let nextActivityId = 2;
  let activity = [
    { id: 1, created_at: '2026-11-23 12:00', action: 'Watch Status', title: 'Miroir', detail: 'Seen & Liked', undo_payload: '' }
  ];
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));

  const install = async () => {
    await page.route('**/health', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await page.route('**/api/**', async route => {
      const url = route.request().url();
      if (url.includes('/sql/select')) {
        const body = JSON.parse(route.request().postData() || '{}');
        const sql = String(body.sql || '');
        if (sql.includes('schema_migrations')) {
          const selected = sql.includes('WHERE version = ?')
            ? schemaVersions.filter(entry => entry.version === Number((body.params || [])[0]))
            : schemaVersions;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: selected }) });
        }
        if (sql.includes('pragma_table_info')) {
          const table = sql.match(/pragma_table_info\('([^']+)'\)/)?.[1];
          const names = table === 'activity_log'
            ? ['id', 'created_at', 'action', 'title', 'detail', 'undo_payload']
            : ['id', 'folder_name', 'title', 'year', 'quality', 'imdb_id', 'imdb_id_source', 'poster_url', 'director', 'cast_list', 'overview', 'status', 'tags', 'clips', 'watch_status', 'media_type', 'season_number', 'episodes_json', 'tmdb_id', 'runtime', 'countries', 'genres'];
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ rows: names.map(name => ({ name })) })
          });
        }
        if (sql.includes('activity_log')) {
          const selected = sql.includes('WHERE id = ?')
            ? activity.filter(entry => entry.id === Number((body.params || [])[0]))
            : activity;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: selected }) });
        }
        if (sql.includes('watch_status FROM wishlist_videos')) {
          const folderName = (body.params || [])[0];
          const row = rows.find(entry => entry.folder_name === folderName);
          const selected = row && sql.includes('SELECT title')
            ? [{ title: row.title, year: row.year, watch_status: row.watch_status }]
            : row ? [{ watch_status: row.watch_status }] : [];
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: selected }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows }) });
      }
      if (url.includes('/sql/execute')) {
        const body = JSON.parse(route.request().postData() || '{}');
        const sql = String(body.sql || '');
        const params = body.params || [];
        executeStatements.push(sql);
        executeCalls.push({ sql, params });
        if (sql.includes('INSERT INTO schema_migrations')) {
          schemaVersions.push({ version: Number(params[0]) });
        }
        if (sql.includes('INSERT INTO activity_log')) {
          const id = nextActivityId++;
          activity.unshift({
            id,
            created_at: '2026-11-23 12:01',
            action: params[0],
            title: params[1],
            detail: params[2],
            undo_payload: params[3]
          });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ changes: 1, lastInsertRowid: id })
          });
        }
        if (sql.startsWith('UPDATE wishlist_videos SET folder_name=')) {
          const [folder_name, title, year, imdb_id, poster_url, director, cast_list, overview, runtime, countries, genres, tmdb_id, imdb_id_source, oldFolderName] = params;
          rows = rows.map(row => row.folder_name === oldFolderName
            ? { ...row, folder_name, title, year: Number(year), imdb_id, imdb_id_source, poster_url, director, cast_list, overview, runtime, countries, genres, tmdb_id }
            : row);
        } else if (sql.includes('DELETE FROM wishlist_videos')) {
          rows = rows.filter(r => r.folder_name !== params.at(0));
        } else if (sql.includes('SET watch_status')) {
          rows = rows.map(r => r.folder_name === params.at(1) ? { ...r, watch_status: params.at(0) } : r);
        } else if (sql.includes('SET tags')) {
          rows = rows.map(r => r.folder_name === params.at(2) ? { ...r, tags: params.at(0), clips: params.at(1) } : r);
        } else if (sql.includes("UPDATE activity_log SET undo_payload")) {
          activity = activity.map(entry => entry.id === Number(params.at(0))
            ? { ...entry, undo_payload: '' }
            : entry);
        }
        const changes = sql.startsWith('UPDATE wishlist_videos SET folder_name=')
          ? Number(rows.some(row => row.folder_name === params[0]))
          : 1;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changes, ok: true }) });
      }
      if (url.toLowerCase().includes('/fs/readdir')) {
        const body = JSON.parse(route.request().postData() || '{}');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ entries: rows.map(r => ({ name: r.folder_name, isDirectory: true, isFile: false })) })
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('https://themoviedb.org**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], episodes: [] }) })
    );
  };

  return {
    install,
    pageErrors,
    getRows: () => rows,
    getExecuteStatements: () => executeStatements,
    getExecuteCalls: () => executeCalls
  };
}

test('Catalog filters, tabs, layout modes, sort dropdown, watch status, and tag editor work without errors', async ({ page }) => {
  const { install, pageErrors, getRows } = setupMockBackend(page);
  await install();
  await page.goto('/');

  // Filter: combined title + year range + multi-tag AND
  const filterInput = page.getByPlaceholder('Filter title, director, cast, tags, clips…');
  await filterInput.fill('star (1970-1980) [outer space, gorilla suit]');
  await expect(page.getByText('Star Crash')).toBeVisible();
  await expect(page.getByText('Miroir')).toHaveCount(0);

  // Filter: Damerau-Levenshtein fuzzy typo match
  await filterInput.fill('miroire');
  await expect(page.getByText('Miroir')).toBeVisible();
  await filterInput.click();

  // Type & layout & sort controls
  await page.getByRole('button', { name: 'TV', exact: true }).click();
  await expect(page.getByText('Happy Days')).toBeVisible();
  await expect(page.getByText('Miroir')).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).first().click();

  await page.getByRole('button', { name: 'Compact view' }).click();
  await page.getByRole('button', { name: 'Posters view' }).click();
  await page.getByRole('button', { name: 'Cards view' }).click();

  await page.getByLabel('Sort catalog').selectOption('title');
  await page.getByLabel('Sort catalog').selectOption('year_desc');
  await page.getByLabel('Sort catalog').selectOption('shuffle');

  // Watch status & Tag editor on Star Crash
  const starCard = page.locator('article', { hasText: 'Star Crash' });
  await starCard.getByRole('button', { name: 'Mark Seen and Liked' }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect.poll(() => getRows().find(row => row.folder_name === 'Star Crash (1978)')?.watch_status).toBe('liked');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.success-banner')).toContainText('Action undone.');
  await expect.poll(() => getRows().find(row => row.folder_name === 'Star Crash (1978)')?.watch_status).toBe('');
  await starCard.getByRole('button', { name: 'Tags' }).click();
  await starCard.getByPlaceholder(/Tags \(comma-separated/).fill('outer space, gorilla suit, cult');
  await starCard.getByRole('button', { name: 'Save' }).click();
  await expect(starCard.getByText('cult')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('Audit unmatched cards remain inside the three-column grid', async ({ page }) => {
  await page.addInitScript(() => { window.__GUPPY_FORCE_HOST__ = true; });
  const { install, getRows } = setupMockBackend(page);
  await install();
  for (const row of getRows()) row.imdb_id = '';
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Switch to Audit and Import' }).click();
  await page.getByRole('button', { name: /Unmatched/ }).click();

  const grid = page.locator('.grid-3').first();
  await expect(grid.locator(':scope > article.catalog-entry')).toHaveCount(3);
  const layout = await grid.evaluate(element => {
    const gridRight = element.getBoundingClientRect().right;
    const cards = [...element.querySelectorAll(':scope > article.catalog-entry')];
    return {
      columns: getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
      gridRight,
      cardRights: cards.map(card => card.getBoundingClientRect().right)
    };
  });
  expect(layout.columns).toBe(3);
  expect(Math.max(...layout.cardRights)).toBeLessThanOrEqual(layout.gridRight + 1);
});

test('Undo remains available from Recent Activity', async ({ page }) => {
  await page.addInitScript(() => { window.__GUPPY_FORCE_HOST__ = true; });
  const { install, pageErrors, getRows } = setupMockBackend(page);
  await install();
  await page.goto('/');

  const starCard = page.locator('article', { hasText: 'Star Crash' });
  await starCard.getByRole('button', { name: 'Mark Seen and Liked' }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Audit and Import' }).click();

  const activityRow = page.locator('.activity-log-row').filter({ hasText: 'Star Crash' });
  await expect(activityRow.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await activityRow.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => getRows().find(row => row.folder_name === 'Star Crash (1978)')?.watch_status).toBe('');
  await expect(activityRow.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('Movie & TV season detail views, header status filters, and Remove confirmation work without errors', async ({ page }) => {
  const { install, pageErrors } = setupMockBackend(page);
  await install();
  await page.goto('/');

  // Open TV Season detail page & go back
  await page.getByRole('button', { name: /Happy Days/i }).click();
  await expect(page.getByRole('heading', { name: /Happy Days.*Season 2/i })).toBeVisible();
  await page.getByRole('button', { name: /← Back/i }).click();

  // Open Movie detail page & go back
  await page.getByRole('button', { name: 'Miroir', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Miroir/i })).toBeVisible();
  await page.getByRole('button', { name: /← Back/i }).click();

  // Header status filter buttons
  await page.getByRole('button', { name: '2 Liked' }).click();
  await expect(page.getByText('Miroir')).toBeVisible();
  await page.getByRole('button', { name: '3 Listed' }).click();

  // Remove -> Delete? confirmation
  const miroCard = page.locator('article', { hasText: 'Miroir' });
  await miroCard.getByRole('button', { name: 'Remove' }).click();
  await miroCard.getByText('Delete?').click();
  await expect(page.getByText('Remove failed')).toHaveCount(0);
  await expect(miroCard).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('Universal Search displays results and Return to Catalog works without errors', async ({ page }) => {
  const { install, pageErrors } = setupMockBackend(page);
  await install();
  await page.goto('/');

  const searchBox = page.getByLabel('Universal search');
  await searchBox.fill('Miroir');
  await searchBox.press('Enter');
  await expect(page.getByRole('heading', { name: /Results for “Miroir”/i })).toBeVisible();
  await page.getByRole('button', { name: 'Return to Catalog' }).click();
  await expect(page.getByText('Star Crash')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('Audit / Import view renders Add Titles, Rescan Library, Catalog Health, and Recent Activity without errors', async ({ page }) => {
  await page.addInitScript(() => { window.__GUPPY_FORCE_HOST__ = true; });
  const { install, pageErrors } = setupMockBackend(page);
  await install();
  await page.goto('/');

  await page.getByRole('button', { name: 'Switch to Audit and Import' }).click();
  await expect(page.getByRole('button', { name: 'Add Titles' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rescan Library' })).toBeVisible();
  // File Library and Import Folder use distinct icons
  const fileLibSvg = await page.getByRole('button', { name: 'File Library' }).locator('svg').innerHTML();
  const importFolderSvg = await page.getByRole('button', { name: 'Import Folder' }).locator('svg').innerHTML();
  expect(fileLibSvg).not.toBe(importFolderSvg);
  await expect(page.getByRole('heading', { name: /Recent Activity/i })).toBeVisible();

  await page.getByRole('button', { name: 'Add Titles' }).click();
  await expect(page.locator('textarea').first()).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('Re-matching Cannon Fodder attaches IMDb link automatically in Audit view', async ({ page }) => {
  await page.addInitScript(() => { window.__GUPPY_FORCE_HOST__ = true; });
  const { install, getExecuteCalls, getRows } = setupMockBackend(page);
  await install();
  const cannonFodder = getRows()[0];
  cannonFodder.folder_name = '1971 - Cannon Fodder [1080p]';
  cannonFodder.title = 'Cannon Fodder';
  cannonFodder.year = 1971;
  cannonFodder.director = 'Vera Neubauer';
  cannonFodder.imdb_id = '';
  cannonFodder.imdb_id_source = '';
  cannonFodder.tmdb_id = 959521;
  await page.route('**/api/imdb-suggest**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    const suggestions = query === 'Cannon Fodder 1971'
      ? [{ id: 'tt37545848', l: 'Cannon fodder', y: 1971 }]
      : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ d: suggestions })
    });
  });
  await page.route(/themoviedb\.org|imdb\.com|wikidata\.org/, async (route) => {
    const url = route.request().url();
    if (url.includes('themoviedb.org/3/search/movie')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ id: 959521, title: 'Cannon Fodder', release_date: '1971-01-01', poster_path: '/cf71.jpg', overview: 'Animated short.' }]
        })
      });
    }
    if (url.includes('themoviedb.org/3/movie/959521')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 959521,
          title: 'Cannon Fodder',
          release_date: '1971-01-01',
          poster_path: '/cf71.jpg',
          imdb_id: null,
          overview: 'Animated short.',
          credits: { crew: [{ job: 'Director', name: 'Vera Neubauer' }], cast: [] }
        })
      });
    }
    if (url.includes('media-imdb.com') || url.includes('wikidata.org')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    }
    return route.continue();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to Audit and Import' }).click();
  await page.getByRole('button', { name: /Unmatched \(1\)/ }).click();

  const firstCard = page.locator('article.catalog-entry').filter({ hasText: 'Cannon Fodder' }).first();
  await firstCard.hover();
  await firstCard.getByRole('button', { name: 'Lookup' }).click();
  const lookupInput = page.locator('form.relookup-bar input[type="text"]').first();
  await lookupInput.fill('Cannon Fodder (1971) [Vera Neubauer]');
  await page.locator('form.relookup-bar button[type="submit"]').first().click();

  const candidate = page.locator('.candidate-row').first();
  await expect(candidate).toBeVisible();
  await candidate.click();

  await expect(page.getByRole('button', { name: /Unmatched \(0\)/ })).toBeVisible();
  expect(getRows()[0].imdb_id).toBe('tt37545848');
  const updateCall = getExecuteCalls().find(call => call.sql.startsWith('UPDATE wishlist_videos SET folder_name='));
  expect(updateCall?.params[3]).toBe('tt37545848');
  expect(updateCall?.params.at(-1)).toBe('1971 - Cannon Fodder [1080p]');
  expect(updateCall?.params[12]).toBe('imdb-suggestion');
  const metadataActivityCalls = getExecuteCalls().filter(call =>
    call.sql.includes('INSERT INTO activity_log') && call.params[0] === 'Updated Metadata'
  );
  expect(metadataActivityCalls).toHaveLength(1);
  expect(metadataActivityCalls[0].params[2]).toContain('tt37545848');
});

test('Unmatched metadata lookup reports unavailable IMDb services instead of a no-match', async ({ page }) => {
  await page.addInitScript(() => { window.__GUPPY_FORCE_HOST__ = true; });
  const { install, getRows } = setupMockBackend(page);
  await install();
  const target = getRows()[0];
  target.folder_name = '1971 - Cannon Fodder [1080p]';
  target.title = 'Cannon Fodder';
  target.year = 1971;
  target.director = 'Vera Neubauer';
  target.imdb_id = '';
  target.imdb_id_source = '';
  target.tmdb_id = 959524;

  await page.route('**/api/imdb-suggest**', route =>
    route.fulfill({ status: 503, body: 'IMDb lookup unavailable' })
  );
  await page.route(/themoviedb\.org|wikidata\.org/, async route => {
    const url = route.request().url();
    if (url.includes('/3/search/movie')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ id: 959524, title: 'Cannon Fodder', release_date: '1971-01-01' }]
        })
      });
    }
    if (url.includes('/3/movie/959524/external_ids')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imdb_id: null }) });
    }
    if (url.includes('/3/movie/959524')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 959524,
          title: 'Cannon Fodder',
          release_date: '1971-01-01',
          external_ids: {},
          credits: { crew: [{ job: 'Director', name: 'Vera Neubauer' }], cast: [] }
        })
      });
    }
    if (url.includes('wikidata.org')) {
      return route.fulfill({ status: 503, body: 'Wikidata unavailable' });
    }
    return route.continue();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to Audit and Import' }).click();
  await page.getByRole('button', { name: /Unmatched \(1\)/ }).click();
  const card = page.locator('article.catalog-entry').filter({ hasText: 'Cannon Fodder' }).first();
  await card.hover();
  await card.getByRole('button', { name: 'Lookup' }).click();
  await page.locator('form.relookup-bar input[type="text"]').first().fill('Cannon Fodder (1971) [Vera Neubauer]');
  await page.locator('form.relookup-bar button[type="submit"]').first().click();
  await page.locator('.candidate-row').first().click();

  await expect(page.getByRole('alert').filter({ hasText: 'IMDb lookup failed' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Unmatched \(1\)/ })).toBeVisible();
  expect(getRows()[0].imdb_id).toBe('');
});

test('Connection refresh disables and animates the refresh control while checking', async ({ page }) => {
  const { install } = setupMockBackend(page);
  await install();
  await page.route('**/health', async route => {
    await new Promise(resolve => setTimeout(resolve, 600));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await page.goto('/');
  await expect(page.getByText(/Connected to/)).toBeVisible();
  await page.getByRole('button', { name: 'Recheck' }).click();
  const refreshing = page.getByRole('button', { name: 'Refreshing connection' });
  await expect(refreshing).toBeDisabled();
  await expect(refreshing.locator('svg')).toHaveClass(/spin/);
  await expect(page.getByRole('button', { name: 'Recheck' })).toBeEnabled({ timeout: 5000 });
});
