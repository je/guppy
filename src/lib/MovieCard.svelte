<script>
  import { readDir } from '@tauri-apps/plugin-fs';
  import { computeSeasonWatchStatus } from '$lib/guppyStore.js';

  export let item;
  export let data;
  export let databaseEntries = [];
  export let loading = false;
  export let error = '';
  export let results = null;
  export let onLookup;
  export let onSelect;
  export let onSave;
  export let onPersonClick;
  export let onWikiLookup;

  const posterSmall = ["https:/", "image.tmdb.org", "t", "p", "w154"].join("/");
  const videoExts = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'ts', 'webm']);

  let scannedKey = '';
  let incomingByEp = new Map();

  function extractEpNum(fileName) {
    const noExt = fileName.replace(/\.[^.]+$/, '');
    const m = noExt.match(/s\d{1,2}[\s._-]*e(\d{1,3})/i)
      || noExt.match(/\b\d{1,2}x(\d{1,3})\b/i)
      || noExt.match(/\b(?:episode|ep|e)\.?\s*0*(\d{1,3})\b/i)
      || (!/^(?:19|20)\d{2}\b/.test(noExt.trim()) && noExt.trim().match(/^0*(\d{1,3})(?:[\s._-]+|$)/));
    const num = m ? Number(m.at(1)) : 0;
    return Number.isInteger(num) && num > 0 ? num : 0;
  }

  function extractFileQuality(fileName) {
    const q = fileName.match(/\b(2160p|4k|1080p|720p|576p|480p|web-?dl|webrip|bluray|bdrip|dvdrip|hdtv)\b/i);
    return q ? q.at(1).toUpperCase() : '';
  }

  async function scanIncomingFiles(itm) {
    const map = new Map();
    let fileNames = [];
    if (Array.isArray(itm?.files) && itm.files.length > 0) {
      fileNames = itm.files.map(f => f.name);
    } else if (itm?.isDirectory && itm?.sourcePath) {
      const entries = await readDir(itm.sourcePath).catch(() => []);
      fileNames = entries.filter(e => e.isFile && !e.name.startsWith('.')).map(e => e.name);
    } else if (itm?.name) {
      fileNames = Array.of(itm.name);
    }

    for (const name of fileNames) {
      const dotIdx = name.lastIndexOf('.');
      if (dotIdx === -1) continue;
      const ext = name.slice(dotIdx + 1).toLowerCase();
      if (!videoExts.has(ext)) continue;
      const epNum = extractEpNum(name);
      if (epNum > 0 && !map.has(epNum)) {
        map.set(epNum, { file_name: name, quality: extractFileQuality(name) });
      }
    }
    incomingByEp = map;
  }

  $: if (data?.media_type === 'tv' && item?.key && item.key !== scannedKey) {
    scannedKey = item.key;
    scanIncomingFiles(item);
  }

  $: isTv = data?.media_type === 'tv';
  $: seasonNum = Number(data?.season_number) || 1;
  $: existingSeason = isTv && data?.title
    ? databaseEntries.find(d =>
        d.media_type === 'tv' &&
        Number(d.season_number) === seasonNum &&
        ((data.tmdb_id && Number(d.tmdb_id) === Number(data.tmdb_id)) ||
          d.title?.toLowerCase().trim() === data.title?.toLowerCase().trim())
      ) || null
    : null;

  $: existingEpMap = (() => {
    const map = new Map();
    if (!existingSeason?.episodes_json) return map;
    try {
      const parsed = JSON.parse(existingSeason.episodes_json);
      for (const ep of parsed) {
        map.set(Number(ep.episode_number), ep);
      }
    } catch (_) {}
    return map;
  })();

  let hydratedSeasonKey = '';
  $: if (isTv && existingSeason && Array.isArray(data?.episodes) && data.episodes.length > 0) {
    const syncKey = `${item?.key || ''}:${existingSeason.folder_name}:${data.episodes.length}`;
    if (syncKey !== hydratedSeasonKey) {
      hydratedSeasonKey = syncKey;
      data.episodes = data.episodes.map(ep => {
        const dbEp = existingEpMap.get(Number(ep.episode_number));
        return dbEp?.watch_status ? { ...ep, watch_status: dbEp.watch_status } : ep;
      });
    }
  }

  $: seasonEpisodes = Array.isArray(data?.episodes) ? data.episodes : [];
  $: newImportableCount = isTv
    ? seasonEpisodes.filter(ep => {
        const num = Number(ep.episode_number);
        const inc = incomingByEp.has(num);
        const alreadyOwned = Boolean(existingEpMap.get(num)?.file_name);
        return inc && !alreadyOwned;
      }).length
    : 0;

  $: matchedSeasonEpisodes = seasonEpisodes
    .filter(ep => incomingByEp.has(Number(ep.episode_number)))
    .map(ep => ({ ...ep, file_name: incomingByEp.get(Number(ep.episode_number)).file_name }));

  $: combinedSeasonEpisodes = seasonEpisodes.map(ep => {
    const num = Number(ep.episode_number);
    const dbEp = existingEpMap.get(num);
    const alreadyOwned = Boolean(dbEp?.file_name);
    const inc = incomingByEp.get(num);
    if (alreadyOwned) {
      return { ...ep, file_name: dbEp.file_name, watch_status: dbEp.watch_status || '' };
    }
    if (inc) {
      return { ...ep, file_name: inc.file_name, watch_status: ep.watch_status || '' };
    }
    return { ...ep, file_name: '', watch_status: ep.watch_status || '' };
  });

  $: seasonRolledWatch = isTv && combinedSeasonEpisodes.length > 0
    ? computeSeasonWatchStatus(combinedSeasonEpisodes)
    : (data?.watch_status || '');

  let seasonPickerOpen = false;
  let showImportTags = false;

  function handleTopWatchClick(status) {
    if (!isTv) {
      data.watch_status = status;
      onSave?.();
      return;
    }

    data.watch_status = status;
    if (seasonEpisodes.length > 0) {
      data.episodes = seasonEpisodes.map(ep => {
        const num = Number(ep.episode_number);
        const alreadyOwned = Boolean(existingEpMap.get(num)?.file_name);
        const isIncoming = incomingByEp.has(num);
        return (!alreadyOwned && isIncoming) ? { ...ep, watch_status: status } : ep;
      });
    }
    seasonPickerOpen = false;
  }

  function setSingleEpisodeWatch(epNum, status) {
    if (!Array.isArray(data?.episodes)) return;
    data.episodes = data.episodes.map(ep =>
      Number(ep.episode_number) === Number(epNum) ? { ...ep, watch_status: status } : ep
    );
  }
</script>

<article class="entry-row" class:is-ready={Boolean(data?.poster_url || data?.imdb_id || data?.overview)}>
  <div class="row-main">
    {#if data?.poster_url}
      <img src={data.poster_url} alt="Poster" class="poster" />
    {:else}
      <div class="poster-blank">No Poster</div>
    {/if}

    <div class="row-content">
      <div class="source-top-row">
        <div class="source-label">
          {item.isDirectory ? 'Folder' : 'File'}: <code>{item.name}</code>
          {#if isTv && existingSeason}
            {#if existingSeason.status === 'wanted'}
              <span class="tag tag-wanted g-st-e3ec32">Season Wanted in Library</span>
            {:else}
              <span class="tag g-st-e3ec32">Season Already Logged</span>
            {/if}
          {/if}
        </div>

        <div class="icon-actions">
          <button
            type="button"
            class="icon-btn"
            on:click={() => showImportTags = !showImportTags}
            title="Set Tags & Clips before importing"
            aria-label="Set Tags & Clips"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
          </button>
          {#if isTv && !seasonPickerOpen}
            <button
              type="button"
              class="icon-btn"
              disabled={newImportableCount === 0}
              on:click={() => { if (newImportableCount > 0) seasonPickerOpen = true; }}
              title={newImportableCount === 0
                ? `Season status: ${seasonRolledWatch || 'Unseen'}`
                : `Season status: ${seasonRolledWatch || 'Unseen'} (click to set status for all ${newImportableCount} importing episodes)`}
              aria-label="Season watch status"
            >
              {#if seasonRolledWatch === 'liked'}
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
              {:else if seasonRolledWatch === 'unfinished'}
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
              {:else if seasonRolledWatch === 'disliked'}
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
              {:else}
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
              {/if}
            </button>
          {:else}
            <span class="watch-triad">
              <button
                type="button"
                class="icon-btn"
                on:click={() => handleTopWatchClick('')}
                title={isTv ? 'Set all importing episodes to Unseen' : 'Save as Unseen'}
                aria-label="Unseen"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                on:click={() => handleTopWatchClick('liked')}
                title={isTv ? 'Set all importing episodes to Seen & Liked' : 'Save as Seen and Liked'}
                aria-label="Seen and Liked"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                on:click={() => handleTopWatchClick('unfinished')}
                title={isTv ? 'Set all importing episodes to Unfinished' : 'Save as Unfinished'}
                aria-label="Unfinished"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                on:click={() => handleTopWatchClick('disliked')}
                title={isTv ? 'Set all importing episodes to Seen & Disliked' : 'Save as Seen and Disliked'}
                aria-label="Seen and Disliked"
              >
                <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
              </button>
            </span>
          {/if}

          {#if isTv}
            <button
              type="button"
              class="icon-btn"
              disabled={newImportableCount === 0}
              on:click={() => onSave?.()}
              title={newImportableCount === 0 ? 'Nothing new to import — all matched episodes are already in library' : `Import ${newImportableCount} new ${newImportableCount === 1 ? 'episode' : 'episodes'}`}
              aria-label="Import TV Season"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          {/if}
        </div>

      </div>

      {#if showImportTags || data?.tags || data?.clips}
        <div class="tag-editor" style="margin: 6px 0;">
          <div class="tag-row">
            <input type="text" placeholder="Tags before import (e.g. adult, noir, 4k)…" bind:value={data.tags} />
            <input type="text" placeholder="Clips / scenes (optional)…" bind:value={data.clips} />
          </div>
        </div>
      {/if}

      {#if data?.director || data?.cast_list}
        <div class="credits">
          {#if data.director}
            Dir.
            {#each data.director.split(',').map(s => s.trim()).filter(Boolean) as dir, idx}
              {#if idx > 0}, {/if}
              <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(dir)}>{dir}</button>
            {/each}
          {/if}
          {#if data.director && data.cast_list} · {/if}
          {#if data.cast_list}
            {#each data.cast_list.split(',').map(s => s.trim()).filter(Boolean) as actor, idx}
              {#if idx > 0}, {/if}
              <button type="button" class="person-link" on:click|stopPropagation={() => onPersonClick?.(actor)}>{actor}</button>
            {/each}
          {/if}
          {#if data.imdb_id} · <span class="mono">{data.imdb_id}</span>{/if}
        </div>
      {/if}

      {#if data?.overview}
        <p class="synopsis">{data.overview}</p>
      {/if}

      <div class="controls">
        <button
          type="button"
          class="btn-secondary"
          on:click={() => {
            data.media_type = data.media_type === 'tv' ? 'movie' : 'tv';
            if (data.media_type === 'tv' && !data.season_number) data.season_number = 1;
          }}
          title="Toggle Movie vs. TV Season"
        >
          {data.media_type === 'tv' ? 'TV' : 'Movie'}
        </button>

        <input type="text" placeholder={data.media_type === 'tv' ? 'Show Title' : 'Title'} bind:value={data.title} />

        {#if data.media_type === 'tv'}
          <input class="g-st-43ae34"
            type="number"
            min="1"
            placeholder="Season"
           
            bind:value={data.season_number}
            title="Season number"
          />
        {/if}

        <input class="g-st-2dd1f7" type="number" placeholder="Year" bind:value={data.year} />
        <input class="g-st-90f955" type="text" placeholder="Director" bind:value={data.director} />
        <input class="g-st-7e5dde" type="text" placeholder="Quality" bind:value={data.quality} />
        <button class="btn-secondary" on:click={onLookup}>{loading ? 'Searching…' : 'Lookup'}</button>
        <button class="btn-secondary" on:click={onWikiLookup} title="Search Wikipedia">Wiki</button>
      </div>

      {#if error}
        <div class="card-error">{error}</div>
      {/if}
    </div>
  </div>

  {#if isTv && seasonEpisodes.length > 0}
    <div class="sub-block g-st-d88c72">
      <div class="g-st-ecac07">
        Episodes ({newImportableCount} new to import · {matchedSeasonEpisodes.length} of {seasonEpisodes.length} in folder)
      </div>
      <div class="episode-list">
        {#each seasonEpisodes as ep (ep.episode_number)}
          {@const epNum = Number(ep.episode_number)}
          {@const inc = incomingByEp.get(epNum)}
          {@const dbEp = existingEpMap.get(epNum)}
          {@const alreadyOwned = Boolean(dbEp?.file_name)}
          {@const epWatch = alreadyOwned ? (dbEp.watch_status || '') : (ep.watch_status || '')}
          {@const epQual = inc?.quality || data?.quality?.trim() || ''}
          <div class="episode-row" class:ep-missing={!inc && !alreadyOwned}>
            <div class="episode-top">
              <div>
                <span class="mono">S{String(seasonNum).padStart(2, '0')}E{String(epNum).padStart(2, '0')}</span>
                <strong>{ep.name}</strong>
                {#if alreadyOwned && inc}
                  <span class="tag tag-missing g-st-e3ec32" title="Already on drive as {dbEp.file_name}">Already Owned · Duplicate</span>
                {:else if alreadyOwned}
                  <span class="tag g-st-e3ec32" title="On drive as {dbEp.file_name}">Already Owned</span>
                {:else if inc}
                  <span class="tag g-st-e3ec32" title={inc.file_name}>New · {epQual || 'Matched'}</span>
                {:else}
                  <span class="tag tag-wanted g-st-e3ec32">Missing</span>
                {/if}
              </div>

              {#if alreadyOwned}
                <span title="Existing library status: {epWatch || 'Unseen'}">
                  {#if epWatch === 'liked'}
                    <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                  {:else if epWatch === 'unfinished'}
                    <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                  {:else if epWatch === 'disliked'}
                    <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                  {:else}
                    <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
                  {/if}
                </span>
              {:else}
                <span class="watch-triad">
                  <button
                    type="button"
                    class="icon-btn"
                    class:active-watch={epWatch === ''}
                    on:click={() => setSingleEpisodeWatch(epNum, '')}
                    title="Unseen"
                    aria-label="Mark Episode Unseen"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    class:active-watch={epWatch === 'liked'}
                    on:click={() => setSingleEpisodeWatch(epNum, 'liked')}
                    title="Seen & Liked"
                    aria-label="Mark Episode Seen and Liked"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    class:active-watch={epWatch === 'unfinished'}
                    on:click={() => setSingleEpisodeWatch(epNum, 'unfinished')}
                    title="Unfinished"
                    aria-label="Mark Episode Unfinished"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    class:active-watch={epWatch === 'disliked'}
                    on:click={() => setSingleEpisodeWatch(epNum, 'disliked')}
                    title="Seen & Disliked"
                    aria-label="Mark Episode Seen and Disliked"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
                  </button>
                </span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if results}
    <div class="candidates">
      <div class="candidates-head">Select a match to attach metadata:</div>
      {#each results as match}
        <div
          class="candidate-row"
          role="button"
          tabindex="0"
          on:click={() => onSelect(match)}
          on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(match); } }}
        >
          {#if match.poster_url || match.poster_path}
            <img src={match.poster_url || (posterSmall + match.poster_path)} alt={match.title} />
          {/if}
          <div class="candidate-info">
            <div class="candidate-title">
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
                    on:click|stopPropagation={() => onSelect({ ...match, season_number: sNum })}
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

            {#if match.overview}
              <p class="synopsis">{match.overview}</p>
            {/if}
          </div>
        </div>
      {:else}
        <div class="manual-meta-box">
          <div class="empty-note">No matches returned. Fill in optional details below and click a status dot above to log manually:</div>
          <div class="controls g-st-f254cb">
            <input class="g-st-063e42" type="text" placeholder="Cast (comma-separated)" bind:value={data.cast_list} />
            <input class="g-st-063e42" type="text" placeholder="Poster URL (optional)" bind:value={data.poster_url} />
          </div>
          <div class="controls g-st-f254cb">
            <input class="g-st-be70d9" type="text" placeholder="Synopsis / Overview (optional)" bind:value={data.overview} />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</article>
