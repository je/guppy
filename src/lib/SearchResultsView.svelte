<script>
  import LoggedCard from '$lib/LoggedCard.svelte';
  import { computeSeasonWatchStatus } from '$lib/guppyStore.js';

  export let searchResults = {};
  export let onLookup;
  export let onWikiLookup;
  export let onSelect;
  export let onDelete;
  export let onSaveTags;
  export let results = null;
  export let loading = false;
  export let databaseEntries = [];
  export let allDatabaseEntries = null;

  $: hiddenAdultEntries = (allDatabaseEntries || databaseEntries).filter(d => {
    const isAdult = String(d.tags || '').toLowerCase().split(',').map(s => s.trim()).includes('adult');
    return isAdult && !databaseEntries.some(v => v.folder_name === d.folder_name);
  });

  function isHiddenAdultMatch(item, kind = 'movie') {
    if (!item || hiddenAdultEntries.length === 0) return false;
    const yr = item.year ? String(item.year) : (item.release_date ? item.release_date.slice(0, 4) : '');
    return hiddenAdultEntries.some(d =>
      (d.media_type || 'movie') === kind &&
      ((item.id && Number(d.tmdb_id) === Number(item.id)) ||
        (d.title?.toLowerCase() === item.title?.toLowerCase() && (!yr || String(d.year) === yr)))
    );
  }
  export let diskFolders = [];
  export let onSelectPerson;
  export let onPersonClick;
  export let onOpenMovie;
  export let onWatchStatus;
  export let onAddWanted;
  export let onRemoveWanted;

  function hasSeasonFiles(sMatch) {
    if (!sMatch || sMatch.status === 'wanted' && !sMatch.episodes_json) return false;
    try {
      const eps = JSON.parse(sMatch.episodes_json || '[]');
      if (Array.isArray(eps) && eps.length > 0) return eps.some(e => Boolean(e.file_name));
    } catch (_) {}
    return sMatch.status !== 'wanted';
  }

  function getSeasonStatus(sMatch) {
    if (!sMatch) return '';
    try {
      const eps = sMatch.episodes_json ? JSON.parse(sMatch.episodes_json) : [];
      if (eps.length > 0) return computeSeasonWatchStatus(eps);
    } catch (_) {}
    return sMatch.watch_status || '';
  }

  const imgBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");

  function getPoster(item) {
    if (item?.poster_url) return item.poster_url;
    if (item?.poster_path) return `${imgBase}${item.poster_path}`;
    return '';
  }

  function findMovieMatch(film) {
    return databaseEntries.find(
      d => (d.media_type || 'movie') === 'movie' &&
        d.title?.toLowerCase() === film.title?.toLowerCase() &&
        (!film.year || String(d.year) === String(film.year))
    );
  }

  let justAddedMovies = new Set();
  let justRemovedMovies = new Set();
  let addedWatchById = {};
  let editingPendingTagId = null;
  let draftPendingTags = '';
  let draftPendingClips = '';
  let savedTagIds = new Set();

  function openPendingTagEditor(film) {
    if (editingPendingTagId === film.id) {
      editingPendingTagId = null;
      return;
    }
    editingPendingTagId = film.id;
    draftPendingTags = film.tags || '';
    draftPendingClips = film.clips || '';
  }

  async function savePendingTags(film) {
    const match = databaseEntries.find(
      d => (d.media_type || 'movie') === 'movie' &&
        d.title?.toLowerCase() === film.title?.toLowerCase() &&
        (!film.year || String(d.year) === String(film.year))
    );
    if (match && onSaveTags) {
      await onSaveTags(match.folder_name, draftPendingTags, draftPendingClips);
    } else if (onAddWanted) {
      const nextRemoved = new Set(justRemovedMovies);
      nextRemoved.delete(film.id);
      justRemovedMovies = nextRemoved;
      justAddedMovies = new Set([...justAddedMovies, film.id]);
      addedWatchById = { ...addedWatchById, [film.id]: '' };
      await onAddWanted({
        ...film,
        watch_status: '',
        tags: draftPendingTags,
        clips: draftPendingClips
      });
    }
    savedTagIds = new Set([...savedTagIds, film.id]);
    editingPendingTagId = null;
  }
  let justAddedSeasons = new Set();
  let justRemovedSeasons = new Set();

  let copiedImdbKey = '';
  const imdbBase = ['https:/', '://imdb.com', 'title', ''].join('/');
  async function copyQuickImdb(key, imdbId) {
    if (!imdbId) return;
    if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) {
      window.open(imdbBase + (typeof imdbId !== 'undefined' ? imdbId : arguments[1]), '_blank', 'noopener');
      return;
    }
    try {
      await navigator.clipboard.writeText(imdbBase + imdbId);
      copiedImdbKey = key;
      setTimeout(() => { if (copiedImdbKey === key) copiedImdbKey = ''; }, 1800);
    } catch (_) {}
  }

  async function handleDotAction(film, nextStatus) {
    const match = findMovieMatch(film);
    if (match) {
      await onWatchStatus?.(match.folder_name, nextStatus);
      return;
    }

    const nextRemoved = new Set(justRemovedMovies);
    nextRemoved.delete(film.id);
    justRemovedMovies = nextRemoved;
    justAddedMovies = new Set([...justAddedMovies, film.id]);
    addedWatchById = { ...addedWatchById, [film.id]: nextStatus };

    const pendingT = editingPendingTagId === film.id ? draftPendingTags : '';
    const pendingC = editingPendingTagId === film.id ? draftPendingClips : '';
    if (editingPendingTagId === film.id) editingPendingTagId = null;
    await onAddWanted?.({
      ...film,
      watch_status: nextStatus,
      ...(pendingT ? { tags: pendingT } : {}),
      ...(pendingC ? { clips: pendingC } : {})
    });
  }

  async function handleRemoveMovie(film) {
    const nextAdded = new Set(justAddedMovies);
    nextAdded.delete(film.id);
    justAddedMovies = nextAdded;
    const nextWatchMap = { ...addedWatchById };
    delete nextWatchMap[film.id];
    addedWatchById = nextWatchMap;
    justRemovedMovies = new Set([...justRemovedMovies, film.id]);
    await onRemoveWanted?.(film);
  }

  function findSeasonMatch(show, seasonNum, entries) {
    if (justRemovedSeasons.has(`${show.id}:${seasonNum}`)) return null;
    return entries.find(
      d => d.media_type === 'tv' &&
        Number(d.season_number) === Number(seasonNum) &&
        (Number(d.tmdb_id) === Number(show.id) || d.title?.toLowerCase() === show.title?.toLowerCase())
    );
  }

  function openSeasonDetail(show, sNum, sMatch) {
    if (sMatch) {
      onOpenMovie?.(sMatch);
      return;
    }
    onOpenMovie?.({
      ...show,
      tmdb_id: show.id,
      media_type: 'tv',
      season_number: Number(sNum) || 1
    });
  }

  async function handleRemoveSeason(e, show, sNum) {
    e.stopPropagation();
    const key = `${show.id}:${sNum}`;
    const nextAdded = new Set(justAddedSeasons);
    nextAdded.delete(key);
    justAddedSeasons = nextAdded;
    justRemovedSeasons = new Set([...justRemovedSeasons, key]);
    await onRemoveWanted?.({
      ...show,
      media_type: 'tv',
      season_number: sNum
    });
  }
</script>

<section class="search-results-section">
  {#if loading}
    <p class="muted">Searching TMDb…</p>
  {:else if results}
    {#if results.people?.length > 0}
      <div class="section-bar">
        <h2>{results.people.length} Cast and Crew</h2>
      </div>
      <div class="grid-3">
        {#each results.people as person (person.id)}
          <article class="catalog-entry">
            <div class="entry-body">
              <button
                type="button"
                class="poster-btn"
                on:click={() => onSelectPerson?.(person.name, person.id)}
                title="View {person.name} filmography"
              >
                {#if person.poster_url}
                  <img
                    src={person.poster_url}
                    alt={person.name}
                    class="poster"
                    on:error={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                {:else}
                  <div class="poster-blank">No Photo</div>
                {/if}
              </button>


              <div class="meta-col">
                <div class="title-line">
                  <button
                    type="button"
                    class="person-link title g-st-6599cf"
                   
                    on:click={() => onSelectPerson?.(person.name, person.id)}
                  >
                    {person.name}
                  </button>
                  {#if person.yearSpan}
                    <span class="mono">({person.yearSpan})</span>
                  {/if}
                </div>

                {#if person.department}
                  <div class="badge-action-row g-st-07c6a7">
                    <span class="tag">{person.department}</span>
                  </div>
                {/if}

                {#if person.knownFor}
                  <p class="synopsis">{person.knownFor}</p>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </div>
    {/if}

    {#if results.movies?.length > 0}
      <div class="section-bar g-st-b861c5">
        <h2>{results.movies.length} Movies</h2>
      </div>
      <div class="grid-3">
        {#each results.movies.filter(f => !isHiddenAdultMatch(f, 'movie')) as film (film.id)}
          {@const existing = justRemovedMovies.has(film.id) ? null : findMovieMatch(film)}
          {#if existing}
            <LoggedCard
              item={existing}
              onDrive={existing.status !== 'wanted' && diskFolders.includes(existing.folder_name)}
              results={searchResults[existing.folder_name]}
              onLookup={(t, y, d, m) => onLookup?.(existing.folder_name, t || existing.title, y || existing.year, d, m)}
              onWikiLookup={() => onWikiLookup?.(existing.folder_name, existing.title, existing.year)}
              onSelect={(m) => onSelect?.(existing.folder_name, m)}
              onDelete={async () => {
                await onDelete?.(existing.folder_name);
              }}
              {onPersonClick}
              onSaveTags={(t, c) => onSaveTags?.(existing.folder_name, t, c)}
              onWatchStatus={(st) => onWatchStatus?.(existing.folder_name, st)}
              {onOpenMovie}
            />
          {:else}
            {@const isPendingWanted = justAddedMovies.has(film.id)}
            {@const curWatch = isPendingWanted ? (addedWatchById[film.id] || '') : ''}
            {@const poster = getPoster(film)}
            <article class="catalog-entry">
              <div class="entry-body">
                <button
                  type="button"
                  class="poster-btn"
                  on:click={() => onOpenMovie?.(film)}
                  title="Open movie details"
                >
                  {#if poster}
                    <img
                      src={poster}
                      alt={film.title}
                      class="poster"
                      on:error={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  {:else}
                    <div class="poster-blank">No Poster</div>
                  {/if}
                </button>

                <div class="meta-col">
                  <div class="title-line">
                    <button
                      type="button"
                      class="person-link title g-st-6599cf"
                     
                      on:click={() => onOpenMovie?.(film)}
                    >
                      {film.title}
                    </button>
                    <span class="mono">({film.year || 'n.d.'})</span>
                  </div>

                  <div class="badge-action-row g-st-62766d">
                    <div>
                      {#if isPendingWanted}
                        <span class="tag tag-wanted">Not Available</span>
                      {:else}
                        <span class="tag tag-wanted">Not in Catalog</span>
                      {/if}
                    </div>

                    <div class="icon-actions g-st-9b2237">
                      {#if copiedImdbKey === `movie:${film.id}`}<span class="copied-note">Copied</span>{/if}
                      {#if film.imdb_id}
                        <button
                          type="button"
                          class="icon-btn"
                          on:click|stopPropagation={() => copyQuickImdb(`movie:${film.id}`, film.imdb_id)}
                          title="Copy IMDb link ({imdbBase + film.imdb_id})"
                          aria-label="Copy IMDb link"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        </button>
                      {/if}
                      <button
                          type="button"
                          class="icon-btn"
                          on:click|stopPropagation={() => openPendingTagEditor(film)}
                          title={savedTagIds.has(film.id) ? 'Tags saved (click to edit)' : 'Add Tags & Clips'}
                          aria-label="Edit Tags & Clips"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
                        </button>
                      <span class="watch-triad">
                        <button
                          type="button"
                          class="icon-btn"
                          class:active-watch={isPendingWanted && curWatch === ''}
                          on:click|stopPropagation={() => handleDotAction(film, '')}
                          title="Add to Not Available as Unseen"
                          aria-label="Unseen"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          class:active-watch={isPendingWanted && curWatch === 'liked'}
                          on:click|stopPropagation={() => handleDotAction(film, 'liked')}
                          title="Add to Not Available as Seen & Liked"
                          aria-label="Seen and Liked"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          class:active-watch={isPendingWanted && curWatch === 'unfinished'}
                          on:click|stopPropagation={() => handleDotAction(film, 'unfinished')}
                          title="Add to Not Available as Unfinished"
                          aria-label="Unfinished"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          class:active-watch={isPendingWanted && curWatch === 'disliked'}
                          on:click|stopPropagation={() => handleDotAction(film, 'disliked')}
                          title="Add to Not Available as Seen & Disliked"
                          aria-label="Seen and Disliked"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                        </button>
                      </span>
                    </div>
                  </div>

                  {#if film.runtime || film.countries || film.genres}<div class="spec-strip" style="margin: 2px 0 4px;">{#if film.runtime}<span>{film.runtime} min</span>{/if}{#if film.countries}<span class="spec-item">{film.countries}</span>{/if}{#if film.genres}<span class="spec-item">{film.genres}</span>{/if}</div>{/if}
                  {#if film.director || film.cast_list}
                    {@const topActors = (film.cast_list || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4)}
                    <div class="credits">
                      {#if film.director}
                        <span>Dir. </span>
                        {#each film.director.split(',').map(s => s.trim()).filter(Boolean) as dir, i}
                          {#if i > 0}, {/if}
                          <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(dir)}>{dir}</button>
                        {/each}
                      {/if}
                      {#if film.director && topActors.length > 0} · {/if}
                      {#if topActors.length > 0}
                        {#each topActors as actor, i}
                          {#if i > 0}, {/if}
                          <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(actor)}>{actor}</button>
                        {/each}
                      {/if}
                    </div>
                  {/if}

                  {#if editingPendingTagId === film.id}
                    <div class="tag-editor">
                      <div class="tag-row">
                        <input type="text" placeholder="Tags (comma-separated, e.g. noir, 4k, adult)…" bind:value={draftPendingTags} />
                        <input type="text" placeholder="Clips / scenes…" bind:value={draftPendingClips} />
                        <button type="button" class="btn btn-sm" on:click|stopPropagation={() => savePendingTags(film)}>Save</button>
                      </div>
                    </div>
                  {/if}
                  {#if film.overview}
                    <p class="synopsis">{film.overview}</p>
                  {/if}
                </div>
              </div>
            </article>
          {/if}
        {/each}
      </div>
    {/if}

    {#if results.tvShows?.length > 0}
      <div class="section-bar g-st-b861c5">
        <h2>{results.tvShows.length} TV Shows</h2>
      </div>
      <div class="grid-3">
        {#each results.tvShows.filter(s => !isHiddenAdultMatch(s, 'tv')) as show (show.id)}
          {@const poster = getPoster(show)}
          <article class="catalog-entry">
            <div class="entry-body">
              <button
                type="button"
                class="poster-btn"
                on:click={() => onOpenMovie?.({ ...show, media_type: 'tv', season_number: 1 })}
                title="Open show details"
              >
                {#if poster}
                  <img
                    src={poster}
                    alt={show.title}
                    class="poster"
                    on:error={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                {:else}
                  <div class="poster-blank">No Poster</div>
                {/if}
              </button>

              <div class="meta-col">
                <div class="title-line">
                  <button
                    type="button"
                    class="person-link title g-st-6599cf"
                   
                    on:click={() => onOpenMovie?.({ ...show, media_type: 'tv', season_number: 1 })}
                  >
                    {show.title}
                  </button>
                  <span class="mono">({show.yearSpan || show.year || 'n.d.'})</span>
                </div>

                {#if !(show.seasons || Array.of(1)).some(s => Boolean(findSeasonMatch(show, s, databaseEntries))) || show.imdb_id}
                  <div class="badge-action-row g-st-62766d">
                    <div>
                      {#if !(show.seasons || Array.of(1)).some(s => Boolean(findSeasonMatch(show, s, databaseEntries)))}
                        <span class="tag tag-wanted">Not in Catalog</span>
                      {/if}
                    </div>
                    {#if show.imdb_id}
                      <div class="icon-actions g-st-9b2237">
                        {#if copiedImdbKey === `tv:${show.id}`}<span class="copied-note">Copied</span>{/if}
                        <button
                          type="button"
                          class="icon-btn"
                          on:click|stopPropagation={() => copyQuickImdb(`tv:${show.id}`, show.imdb_id)}
                          title="Copy IMDb link ({imdbBase + show.imdb_id})"
                          aria-label="Copy IMDb link"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        </button>
                      </div>
                    {/if}
                  </div>
                {/if}
                
                <div class="season-badges">
                  {#each (show.seasons || Array.of(1)) as sNum}
                    {@const sMatch = findSeasonMatch(show, sNum, databaseEntries)}
                    {@const isInCatalog = Boolean(sMatch)}
                    {@const sLabel = `S${String(sNum).padStart(2, '0')}`}
                    {@const sWatch = getSeasonStatus(sMatch)}
                    <button
                      type="button"
                      class="tax-pill season-pill"
                      class:season-owned={hasSeasonFiles(sMatch)}
                      class:season-wanted={sMatch && !hasSeasonFiles(sMatch)}
                      title={isInCatalog
                        ? `Open ${show.title} ${sLabel} (${sMatch.status === 'wanted' ? 'Not Available' : 'On Drive'} · ${sWatch || 'Unseen'})`
                        : `Open ${show.title} ${sLabel} details`}
                      on:click={() => openSeasonDetail(show, sNum, sMatch)}
                    >
                      {#if isInCatalog}
                        {#if sWatch === 'liked'}
                          <svg width="8" height="8" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                        {:else if sWatch === 'disliked'}
                          <svg width="8" height="8" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                        {:else if sWatch === 'unfinished'}
                          <svg width="8" height="8" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                        {:else}
                          <svg width="8" height="8" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
                        {/if}
                      {/if}
                      <span>{sLabel}</span>
                    </button>
                  {/each}
                </div>

                {#if show.cast_list}
                  {@const tvActors = show.cast_list.split(',').map(s => s.trim()).filter(Boolean).slice(0, 4)}
                  {#if tvActors.length > 0}
                    <div class="credits">
                      {#each tvActors as actor, i}
                        {#if i > 0}, {/if}
                        <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(actor)}>{actor}</button>
                      {/each}
                    </div>
                  {/if}
                {/if}

                {#if show.overview}
                  <p class="synopsis">{show.overview}</p>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </div>
    {/if}

    {#if !results.people?.length && !results.movies?.length && !results.tvShows?.length}
      <p class="empty-note">No matches found for “{results.queryName}”.</p>
    {/if}
  {/if}
</section>
