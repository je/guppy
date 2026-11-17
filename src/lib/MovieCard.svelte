<script>
  export let item;
  export let data;
  export let loading = false;
  export let error = '';
  export let results = null;
  export let onLookup;
  export let onSelect;
  export let onSave;
  export let onPersonClick;
  export let onWikiLookup;

  const posterSmall = ["https:/", "image.tmdb.org", "t", "p", "w154"].join("/");

  function saveWithWatch(status) {
    data.watch_status = status;
    onSave?.();
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
        <div class="source-label">{item.isDirectory ? 'Folder' : 'File'}: <code>{item.name}</code></div>

        <span class="watch-triad">
          <button
            type="button"
            class="icon-btn"
            on:click={() => saveWithWatch('')}
            title="Save as Unseen"
            aria-label="Save as Unseen"
          >
            <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="#fffff8" stroke="#111" stroke-width="1.5" /></svg>
          </button>
          <button
            type="button"
            class="icon-btn"
            on:click={() => saveWithWatch('liked')}
            title="Save as Seen & Liked"
            aria-label="Save as Seen and Liked"
          >
            <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#2b7a3d" /></svg>
          </button>
          <button
            type="button"
            class="icon-btn"
            on:click={() => saveWithWatch('unfinished')}
            title="Save as Unfinished"
            aria-label="Save as Unfinished"
          >
            <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#8a8578" /></svg>
          </button>
          <button
            type="button"
            class="icon-btn"
            on:click={() => saveWithWatch('disliked')}
            title="Save as Seen & Disliked"
            aria-label="Save as Seen and Disliked"
          >
            <svg width="10" height="10" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#9e2a2b" /></svg>
          </button>
        </span>
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
          <input
            type="number"
            min="1"
            placeholder="Season"
            style="width: 68px;"
            bind:value={data.season_number}
            title="Season number"
          />
        {/if}

        <input type="number" placeholder="Year" style="width: 72px;" bind:value={data.year} />
        <input type="text" placeholder="Director" style="width: 140px;" bind:value={data.director} />
        <input type="text" placeholder="Quality" style="width: 105px;" bind:value={data.quality} />
        <button class="btn-secondary" on:click={onLookup}>{loading ? 'Searching…' : 'Lookup'}</button>
        <button class="btn-secondary" on:click={onWikiLookup} title="Search Wikipedia">Wiki</button>
      </div>


      {#if error}
        <div class="card-error">{error}</div>
      {/if}
    </div>
  </div>

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
              <div class="season-badges" style="margin: 4px 0;">
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
        <div class="empty-note">No matches returned. Edit fields above to log manually.</div>
      {/each}
    </div>
  {/if}
</article>
