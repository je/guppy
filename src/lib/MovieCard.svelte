<script>
  import { readDir } from '@tauri-apps/plugin-fs';
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import Icon from '$lib/Icon.svelte';
  import { computeSeasonWatchStatus } from '$lib/guppyStore.js';

  export let item;
  export let data;
  export let databaseEntries = [];
  export let loading = false;
  export let error = '';
  export let results = null;
  export let onLookup;
  export let onLookupMore = null;
  export let onRemove = null;
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
  let lookupQuery = '';
  let lastSyncedLookupKey = '';
  $: if (data && (item?.key || '') !== lastSyncedLookupKey) {
    lastSyncedLookupKey = item?.key || '';
    const t = data.title || '';
    const y = data.year ? ` (${data.year})` : '';
    const d = data.director ? ` [${data.director}]` : '';
    lookupQuery = `${t}${y}${d}`.trim();
  }
  function applyLookupQuery() {
    if (!data) return;
    let w = (lookupQuery || '').trim();
    let dir = '';
    w = w.replace(/\[([^\]]+)\]/g, (_, d) => { dir = d.trim(); return ' '; });
    let yr = '';
    w = w.replace(/\(\s*((?:19|20)\d{2})(?:\s*[-–]\s*(?:19|20)\d{2})?\s*\)/g, (_, y1) => { yr = y1; return ' '; });
    data.title = w.replace(/\s+/g, ' ').trim();
    data.year = yr;
    data.director = dir;
    onLookup?.();
  }

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
          {#if data}
            <input
              type="text"
              placeholder="Quality"
              bind:value={data.quality}
              title="File quality (e.g. 1080p, 720p, DVD)"
              style="width: 72px; height: 26px; padding: 0 6px; font-size: 0.78rem; background: #fff; border: 1px solid #b8b4a6; box-sizing: border-box;"
            />
          {/if}
          {#if item?.sourcePath}
            <button
              type="button"
              class="icon-btn"
              on:click={() => revealItemInDir(item.sourcePath).catch(() => {})}
              title="Reveal file/folder in Finder"
              aria-label="Reveal in Finder"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </button>
          {/if}
          {#if onRemove}
            <button
              type="button"
              class="icon-btn"
              on:click={onRemove}
              title="Remove from staged import"
              aria-label="Remove from staged import"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          {/if}
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

      <div class="controls" style="display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box;">
        <div style="display: flex; align-items: stretch; flex: 1; min-width: 0;">
          <button
            type="button"
            class="btn-secondary"
            style="display: inline-flex; align-items: center; justify-content: center; width: 32px; padding: 0; border-right: none; flex-shrink: 0;"
            on:click={() => {
              data.media_type = data.media_type === 'tv' ? 'movie' : 'tv';
              if (data.media_type === 'tv' && !data.season_number) data.season_number = 1;
            }}
            title={data.media_type === 'tv' ? 'TV Season (click to switch to Movie)' : 'Movie (click to switch to TV Season)'}
            aria-label={data.media_type === 'tv' ? 'TV Season' : 'Movie'}
          >
            <Icon name={data.media_type === 'tv' ? 'tv' : 'movie'} size={14} />
          </button>
          <input
            type="text"
            style="flex: 1; min-width: 160px; width: 100%;"
            placeholder="title (year) [director]"
            bind:value={lookupQuery}
            on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLookupQuery(); } }}
          />
        </div>

        {#if data.media_type === 'tv'}
          <input class="g-st-43ae34"
            type="number"
            min="1"
            placeholder="Season"
            bind:value={data.season_number}
            title="Season number"
          />
        {/if}

        <button type="button" class="btn-secondary" on:click={applyLookupQuery}>{loading ? 'Searching…' : 'Lookup'}</button>
        <button type="button" class="btn-secondary" on:click={onWikiLookup} title="Search Wikipedia">Wiki</button>
      </div>

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

      {#if data}
        <div class="tag-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin: 6px 0 0 0; box-sizing: border-box;">
          <input type="text" style="width: 100%; box-sizing: border-box;" placeholder="Tags before import (e.g. adult, noir, 4k)…" bind:value={data.tags} />
          <input type="text" style="width: 100%; box-sizing: border-box;" placeholder="Clips / scenes (optional)…" bind:value={data.clips} />
        </div>
      {/if}

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
      {#if results?.hasMoreMatches && onLookupMore}
        <div style="margin-top: 8px;">
          <button
            type="button"
            class="btn btn-sm"
            disabled={loading}
            on:click={() => onLookupMore((results?.length || 8) + 8)}
          >
            {loading ? 'Loading more…' : `Show more matches (${results.length} of ${results.totalRankedCount})`}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</article>
