<script context="module">
  let cachedMissingSidecars = null;
  let lastSidecarScanKey = '';
</script>
<script>
  import Icon from '$lib/Icon.svelte';
  import { onMount } from 'svelte';
  import MovieCard from '$lib/MovieCard.svelte';
  import LoggedCard from '$lib/LoggedCard.svelte';
  import BulkWantedModal from '$lib/BulkWantedModal.svelte';
  import {
    MEDIA_ROOT,
    loadActivityLog,
    clearActivityLog,
    scanMissingSidecarsOnDisk,
    syncMissingJellyfinSidecars
  } from '$lib/guppyStore.js';

  export let orphans = [];
  export let databaseEntries = [];
  export let diskFolders = [];
  export let importQueue = [];
  export let stagedBanner = '';
  export let inputs = {};
  export let searchResults = {};
  export let loadingLookup = {};
  export let showBulkForm = false;
  export let auditResetNonce = 0;
  export let openMetafilesNonce = 0;
  export let syncStatus = '';
  export let ownedCount = 0;
  export let onRewriteMetafiles = null;
  export let onRescanLibrary = null;
  export let onExportJson = null;
  let confirmRescan = false;
  let confirmRewrite = false;
  let confirmWriteMissing = false;
  let lastOpenMetafilesNonce = 0;
  $: if (openMetafilesNonce !== lastOpenMetafilesNonce) {
    lastOpenMetafilesNonce = openMetafilesNonce;
    activeHealthFilter = 'metafiles';
    showRecentActivity = false;
    onClearSubViews?.();
  }
  export let onClearSubViews = null;
  let showRecentActivity = true;
  let lastResetNonce = 0;
  $: if (auditResetNonce !== lastResetNonce) {
    lastResetNonce = auditResetNonce;
    activeHealthFilter = '';
    if (showBulkForm || importQueue.length > 0) showRecentActivity = false;
  }
  $: if (showBulkForm || importQueue.length > 0) {
    showRecentActivity = false;
  }
  export let onAudit;
  export let onClearImport;
  export let onLookup;
  export let onLookupMore = null;
  export let onWikiLookup;
  export let onSelect;
  export let onSave;
  export let onUpdateLogged;
  export let onDeleteLogged;
  export let onPersonClick;
  export let onSaveTags;
  export let onOpenMovie;
  export let onWatchStatus;
  export let onToggleBulk;
  export let saveErrors = {};

  export let activeHealthFilter = '';
  let activityEntries = [];
  let activityLimit = 40;
  let missingSidecars = cachedMissingSidecars || [];
  let scanningSidecars = false;

  function isAdultEntry(entry) {
    return String(entry?.tags || '')
      .toLowerCase()
      .split(',')
      .map(s => s.trim())
      .includes('adult');
  }

  function getAuditWatchColor(entry) {
    const st = entry?.watch_status || '';
    if (st === 'liked') return '#2b7a3d';
    if (st === 'unfinished') return '#8a8578';
    if (st === 'disliked') return '#9e2a2b';
    return '#111111';
  }

  function getAuditDetailTooltip(entry) {
    const kind = entry?.media_type === 'tv' ? 'TV' : (isAdultEntry(entry) ? 'Adult Movie' : 'Movie');
    const st = entry?.watch_status === 'liked'
      ? 'Seen & Liked'
      : entry?.watch_status === 'unfinished'
        ? 'Unfinished'
        : entry?.watch_status === 'disliked'
          ? 'Seen & Disliked'
          : 'Unseen';
    return `Open ${kind} details (${st})`;
  }

  function normalizeTitleKey(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/^((?:19|20)\d{2})\s*-\s*/, '')
      .replace(/\s*[-–:]?\s*(?:season|series|s)\s*0*\d{1,2}\b/gi, '')
      .replace(/\s*\((?:19|20)\d{2}(?:\s*series)?\)\s*$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function findLogEntry(logTitle) {
    const raw = String(logTitle || '').trim();
    if (!raw || !Array.isArray(databaseEntries)) return null;
    const lower = raw.toLowerCase();

    const byFolder = databaseEntries.find(e => String(e.folder_name || '').trim().toLowerCase() === lower);
    if (byFolder) return byFolder;

    const seasonMatch = raw.match(/^(.*?)(?:\s*[-–:])?\s+(?:season|s)\s*0*(\d{1,2})$/i);
    if (seasonMatch) {
      const showKey = normalizeTitleKey(seasonMatch.at(1));
      const sNum = Number(seasonMatch.at(2));
      const tvHit = databaseEntries.find(e =>
        e.media_type === 'tv' &&
        Number(e.season_number || 1) === sNum &&
        normalizeTitleKey(e.title) === showKey
      );
      if (tvHit) return tvHit;
    }

    const yearMatch = raw.match(/^((?:19|20)\d{2})\s*-/) || raw.match(/\(((?:19|20)\d{2})\)\s*$/);
    const targetKey = normalizeTitleKey(raw);
    if (!targetKey) return null;

    if (yearMatch) {
      const y = Number(yearMatch.at(1));
      const exactYearHit = databaseEntries.find(e =>
        normalizeTitleKey(e.title) === targetKey && Number(e.year) === y
      );
      if (exactYearHit) return exactYearHit;
    }

    return databaseEntries.find(e => normalizeTitleKey(e.title) === targetKey) || null;
  }
  let writingMissingSidecars = '';

  async function refreshAuditExtras(forceScan = false) {
    activityEntries = await loadActivityLog(activityLimit).catch(() => []);
    if (databaseEntries.length > 0 && diskFolders.length > 0) {
      const scanKey = `${databaseEntries.length}:${diskFolders.length}`;
      if (!forceScan && cachedMissingSidecars !== null && scanKey === lastSidecarScanKey) {
        missingSidecars = cachedMissingSidecars;
        return;
      }
      if (scanningSidecars) return;
      scanningSidecars = true;
      try {
        const found = await scanMissingSidecarsOnDisk(databaseEntries, diskFolders).catch(() => []);
        missingSidecars = found;
        cachedMissingSidecars = found;
        lastSidecarScanKey = scanKey;
      } finally {
        scanningSidecars = false;
      }
    } else {
      missingSidecars = [];
    }
  }

  onMount(refreshAuditExtras);

  $: if (databaseEntries && diskFolders) {
    refreshAuditExtras();
  }

  $: missingEntries = databaseEntries.filter(i => i.status !== 'wanted' && !diskFolders.includes(i.folder_name));
  $: noPosterEntries = databaseEntries.filter(i => !i.poster_url || !i.poster_url.trim());
  $: noImdbEntries = databaseEntries.filter(
    i => (!i.imdb_id || !i.imdb_id.trim()) && !Number(i.tmdb_id)
  );
  $: noQualityEntries = databaseEntries.filter(
    i => i.status !== 'wanted' && (i.media_type || 'movie') === 'movie' && (!i.quality || !i.quality.trim())
  );
  $: incompleteTvEntries = databaseEntries.filter(i => {
    if (i.media_type !== 'tv') return false;
    try {
      const eps = i.episodes_json ? JSON.parse(i.episodes_json) : [];
      if (eps.length === 0) return false;
      const hasAnyOnDisk = eps.some(e => Boolean(e.file_name)) || diskFolders.includes(i.folder_name);
      const hasMissingEps = eps.some(e => !e.file_name);
      return hasAnyOnDisk && hasMissingEps;
    } catch (_) {
      return false;
    }
  });

  $: missingMetafiles = missingSidecars;

  $: activeHealthList =
    activeHealthFilter === 'metafiles' ? missingMetafiles :
    activeHealthFilter === 'imdb' ? noImdbEntries :
    activeHealthFilter === 'quality' ? noQualityEntries :
    activeHealthFilter === 'tv' ? incompleteTvEntries :
    [];

  $: activeHealthLabel =
    activeHealthFilter === 'metafiles' ? 'Missing Poster or NFO Metafiles' :
    activeHealthFilter === 'imdb' ? 'Unmatched in TMDB/Wikipedia' :
    activeHealthFilter === 'quality' ? 'Unknown File Quality' :
    activeHealthFilter === 'tv' ? 'Seasons with Missing Episodes' :
    '';

  function resetToAuditHome() {
    activeHealthFilter = '';
    showRecentActivity = true;
    onClearSubViews?.();
  }

  function toggleHealthFilter(key) {
    const next = activeHealthFilter === key ? '' : key;
    activeHealthFilter = next;
    if (next) {
      showRecentActivity = false;
      onClearSubViews?.();
    } else if (!showBulkForm && importQueue.length === 0) {
      showRecentActivity = true;
    }
  }

  async function handleWriteMissingSidecars() {
    if (missingSidecars.length === 0 || writingMissingSidecars) return;
    writingMissingSidecars = `Writing 0/${missingSidecars.length}…`;
    try {
      await syncMissingJellyfinSidecars(missingSidecars, (done, total) => {
        writingMissingSidecars = `Writing ${done}/${total}…`;
      });
      await refreshAuditExtras(true);
    } catch (err) {
      alert(`Failed writing missing metafiles: ${err}`);
    } finally {
      writingMissingSidecars = '';
    }
  }

  async function handleClearLog() {
    await clearActivityLog();
    activityEntries = [];
  }
</script>

{#if !showBulkForm && importQueue.length === 0}
<div class="audit-health-bar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%;">
  <button
    type="button"
    class="audit-health-pill"
    class:active={activeHealthFilter === 'metafiles'}
    on:click={() => toggleHealthFilter('metafiles')}
  >
    Missing Metafiles ({scanningSidecars ? '…' : missingMetafiles.length})
  </button>
  <button
    type="button"
    class="audit-health-pill"
    class:active={activeHealthFilter === 'quality'}
    on:click={() => toggleHealthFilter('quality')}
  >
    Unknown Quality ({noQualityEntries.length})
  </button>
  <button
    type="button"
    class="audit-health-pill"
    class:active={activeHealthFilter === 'imdb'}
    on:click={() => toggleHealthFilter('imdb')}
  >
    Unmatched ({noImdbEntries.length})
  </button>
  <button
    type="button"
    class="audit-health-pill"
    class:active={activeHealthFilter === 'tv'}
    on:click={() => toggleHealthFilter('tv')}
  >
    Missing Episodes ({incompleteTvEntries.length})
  </button>

  <div style="margin-left: auto; display: inline-flex; align-items: center; gap: 6px;">
    {#if !confirmRescan}
      <button
        type="button"
        class="audit-health-pill"
        style="display: inline-flex; align-items: center; gap: 5px;"
        on:click={() => { confirmRescan = true; resetToAuditHome(); }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        <span>Rescan Library</span>
      </button>
    {:else}
      <button
        type="button"
        class="audit-health-pill active"
        on:click={async () => { confirmRescan = false; cachedMissingSidecars = null; await onRescanLibrary?.(); await refreshAuditExtras(true); }}
      >
        Confirm Rescan?
      </button>
      <button
        type="button"
        class="audit-health-pill"
        on:click={() => { confirmRescan = false; }}
      >
        Cancel
      </button>
    {/if}

    <button
      type="button"
      class="audit-health-pill"
      style="display: inline-flex; align-items: center; gap: 5px;"
      on:click={() => { resetToAuditHome(); onExportJson?.(); }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span>Export JSON</span>
    </button>
  </div>
</div>
{/if}

{#if activeHealthFilter}
  <section class="staged-section">
    <div class="section-bar">
      <h2>{activeHealthList.length} {activeHealthLabel}</h2>
      <div class="g-st-133d27" style="display: flex; align-items: center; gap: 8px;">
        {#if activeHealthFilter === 'metafiles'}
          {#if missingSidecars.length > 0}
            {#if writingMissingSidecars}
              <button type="button" class="btn-primary" disabled>{writingMissingSidecars}</button>
            {:else if !confirmWriteMissing}
              <button
                type="button"
                class="btn-primary"
                on:click={() => { confirmWriteMissing = true; confirmRewrite = false; }}
              >
                Write Missing Metafiles ({missingSidecars.length})
              </button>
            {:else}
              <button
                type="button"
                class="btn-primary"
                on:click={() => { confirmWriteMissing = false; handleWriteMissingSidecars(); }}
              >
                Confirm Write ({missingSidecars.length} Folders)?
              </button>
              <button type="button" class="btn-secondary" on:click={() => { confirmWriteMissing = false; }}>Cancel</button>
            {/if}
          {/if}
          {#if syncStatus}
            <button type="button" class="btn-secondary" disabled>{syncStatus}</button>
          {:else if !confirmRewrite}
            <button type="button" class="btn-secondary" disabled={ownedCount === 0} on:click={() => { confirmRewrite = true; confirmWriteMissing = false; }}>
              Write All Metafiles
            </button>
          {:else}
            <button type="button" class="btn-primary" on:click={() => { confirmRewrite = false; onRewriteMetafiles?.(); }}>
              Confirm Rewrite ({ownedCount} Folders)?
            </button>
            <button type="button" class="btn-secondary" on:click={() => { confirmRewrite = false; }}>Cancel</button>
          {/if}
        {/if}
      </div>
    </div>
    {#if activeHealthList.length > 0}
      <div class="grid-3">
        {#each activeHealthList as item (item.folder_name)}
          <LoggedCard
            {item}
            auditIconTitle={true}
            onDrive={diskFolders.includes(item.folder_name)}
            results={Reflect.get(searchResults, `db:${item.folder_name}`)}
            onLookup={(t, y, d, m) => onLookup(`db:${item.folder_name}`, t, y, d, m)}
            onWikiLookup={(t, y, d) => onWikiLookup?.(`db:${item.folder_name}`, t, y, d)}
            onSelect={(m) => onUpdateLogged(item.folder_name, m)}
            onDelete={() => onDeleteLogged(item.folder_name)}
            {onPersonClick}
            {onSaveTags}
            {onOpenMovie}
            {onWatchStatus}
          />
        {/each}
      </div>
    {:else}
      <p class="empty-note">None found — everything looks complete.</p>
    {/if}
  </section>
{/if}

{#if showBulkForm}
  <BulkWantedModal
    {databaseEntries}
    {diskFolders}
    onClose={onToggleBulk}
    onComplete={async (count) => {
      await onAudit?.(count);
      await refreshAuditExtras();
    }}
  />
{/if}

{#if importQueue.length > 0 || stagedBanner}
  <section class="staged-section">
    {#if importQueue.length > 0}
      <div class="section-bar">
        <h2>Staged Import <span class="count">({importQueue.length})</span></h2>
        <button class="btn-text" on:click={onClearImport}>Close</button>
      </div>
    {/if}
    {#if stagedBanner}
      <div class="error-banner" style="margin-bottom: 10px; background: #edf7ed; border-color: #2b7a3d; color: #1b4d27;">{stagedBanner}</div>
    {/if}
    {#each importQueue as item (item.key)}
      <MovieCard
        {item}
        {databaseEntries}
        bind:data={inputs[item.key]}
        buttonLabel={item.isDirectory ? 'Move, Rename & Log' : 'Pack & Log'}
        loading={Reflect.get(loadingLookup, item.key)}
        results={Reflect.get(searchResults, item.key)}
        onLookup={() => onLookup(item.key)}
        onLookupMore={(nextLimit) => onLookupMore?.(item.key, nextLimit)}
        onRemove={() => { importQueue = importQueue.filter(q => q.key !== item.key); }}
        onWikiLookup={() => onWikiLookup(item.key)}
        onSelect={(m) => onSelect(item.key, m)}
        onSave={() => onSave(item)}
        error={Reflect.get(saveErrors, item.key) || ''}
        {onPersonClick}
      />
    {/each}
  </section>
{/if}

{#if !showBulkForm && importQueue.length === 0 && !activeHealthFilter}
<div class="two-col">
  <section>
    <div class="section-bar"><h2>Unlogged on Drive <span class="count">({orphans.length})</span></h2></div>
    {#each orphans as folder (`root:${folder}`)}
      <MovieCard
        item={{ key: `root:${folder}`, name: folder, isDirectory: true, sourcePath: `${MEDIA_ROOT}/${folder}` }}
        {databaseEntries}
        bind:data={inputs[`root:${folder}`]}
        loading={Reflect.get(loadingLookup, `root:${folder}`)}
        results={Reflect.get(searchResults, `root:${folder}`)}
        onLookup={() => onLookup(`root:${folder}`)}
        onLookupMore={(nextLimit) => onLookupMore?.(`root:${folder}`, nextLimit)}
        onWikiLookup={() => onWikiLookup(`root:${folder}`)}
        onSelect={(m) => onSelect(`root:${folder}`, m)}
        onSave={() => onSave({ key: `root:${folder}`, name: folder, isDirectory: true, sourcePath: `${MEDIA_ROOT}/${folder}` })}
        error={Reflect.get(saveErrors, `root:${folder}`) || ''}
        {onPersonClick}
      />
    {:else}
      <p class="empty-note">All folders on drive are accounted for.</p>
    {/each}
  </section>

  <section>
    <div class="section-bar"><h2>Missing <span class="count">({missingEntries.length})</span></h2></div>
    {#each missingEntries as item (item.folder_name)}
      <LoggedCard
        {item}
        auditIconTitle={true}
        onDrive={false}
        results={Reflect.get(searchResults, `db:${item.folder_name}`)}
        onLookup={(t, y, d, m) => onLookup(`db:${item.folder_name}`, t, y, d, m)}
        onWikiLookup={(t, y, d) => onWikiLookup?.(`db:${item.folder_name}`, t, y, d)}
        onSelect={(m) => onUpdateLogged(item.folder_name, m)}
        onDelete={() => onDeleteLogged(item.folder_name)}
        {onPersonClick}
        {onSaveTags}
        {onOpenMovie}
        {onWatchStatus}
      />
    {:else}
      <p class="empty-note">No missing titles.</p>
    {/each}
  </section>
</div>
{/if}

{#if showRecentActivity}
<section class="activity-log-section">
  <div class="section-bar">
    <h2>Recent Activity <span class="count">({activityEntries.length})</span></h2>
  </div>
  {#if activityEntries.length > 0}
    <div class="activity-log-list">
      {#each activityEntries as log (log.id)}
        {@const matchedEntry = findLogEntry(log.title)}
        <div class="activity-log-row">
          <span class="mono activity-time">{log.created_at}</span>
          <span class="tag" class:tag-wanted={log.action.startsWith('Added')} class:tag-missing={log.action === 'Removed'}>{log.action}</span>
          {#if matchedEntry && onOpenMovie}
            {@const iconColor = getAuditWatchColor(matchedEntry)}
            <button
              type="button"
              class="icon-btn"
              style="color: {iconColor}; border-color: {iconColor}; flex-shrink: 0;"
              title={getAuditDetailTooltip(matchedEntry)}
              aria-label={getAuditDetailTooltip(matchedEntry)}
              on:click={() => onOpenMovie(matchedEntry)}
            >
              <Icon name={matchedEntry.media_type === 'tv' ? 'tv' : (isAdultEntry(matchedEntry) ? 'adult' : 'movie')} size={13} />
            </button>
            <button
              type="button"
              class="title-link-btn activity-title"
              title={getAuditDetailTooltip(matchedEntry)}
              on:click={() => onOpenMovie(matchedEntry)}
            >{log.title}</button>
            {#if matchedEntry.year}
              <span class="mono">({matchedEntry.year})</span>
            {/if}
          {:else}
            <span style="display: inline-block; width: 24px; flex-shrink: 0;"></span>
            <span class="activity-title">{log.title}</span>
          {/if}
          {#if log.detail}
            <span class="muted">({log.detail})</span>
          {/if}
        </div>
      {/each}
    </div>
    <div style="margin-top: 10px; display: flex; align-items: center; gap: 10px;">
      {#if activityEntries.length >= activityLimit}
        <button type="button" class="btn btn-sm" on:click={() => { activityLimit += 60; refreshAuditExtras(); }}>
          Show older entries
        </button>
      {:else}
        <span class="muted">Showing all {activityEntries.length} entries</span>
      {/if}
    </div>
  {:else}
    <p class="empty-note">No recent library changes recorded yet.</p>
  {/if}
</section>
{/if}
