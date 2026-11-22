<script>
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
  export let inputs = {};
  export let searchResults = {};
  export let loadingLookup = {};
  export let showBulkForm = false;
  export let onAudit;
  export let onClearImport;
  export let onLookup;
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

  let activeHealthFilter = '';
  let activityEntries = [];
  let missingSidecars = [];
  let scanningSidecars = false;

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

    const exactKey = databaseEntries.find(e => normalizeTitleKey(e.title) === targetKey);
    if (exactKey) return exactKey;
    if (targetKey.length >= 5) {
      return databaseEntries.find(e => {
        const k = normalizeTitleKey(e.title);
        return k && (k.includes(targetKey) || targetKey.includes(k));
      }) || null;
    }
    return null;
  }
  let writingMissingSidecars = '';

  async function refreshAuditExtras() {
    activityEntries = await loadActivityLog(40).catch(() => []);
    if (databaseEntries.length > 0 && diskFolders.length > 0) {
      scanningSidecars = true;
      missingSidecars = await scanMissingSidecarsOnDisk(databaseEntries, diskFolders).catch(() => []);
      scanningSidecars = false;
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

  $: activeHealthList =
    activeHealthFilter === 'sidecars' ? missingSidecars :
    activeHealthFilter === 'poster' ? noPosterEntries :
    activeHealthFilter === 'imdb' ? noImdbEntries :
    activeHealthFilter === 'quality' ? noQualityEntries :
    activeHealthFilter === 'tv' ? incompleteTvEntries :
    [];

  $: activeHealthLabel =
    activeHealthFilter === 'sidecars' ? 'Missing Poster / .nfo on Drive' :
    activeHealthFilter === 'poster' ? 'Missing Poster URL in DB' :
    activeHealthFilter === 'imdb' ? 'Unmatched (No TMDb / IMDb)' :
    activeHealthFilter === 'quality' ? 'Missing Quality Tag' :
    activeHealthFilter === 'tv' ? 'TV Seasons Missing Episode Files' :
    '';

  function toggleHealthFilter(key) {
    activeHealthFilter = activeHealthFilter === key ? '' : key;
  }

  async function handleWriteMissingSidecars() {
    if (missingSidecars.length === 0 || writingMissingSidecars) return;
    writingMissingSidecars = `Writing 0/${missingSidecars.length}…`;
    try {
      await syncMissingJellyfinSidecars(missingSidecars, (done, total) => {
        writingMissingSidecars = `Writing ${done}/${total}…`;
      });
      await refreshAuditExtras();
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

<div class="audit-health-bar">
  <span class="audit-health-label">Catalog Health:</span>
  <button
    type="button"
    class="audit-health-pill"
    class:active={activeHealthFilter === 'sidecars'}
    on:click={() => toggleHealthFilter('sidecars')}
  >
    Missing Poster/NFO ({scanningSidecars ? '…' : missingSidecars.length})
  </button>
  <button
    type="button"
    class="audit-health-pill"
    class:active={activeHealthFilter === 'tv'}
    on:click={() => toggleHealthFilter('tv')}
  >
    TV Missing Episodes ({incompleteTvEntries.length})
  </button>
  <button
    type="button"
    class="audit-health-pill"
    class:active={activeHealthFilter === 'poster'}
    on:click={() => toggleHealthFilter('poster')}
  >
    Missing Poster URL ({noPosterEntries.length})
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
    class:active={activeHealthFilter === 'quality'}
    on:click={() => toggleHealthFilter('quality')}
  >
    Missing Quality ({noQualityEntries.length})
  </button>
</div>

{#if activeHealthFilter}
  <section class="staged-section">
    <div class="section-bar">
      <h2>{activeHealthLabel} <span class="count">({activeHealthList.length})</span></h2>
      <div class="g-st-133d27">
        {#if activeHealthFilter === 'sidecars' && missingSidecars.length > 0}
          <button
            type="button"
            class="btn-primary"
            disabled={Boolean(writingMissingSidecars)}
            on:click={handleWriteMissingSidecars}
          >
            {writingMissingSidecars || `Write Missing Metafiles (${missingSidecars.length})`}
          </button>
        {/if}
        <button type="button" class="btn-text" on:click={() => activeHealthFilter = ''}>Close</button>
      </div>
    </div>
    {#if activeHealthList.length > 0}
      <div class="grid-3">
        {#each activeHealthList as item (item.folder_name)}
          <LoggedCard
            {item}
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

{#if importQueue.length > 0}
  <section class="staged-section">
    <div class="section-bar">
      <h2>Staged Import <span class="count">({importQueue.length})</span></h2>
      <button class="btn-text" on:click={onClearImport}>Close</button>
    </div>
    {#each importQueue as item (item.key)}
      <MovieCard
        {item}
        {databaseEntries}
        bind:data={inputs[item.key]}
        buttonLabel={item.isDirectory ? 'Move, Rename & Log' : 'Pack & Log'}
        loading={Reflect.get(loadingLookup, item.key)}
        results={Reflect.get(searchResults, item.key)}
        onLookup={() => onLookup(item.key)}
        onWikiLookup={() => onWikiLookup(item.key)}
        onSelect={(m) => onSelect(item.key, m)}
        onSave={() => onSave(item)}
        error={Reflect.get(saveErrors, item.key) || ''}
        {onPersonClick}
      />
    {/each}
  </section>
{/if}

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

<section class="activity-log-section">
  <div class="section-bar">
    <h2>Recent Activity <span class="count">({activityEntries.length})</span></h2>
    {#if activityEntries.length > 0}
      <button type="button" class="btn-text" on:click={handleClearLog}>Clear Log</button>
    {/if}
  </div>
  {#if activityEntries.length > 0}
    <div class="activity-log-list">
      {#each activityEntries as log (log.id)}
        {@const matchedEntry = findLogEntry(log.title)}
        <div class="activity-log-row">
          <span class="mono activity-time">{log.created_at}</span>
          <span class="tag" class:tag-wanted={log.action.startsWith('Added')} class:tag-missing={log.action === 'Removed'}>{log.action}</span>
          {#if matchedEntry && onOpenMovie}
            <button type="button" class="activity-title-link" on:click={() => onOpenMovie(matchedEntry)}>{log.title}</button>
          {:else}
            <span class="activity-title">{log.title}</span>
          {/if}
          {#if log.detail}
            <span class="muted">({log.detail})</span>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty-note">No recent library changes recorded yet.</p>
  {/if}
</section>
