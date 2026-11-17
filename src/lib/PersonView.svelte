<script>
  import { enrichFilmBatch, computeSeasonWatchStatus } from '$lib/guppyStore.js';

  export let personData;
  export let loading = false;
  export let databaseEntries = [];
  export let diskFolders = [];
  export let watchFilter = 'all';
  export let onSelectPerson;
  export let onBack;
  export let onAddWanted;
  export let onAddWantedTv;
  export let onRemoveWanted;
  export let onWatchStatus;
  export let onOpenMovie;

  let visibleActed = 24;
  let loadingMore = false;
  let lastPersonId = null;
  let justAddedIds = new Set();
  let justRemovedIds = new Set();
  let addedWatchById = {};

  $: if (personData?.id && personData.id !== lastPersonId) {
    lastPersonId = personData.id;
    visibleActed = 24;
    justAddedIds = new Set();
    justRemovedIds = new Set();
    addedWatchById = {};
  }

  async function showMoreActed() {
    loadingMore = true;
    const nextEnd = visibleActed + 24;
    const sliceToEnrich = personData.acted.slice(visibleActed, nextEnd);
    const enriched = await enrichFilmBatch(sliceToEnrich);
    personData = {
      ...personData,
      acted: [
        ...personData.acted.slice(0, visibleActed),
        ...enriched,
        ...personData.acted.slice(nextEnd)
      ]
    };
    visibleActed = nextEnd;
    loadingMore = false;
  }

  async function handleDotAction(film, nextStatus, fallbackDirector = '') {
    const match = getCatalogMatch(film, databaseEntries).at(0);
    if (match) {
      await onWatchStatus?.(match.folder_name, nextStatus);
      return;
    }

    const nextRemoved = new Set(justRemovedIds);
    nextRemoved.delete(film.id);
    justRemovedIds = nextRemoved;
    justAddedIds = new Set([...justAddedIds, film.id]);
    addedWatchById = { ...addedWatchById, [film.id]: nextStatus };

    await onAddWanted({
      ...film,
      director: film.director || fallbackDirector,
      watch_status: nextStatus
    }, fallbackDirector);
  }

  async function handleRemoveClick(film) {
    const nextAdded = new Set(justAddedIds);
    nextAdded.delete(film.id);
    justAddedIds = nextAdded;
    const nextWatchMap = { ...addedWatchById };
    delete nextWatchMap[film.id];
    addedWatchById = nextWatchMap;
    justRemovedIds = new Set([...justRemovedIds, film.id]);
    await onRemoveWanted?.(film);
  }

  function getCatalogMatch(movie, entries) {
    return entries.filter(
      d => d.title?.toLowerCase() === movie.title?.toLowerCase() && (!movie.year || String(d.year) === String(movie.year))
    );
  }

  function findSeasonMatch(show, seasonNum, entries) {
    return entries.find(
      d => d.media_type === 'tv' &&
        Number(d.season_number) === Number(seasonNum) &&
        (Number(d.tmdb_id) === Number(show.id) || d.title?.toLowerCase() === show.title?.toLowerCase())
    );
  }

  function getSeasonStatus(sMatch) {
    if (!sMatch) return '';
    try {
      const eps = sMatch.episodes_json ? JSON.parse(sMatch.episodes_json) : [];
      if (eps.length > 0) return computeSeasonWatchStatus(eps);
    } catch (_) {}
    return sMatch.watch_status || '';
  }

  function matchesWatchFilter(movie, entries, filter) {
    if (filter === 'all') return true;
    const matches = getCatalogMatch(movie, entries);
    const ws = matches.at(0)?.watch_status || '';
    if (filter === 'unseen') return ws === '';
    return ws === filter;
  }

  $: filteredDirected = (personData?.directed || []).filter(f => matchesWatchFilter(f, databaseEntries, watchFilter));
  $: filteredActed = (personData?.acted || []).filter(f => matchesWatchFilter(f, databaseEntries, watchFilter));

  function getCatalogStatus(movie, entries, addedSet, removedSet) {
    if (removedSet.has(movie.id)) return null;
    if (addedSet.has(movie.id)) return 'Wanted';

    const matches = getCatalogMatch(movie, entries);
    if (matches.length === 0) return null;

    if (matches.every(m => m.status === 'wanted')) return 'Wanted';

    const owned = matches.filter(m => m.status !== 'wanted');
    const missingAll = owned.every(m => !diskFolders.includes(m.folder_name));
    if (missingAll) return 'Missing';

    const quals = owned
      .filter(m => diskFolders.includes(m.folder_name))
      .map(m => {
        if (m.quality?.trim()) return m.quality.trim();
        const bracketMatch = m.folder_name.match(/\[([^\]]+)\]/);
        return bracketMatch && !bracketMatch.at(1).startsWith('imdbid-') ? bracketMatch.at(1) : '';
      })
      .filter(Boolean);

    return quals.length > 0 ? [...new Set(quals)].join(', ') : '???';
  }
</script>

<section class="person-page">
  <div class="section-bar">
    <h2>{personData?.name || (loading ? 'Loading…' : 'Filmography')}</h2>
    {#if onBack}
      <button type="button" class="btn-text" on:click={onBack}>← Back</button>
    {/if}
  </div>

  {#if loading}
    <p class="loading-note">Loading filmography…</p>
  {:else if personData}
    {#if personData.matches?.length > 1}
      <div class="person-matches">
        <span class="match-label">Matches:</span>
        {#each personData.matches as person (person.id)}
          <button
            class="person-pill"
            class:active={person.id === personData.id}
            on:click={() => onSelectPerson(personData.queryName || person.name, person.id)}
          >
            {person.name}
            {#if person.knownTitle}
              <span class="dept">({person.knownTitle})</span>
            {:else if person.knownFor}
              <span class="dept">({person.knownFor})</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if filteredDirected.length > 0}
      <h3>{filteredDirected.length} Directed by {personData.name}</h3>
      <div class="film-grid">
        {#each filteredDirected as film (film.id)}
          {@const status = getCatalogStatus(film, databaseEntries, justAddedIds, justRemovedIds)}
          {@const dbMatch = getCatalogMatch(film, databaseEntries).at(0)}
          {@const curWatch = dbMatch ? (dbMatch.watch_status || '') : (justAddedIds.has(film.id) ? (addedWatchById[film.id] || '') : '')}
          <article class="film-card">
            <button
              type="button"
              class="poster-btn"
              style="padding: 0; border: none; background: none; cursor: pointer;"
              on:click={() => onOpenMovie?.(film)}
              title="Open details"
            >
              {#if film.poster_url}
                <img src={film.poster_url} alt={film.title} />
              {:else}
                <div class="no-poster">No Poster</div>
              {/if}
            </button>
            <div class="film-meta">
              <div class="film-title-row">
                <div class="title-left">
                  <button
                    type="button"
                    class="person-link"
                    style="font-weight: bold; text-align: left;"
                    on:click={() => onOpenMovie?.(film)}
                  >{film.title}</button> <span class="mono">({film.year || 'n.d.'})</span>
                </div>

                <div class="title-right">
                  {#if status === 'Wanted'}
                    <button type="button" class="icon-btn icon-danger" on:click={() => handleRemoveClick(film)} title="Remove from Wanted" aria-label="Remove from Wanted">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>
                    </button>
                  {/if}
                </div>
              </div>

              <div class="badge-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div>
                  {#if status}
                    <span class="tag" class:tag-wanted={status === 'Wanted'} class:tag-missing={status === 'Missing'}>{status}</span>
                  {/if}
                </div>

                <div class="icon-actions" style="margin-left: auto;">
                  {#if curWatch === ''}
                    <span class="watch-triad">
                      <button
                        type="button"
                        class="icon-btn"
                        class:active-watch={Boolean(dbMatch || justAddedIds.has(film.id))}
                        on:click|stopPropagation={() => handleDotAction(film, '', personData.name)}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Unseen' : 'Add to Wanted as Unseen'}
                        aria-label="Unseen"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        on:click|stopPropagation={() => handleDotAction(film, 'liked', personData.name)}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Seen & Liked' : 'Add to Wanted as Seen & Liked'}
                        aria-label="Seen and Liked"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        on:click|stopPropagation={() => handleDotAction(film, 'unfinished', personData.name)}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Unfinished' : 'Add to Wanted as Unfinished'}
                        aria-label="Unfinished"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        on:click|stopPropagation={() => handleDotAction(film, 'disliked', personData.name)}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Seen & Disliked' : 'Add to Wanted as Seen & Disliked'}
                        aria-label="Seen and Disliked"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        on:click|stopPropagation={() => handleDotAction(film, 'disliked', personData.name)}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Seen & Disliked' : 'Add to Wanted as Seen & Disliked'}
                        aria-label="Seen and Disliked"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                      </button>
                    </span>
                  {:else}
                    <button
                      type="button"
                      class="icon-btn"
                      on:click|stopPropagation={() => handleDotAction(film, '', personData.name)}
                      title={curWatch === 'liked' ? 'Seen & Liked (click to reset to Unseen)' : curWatch === 'unfinished' ? 'Unfinished (click to reset to Unseen)' : 'Seen & Disliked (click to reset to Unseen)'}
                      aria-label="Clear watch status"
                    >
                      {#if curWatch === 'liked'}
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                      {:else if curWatch === 'unfinished'}
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                      {:else}
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                      {/if}
                    </button>
                  {/if}
                </div>
              </div>

              {#if film.overview}
                <p class="synopsis">{film.overview}</p>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}

    {#if filteredActed.length > 0}
      <h3>{filteredActed.length} Film Credits</h3>
      <div class="film-grid">
        {#each filteredActed.slice(0, visibleActed) as film (film.id)}
          {@const status = getCatalogStatus(film, databaseEntries, justAddedIds, justRemovedIds)}
          {@const dbMatch = getCatalogMatch(film, databaseEntries).at(0)}
          {@const curWatch = dbMatch ? (dbMatch.watch_status || '') : (justAddedIds.has(film.id) ? (addedWatchById[film.id] || '') : '')}
          <article class="film-card">
            <button
              type="button"
              class="poster-btn"
              style="padding: 0; border: none; background: none; cursor: pointer;"
              on:click={() => onOpenMovie?.(film)}
              title="Open details"
            >
              {#if film.poster_url}
                <img src={film.poster_url} alt={film.title} />
              {:else}
                <div class="no-poster">No Poster</div>
              {/if}
            </button>
            <div class="film-meta">
              <div class="film-title-row">
                <div class="title-left">
                  <button
                    type="button"
                    class="person-link"
                    style="font-weight: bold; text-align: left;"
                    on:click={() => onOpenMovie?.(film)}
                  >{film.title}</button> <span class="mono">({film.year || 'n.d.'})</span>
                </div>
                <div class="title-right">
                  {#if status === 'Wanted'}
                    <button type="button" class="icon-btn icon-danger" on:click={() => handleRemoveClick(film)} title="Remove from Wanted" aria-label="Remove from Wanted">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>
                    </button>
                  {/if}
                </div>
              </div>

              <div class="badge-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div>
                  {#if status}
                    <span class="tag" class:tag-wanted={status === 'Wanted'} class:tag-missing={status === 'Missing'}>{status}</span>
                  {/if}
                </div>

                <div class="icon-actions" style="margin-left: auto;">
                  {#if curWatch === ''}
                    <span class="watch-triad">
                      <button
                        type="button"
                        class="icon-btn"
                        class:active-watch={Boolean(dbMatch || justAddedIds.has(film.id))}
                        on:click|stopPropagation={() => handleDotAction(film, '', '')}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Unseen' : 'Add to Wanted as Unseen'}
                        aria-label="Unseen"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        on:click|stopPropagation={() => handleDotAction(film, 'liked', '')}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Seen & Liked' : 'Add to Wanted as Seen & Liked'}
                        aria-label="Seen and Liked"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        on:click|stopPropagation={() => handleDotAction(film, 'unfinished', '')}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Unfinished' : 'Add to Wanted as Unfinished'}
                        aria-label="Unfinished"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        on:click|stopPropagation={() => handleDotAction(film, 'disliked', '')}
                        title={dbMatch || justAddedIds.has(film.id) ? 'Seen & Disliked' : 'Add to Wanted as Seen & Disliked'}
                        aria-label="Seen and Disliked"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                      </button>
                    </span>
                  {:else}
                    <button
                      type="button"
                      class="icon-btn"
                      on:click|stopPropagation={() => handleDotAction(film, '', '')}
                      title={curWatch === 'liked' ? 'Seen & Liked (click to reset to Unseen)' : curWatch === 'unfinished' ? 'Unfinished (click to reset to Unseen)' : 'Seen & Disliked (click to reset to Unseen)'}
                      aria-label="Clear watch status"
                    >
                      {#if curWatch === 'liked'}
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                      {:else if curWatch === 'unfinished'}
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                      {:else}
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                      {/if}
                    </button>
                  {/if}
                </div>
              </div>

              {#if film.role}
                <div class="credits">as {film.role}</div>
              {/if}

              {#if film.overview}
                <p class="synopsis">{film.overview}</p>
              {/if}
            </div>
          </article>
        {/each}
      </div>

      {#if visibleActed < filteredActed.length}
        <div class="show-more-row">
          <button type="button" class="btn-secondary" disabled={loadingMore} on:click={showMoreActed}>
            {loadingMore ? 'Loading…' : `Show More (${filteredActed.length - visibleActed} remaining)`}
          </button>
        </div>
      {/if}
    {/if}

  {/if}
      {#if personData.tvShows?.length > 0}
      <h3 style="margin-top: 28px;">{personData.tvShows.length} TV Shows with {personData.name}</h3>
      <div class="film-grid">
        {#each personData.tvShows as show (show.id)}
          <article class="film-card">
            {#if show.poster_url}
              <img
                src={show.poster_url}
                alt={show.title}
                on:error={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            {:else}
              <div class="no-poster">No Poster</div>
            {/if}
            <div class="film-meta">
              <div class="film-title-row">
                <div class="title-left">
                  <strong>{show.title}</strong> <span class="mono">({show.year || 'n.d.'})</span>
                </div>
              </div>

              {#if show.role}
                <div class="credits">{show.role}</div>
              {/if}

              <div class="season-badges" style="margin: 4px 0;">
                {#each (show.seasons || Array.of(1)) as sNum}
                  {@const sMatch = findSeasonMatch(show, sNum, databaseEntries)}
                  {@const sLabel = `S${String(sNum).padStart(2, '0')}`}
                  {@const sWatch = getSeasonStatus(sMatch)}
                  <button
                    type="button"
                    class="tax-pill season-pill"
                    class:season-owned={sMatch && sMatch.status !== 'wanted'}
                    class:season-wanted={sMatch?.status === 'wanted'}
                    title={sMatch
                      ? `${sLabel} in catalog (${sMatch.status === 'wanted' ? 'Wanted' : 'On Drive'} · ${sWatch || 'Unseen'})`
                      : `Add ${show.title} ${sLabel} to Wanted`}
                    on:click={() => { if (!sMatch) onAddWantedTv?.(show, sNum); }}
                  >
                    {#if sMatch}
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

              {#if show.overview}
                <p class="synopsis">{show.overview}</p>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
</section>
