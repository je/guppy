<script>
  export let results = null;
  export let loading = false;
  export let databaseEntries = [];
  export let diskFolders = [];
  export let onSelectPerson;
  export let onPersonClick;
  export let onAddWanted;
  export let onRemoveWanted;
  export let onAddWantedTv;

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

  let justAddedSeasons = new Set();

  function findSeasonMatch(show, seasonNum, entries) {
    return entries.find(
      d => d.media_type === 'tv' &&
        Number(d.season_number) === Number(seasonNum) &&
        (Number(d.tmdb_id) === Number(show.id) || d.title?.toLowerCase() === show.title?.toLowerCase())
    );
  }

  async function handleSeasonClick(show, sNum, sMatch) {
    if (sMatch) return;
    const key = `${show.id}:${sNum}`;
    if (justAddedSeasons.has(key)) return;
    justAddedSeasons = new Set([...justAddedSeasons, key]);
    await onAddWantedTv?.(show, sNum);
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
          {@const existing = findMovieMatch(film)}
          {@const onDrive = existing && existing.status !== 'wanted' && diskFolders.includes(existing.folder_name)}
          {@const poster = getPoster(film)}
          <article class="catalog-entry">
            <div class="entry-body">
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


              <div class="meta-col">
                <div class="title-line">
                  <span class="title">{film.title}</span>
                  <span class="mono">({film.year || 'n.d.'})</span>
                </div>

                <div class="badge-action-row" style="margin-top: 4px;">
                  {#if onDrive}
                    <span class="tag">{existing.quality || 'On Drive'}</span>
                  {:else if existing?.status === 'wanted'}
                    <span class="tag tag-wanted">Wanted</span>
                  {:else if existing}
                    <span class="tag tag-missing">Missing</span>
                  {/if}

                  <div class="icon-actions">
                    {#if existing?.status === 'wanted'}
                      <button type="button" class="btn-secondary" style="height: 24px; padding: 0 8px; font-size: 0.76rem;" on:click={() => onRemoveWanted?.(film)}>
                        Remove Wanted
                      </button>
                    {:else if !existing}
                      <button type="button" class="btn-secondary" style="height: 24px; padding: 0 8px; font-size: 0.76rem;" on:click={() => onAddWanted?.(film)}>
                        + Wanted
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

              <div class="meta-col">
                <div class="title-line">
                  <span class="title">{show.title}</span>
                  <span class="mono">({show.yearSpan || show.year || 'n.d.'})</span>
                </div>

                <div class="season-badges">
                  {#each (show.seasons || Array.of(1)) as sNum}
                    {@const sMatch = findSeasonMatch(show, sNum, databaseEntries)}
                    {@const isPendingWanted = !sMatch && justAddedSeasons.has(`${show.id}:${sNum}`)}
                    {@const isInCatalog = Boolean(sMatch) || isPendingWanted}
                    {@const sLabel = `S${String(sNum).padStart(2, '0')}`}
                    {@const sWatch = getSeasonStatus(sMatch)}
                    <button
                      type="button"
                      class="tax-pill season-pill"
                      class:season-owned={sMatch && sMatch.status !== 'wanted'}
                      class:season-wanted={sMatch?.status === 'wanted' || isPendingWanted}
                      title={isInCatalog
                        ? `${sLabel} in catalog (${sMatch?.status && sMatch.status !== 'wanted' ? 'On Drive' : 'Wanted'} · ${sWatch || 'Unseen'})`
                        : `Add ${show.title} ${sLabel} to Wanted`}
                      on:click={() => handleSeasonClick(show, sNum, sMatch)}
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
