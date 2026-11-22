<script>
  import { getPrimaryVideoExt } from '$lib/guppyStore.js';
  import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener';
  import { getMediaRoot, fetchMovieKeywords, computeSeasonWatchStatus, playInVlc, resolveLocalMediaPath } from '$lib/guppyStore.js';
  export let item;
  export let layout = 'cards';
  export let onDrive = true;
  export let results = null;
  export let onLookup;
  export let onWikiLookup;
  export let onSelect;
  export let onDelete;
  export let onPersonClick;
  export let onTagClick;
  export let onSaveTags;
  export let onWatchStatus;
  export let onOpenMovie;

  const posterSmall = ["https:/", "image.tmdb.org", "t", "p", "w154"].join("/");
  const imdbBase = ["https:/", "www.imdb.com", "title", ""].join("/");

  let editingTags = false;
  let draftTags = item.tags || '';
  let draftClips = item.clips || '';
  let suggestedTags = [];
  let loadingTags = false;
  let copiedNote = false;
  let confirmDelete = false;
  let confirmTimer = null;

  let showLookupBox = false;
  let queryTitle = item.title || '';
  let queryYear = item.year || '';
  let queryDirector = item.director || '';
  let queryMediaType = item.media_type === 'tv' ? 'tv' : 'movie';

  let localWatch = item.watch_status || '';
  let lastFolder = item.folder_name;

  $: if (item?.folder_name && item.folder_name !== lastFolder) {
    lastFolder = item.folder_name;
    localWatch = item.watch_status || '';
    confirmDelete = false;
  }

  $: activeTagSet = new Set(draftTags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));

  $: effectiveWatch = (() => {
    if (item.media_type === 'tv') {
        try {
        const eps = item.episodes_json ? JSON.parse(item.episodes_json) : [];
        if (eps.length > 0) return computeSeasonWatchStatus(eps);
        } catch (_) {}
    }
    return localWatch;
    })();

  function handleTrashClick() {
    if (!confirmDelete) {
      confirmDelete = true;
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirmDelete = false; }, 3200);
      return;
    }
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmDelete = false;
    onDelete?.();
  }

  async function openMovieFolder() {
    try {
      const baseRoot = getMediaRoot(item);
      const resolvedPath = await resolveLocalMediaPath(`${baseRoot}/${item.folder_name}`);
      await openPath(resolvedPath);
    } catch (err) {
      alert(`Could not open folder: ${err}`);
    }
  }

  async function setWatch(nextStatus) {
    localWatch = nextStatus;
    await onWatchStatus?.(item.folder_name, nextStatus);
  }

  async function copyImdb() {
    if (!item.imdb_id) return;
    try {
      await navigator.clipboard.writeText(imdbBase + item.imdb_id);
      copiedNote = true;
      setTimeout(() => copiedNote = false, 1400);
    } catch (_) {}
  }

  function toggleLookupBox() {
    queryTitle = item.title || '';
    queryYear = item.year || '';
    queryDirector = item.director || '';
    queryMediaType = item.media_type === 'tv' ? 'tv' : 'movie';
    showLookupBox = !showLookupBox;
  }

  async function openTagEditor() {
    draftTags = item.tags || '';
    draftClips = item.clips || '';
    editingTags = !editingTags;
    if (editingTags && suggestedTags.length === 0) {
      loadingTags = true;
      suggestedTags = await fetchMovieKeywords(item).catch(() => []);
      loadingTags = false;
    }
  }

  function toggleSuggestedTag(tag) {
    const current = draftTags.split(',').map(s => s.trim()).filter(Boolean);
    const lower = tag.toLowerCase();
    if (current.some(t => t.toLowerCase() === lower)) {
      draftTags = current.filter(t => t.toLowerCase() !== lower).join(', ');
    } else {
      draftTags = [...current, lower].join(', ');
    }
  }

  async function submitTags() {
    await onSaveTags?.(item.folder_name, draftTags, draftClips);
    editingTags = false;
  }

  function extractCardQuality(entry) {
    if (entry.quality?.trim()) return entry.quality.trim();
    const match = entry.folder_name?.match(/\[([^\]]+)\]/);
    return match && !match.at(1).startsWith('imdbid-') ? match.at(1).trim() : '';
  }

  $: tagList = (item.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  $: clipList = (item.clips || '').split(',').map(s => s.trim()).filter(Boolean);

  $: tvEpisodeCounts = (() => {
    if (item?.media_type !== 'tv' || !item?.episodes_json) return { owned: 0, total: 0 };
    try {
      const eps = JSON.parse(item.episodes_json);
      if (!Array.isArray(eps)) return { owned: 0, total: 0 };
      return { owned: eps.filter(e => Boolean(e.file_name)).length, total: eps.length };
    } catch (_) {
      return { owned: 0, total: 0 };
    }
  })();
  $: isIncompleteSeason = item?.media_type === 'tv' && tvEpisodeCounts.owned > 0 && (item?.status === 'wanted' || tvEpisodeCounts.owned < tvEpisodeCounts.total);
  $: fileExt = '';
  let extCheckedKey = '';
  $: if (onDrive && item?.folder_name && item.status !== 'wanted') {
    const k = `${item.folder_name}:${item.episodes_json || ''}`;
    if (k !== extCheckedKey) {
      extCheckedKey = k;
      getPrimaryVideoExt(item).then(ext => { fileExt = ext; });
    }
  } else {
    fileExt = '';
  }

  $: displayQuality = (() => {
    const ownQual = extractCardQuality(item);
    if (onDrive && item.status !== 'wanted') {
      const base = ownQual || '???';
      return fileExt ? `${base} ${fileExt}` : base;
    }
    return ownQual;
  })();
</script>

{#if layout === 'posters'}
  <button
    type="button"
    class="poster-tile"
    title="{item.title} ({item.year || 'n.d.'})"
    on:click={() => onOpenMovie?.(item)}
  >
    <div class="poster-frame">
      {#if item.poster_url}
        <img
          src={item.poster_url}
          alt={item.title}
          on:error={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      {:else}
        <div class="poster-tile-blank">{item.title}</div>
      {/if}
      {#if isIncompleteSeason}
        <span class="tile-badge tag-wanted">Incomplete</span>
      {:else if item.status === 'wanted'}
        <span class="tile-badge tag-wanted">Not Available</span>
      {:else if !onDrive}
        <span class="tile-badge tag-missing">Missing</span>
      {:else if displayQuality && displayQuality !== '???'}
        <span class="tile-badge">{displayQuality}</span>
      {:else if item.media_type === 'tv' && item.season_number}
        <span class="tile-badge">S{String(item.season_number).padStart(2, '0')}</span>
      {/if}
    </div>

    <div class="tile-caption">
    <strong>
        {item.title}
        {#if item.media_type === 'tv' && item.season_number} · S{String(item.season_number).padStart(2, '0')}{/if}
    </strong>
    <span class="mono">({item.year || 'n.d.'})</span>
    </div>

  </button>
{:else}
  <article
    class="catalog-entry"
    class:media-tv={item.media_type === 'tv'}
    class:media-movie={(item.media_type || 'movie') === 'movie'}
    class:flag-owned={onDrive && item.status !== 'wanted'}
    class:flag-missing={!onDrive && item.status !== 'wanted'}
    class:flag-wanted={item.status === 'wanted'}
  >
    <div class="entry-body">
      <button type="button" class="poster-btn" on:click={() => onOpenMovie?.(item)} title="Open movie details">
        {#if item.poster_url}
          <img
            src={item.poster_url}
            alt={item.title}
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
            class="title title-link-btn"
            on:click={() => onOpenMovie?.(item)}
            title="Open movie details"
          >
            {item.title || item.folder_name}
            {#if item.media_type === 'tv' && item.season_number}
              <span class="season-tag">· Season {item.season_number}</span>
            {/if}
          </button>
          <span class="mono">({item.year || 'n.d.'})</span>
        </div>

        <div class="badge-action-row">
          {#if isIncompleteSeason}
            <span class="tag tag-wanted">Incomplete</span>
          {:else if item.status === 'wanted'}
            <span class="tag tag-wanted">Not Available</span>
          {:else if !onDrive}
            <span class="tag tag-missing">Missing</span>
          {:else if displayQuality}
            <span class="tag">{displayQuality}</span>
          {/if}

          <div class="icon-actions">
            {#if copiedNote}<span class="copied-note">Copied</span>{/if}

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

            <button type="button" class="icon-btn" on:click={toggleLookupBox} title="Edit search & re-lookup metadata" aria-label="Lookup">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>

            {#if item.imdb_id}
              <button type="button" class="icon-btn" on:click={copyImdb} title="Copy IMDb link ({imdbBase + item.imdb_id})" aria-label="Copy IMDb link">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </button>
            {/if}

            <button type="button" class="icon-btn" on:click={openTagEditor} title="Edit Tags & Clips" aria-label="Tags">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
            </button>

            {#if onDrive && item.status !== 'wanted'}
              <button type="button" class="icon-btn" on:click={openMovieFolder} title="Open folder in Finder" aria-label="Open folder">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                on:click={() => playInVlc(item.folder_name, '', item.media_type === 'tv')}
                title="Play in VLC"
                aria-label="Play in VLC"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              </button>
            {/if}

            <span class="watch-triad">
              <button
                type="button"
                class="icon-btn"
                class:active-watch={(item.media_type === 'tv' ? effectiveWatch : localWatch) === ''}
                on:click|stopPropagation={() => setWatch('')}
                title="Unseen"
                aria-label="Mark Unseen"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                class:active-watch={(item.media_type === 'tv' ? effectiveWatch : localWatch) === 'liked'}
                on:click|stopPropagation={() => setWatch('liked')}
                title="Seen & Liked"
                aria-label="Mark Seen and Liked"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                class:active-watch={(item.media_type === 'tv' ? effectiveWatch : localWatch) === 'unfinished'}
                on:click|stopPropagation={() => setWatch('unfinished')}
                title="Unfinished"
                aria-label="Mark Unfinished"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                class:active-watch={(item.media_type === 'tv' ? effectiveWatch : localWatch) === 'disliked'}
                on:click|stopPropagation={() => setWatch('disliked')}
                title="Seen & Disliked"
                aria-label="Mark Seen and Disliked"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
              </button>
            </span>
          </div>
        </div>
            {#if item.director || item.cast_list}
            <div class="credits">
                {#if item.director}
                Dir.
                {#each item.director.split(',').map(s => s.trim()).filter(Boolean) as dir, idx}
                    {#if idx > 0}, {/if}
                    <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(dir)}>{dir}</button>
                {/each}
                {/if}
                {#if item.director && item.cast_list} · {/if}
                {#if item.cast_list}
                {#each item.cast_list.split(',').map(s => s.trim()).filter(Boolean) as actor, idx}
                    {#if idx > 0}, {/if}
                    <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(actor)}>{actor}</button>
                {/each}
                {/if}
            </div>
            {/if}

        {#if tagList.length > 0 || clipList.length > 0}
          <div class="taxonomy-rows">
            {#if tagList.length > 0}
              <div class="tax-line">
                <span class="tax-label">Tags:</span>
                {#each tagList as tag}
                  <button type="button" class="tax-pill" on:click={() => onTagClick?.(tag)}>{tag}</button>
                {/each}
              </div>
            {/if}
            {#if clipList.length > 0}
              <div class="tax-line">
                <span class="tax-label">Clips:</span>
                {#each clipList as clip}
                  <button type="button" class="tax-pill clip-pill" on:click={() => onTagClick?.(clip)}>{clip}</button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if editingTags}
          <form class="tag-editor" on:submit|preventDefault={submitTags}>
            <input type="text" placeholder="Tags (comma-separated: noir, space opera)" bind:value={draftTags} />

            {#if loadingTags}
              <div class="muted g-st-3a883c">Loading TMDb tags…</div>
            {:else if suggestedTags.length > 0}
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

            <input type="text" placeholder="Clips (comma-separated: nazi salute, beheading)" bind:value={draftClips} />
            <div class="editor-btns">
              <button type="submit" class="btn-save">Save</button>
              <button type="button" class="btn-cancel" on:click={() => editingTags = false}>Cancel</button>
            </div>
          </form>
        {/if}

        {#if layout === 'cards' && item.overview}
          <p class="synopsis">{item.overview}</p>
        {/if}
      </div>
    </div>

    {#if showLookupBox}
      <form class="relookup-bar" on:submit|preventDefault={() => onLookup?.(queryTitle, queryYear, queryDirector, queryMediaType)}>
        <input type="text" placeholder="Title" bind:value={queryTitle} />
        <input class="g-st-43ae34" type="number" placeholder="Year" bind:value={queryYear} />
        <input class="g-st-d44c18" type="text" placeholder="Director" bind:value={queryDirector} />
        <button
          type="button"
          class="btn-secondary"
          on:click={() => queryMediaType = queryMediaType === 'tv' ? 'movie' : 'tv'}
          title="Toggle Movie vs. TV lookup"
        >
          {queryMediaType === 'tv' ? 'TV' : 'Movie'}
        </button>
        <button type="submit" class="btn-save">TMDb</button>
        {#if onWikiLookup}
          <button type="button" class="btn-secondary" on:click={() => onWikiLookup?.(queryTitle, queryYear, queryDirector)}>Wiki</button>
        {/if}
        <button type="button" class="btn-cancel" on:click={() => showLookupBox = false}>Close</button>
      </form>
    {/if}

    {#if results}
      <div class="candidates">
        {#each results as match}
          <div
            class="candidate-row"
            role="button"
            tabindex="0"
            on:click={() => { onSelect(match); showLookupBox = false; }}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(match); showLookupBox = false; } }}
          >
            {#if match.poster_url || match.poster_path}
              <img src={match.poster_url || (posterSmall + match.poster_path)} alt={match.title} />
            {/if}
            <div class="candidate-info">
              <div>
                <strong>{match.title}</strong>
                {#if match.season_number}
                  <span class="tag">Season {match.season_number}</span>
                {/if}
                <span class="mono">({match.release_date?.slice(0, 4) || 'n.d.'})</span>
              </div>
              {#if match.media_type === 'tv' && match.seasons?.length > 0}
                <div class="season-badges g-st-ad95c7">
                  {#each match.seasons as sNum}
                    <button
                      type="button"
                      class="tax-pill season-pill"
                      on:click|stopPropagation={() => { onSelect({ ...match, season_number: sNum }); showLookupBox = false; }}
                    >
                      S{String(sNum).padStart(2, '0')}
                    </button>
                  {/each}
                </div>
              {/if}
              {#if match.director || match.cast_list}

                <div class="credits">
                  {#if match.director}
                    Dir.
                    {#each match.director.split(',').map(s => s.trim()).filter(Boolean) as dir, idx}
                      {#if idx > 0}, {/if}
                      <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(dir)}>{dir}</button>
                    {/each}
                  {/if}
                  {#if match.director && match.cast_list} · {/if}
                  {#if match.cast_list}
                    {#each match.cast_list.split(',').map(s => s.trim()).filter(Boolean) as actor, idx}
                      {#if idx > 0}, {/if}
                      <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(actor)}>{actor}</button>
                    {/each}
                  {/if}
                </div>
              {/if}
              {#if match.overview}<p class="synopsis">{match.overview}</p>{/if}
            </div>
          </div>
        {:else}
          <div class="empty-note">No matches found.</div>
        {/each}
      </div>
    {/if}
  </article>
{/if}
