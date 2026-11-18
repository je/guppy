<script>
  export let results = null;
  export let loading = false;
  export let databaseEntries = [];
  export let diskFolders = [];
  export let onSelectPerson;
  export let onPersonClick;
  export let onOpenMovie;
  export let onWatchStatus;
  export let onAddWanted;
  export let onRemoveWanted;

  import { computeSeasonWatchStatus } from '$lib/guppyStore.js';

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
  let justAddedSeasons = new Set();
  let justRemovedSeasons = new Set();

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

    await onAddWanted?.({
      ...film,
      watch_status: nextStatus
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
                    class="person-link title"
                    style="text-align: left;"
                    on:click={() => onSelectPerson?.(person.name, person.id)}
                  >
                    {person.name}
                  </button>
                  {#if person.yearSpan}
                    <span class="mono">({person.yearSpan})</span>
                  {/if}
                </div>

                {#if person.department}
                  <div class="badge-action-row" style="margin-top: 4px;">
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
      <div class="section-bar" style="margin-top: 28px;">
        <h2>{results.movies.length} Movies</h2>
      </div>
      <div class="grid-3">
        {#each results.movies as film (film.id)}
          {@const existing = justRemovedMovies.has(film.id) ? null : findMovieMatch(film)}
          {@const isPendingWanted = !existing && justAddedMovies.has(film.id)}
          {@const onDrive = existing && existing.status !== 'wanted' && diskFolders.includes(existing.folder_name)}
          {@const curWatch = existing ? (existing.watch_status || '') : (isPendingWanted ? (addedWatchById[film.id] || '') : '')}
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
                    class="person-link title"
                    style="text-align: left;"
                    on:click={() => onOpenMovie?.(film)}
                  >
                    {film.title}
                  </button>
                  <span class="mono">({film.year || 'n.d.'})</span>
                </div>

                <div class="badge-action-row" style="margin-top: 4px; display: flex; align-items: center; justify-content: space-between; width: 100%;">
                  <div>
                    {#if onDrive}
                      <span class="tag">{existing.quality || 'On Drive'}</span>
                    {:else if existing?.status === 'wanted' || isPendingWanted}
                      <span class="tag tag-wanted">Wanted</span>
                    {:else if existing}
                      <span class="tag tag-missing">Missing</span>
                    {/if}
                  </div>

                  <div class="icon-actions" style="margin-left: auto;">
                    {#if existing?.status === 'wanted' || isPendingWanted}
                      <button
                        type="button"
                        class="icon-btn icon-danger"
                        on:click={() => handleRemoveMovie(film)}
                        title="Remove from Wanted"
                        aria-label="Remove from Wanted"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>
                      </button>
                    {/if}

                    {#if curWatch === ''}
                      <span class="watch-triad">
                        <button
                          type="button"
                          class="icon-btn"
                          class:active-watch={Boolean(existing || isPendingWanted)}
                          on:click|stopPropagation={() => handleDotAction(film, '')}
                          title={existing || isPendingWanted ? 'Unseen' : 'Add to Wanted as Unseen'}
                          aria-label="Unseen"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          on:click|stopPropagation={() => handleDotAction(film, 'liked')}
                          title={existing || isPendingWanted ? 'Seen & Liked' : 'Add to Wanted as Seen & Liked'}
                          aria-label="Seen and Liked"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          on:click|stopPropagation={() => handleDotAction(film, 'unfinished')}
                          title={existing || isPendingWanted ? 'Unfinished' : 'Add to Wanted as Unfinished'}
                          aria-label="Unfinished"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          on:click|stopPropagation={() => handleDotAction(film, 'disliked')}
                          title={existing || isPendingWanted ? 'Seen & Disliked' : 'Add to Wanted as Seen & Disliked'}
                          aria-label="Seen and Disliked"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                        </button>
                      </span>
                    {:else}
                      <button
                        type="button"
                        class="icon-btn"
                        on:click|stopPropagation={() => handleDotAction(film, '')}
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

                {#if film.director || film.cast_list}
                  <div class="credits">
                    {#if film.director}
                      Dir.
                      {#each film.director.split(',').map(s => s.trim()).filter(Boolean) as dir, idx}
                        {#if idx > 0}, {/if}
                        <button type="button" class="person-link" on:click={() => onPersonClick?.(dir)}>{dir}</button>
                      {/each}
                    {/if}
                    {#if film.director && film.cast_list} · {/if}
                    {#if film.cast_list}
                      {#each film.cast_list.split(',').map(s => s.trim()).filter(Boolean) as actor, idx}
                        {#if idx > 0}, {/if}
                        <button type="button" class="person-link" on:click={() => onPersonClick?.(actor)}>{actor}</button>
                      {/each}
                    {/if}
                  </div>
                {/if}

                {#if film.overview}
                  <p class="synopsis">{film.overview}</p>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </div>
    {/if}

    {#if results.tvShows?.length > 0}
      <div class="section-bar" style="margin-top: 28px;">
        <h2>{results.tvShows.length} TV Shows</h2>
      </div>
      <div class="grid-3">
        {#each results.tvShows as show (show.id)}
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
                    class="person-link title"
                    style="text-align: left;"
                    on:click={() => onOpenMovie?.({ ...show, media_type: 'tv', season_number: 1 })}
                  >
                    {show.title}
                  </button>
                  <span class="mono">({show.yearSpan || show.year || 'n.d.'})</span>
                </div>

                <div class="season-badges">
                  {#each (show.seasons || Array.of(1)) as sNum}
                    {@const sMatch = findSeasonMatch(show, sNum, databaseEntries)}
                    {@const isInCatalog = Boolean(sMatch)}
                    {@const sLabel = `S${String(sNum).padStart(2, '0')}`}
                    {@const sWatch = getSeasonStatus(sMatch)}
                    <button
                      type="button"
                      class="tax-pill season-pill"
                      class:season-owned={sMatch && sMatch.status !== 'wanted'}
                      class:season-wanted={sMatch?.status === 'wanted'}
                      title={isInCatalog
                        ? `Open ${show.title} ${sLabel} (${sMatch.status === 'wanted' ? 'Wanted' : 'On Drive'} · ${sWatch || 'Unseen'})`
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
