<script>
  import { onMount } from 'svelte';
  import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener';
  import { getMediaRoot, fetchMovieDetails, getMovieFolderFiles, fetchMovieKeywords, computeSeasonWatchStatus, fetchTvSeasonDetails, playInVlc, resolveLocalMediaPath } from '$lib/guppyStore.js';

  export let movie;
  export let onDrive = true;
  export let onBack;
  export let onPersonClick;
  export let onSaveTags;
  export let onSaveEpisodes;
  export let onWatchStatus;
  export let onDelete;
  export let onAddWanted;

  const imdbBase = ["https:/", "://imdb.com", "title", ""].join("/");
  const isDesktopTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
  let activeStream = null;
  let streamError = "";

  let extra = null;
  let files = [];
  let suggestedTags = [];
  let loadingExtra = true;
  let draftTags = movie.tags || '';
  let draftClips = movie.clips || '';
  let savedNote = '';
  let copiedNote = false;
  let confirmDelete = false;
  let confirmTimer = null;

  let localWatch = movie.watch_status || '';
  let lastFolder = movie.folder_name;
  let seasonPickerOpen = false;
  let episodesDirty = false;
  let savingEpisodes = false;


  $: if (movie?.folder_name && movie.folder_name !== lastFolder) {
    lastFolder = movie.folder_name;
    localWatch = movie.watch_status || '';
    draftTags = movie.tags || '';
    draftClips = movie.clips || '';
    confirmDelete = false;
  }

  $: activeTagSet = new Set(draftTags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));

  $: largePoster = movie.poster_url
    ? movie.poster_url.replace('/w300/', '/w500/').replace('/w185/', '/w500/')
    : '';

  $: rootDir = getMediaRoot(movie);

    let episodesList = [];
  let lastEpisodesJson = '';
  $: if (movie && (movie.episodes_json || '') !== lastEpisodesJson) {
    lastEpisodesJson = movie.episodes_json || '';
    try {
      episodesList = lastEpisodesJson ? JSON.parse(lastEpisodesJson) : [];
    } catch (_) {}
  }
    let editingEpNum = null;
    let epDraftTags = '';
    let epDraftClips = '';

    $: if (movie?.folder_name) {
    try {
        episodesList = movie.episodes_json ? JSON.parse(movie.episodes_json) : [];
    } catch (_) {
        episodesList = [];
    }
    }

    $: seasonWatch = movie.media_type === 'tv' ? computeSeasonWatchStatus(episodesList) : localWatch;

    async function setEpisodeWatch(epNumber, nextStatus) {
    const updated = episodesList.map(ep =>
        Number(ep.episode_number) === Number(epNumber)
        ? { ...ep, watch_status: nextStatus }
        : ep
    );
    episodesList = updated;
    await onSaveEpisodes?.(movie.folder_name, updated);
    }

    function openEpisodeEditor(ep) {
    if (editingEpNum === ep.episode_number) {
        editingEpNum = null;
        return;
    }
    editingEpNum = ep.episode_number;
    epDraftTags = ep.tags || '';
    epDraftClips = ep.clips || '';
    }

    async function saveEpisodeMeta(epNumber) {
    const updated = episodesList.map(ep =>
        Number(ep.episode_number) === Number(epNumber)
        ? { ...ep, tags: epDraftTags.trim(), clips: epDraftClips.trim() }
        : ep
    );
    episodesList = updated;
    editingEpNum = null;
    await onSaveEpisodes?.(movie.folder_name, updated);
    }

  onMount(async () => {
    const baseRoot = getMediaRoot(movie);
    const isLogged = Boolean(movie.folder_name);
    const [details, folderFiles, keywords] = await Promise.all([
      fetchMovieDetails(movie).catch(() => null),
      isLogged && onDrive && movie.status !== 'wanted' ? getMovieFolderFiles(movie.folder_name, baseRoot) : Promise.resolve([]),
      fetchMovieKeywords(movie).catch(() => [])
    ]);
    extra = details;
    files = folderFiles;
    suggestedTags = keywords;

    if (movie.media_type === 'tv' && episodesList.length === 0 && (movie.tmdb_id || movie.id)) {
      const seasonData = await fetchTvSeasonDetails(movie.tmdb_id || movie.id, movie.season_number || 1).catch(() => null);
      if (seasonData?.episodes?.length > 0) {
        episodesList = seasonData.episodes;
        movie = {
          ...movie,
          poster_url: seasonData.poster_url || movie.poster_url,
          year: seasonData.air_date ? Number(seasonData.air_date.slice(0, 4)) : movie.year,
          overview: seasonData.overview || movie.overview
        };
      }
    }

    loadingExtra = false;
  });

  function toggleSuggestedTag(tag) {
    const current = draftTags.split(',').map(s => s.trim()).filter(Boolean);
    const lower = tag.toLowerCase();
    if (current.some(t => t.toLowerCase() === lower)) {
      draftTags = current.filter(t => t.toLowerCase() !== lower).join(', ');
    } else {
      draftTags = [...current, lower].join(', ');
    }
  }

  function handleTrashClick() {
    if (!confirmDelete) {
      confirmDelete = true;
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirmDelete = false; }, 3200);
      return;
    }
    if (confirmTimer) clearTimeout(confirmTimer);
    onDelete(movie.folder_name);
    onBack();
  }

    async function openMovieFolder() {
        try {
            const target = await resolveLocalMediaPath(`${rootDir}/${movie.folder_name}`);
            await openPath(target);
        } catch (err) {
            alert(`Could not open folder: ${err}`);
        }
    }

  async function setWatch(nextStatus) {
    localWatch = nextStatus;
    await onWatchStatus?.(movie.folder_name, nextStatus);
  }

  async function copyImdbUrl() {
    if (!movie.imdb_id) return;
    try {
      await navigator.clipboard.writeText(imdbBase + movie.imdb_id);
      copiedNote = true;
      setTimeout(() => copiedNote = false, 1500);
    } catch (_) {}
  }

  async function saveTaxonomy() {
    await onSaveTags?.(movie.folder_name, draftTags, draftClips);
    savedNote = 'Saved';
    setTimeout(() => savedNote = '', 1800);
  }

  function applySeasonWatchToAll(status) {
    episodesList = episodesList.map(ep => ({ ...ep, watch_status: status }));
    episodesDirty = true;
    seasonPickerOpen = false;
  }

  function setEpisodeWatchLocal(epNum, status) {
    episodesList = episodesList.map(ep =>
      Number(ep.episode_number) === Number(epNum) ? { ...ep, watch_status: status } : ep
    );
    episodesDirty = true;
  }

  async function saveEpisodeStatuses() {
    if (!movie.folder_name || savingEpisodes) return;
    savingEpisodes = true;
    try {
      await onSaveEpisodes?.(movie.folder_name, episodesList);
      episodesDirty = false;
    } finally {
      savingEpisodes = false;
    }
  }
  onMount(() => {
    const onStream = (ev) => { streamError = ""; activeStream = ev.detail || null; };
    window.addEventListener('guppy:stream', onStream);
    return () => window.removeEventListener('guppy:stream', onStream);
  });
</script>

<section class="detail-page">
  {#if activeStream}
    <div style="background: #111; color: #fff; border-radius: 8px; padding: 12px; margin-bottom: 14px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; font-size: 0.85rem; flex-wrap: wrap;">
        <strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">{activeStream.title}</strong>
        <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
          <a
            href={`vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(activeStream.url)}`}
            style="color: #93c5fd; text-decoration: underline; font-size: 0.8rem;"
          >Open in VLC</a>
          <a
            href={activeStream.url}
            target="_blank"
            rel="noopener"
            style="color: #d1d5db; text-decoration: underline; font-size: 0.8rem;"
          >Direct Stream</a>
          <button
            type="button"
            on:click={() => { activeStream = null; streamError = ""; }}
            style="background: #374151; color: #fff; border: none; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 0.78rem;"
          >Close</button>
        </div>
      </div>
      {#if streamError}
        <div style="background: #7f1d1d; color: #fecaca; padding: 8px 10px; border-radius: 4px; font-size: 0.8rem; margin-bottom: 8px;">
          {streamError}
        </div>
      {/if}
      <!-- svelte-ignore a11y-media-has-caption -->
      <video
        src={activeStream.url}
        controls
        autoplay
        playsinline
        on:error={() => {
          const ext = (activeStream?.title || '').split('.').pop()?.toUpperCase() || 'this format';
          streamError = `Safari cannot play ${ext} natively in-browser. Tap "Open in VLC" above (requires the free VLC for Mobile app on iPad).`;
        }}
        style="width: 100%; max-height: 60vh; border-radius: 4px; background: #000;"
      ></video>
    </div>
  {/if}
  <div class="top-bar">
    <button type="button" class="btn-text" on:click={onBack}>← Back</button>

    <div class="icon-actions">
      {#if copiedNote}
        <span class="copied-note">Copied</span>
      {/if}

      {#if !movie.folder_name}
        <span class="tag tag-wanted">Not in Library</span>
      {:else if movie.status === 'wanted'}
        <span class="tag tag-wanted">Wanted</span>
      {:else if !onDrive}
        <span class="tag tag-missing">Missing</span>
      {:else if movie.quality}
        <span class="tag">{movie.quality}</span>
      {/if}

      {#if movie.folder_name}
        <button
          type="button"
          class="icon-btn icon-danger"
          class:confirm-del={confirmDelete}
          on:click={handleTrashClick}
          title={confirmDelete ? 'Click again to confirm moving folder to /deleted/' : 'Remove from library'}
          aria-label="Remove"
        >
          {#if confirmDelete}
            <span>Delete?</span>
          {:else}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          {/if}
        </button>
      {/if}

      {#if movie.imdb_id}
        <button
          type="button"
          class="icon-btn"
          on:click={copyImdbUrl}
          title="Copy IMDb link ({imdbBase + movie.imdb_id})"
          aria-label="Copy IMDb link"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
      {/if}

      {#if isDesktopTauri && movie.folder_name && onDrive && movie.status !== 'wanted'}
        <button
          type="button"
          class="icon-btn"
          on:click={openMovieFolder}
          title="Open folder in Finder"
          aria-label="Open folder"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
        </button>
      {/if}

      {#if onDrive && movie.status !== 'wanted'}
        <button
        type="button"
        class="icon-btn"
        on:click={() => playInVlc(movie.folder_name, '', movie.media_type === 'tv')}
        title="Play in VLC"
        aria-label="Play in VLC"
        >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
        </button>
      {/if}

      {#if movie.folder_name && movie.media_type === 'tv'}
        {#if !seasonPickerOpen}
          <button
            type="button"
            class="icon-btn"
            on:click={() => { seasonPickerOpen = true; }}
            title="Season status: {seasonWatch || 'Unseen'} (click to set status for all episodes)"
            aria-label="Season watch status"
          >
            {#if seasonWatch === 'liked'}
              <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
            {:else if seasonWatch === 'disliked'}
              <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
            {:else if seasonWatch === 'unfinished'}
              <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
            {:else}
              <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
            {/if}
          </button>
        {:else}
          <span class="watch-triad">
            <button type="button" class="icon-btn" on:click={() => applySeasonWatchToAll('')} title="Set all episodes to Unseen" aria-label="All Unseen">
              <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
            </button>
            <button type="button" class="icon-btn" on:click={() => applySeasonWatchToAll('liked')} title="Set all episodes to Seen & Liked" aria-label="All Liked">
              <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
            </button>
            <button type="button" class="icon-btn" on:click={() => applySeasonWatchToAll('unfinished')} title="Set all episodes to Unfinished" aria-label="All Unfinished">
              <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
            </button>
            <button type="button" class="icon-btn" on:click={() => applySeasonWatchToAll('disliked')} title="Set all episodes to Seen & Disliked" aria-label="All Disliked">
              <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
            </button>
          </span>
        {/if}

        <button
          type="button"
          class={episodesDirty ? 'btn-primary' : 'btn-secondary'}
          style="height: 24px; padding: 0 8px; font-size: 0.76rem;"
          disabled={!episodesDirty || savingEpisodes}
          on:click={saveEpisodeStatuses}
          title={episodesDirty ? 'Save episode watch statuses' : 'No unsaved episode changes'}
        >
          {savingEpisodes ? 'Saving…' : 'Save'}
        </button>
      {:else}
        <span class="watch-triad">
          <button
            type="button"
            class="icon-btn"
            class:active-watch={Boolean(movie.folder_name) && localWatch === ''}
            on:click={() => movie.folder_name ? setWatch('') : onAddWanted?.({ ...movie, id: movie.tmdb_id || movie.id, watch_status: '' })}
            title={movie.folder_name ? 'Unseen' : 'Add to Wanted as Unseen'}
            aria-label="Unseen"
          >
            <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
          </button>
          <button
            type="button"
            class="icon-btn"
            class:active-watch={Boolean(movie.folder_name) && localWatch === 'liked'}
            on:click={() => movie.folder_name ? setWatch('liked') : onAddWanted?.({ ...movie, id: movie.tmdb_id || movie.id, watch_status: 'liked' })}
            title={movie.folder_name ? 'Seen & Liked' : 'Add to Wanted as Seen & Liked'}
            aria-label="Seen and Liked"
          >
            <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
          </button>
          <button
            type="button"
            class="icon-btn"
            class:active-watch={Boolean(movie.folder_name) && localWatch === 'unfinished'}
            on:click={() => movie.folder_name ? setWatch('unfinished') : onAddWanted?.({ ...movie, id: movie.tmdb_id || movie.id, watch_status: 'unfinished' })}
            title={movie.folder_name ? 'Unfinished' : 'Add to Wanted as Unfinished'}
            aria-label="Unfinished"
          >
            <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
          </button>
          <button
            type="button"
            class="icon-btn"
            class:active-watch={Boolean(movie.folder_name) && localWatch === 'disliked'}
            on:click={() => movie.folder_name ? setWatch('disliked') : onAddWanted?.({ ...movie, id: movie.tmdb_id || movie.id, watch_status: 'disliked' })}
            title={movie.folder_name ? 'Seen & Disliked' : 'Add to Wanted as Seen & Disliked'}
            aria-label="Seen and Disliked"
          >
            <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
          </button>
        </span>
      {/if}
    </div>
  </div>

  <div class="detail-grid">
    <div class="poster-col">
      {#if largePoster}
        <img src={largePoster} alt={movie.title} class="hero-poster" />
      {:else}
        <div class="hero-blank">No Poster</div>
      {/if}
    </div>

    <div class="info-col">
      <div class="title-block">
        <h2>
          {movie.title}
          {#if movie.media_type === 'tv' && movie.season_number}· Season {movie.season_number}{/if}
          <span class="year">({movie.year || 'n.d.'})</span>
        </h2>

        {#if extra?.original_title}
          <div class="orig-title">Original title: <em>{extra.original_title}</em></div>
        {/if}
        {#if extra?.tagline}
          <div class="tagline">“{extra.tagline}”</div>
        {/if}
      </div>

      {#if extra?.runtime || extra?.countries || extra?.languages || extra?.genres}
        <div class="spec-strip">
          {#if extra?.runtime}<span>{extra.runtime} min</span>{/if}
          {#if extra?.countries}<span class="spec-item">{extra.countries}</span>{/if}
          {#if extra?.languages}<span class="spec-item">{extra.languages}</span>{/if}
          {#if extra?.genres}<span class="spec-item">{extra.genres}</span>{/if}
        </div>
      {/if}

      <dl class="credits-table">
        {#if movie.director || extra?.director}
          <dt>Director</dt>
          <dd>
            {#each (movie.director || extra?.director || '').split(',').map(s => s.trim()).filter(Boolean) as dir, i}
              {#if i > 0}, {/if}
              <button type="button" class="person-link" on:click={() => onPersonClick?.(dir)}>{dir}</button>
            {/each}
          </dd>
        {/if}
        {#if extra?.writers}
          <dt>Writing</dt>
          <dd>
            {#each extra.writers.split(',').map(s => s.trim()).filter(Boolean) as writer, i}
              {#if i > 0}, {/if}
              <button type="button" class="person-link" on:click={() => onPersonClick?.(writer)}>{writer}</button>
            {/each}
          </dd>
        {/if}
        {#if extra?.cinematographer}
          <dt>Cinematography</dt>
          <dd>
            <button type="button" class="person-link" on:click={() => onPersonClick?.(extra.cinematographer)}>{extra.cinematographer}</button>
          </dd>
        {/if}
      </dl>

      {#if movie.overview || extra?.overview}
        <p class="overview">{movie.overview || extra?.overview}</p>
      {/if}


      {#if extra?.fullCast?.length > 0}
        <div class="sub-block">
          <h3>Cast</h3>
          <div class="cast-grid">
            {#each extra.fullCast as c}
              <div class="cast-row">
                <button type="button" class="person-link" on:click={() => onPersonClick?.(c.name)}>{c.name}</button>
                {#if c.character}<span class="char">as {c.character}</span>{/if}
              </div>
            {/each}
          </div>
        </div>
      {:else if movie.cast_list}
        <div class="sub-block">
          <h3>Cast</h3>
          <div>
            {#each movie.cast_list.split(',').map(s => s.trim()).filter(Boolean) as actor, i}
              {#if i > 0}, {/if}
              <button type="button" class="person-link" on:click={() => onPersonClick?.(actor)}>{actor}</button>
            {/each}
          </div>
        </div>
      {:else if loadingExtra}
        <p class="muted">Loading extended credits…</p>
      {/if}

      {#if episodesList.length > 0}
        {@const ownedEpCount = episodesList.filter(e => Boolean(e.file_name)).length}
        <div class="sub-block">
          <h3>
            Episodes ({ownedEpCount} of {episodesList.length} on Drive)
            {#if ownedEpCount < episodesList.length}
              <span class="tag tag-wanted" style="margin-left: 6px; vertical-align: middle;">Incomplete · Wanted</span>
            {/if}
          </h3>
          <div class="episode-list">
            {#each episodesList as ep (ep.episode_number)}
              {@const epWatch = ep.watch_status || ''}
              {@const epTags = (ep.tags || '').split(',').map(s => s.trim()).filter(Boolean)}
              {@const epClips = (ep.clips || '').split(',').map(s => s.trim()).filter(Boolean)}
              {@const hasFile = Boolean(ep.file_name)}
              <div class="episode-row" class:ep-missing={!hasFile}>
                <div class="episode-top">
                  <div>
                    <span class="mono">S{String(movie.season_number || 1).padStart(2, '0')}E{String(ep.episode_number).padStart(2, '0')}</span>
                    <strong>{ep.name}</strong>
                    {#if ep.air_date}<span class="muted">({ep.air_date})</span>{/if}
                    {#if hasFile}
                      <span class="tag" style="margin-left: 6px;" title={ep.file_name}>
                        {ep.quality?.trim() || movie.quality?.trim() || '???'}
                      </span>
                    {:else}
                      <span class="tag tag-wanted" style="margin-left: 6px;">Wanted</span>
                    {/if}
                  </div>

                  <div class="icon-actions">
                    <button
                      type="button"
                      class="icon-btn"
                      on:click={() => openEpisodeEditor(ep)}
                      title="Edit episode tags & clips"
                      aria-label="Edit episode tags and clips"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
                    </button>
                    {#if ep.file_name}
                    <button
                    type="button"
                    class="icon-btn"
                    on:click={() => playInVlc(movie.folder_name, ep.file_name, true)}
                    title="Play {ep.file_name} in VLC"
                    aria-label="Play episode in VLC"
                    >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                    </button>
                    {/if}
                    <span class="watch-triad">
                      <button
                        type="button"
                        class="icon-btn"
                        class:active-watch={epWatch === ''}
                        on:click={() => setEpisodeWatch(ep.episode_number, '')}
                        title="Unseen"
                        aria-label="Mark Episode Unseen"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        class:active-watch={epWatch === 'liked'}
                        on:click={() => setEpisodeWatch(ep.episode_number, 'liked')}
                        title="Seen & Liked"
                        aria-label="Mark Episode Seen and Liked"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        class:active-watch={epWatch === 'unfinished'}
                        on:click={() => setEpisodeWatch(ep.episode_number, 'unfinished')}
                        title="Unfinished"
                        aria-label="Mark Episode Unfinished"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        class:active-watch={epWatch === 'disliked'}
                        on:click={() => setEpisodeWatch(ep.episode_number, 'disliked')}
                        title="Seen & Disliked"
                        aria-label="Mark Episode Seen and Disliked"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                      </button>
                    </span>
                  </div>
                </div>

                {#if ep.overview}
                  <p class="synopsis">{ep.overview}</p>
                {/if}

                {#if epTags.length > 0 || epClips.length > 0}
                  <div class="tax-pills" style="margin-top: 4px;">
                    {#each epTags as t}<span class="tax-pill">{t}</span>{/each}
                    {#each epClips as c}<span class="tax-pill tax-clip">clip: {c}</span>{/each}
                  </div>
                {/if}

                {#if editingEpNum === ep.episode_number}
                  <form class="ep-tax-form" on:submit|preventDefault={() => saveEpisodeMeta(ep.episode_number)}>
                    <input type="text" placeholder="Episode tags (comma-separated)" bind:value={epDraftTags} />
                    <input type="text" placeholder="Episode clips (comma-separated)" bind:value={epDraftClips} />
                    <button type="submit" class="btn-primary">Save</button>
                    <button type="button" class="btn-secondary" on:click={() => editingEpNum = null}>Cancel</button>
                  </form>
                {/if}
              </div>
            {/each}

          </div>
        </div>
      {/if}


      <form class="tax-form" on:submit|preventDefault={saveTaxonomy}>
        <h3>Tags & Clips</h3>
        <label>
          <span>Tags</span>
          <input type="text" placeholder="noir, space opera, adult" bind:value={draftTags} />
        </label>

        {#if suggestedTags.length > 0}
          <div class="suggest-row">
            <span class="tax-label">TMDb:</span>
            {#each suggestedTags as tag}
              <button
                type="button"
                class="tax-pill suggest-pill"
                class:active-pill={activeTagSet.has(tag)}
                on:click={() => toggleSuggestedTag(tag)}
              >
                {activeTagSet.has(tag) ? '✓ ' : ''}{tag}
              </button>
            {/each}
          </div>
        {/if}

        <label>
          <span>Clips</span>
          <input type="text" placeholder="nazi salute, beheading, fake suicide" bind:value={draftClips} />
        </label>
        <div class="tax-actions">
          <button type="submit" class="btn-primary">Save Tags & Clips</button>
          {#if savedNote}<span class="saved-note">{savedNote}</span>{/if}
        </div>
      </form>

      {#if movie.folder_name && onDrive && movie.status !== 'wanted'}
        <div class="sub-block">
          <h3>Drive Storage</h3>
           <div class="mono path">{rootDir}/{movie.folder_name}</div>
          {#if files.length > 0}
            <ul class="file-list">
              {#each files as f}<li class="mono">{f}</li>{/each}
            </ul>
          {/if}
        </div>
      {/if}

    </div>
  </div>
</section>
