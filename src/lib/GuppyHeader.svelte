<script>
  export let viewMode = 'collection';
  export let isRemote = true;
  export let connStatus = { mode: 'checking', serverUrl: '', serverOk: false, driveMounted: false };
  export let mountingDrive = false;
  export let refreshingConnection = false;
  export let showAdultOnly = false;
  export let adultProgress = 0;
  export let watchFilter = 'all';
  export let listedCount = 0;
  export let unwatchedCount = 0;
  export let unfinishedCount = 0;
  export let likedCount = 0;
  export let hatedCount = 0;
  export let showBulkForm = false;
  export let importQueue = [];
  export let activeAuditHealthFilter = '';
  export let personQuery = '';

  export let onMountDrive;
  export let onRefresh;
  export let onSwitchAudit;
  export let onReturnCatalog;
  export let onAdultMousedown;
  export let onAdultMouseup;
  export let onAdultMouseleave;
  export let onWatchFilter;
  export let onFileLibrary;
  export let onPickImport;
  export let onToggleBulk;
  export let onUniversalSearch;
</script>

<div class="conn-bar g-st-6a0b66" style="display: flex; align-items: center; gap: 8px; padding: 4px 0; margin-bottom: 0; width: 100%;">
  {#if viewMode === 'collection' && !isRemote}
    <button type="button" class="icon-btn" on:click={onSwitchAudit} title="Switch to Audit & Import" aria-label="Switch to Audit and Import">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
    </button>
  {:else}
    <button type="button" class="icon-btn" on:click={onReturnCatalog} title="Return to Catalog" aria-label="Return to Catalog">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>
    </button>
  {/if}

  <span style="display: inline-flex; align-items: center; gap: 5px;">
    {#if connStatus.mode === 'remote'}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Client"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      <strong style="color: {connStatus.serverOk ? '#2b7a3d' : '#9e2a2b'};">{connStatus.serverOk ? `Connected to ${connStatus.serverUrl}` : `Unreachable (${connStatus.serverUrl})`}</strong>
    {:else if connStatus.mode === 'host'}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Host Server"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
      <strong style="color: {connStatus.serverOk ? '#2b7a3d' : '#8a8578'};">{connStatus.serverOk ? `Sharing on ${connStatus.serverUrl}` : 'Starting…'}</strong>
    {:else}
      <strong>Checking…</strong>
    {/if}
  </span>

  <span style="display: inline-flex; align-items: center; gap: 5px;">
    <span>·</span>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Media Drive"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
    <strong style="color: {connStatus.driveMounted ? '#2b7a3d' : '#9e2a2b'};">{connStatus.driveMounted ? (connStatus.mode === 'remote' ? 'Remote' : 'Local') : 'Not Mounted'}</strong>
  </span>

  {#if !connStatus.driveMounted}
    <button type="button" class="btn-secondary g-st-ab0b11" disabled={mountingDrive} on:click={onMountDrive}>{mountingDrive ? 'Mounting…' : 'Mount Drive'}</button>
  {/if}

  <button type="button" class="icon-btn" disabled={refreshingConnection} aria-busy={refreshingConnection} title={refreshingConnection ? 'Refreshing connection and drive status…' : 'Recheck connection & drive status'} aria-label={refreshingConnection ? 'Refreshing connection' : 'Recheck'} on:click={onRefresh}>
    <svg class:spin={refreshingConnection} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
  </button>
</div>

<header class="app-header" style="padding-top: 8px;">
  <div class="header-left">
    <button type="button" class="adult-toggle" class:adult-active={!isRemote && showAdultOnly} style={isRemote ? 'cursor: default;' : ''} on:mousedown={isRemote ? null : onAdultMousedown} on:mouseup={isRemote ? null : onAdultMouseup} on:mouseleave={isRemote ? null : onAdultMouseleave} aria-label="Catalog mode">
      <svg width="18" height="18" viewBox="0 0 18 18">
        {#if viewMode === 'collection' && watchFilter === 'unseen'}
          <circle cx="9" cy="9" r="4.25" fill="#fffff8" stroke="#111" stroke-width="1.5" />
        {:else if viewMode === 'collection' && watchFilter === 'liked'}<circle cx="9" cy="9" r="5" fill="#2b7a3d" />
        {:else if viewMode === 'collection' && watchFilter === 'unfinished'}<circle cx="9" cy="9" r="5" fill="#8a8578" />
        {:else if viewMode === 'collection' && watchFilter === 'disliked'}<circle cx="9" cy="9" r="5" fill="#9e2a2b" />
        {:else}<circle cx="9" cy="9" r="5" fill="currentColor" />{/if}
        {#if !isRemote && showAdultOnly && adultProgress === 0}<circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.55" />{/if}
        {#if !isRemote && adultProgress > 0}<circle cx="9" cy="9" r="7.5" fill="none" stroke="#111" stroke-width="1.5" stroke-dasharray="47.1" stroke-dashoffset={47.1 - adultProgress * 47.1} transform="rotate(-90 9 9)" />{/if}
      </svg>
    </button>
  </div>

  <div class="header-mid">
    {#if viewMode !== 'split'}
      <h2 class="watch-status-bar g-st-1c244e">
        <button type="button" class="status-filter-link" class:active={viewMode === 'collection' && watchFilter === 'all'} on:click={() => onWatchFilter('all')}>{listedCount} Listed</button><span class="sep">,</span>
        <button type="button" class="status-filter-link" class:active={viewMode === 'collection' && watchFilter === 'unseen'} on:click={() => onWatchFilter('unseen')}>{unwatchedCount} Unwatched</button><span class="sep">,</span>
        <button type="button" class="status-filter-link" class:active={viewMode === 'collection' && watchFilter === 'unfinished'} on:click={() => onWatchFilter('unfinished')}>{unfinishedCount} Unfinished</button><span class="sep">,</span>
        <button type="button" class="status-filter-link" class:active={viewMode === 'collection' && watchFilter === 'liked'} on:click={() => onWatchFilter('liked')}>{likedCount} Liked</button><span class="sep">, and</span>
        <button type="button" class="status-filter-link" class:active={viewMode === 'collection' && watchFilter === 'disliked'} on:click={() => onWatchFilter('disliked')}>{hatedCount} Hated</button>
      </h2>
    {:else if viewMode === 'split' && !isRemote}
      <button type="button" class="{!showBulkForm && importQueue.length === 0 && !activeAuditHealthFilter ? 'btn-primary' : 'btn-secondary'} g-st-678404" on:click={onFileLibrary}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>
        <span>File Library</span>
      </button>
      <button type="button" class="{importQueue.length > 0 ? 'btn-primary' : 'btn-secondary'} g-st-678404" on:click={onPickImport}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
        <span>Import Folder</span>
      </button>
      <button type="button" class="{showBulkForm ? 'btn-primary' : 'btn-secondary'} g-st-678404" on:click={onToggleBulk}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Add Titles</span>
      </button>
    {/if}
  </div>

  <div class="header-right">
    <form class="person-search" on:submit|preventDefault={() => { const q = personQuery; personQuery = ''; onUniversalSearch(q); }}>
      <textarea bind:value={personQuery} rows="1" placeholder="name (year-year) [keywords]" aria-label="Universal search" style="resize: none; overflow: hidden; height: 30px; min-height: 30px !important; line-height: 1.3; padding: 5px 8px;"
        on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const q = personQuery; personQuery = ''; onUniversalSearch(q); } }}>
      </textarea>
    </form>
  </div>
</header>
