<script>
  import { parseBulkLines, findTmdbByImdbId, searchTmdb, searchTmdbTv, saveWantedMovie, saveWantedTvSeason } from '$lib/guppyStore.js';

  export let databaseEntries = [];
  export let diskFolders = [];
  export let onClose;
  export let onComplete;

  const posterSmall = ["https:/", "image.tmdb.org", "t", "p", "w154"].join("/");

  let rawText = '';
  let rows = [];
  let running = false;
  let saving = false;
  let defaultWatch = '';

  $: matchedCount = rows.filter(r => r.selected).length;

  function findExistingInCatalog(match) {
    if (!match) return null;
    const mTitle = (match.title || '').toLowerCase().trim();
    if (match.media_type === 'tv') {
      const sNum = Number(match.season_number) || 1;
      return databaseEntries.find(d =>
        d.media_type === 'tv' &&
        Number(d.season_number) === sNum &&
        (Number(d.tmdb_id) === Number(match.id) || (d.title || '').toLowerCase().trim() === mTitle)
      ) || null;
    }
    const mYear = String(match.year || match.release_date?.slice(0, 4) || '');
    return databaseEntries.find(d => {
      if ((d.media_type || 'movie') !== 'movie') return false;
      if ((d.title || '').toLowerCase().trim() !== mTitle) return false;
      if (mYear && d.year && String(d.year) !== mYear) return false;
      return true;
    }) || null;
  }

  function parseLinesWithTags(text) {
    const rawLines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return rawLines.map((rawLine, idx) => {
      const pipeIdx = rawLine.indexOf('|');
      const moviePart = pipeIdx >= 0 ? rawLine.slice(0, pipeIdx).trim() : rawLine;
      const tagsPart = pipeIdx >= 0 ? rawLine.slice(pipeIdx + 1).trim() : '';

      const seasonMatch = moviePart.match(/(?:^|\s|[-–:])(?:season|s)\s*0*(\d{1,2})\b/i);
      const seasonNumber = seasonMatch ? Number(seasonMatch[1]) : null;
      const cleanedForMovie = seasonNumber
        ? moviePart.replace(/(?:^|\s|[-–:])(?:season|s)\s*0*\d{1,2}\b/gi, ' ').replace(/\s+/g, ' ').trim()
        : moviePart;

      const quotedMatch = cleanedForMovie.match(/^"([^"]+)"(.*)$/);
      let base;
      if (quotedMatch) {
        const quotedTitle = quotedMatch[1].trim();
        const rest = quotedMatch[2].replace(/^[\s,]+/, '').trim();
        const restParsed = rest ? parseBulkLines(rest).at(0) : null;
        const yearMatch = rest.match(/\b(19\d{2}|20\d{2})\b/);
        base = {
          raw: moviePart,
          title: quotedTitle,
          year: restParsed?.year || (yearMatch ? yearMatch[1] : ''),
          director: restParsed?.director || '',
          imdbId: restParsed?.imdbId || ''
        };
      } else {
        base = parseBulkLines(cleanedForMovie).at(0) || { raw: moviePart, title: cleanedForMovie, year: '', director: '', imdbId: '' };
      }

      return {
        ...base,
        key: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        raw: rawLine,
        isTv: Boolean(seasonNumber),
        seasonNumber,
        tags: tagsPart,
        watch_status: defaultWatch,
        refining: false,
        matches: [],
        selected: null,
        existingMatch: null,
        status: 'pending'
      };
    });
  }


  function isTitleMismatch(row, sel) {
    if (!sel) return false;
    const norm = (s) => (s || '').toLowerCase().replace(/^the\s+|^a\s+|^an\s+/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const inTitle = norm(row.title);
    const outTitle = norm(sel.title);
    return Boolean(inTitle && outTitle && inTitle !== outTitle);
  }


  async function lookupSingleRow(row) {
    const qTitle = (row.title || '').trim();
    const qYear = (row.year || '').trim();
    const qDir = (row.director || '').trim();
    const imdbMatch = qTitle.match(/^(tt\d{6,9})$/i);

    if (imdbMatch) {
      return await findTmdbByImdbId(imdbMatch[1]);
    }
    if (row.imdbId) {
      return await findTmdbByImdbId(row.imdbId);
    }
    if (row.isTv) {
      const tvRes = await searchTmdbTv(qTitle, qYear);
      return tvRes.map(s => ({ ...s, season_number: row.seasonNumber || 1 }));
    }
    return await searchTmdb(qTitle, qYear, qDir);
  }

  async function runBulkLookup() {
    const parsed = parseLinesWithTags(rawText);
    if (parsed.length === 0) return;
    rows = parsed;
    running = true;

    for (let i = 0; i < rows.length; i++) {
      const row = rows.at(i);
      rows[i] = { ...row, status: 'searching' };
      try {
        const results = await lookupSingleRow(row);
        const topMatch = results.at(0) || null;
        const existing = findExistingInCatalog(topMatch);
        const mismatch = isTitleMismatch(row, topMatch);

        rows[i] = {
          ...row,
          matches: results,
          existingMatch: existing,
          selected: (existing || mismatch) ? null : topMatch,
          watch_status: existing?.watch_status || row.watch_status || defaultWatch,
          status: results.length > 0 ? 'matched' : 'none'
        };
      } catch (_) {
        rows[i] = { ...row, status: 'error' };
      }
    }
    running = false;
  }

  async function refineRow(index) {
    const row = rows.at(index);
    if (!row) return;
    rows[index] = { ...row, status: 'searching' };
    try {
      const results = await lookupSingleRow(row);
      const topMatch = results.at(0) || null;
      const existing = findExistingInCatalog(topMatch);
      const mismatch = isTitleMismatch(row, topMatch);

      rows[index] = {
        ...row,
        matches: results,
        existingMatch: existing,
        selected: (existing || mismatch) ? null : topMatch,
        watch_status: existing?.watch_status || row.watch_status || defaultWatch,
        status: results.length > 0 ? 'matched' : 'none'
      };
    } catch (_) {
      rows[index] = { ...row, status: 'error' };
    }
  }


  function setBatchWatch(nextWatch) {
    defaultWatch = nextWatch;
    rows = rows.map(r => r.existingMatch ? r : { ...r, watch_status: nextWatch });
  }

  function setRowWatch(key, nextWatch) {
    rows = rows.map(r => r.key === key ? { ...r, watch_status: nextWatch } : r);
  }

  function removeRow(key) {
    rows = rows.filter(r => r.key !== key);
  }

  async function commitSelected() {
    const toSave = rows.filter(r => r.selected);
    if (toSave.length === 0) return;
    saving = true;
    for (const r of toSave) {
      if (r.selected.media_type === 'tv') {
        await saveWantedTvSeason(r.selected, r.selected.season_number || r.seasonNumber || 1, {
          tags: r.tags || '',
          watch_status: r.watch_status || ''
        });
      } else {
        await saveWantedMovie({
          ...r.selected,
          quality: '',
          tags: r.tags || '',
          watch_status: r.watch_status || ''
        });
      }
    }
    saving = false;
    await onComplete();
    onClose();
  }

  function getMismatchNote(row, sel) {
    if (!sel) return '';
    const norm = (s) => (s || '').toLowerCase().replace(/^the\s+|^a\s+|^an\s+/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const inTitle = norm(row.title);
    const outTitle = norm(sel.title);
    const inYear = String(row.year || '').trim();
    const outYear = String(sel.release_date?.slice(0, 4) || sel.year || '').trim();

    const titleDiff = inTitle && outTitle && inTitle !== outTitle;
    const yearDiff = inYear && outYear && inYear !== outYear;

    if (titleDiff && yearDiff) return `Mismatch: expected "${row.title}" (${inYear})`;
    if (titleDiff) return `Title differs from "${row.title}"`;
    if (yearDiff) return `Year differs (${outYear} vs ${inYear})`;
    return '';
  }

</script>

<section class="bulk-box">
  <div class="section-bar">
    <h2>Bulk Add to Wanted List</h2>
    <div class="bar-links">
      {#if rows.length > 0}
        <button class="btn-text" on:click={() => { rows = []; rawText = ''; }}>Clear</button>
        <span class="sep">·</span>
      {/if}
      <button class="btn-text" on:click={onClose}>Close</button>
    </div>
  </div>

  <p class="hint">
    Paste one movie or TV season per line using <code>Title (Year)</code> or <code>Title, Year, Director, IMDb ID</code> (wrap titles containing commas in quotes, e.g. <code>"Bell, Book, and Candle" (1958)</code>), with optional tags after <code>|</code>.
  </p>


  <textarea
    rows="5"
    placeholder="The 'Burbs (1989) | horror comedy, joe dante
10 Rillington Place (1971) | true crime
Better Call Saul Season 6 | drama"
    bind:value={rawText}
  ></textarea>

  <div class="toolbar" style="justify-content: space-between;">
    <button class="btn-primary" disabled={running || !rawText.trim()} on:click={runBulkLookup}>
      {running ? 'Looking up…' : 'Lookup All'}
    </button>

    <div style="display: flex; align-items: center; gap: 8px;">
      <span class="watch-triad" title="Default watch status for batch">
        <button
          type="button"
          class="icon-btn"
          class:active-watch={defaultWatch === ''}
          on:click={() => setBatchWatch('')}
          title="Default: Unseen"
          aria-label="Default Unseen"
        >
          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          class:active-watch={defaultWatch === 'liked'}
          on:click={() => setBatchWatch('liked')}
          title="Default: Seen & Liked"
          aria-label="Default Seen and Liked"
        >
          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          class:active-watch={defaultWatch === 'unfinished'}
          on:click={() => setBatchWatch('unfinished')}
          title="Default: Unfinished"
          aria-label="Default Unfinished"
        >
          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          class:active-watch={defaultWatch === 'disliked'}
          on:click={() => setBatchWatch('disliked')}
          title="Default: Seen & Disliked"
          aria-label="Default Seen and Disliked"
        >
          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
        </button>
      </span>

      <button
        type="button"
        class="btn-primary"
        disabled={saving || running || matchedCount === 0}
        on:click={commitSelected}
      >
        {saving ? 'Saving…' : `Add ${matchedCount} Matched to Wanted`}
      </button>

    </div>
  </div>


  {#if rows.length > 0}
    <div class="results-list">
      {#each rows as row, i (row.key)}
        {@const sel = row.selected || row.matches.at(0)}
        {@const poster = sel?.poster_url || (sel?.poster_path ? posterSmall + sel.poster_path : '')}
        {@const ex = row.existingMatch}
        {@const mismatchNote = getMismatchNote(row, sel)}
        {@const unconfirmedMismatch = !ex && !row.selected && isTitleMismatch(row, sel)}
            <div
            class="bulk-row"
            class:bulk-row-duplicate={Boolean(ex)}
            class:bulk-row-mismatch={unconfirmedMismatch}
            >
          <div class="poster-slot">
            {#if poster}
              <img
                src={poster}
                alt={sel?.title || row.title}
                on:error={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            {:else}
              <div class="poster-empty">—</div>
            {/if}
          </div>

          <div class="query-col">
            <div class="raw-line">
              {#if sel}
                <span>
                  {sel.title}{sel.season_number ? ` · Season ${sel.season_number}` : ''}
                  <span class="mono" style="font-weight: normal;">({sel.release_date?.slice(0, 4) || 'n.d.'})</span>
                </span>
              {:else}
                <span>{row.title}{row.year ? ` (${row.year})` : ''}</span>
              {/if}

              {#if ex}
                {#if ex.status === 'wanted'}
                  <span class="tag tag-wanted" style="margin-left: 6px;">Already Wanted</span>
                {:else if diskFolders.includes(ex.folder_name)}
                  <span class="tag" style="margin-left: 6px;">Already Logged{ex.quality ? ` · ${ex.quality}` : ''}</span>
                {:else}
                  <span class="tag tag-missing" style="margin-left: 6px;">Already Logged (Missing)</span>
                {/if}
              {:else if mismatchNote}
                <span class="tag tag-wanted" style="margin-left: 6px;">{mismatchNote}</span>
              {/if}
            </div>

            <div class="parsed-meta mono">
              Input: {row.raw}
            </div>

            {#if row.refining}
              <form class="refine-bar" on:submit|preventDefault={() => refineRow(i)}>
                <input
                  type="text"
                  placeholder="Title or tt1234567"
                  bind:value={rows[i].title}
                />
                <input
                  type="text"
                  placeholder="Year"
                  style="max-width: 68px;"
                  bind:value={rows[i].year}
                />
                <input
                  type="text"
                  placeholder="Director"
                  bind:value={rows[i].director}
                />
                <button type="submit" class="btn-primary" disabled={row.status === 'searching'}>
                  {row.status === 'searching' ? '…' : 'Search'}
                </button>
              </form>
            {/if}

            {#if row.tags}
              <div class="tag-preview">
                {#each row.tags.split(',').map(s => s.trim()).filter(Boolean) as t}
                  <span class="mini-tag">{t}</span>
                {/each}
              </div>
            {/if}

            {#if sel}
              <div class="match-detail">
                {#if sel.director}<span>Dir. {sel.director}</span>{/if}
                {#if sel.director && sel.cast_list}<span> · </span>{/if}
                {#if sel.cast_list}<span>{sel.cast_list}</span>{/if}
              </div>
              {#if sel.overview}
                <p class="match-synopsis">{sel.overview}</p>
              {/if}
            {/if}
          </div>


          <div class="match-col">
            {#if row.status === 'searching'}
              <span class="muted">Searching TMDb…</span>
            {:else if row.matches.length > 0}
              <select
                value={ex ? '' : (row.selected?.id || '')}
                on:change={(e) => {
                  const chosen = row.matches.find(m => String(m.id) === e.target.value) || null;
                  const existing = findExistingInCatalog(chosen);
                  rows[i] = { ...row, existingMatch: existing, selected: existing ? null : chosen };
                }}
              >
                <option value="">
                  {ex ? '— Will Not Import (Already Logged) —' : unconfirmedMismatch ? '— Review Mismatch (Skipped) —' : '— Skip —'}
                </option>
                {#each row.matches as m (m.id)}
                  <option value={m.id}>
                    {m.title}{m.season_number ? ` · Season ${m.season_number}` : ''} ({m.release_date?.slice(0, 4) || 'n.d.'}){m.director ? ` — Dir. ${m.director}` : ''}
                  </option>
                {/each}
              </select>
            {:else if row.status === 'none'}
              <span class="miss">No match found</span>
            {:else if row.status === 'error'}
              <span class="miss">Lookup error</span>
            {/if}

            <button
              type="button"
              class="icon-btn"
              on:click={() => { rows[i] = { ...row, refining: !row.refining }; }}
              title="Refine search (edit title, year, director, or IMDb ID)"
              aria-label="Refine search"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>

            <span class="watch-triad">
              <button
                type="button"
                class="icon-btn"
                class:active-watch={row.watch_status === ''}
                disabled={Boolean(ex)}
                on:click={() => setRowWatch(row.key, '')}
                title="Unseen"
                aria-label="Mark Unseen"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                class:active-watch={row.watch_status === 'liked'}
                disabled={Boolean(ex)}
                on:click={() => setRowWatch(row.key, 'liked')}
                title="Seen & Liked"
                aria-label="Mark Seen and Liked"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                class:active-watch={row.watch_status === 'unfinished'}
                disabled={Boolean(ex)}
                on:click={() => setRowWatch(row.key, 'unfinished')}
                title="Unfinished"
                aria-label="Mark Unfinished"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                class:active-watch={row.watch_status === 'disliked'}
                disabled={Boolean(ex)}
                on:click={() => setRowWatch(row.key, 'disliked')}
                title="Seen & Disliked"
                aria-label="Mark Seen and Disliked"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
              </button>
            </span>

            <button
              type="button"
              class="icon-btn icon-danger"
              on:click={() => removeRow(row.key)}
              title="Remove from import list"
              aria-label="Remove row"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      {/each}
    </div>

    {#if rows.length > 0}
      <div class="toolbar" style="margin-top: 12px; justify-content: flex-end;">
        <button
          type="button"
          class="btn-primary"
          disabled={saving || running || matchedCount === 0}
          on:click={commitSelected}
        >
          {saving ? 'Saving…' : `Add ${matchedCount} Matched to Wanted`}
        </button>
      </div>
    {/if}

  {/if}
</section>
