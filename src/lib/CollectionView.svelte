<script>
  import LoggedCard from '$lib/LoggedCard.svelte';

  export let allEntries = [];
  export let databaseEntries = [];
  export let diskFolders = [];
  export let searchResults = {};
  export let watchFilter = 'all';
  export let onLookup;
  export let onWikiLookup;
  export let onSelect;
  export let onDelete;
  export let onPersonClick;
  export let onSaveTags;
  export let onWatchStatus;
  export let onOpenMovie;
  export let typeFilter = 'all';

  let searchFilter = '';
  let collectionFilter = 'all';
  let layoutMode = 'cards';
  let sortBy = 'recent';

  $: wantedCount = databaseEntries.filter(i => i.status === 'wanted').length;
  $: collectedCount = databaseEntries.length - wantedCount;

  function matchesBaseFilters(item, tFilter, cFilter, qText) {
    if (tFilter === 'movie' && (item.media_type || 'movie') !== 'movie') return false;
    if (tFilter === 'tv' && item.media_type !== 'tv') return false;
    if (cFilter === 'collected' && item.status === 'wanted') return false;
    if (cFilter === 'wanted' && item.status !== 'wanted') return false;
    const q = qText.toLowerCase().trim();
    if (!q) return true;
    return [
      item.title,
      item.director,
      item.cast_list,
      item.tags,
      item.clips,
      item.episodes_json,
      String(item.year)
    ].some(v => v?.toLowerCase().includes(q));
  }

  $: countPool = (allEntries.length > 0 ? allEntries : databaseEntries).filter(item =>
    matchesBaseFilters(item, typeFilter, collectionFilter, searchFilter)
  );
  $: listedCount = countPool.length;
  $: unwatchedCount = countPool.filter(i => !i.watch_status || i.watch_status === '').length;
  $: unfinishedCount = countPool.filter(i => i.watch_status === 'unfinished').length;
  $: likedCount = countPool.filter(i => i.watch_status === 'liked').length;
  $: hatedCount = countPool.filter(i => i.watch_status === 'disliked').length;

  $: filtered = databaseEntries.filter(item =>
    matchesBaseFilters(item, typeFilter, collectionFilter, searchFilter)
  );

  $: sortedEntries = [...filtered].sort((a, b) => {
    if (sortBy === 'title') {
      return (a.title || a.folder_name || '').localeCompare(b.title || b.folder_name || '');
    }
    if (sortBy === 'year_desc') {
      return (Number(b.year) || 0) - (Number(a.year) || 0) || (a.title || '').localeCompare(b.title || '');
    }
    if (sortBy === 'year_asc') {
      return (Number(a.year) || 9999) - (Number(b.year) || 9999) || (a.title || '').localeCompare(b.title || '');
    }
    return 0; // 'recent' keeps database order
  });
</script>

<section class="collection-section">
  <div class="section-bar">
    <h2 class="watch-status-bar">
      <span class="heading-dot" aria-hidden="true">
        {#if watchFilter === 'all'}
          <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5" fill="#111" /></svg>
        {:else if watchFilter === 'unseen'}
          <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="4.25" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
        {:else if watchFilter === 'liked'}
          <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5" fill="#2b7a3d" /></svg>
        {:else if watchFilter === 'disliked'}
          <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5" fill="#9e2a2b" /></svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5" fill="#8a8578" /></svg>
        {/if}
      </span>

      <button
        type="button"
        class="status-filter-link"
        class:active={watchFilter === 'all'}
        on:click={() => { watchFilter = 'all'; }}
      >{listedCount} Listed</button><span class="sep">,</span>

      <button
        type="button"
        class="status-filter-link"
        class:active={watchFilter === 'unseen'}
        on:click={() => { watchFilter = 'unseen'; }}
      >{unwatchedCount} Unwatched</button><span class="sep">,</span>

      <button
        type="button"
        class="status-filter-link"
        class:active={watchFilter === 'unfinished'}
        on:click={() => { watchFilter = 'unfinished'; }}
      >{unfinishedCount} Unfinished</button><span class="sep">,</span>

      <button
        type="button"
        class="status-filter-link"
        class:active={watchFilter === 'liked'}
        on:click={() => { watchFilter = 'liked'; }}
      >{likedCount} Liked</button><span class="sep">, and</span>

      <button
        type="button"
        class="status-filter-link"
        class:active={watchFilter === 'disliked'}
        on:click={() => { watchFilter = 'disliked'; }}
      >{hatedCount} Hated</button>
    </h2>

    <div class="controls">
      <div class="filter-tabs">
        <button type="button" class:active={typeFilter === 'all'} on:click={() => typeFilter = 'all'}>All</button>
        <button type="button" class:active={typeFilter === 'movie'} on:click={() => typeFilter = 'movie'}>Movies</button>
        <button type="button" class:active={typeFilter === 'tv'} on:click={() => typeFilter = 'tv'}>TV</button>
      </div>

      <div class="filter-tabs layout-tabs" title="Switch catalog layout">
        <button
          type="button"
          class:active={layoutMode === 'compact'}
          on:click={() => layoutMode = 'compact'}
          title="Compact view (no summaries)"
          aria-label="Compact view"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
        </button>
        <button
          type="button"
          class:active={layoutMode === 'cards'}
          on:click={() => layoutMode = 'cards'}
          title="Cards view (with summaries)"
          aria-label="Cards view"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 8h4v8H7z"/><path d="M14 9h3"/><path d="M14 13h3"/><path d="M14 16h2"/></svg>
        </button>
        <button
          type="button"
          class:active={layoutMode === 'posters'}
          on:click={() => layoutMode = 'posters'}
          title="Posters wall view"
          aria-label="Posters view"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
        </button>
      </div>

      <div class="filter-tabs">
        <button type="button" class:active={collectionFilter === 'all'} on:click={() => collectionFilter = 'all'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          <span>All ({databaseEntries.length})</span>
        </button>
        <button type="button" class:active={collectionFilter === 'collected'} on:click={() => collectionFilter = 'collected'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Collected ({collectedCount})</span>
        </button>
        <button type="button" class:active={collectionFilter === 'wanted'} on:click={() => collectionFilter = 'wanted'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
          <span>Wanted ({wantedCount})</span>
        </button>
      </div>

      <select class="sort-select" bind:value={sortBy} aria-label="Sort catalog">
        <option value="recent">Added</option>
        <option value="title">Title A–Z</option>
        <option value="year_desc">Year ↓</option>
        <option value="year_asc">Year ↑</option>
      </select>

      <input type="text" class="search-input" placeholder="Filter title, director, cast, tags, clips…" bind:value={searchFilter} />
    </div>
  </div>

  <div class:grid-3={layoutMode === 'cards' || layoutMode === 'compact'} class:poster-wall={layoutMode === 'posters'}>
    {#each sortedEntries as item (item.folder_name)}
      <LoggedCard
        {item}
        layout={layoutMode}
        onDrive={diskFolders.includes(item.folder_name)}
        results={Reflect.get(searchResults, `db:${item.folder_name}`)}
        onLookup={(t, y, d) => onLookup(`db:${item.folder_name}`, t, y, d)}
        onWikiLookup={(t, y, d) => onWikiLookup?.(`db:${item.folder_name}`, t, y, d)}
        onSelect={(m) => onSelect(item.folder_name, m)}
        onDelete={() => onDelete(item.folder_name)}
        {onPersonClick}
        onTagClick={(t) => searchFilter = t}
        {onSaveTags}
        {onWatchStatus}
        {onOpenMovie}
      />
    {/each}
  </div>
</section>
