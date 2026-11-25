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
  let activity = [
    { id: 1, created_at: '2026-11-23 12:00', action: 'Watch Status', title: 'Miroir', detail: 'Seen & Liked' }
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
        if (sql.includes('activity_log')) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: activity }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows }) });
      }
      if (url.includes('/sql/execute')) {
        const body = JSON.parse(route.request().postData() || '{}');
        const sql = String(body.sql || '');
        const params = body.params || [];
        if (sql.includes('DELETE FROM wishlist_videos')) {
          rows = rows.filter(r => r.folder_name !== params.at(0));
        } else if (sql.includes('SET watch_status')) {
          rows = rows.map(r => r.folder_name === params.at(1) ? { ...r, watch_status: params.at(0) } : r);
        } else if (sql.includes('SET tags')) {
          rows = rows.map(r => r.folder_name === params.at(2) ? { ...r, tags: params.at(0), clips: params.at(1) } : r);
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      if (url.includes('/fs/readdir')) {
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

  return { install, pageErrors };
}

test('Catalog filters, tabs, layout modes, sort dropdown, watch status, and tag editor work without errors', async ({ page }) => {
  const { install, pageErrors } = setupMockBackend(page);
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
  await starCard.getByRole('button', { name: 'Tags' }).click();
  await starCard.getByPlaceholder(/Tags \(comma-separated/).fill('outer space, gorilla suit, cult');
  await starCard.getByRole('button', { name: 'Save' }).click();
  await expect(starCard.getByText('cult')).toBeVisible();

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
  await expect(page.getByText('Miroir')).toHaveCount(0);

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
  const { install } = setupMockBackend(page);
  await install();
  await page.route(/themoviedb\.org|imdb\.com|wikidata\.org/, async (route) => {
    const url = route.request().url();
    if (url.includes('themoviedb.org/3/search/movie')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ id: 777333, title: 'Cannon Fodder', release_date: '1971-01-01', poster_path: '/cf71.jpg', overview: 'Animated short.' }]
        })
      });
    }
    if (url.includes('themoviedb.org/3/movie/777333')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 777333,
          title: 'Cannon Fodder',
          release_date: '1971-01-01',
          poster_path: '/cf71.jpg',
          imdb_id: null,
          overview: 'Animated short.',
          credits: { crew: [{ job: 'Director', name: 'Vera Neubauer' }], cast: [] }
        })
      });
    }
    if (url.includes('://imdb.com')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<a href="/title/tt37545848/">Cannon Fodder (1971)</a>'
      });
    }
    if (url.includes('media-imdb.com') || url.includes('wikidata.org')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    }
    return route.continue();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to Audit and Import' }).click();

  const firstCard = page.locator('article.catalog-entry').first();
  await firstCard.hover();
  await firstCard.getByRole('button', { name: 'Lookup' }).click();
  const lookupInput = page.locator('form.relookup-bar input[type="text"]').first();
  await lookupInput.fill('Cannon Fodder (1971) [Vera Neubauer]');
  await page.locator('form.relookup-bar button[type="submit"]').first().click();

  const candidate = page.locator('.candidate-row').first();
  await expect(candidate).toBeVisible();
  await candidate.click();

  await firstCard.hover();
  await expect(firstCard.getByRole('button', { name: 'Copy IMDb link' })).toBeVisible();
});
