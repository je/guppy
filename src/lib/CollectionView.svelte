<script>
  import LoggedCard from '$lib/LoggedCard.svelte';

  export let databaseEntries = [];
  export let diskFolders = [];
  export let searchResults = {};
  export let onLookup;
  export let onWikiLookup;
  export let onSelect;
  export let onDelete;
  export let onPersonClick;
  export let onSaveTags;
  export let onWatchStatus;
  export let onOpenMovie;
  export let typeFilter = 'all';
  export let searchFilter = '';
  export let collectionFilter = 'all';

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
    <div class="controls">
      <div class="filter-tabs">
        <button type="button" class:active={typeFilter === 'all'} on:click={() => typeFilter = 'all'}>
          <span>All</span>
        </button>
        <button type="button" class:active={typeFilter === 'movie'} on:click={() => typeFilter = 'movie'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>
          <span>Movies</span>
        </button>
        <button type="button" class:active={typeFilter === 'tv'} on:click={() => typeFilter = 'tv'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>
          <span>TV</span>
        </button>
      </div>

      <div class="filter-tabs">
        <button type="button" class:active={collectionFilter === 'all'} on:click={() => collectionFilter = 'all'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          <span>All</span>
        </button>
        <button type="button" class:active={collectionFilter === 'collected'} on:click={() => collectionFilter = 'collected'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Collected</span>
        </button>
        <button type="button" class:active={collectionFilter === 'wanted'} on:click={() => collectionFilter = 'wanted'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Wanted</span>
        </button>
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
        onLookup={(t, y, d, m) => onLookup(`db:${item.folder_name}`, t, y, d, m)}
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
