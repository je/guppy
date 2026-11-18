<script>
  import '$lib/guppy.css';
  import { onMount } from 'svelte';
  import { writeTextFile, readDir } from '@tauri-apps/plugin-fs';
  import { save, open } from '@tauri-apps/plugin-dialog';
  import MovieCard from '$lib/MovieCard.svelte';
  import CollectionView from '$lib/CollectionView.svelte';
  import AuditorView from '$lib/AuditorView.svelte';
  import PersonView from '$lib/PersonView.svelte';
  import MovieDetailView from '$lib/MovieDetailView.svelte';
  import SearchResultsView from '$lib/SearchResultsView.svelte';
  import { MEDIA_ROOT, TV_ROOT, VIDEO_EXTS, initDb, inferMetadata, inferFolder, searchTmdb, searchWikipediaMovie, fetchPersonFilmography, fetchEnrichedMovie, saveToLibrary, saveWantedMovie, updateExistingMovie, updateMovieTagsAndClips, syncAllJellyfinSidecars, removeMovieFromLibrary, updateMovieWatchStatus, searchUniversal, searchTmdbTv, fetchTvSeasonDetails, saveTvSeasonToLibrary, saveWantedTvSeason, updateSeasonEpisodes, computeSeasonWatchStatus, parseLooseTvFilename, exportCatalogToJson } from '$lib/guppyStore.js';

  let viewMode = 'collection';
  let previousView = 'split';
  let showAddForm = false;
  let diskFolders = [];
  let orphans = [];
  let databaseEntries = [];
  let importQueue = [];
  let inputs = { wishlist: { title: '', year: '', director: '', quality: '', poster_url: '', imdb_id: '', cast_list: '', overview: '' } };
  let searchResults = {};
  let loadingLookup = {};
  let activePersonData = null;
  let loadingPerson = false;
  let statusMsg = '';
  let personQuery = '';
  let showBulkForm = false;
  let showAdultOnly = false;
  let adultHoldRaf = null;
  let adultProgress = 0;
  let universalResults = null;
  let loadingUniversal = false;
  let viewHistory = [];
  let activeMovie = null;

  async function runUniversalSearch(query) {
    const q = (query || '').trim();
    if (!q) return;
    viewHistory = [];
    viewMode = 'search';
    loadingUniversal = true;
    try {
      universalResults = await searchUniversal(q);
    } catch (err) {
      statusMsg = `Search failed: ${err}`;
    } finally {
      loadingUniversal = false;
    }
  }

  function startAdultHold() {
    if (showAdultOnly) {
      showAdultOnly = false;
      adultProgress = 0;
      return;
    }
    if (adultHoldRaf) cancelAnimationFrame(adultHoldRaf);
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;
      adultProgress = Math.min(1, elapsed / 5000);
      if (adultProgress >= 1) {
        showAdultOnly = true;
        adultProgress = 0;
        adultHoldRaf = null;
      } else {
        adultHoldRaf = requestAnimationFrame(tick);
      }
    };
    adultHoldRaf = requestAnimationFrame(tick);
  }

  function cancelAdultHold() {
    if (adultHoldRaf) {
      cancelAnimationFrame(adultHoldRaf);
      adultHoldRaf = null;
    }
    adultProgress = 0;
  }

  async function runAudit() {
    try {
      const db = await initDb();
      const movieEntries = await readDir(MEDIA_ROOT);
      const movieFolders = movieEntries
        .filter(e => e.isDirectory && !e.name.startsWith('.') && e.name !== 'deleted')
        .map(e => e.name)
        .sort();

      const tvEntries = await readDir(TV_ROOT).catch(() => []);
      const tvFolders = tvEntries
        .filter(e => e.isDirectory && !e.name.startsWith('.') && e.name !== 'deleted')
        .map(e => e.name)
        .sort();

      diskFolders = [...new Set([...movieFolders, ...tvFolders])].sort();
      databaseEntries = await db.select("SELECT * FROM wishlist_videos ORDER BY title ASC");
      const inDb = databaseEntries.map(r => r.folder_name);
      orphans = movieFolders.filter(f => !inDb.includes(f));

      const nextInputs = { ...inputs };
      for (const folder of orphans) {
        const key = `root:${folder}`;
        if (!Reflect.get(nextInputs, key)) Reflect.set(nextInputs, key, await inferFolder(`${MEDIA_ROOT}/${folder}`, folder));
      }
      inputs = nextInputs;
      statusMsg = '';
    } catch (err) { statusMsg = `Scan error: ${err}`; }
  }

  async function pickImportFolder() {
    try {
      const selected = await open({ directory: true, multiple: false, defaultPath: "/Volumes/4TB0-SEAGATE" });
      if (!selected) return;
      const entries = await readDir(selected);
      const items = [];
      const looseTvGroups = new Map();
      const nextInputs = { ...inputs };

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const isVideo = !entry.isDirectory && VIDEO_EXTS.some(ext => entry.name.toLowerCase().endsWith(ext));
        if (!entry.isDirectory && !isVideo) continue;

        if (!entry.isDirectory) {
          const parsedTv = parseLooseTvFilename(entry.name);
          if (parsedTv) {
            if (!looseTvGroups.has(parsedTv.normKey)) {
              looseTvGroups.set(parsedTv.normKey, {
                parsedTv,
                files: []
              });
            }
            looseTvGroups.get(parsedTv.normKey).files.push({
              name: entry.name,
              sourcePath: `${selected}/${entry.name}`
            });
            continue;
          }
        }

        const key = `import:${entry.name}`;
        items.push({ key, name: entry.name, isDirectory: entry.isDirectory, sourcePath: `${selected}/${entry.name}` });
        if (!Reflect.get(nextInputs, key)) {
          Reflect.set(
            nextInputs,
            key,
            entry.isDirectory ? await inferFolder(`${selected}/${entry.name}`, entry.name) : inferMetadata(entry.name)
          );
        }
      }

      for (const [normKey, group] of looseTvGroups.entries()) {
        const { parsedTv, files } = group;
        const sPad = String(parsedTv.season_number).padStart(2, '0');
        const label = `${parsedTv.title} - s${sPad} (${files.length} ${files.length === 1 ? 'episode' : 'episodes'})`;
        const key = `import:tv:${normKey}`;
        items.push({
          key,
          name: label,
          isDirectory: false,
          sourcePath: files.at(0).sourcePath,
          files
        });
        if (!Reflect.get(nextInputs, key)) {
          Reflect.set(nextInputs, key, {
            title: parsedTv.title,
            year: parsedTv.year,
            director: '',
            quality: '',
            media_type: 'tv',
            season_number: parsedTv.season_number,
            watch_status: ''
          });
        }
      }

      items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      inputs = nextInputs;
      importQueue = items;
      viewMode = 'split';

      for (let i = 0; i < items.length; i += 3) {
        await Promise.all(items.slice(i, i + 3).map(item => handleLookup(item.key)));
      }
    } catch (err) { statusMsg = `Import error: ${err}`; }
  }


  async function handleLookup(key, t = '', y = '', d = '') {
    const cur = Reflect.get(inputs, key);
    const dbItem = key.startsWith('db:')
      ? databaseEntries.find(item => `db:${item.folder_name}` === key)
      : null;
    const isTv = cur?.media_type === 'tv' || dbItem?.media_type === 'tv';

    const title = t || cur?.title || dbItem?.title;
    const year = y || cur?.year || dbItem?.year;
    const director = d || cur?.director || dbItem?.director;
    if (!title && !year && !director) { statusMsg = "Enter a Title, Year, or Director first."; return; }
    loadingLookup = { ...loadingLookup, [key]: true };
    statusMsg = '';
    try {
      const res = isTv
        ? await searchTmdbTv(title, year)
        : await searchTmdb(title, year, director);
      searchResults = { ...searchResults, [key]: res };
    } catch (err) { statusMsg = `Lookup failed: ${err}`; }
    finally { loadingLookup = { ...loadingLookup, [key]: false }; }
  }



  async function handleWikiLookup(key, t = '', y = '', d = '') {
    const cur = Reflect.get(inputs, key);
    const title = t || cur?.title;
    const year = y || cur?.year;
    const director = d || cur?.director;
    if (!title) { statusMsg = "Enter a Title first for Wikipedia lookup."; return; }
    loadingLookup = { ...loadingLookup, [key]: true };
    statusMsg = '';
    try {
      const res = await searchWikipediaMovie(title, year, director);
      searchResults = { ...searchResults, [key]: res };
    } catch (err) { statusMsg = `Wikipedia lookup failed: ${err}`; }
    finally { loadingLookup = { ...loadingLookup, [key]: false }; }
  }


  async function handleSelect(key, movie) {
    const cur = Reflect.get(inputs, key) || {};

    if (movie.media_type === 'tv') {
      const seasonNum = Number(movie.season_number) || Number(cur.season_number) || 1;
      loadingLookup = { ...loadingLookup, [key]: true };
      try {
        const seasonData = await fetchTvSeasonDetails(movie.id, seasonNum);
        inputs = {
          ...inputs,
          [key]: {
            ...cur,
            ...movie,
            media_type: 'tv',
            tmdb_id: movie.id,
            season_number: seasonNum,
            title: movie.title,
            year: seasonData.air_date
              ? Number(seasonData.air_date.slice(0, 4))
              : (movie.release_date ? Number(movie.release_date.slice(0, 4)) : cur.year || ''),
            quality: cur.quality || '',
            poster_url: seasonData.poster_url || movie.poster_url || '',
            overview: seasonData.overview || movie.overview || '',
            cast_list: seasonData.cast_list || '',
            imdb_id: seasonData.imdb_id || '',
            air_date: seasonData.air_date || '',
            episodes: seasonData.episodes || []
          }
        };
        const next = { ...searchResults };
        Reflect.deleteProperty(next, key);
        searchResults = next;
      } catch (err) {
        saveErrors = { ...saveErrors, [key]: `Season lookup failed: ${err}` };
      } finally {
        loadingLookup = { ...loadingLookup, [key]: false };
      }
      return;
    }

    inputs = { ...inputs, [key]: { ...movie, year: movie.year || cur.year || '', quality: cur.quality || '' } };
    const next = { ...searchResults };
    Reflect.deleteProperty(next, key);
    searchResults = next;
  }

  let saveErrors = {};

  async function handleSave(item) {
    const entry = Reflect.get(inputs, item.key);
    if (!entry?.title || !entry?.year) {
      saveErrors = { ...saveErrors, [item.key]: "Enter both Title and Year." };
      return;
    }
    if (Reflect.get(searchResults, item.key)?.length > 0 && !entry.poster_url && !entry.imdb_id) {
      saveErrors = { ...saveErrors, [item.key]: "Select a match below first." };
      return;
    }
    saveErrors = { ...saveErrors, [item.key]: '' };
    try {
      if (entry.media_type === 'tv') {
        await saveTvSeasonToLibrary(item, entry);
      } else {
        await saveToLibrary(item, entry);
      }
      const nextErrors = { ...saveErrors };
      delete nextErrors[item.key];
      saveErrors = nextErrors;
      importQueue = importQueue.filter(q => q.key !== item.key);
      await runAudit();
    } catch (err) {
      saveErrors = { ...saveErrors, [item.key]: String(err?.message || err) };
    }
  }

  function clearAddForm() {
    inputs = {
      ...inputs,
      wishlist: { title: '', year: '', director: '', quality: '', poster_url: '', imdb_id: '', cast_list: '', overview: '' }
    };
    const nextResults = { ...searchResults };
    Reflect.deleteProperty(nextResults, 'wishlist');
    searchResults = nextResults;
    statusMsg = '';
  }

  async function handleUpdate(oldFolder, movie) {
    try {
      const existing = databaseEntries.find(e => e.folder_name === oldFolder);
      const isTv = movie.media_type === 'tv' || existing?.media_type === 'tv';

      if (isTv) {
        const seasonNum = Number(movie.season_number) || Number(existing?.season_number) || 1;

        let tvId = Number(movie.media_type === 'tv' ? movie.id : existing?.tmdb_id) || 0;

        if (!tvId && movie.title) {
          const tvMatches = await searchTmdbTv(movie.title, movie.year || existing?.year || '').catch(() => []);
          tvId = Number(tvMatches.at(0)?.id) || 0;
        }

        const seasonData = tvId
          ? await fetchTvSeasonDetails(tvId, seasonNum).catch(() => ({}))
          : {};

        const prevEpisodes = (() => {
          try {
            return existing?.episodes_json ? JSON.parse(existing.episodes_json) : [];
          } catch (_) {
            return [];
          }
        })();
        const prevByNum = new Map(prevEpisodes.map(ep => [Number(ep.episode_number), ep]));

        const mergedEpisodes = seasonData.episodes?.length > 0
          ? seasonData.episodes.map(freshEp => {
              const oldEp = prevByNum.get(Number(freshEp.episode_number)) || {};
              return {
                ...freshEp,
                file_name: oldEp.file_name || '',
                watch_status: oldEp.watch_status || '',
                tags: oldEp.tags || '',
                clips: oldEp.clips || ''
              };
            })
          : prevEpisodes;

        const rolledWatch = computeSeasonWatchStatus(mergedEpisodes);
        const db = await initDb();
        const seasonYear = seasonData.air_date
          ? Number(seasonData.air_date.slice(0, 4))
          : (movie.release_date ? Number(movie.release_date.slice(0, 4)) : (Number(movie.year) || existing?.year || 0));
        const posterUrl = seasonData.poster_url || movie.poster_url || existing?.poster_url || '';
        const overview = seasonData.overview || movie.overview || existing?.overview || '';
        const castList = seasonData.cast_list || movie.cast_list || existing?.cast_list || '';
        const imdbId = seasonData.imdb_id || movie.imdb_id || existing?.imdb_id || '';

        await db.execute(
          `UPDATE wishlist_videos
           SET title = ?, year = ?, poster_url = ?, overview = ?, cast_list = ?, imdb_id = ?, tmdb_id = ?, episodes_json = ?, watch_status = ?, media_type = 'tv', season_number = ?
           WHERE folder_name = ?`,
          [movie.title, seasonYear, posterUrl, overview, castList, imdbId, tvId, JSON.stringify(mergedEpisodes), rolledWatch, seasonNum, oldFolder]
        );

        if (existing?.status !== 'wanted' && diskFolders.includes(oldFolder)) {
          await writeJellyfinTvSidecars(`${TV_ROOT}/${oldFolder}`, {
            ...existing,
            title: movie.title,
            year: seasonYear,
            poster_url: posterUrl,
            overview,
            season_number: seasonNum
          }, mergedEpisodes);
        }

        const next = { ...searchResults };
        Reflect.deleteProperty(next, `db:${oldFolder}`);
        searchResults = next;
        await runAudit();
        return;
      }


      await updateExistingMovie(oldFolder, existing, movie, diskFolders.includes(oldFolder));
      const next = { ...searchResults };
      Reflect.deleteProperty(next, `db:${oldFolder}`);
      searchResults = next;
      await runAudit();
    } catch (err) { statusMsg = `Update failed: ${err}`; }
  }


  async function handleDelete(folderName) {
    try {
      const isOnDisk = diskFolders.includes(folderName);
      await removeMovieFromLibrary(folderName, isOnDisk);
      await runAudit();
    } catch (err) {
      statusMsg = `Remove failed: ${err}`;
    }
  }

  function navigateTo(nextMode) {
    if (viewMode && viewMode !== nextMode) {
      viewHistory = [...viewHistory, viewMode];
    }
    viewMode = nextMode;
  }

  let personReqId = 0;

  async function openPersonPage(name, personId = null) {
    const cleanName = (name || '').trim();
    if (!cleanName && !personId) return;

    const reqId = ++personReqId;
    const prevQueryName = activePersonData?.queryName;
    if (viewMode !== 'person') {
      viewHistory = [...viewHistory, viewMode];
    }
    activePersonData = { name: cleanName, queryName: cleanName, directed: [], acted: [], tvShows: [], matches: [] };
    loadingPerson = true;
    statusMsg = '';
    viewMode = 'person';

    try {
      const searchTerm = personId && prevQueryName ? prevQueryName : cleanName;
      const data = await fetchPersonFilmography(searchTerm, personId);
      if (reqId !== personReqId) return;
      activePersonData = { ...data, queryName: searchTerm };
    } catch (err) {
      if (reqId !== personReqId) return;
      statusMsg = `Person lookup failed: ${err}`;
    } finally {
      if (reqId === personReqId) loadingPerson = false;
    }
  }

  function goBack() {
    personReqId++;
    loadingPerson = false;
    while (viewHistory.length > 0) {
      const prev = viewHistory.at(-1);
      viewHistory = viewHistory.slice(0, -1);
      if (prev && prev !== viewMode) {
        viewMode = prev;
        return;
      }
    }
    viewMode = 'collection';
  }


  function openMoviePage(movie) {
    if (!movie) return;
    if (viewMode !== 'movie') {
      viewHistory = [...viewHistory, viewMode];
    }

    const dbMatch = movie.folder_name
      ? databaseEntries.find(e => e.folder_name === movie.folder_name)
      : databaseEntries.find(
          e => (e.media_type || 'movie') === (movie.media_type || 'movie') &&
            e.title?.toLowerCase() === movie.title?.toLowerCase() &&
            (!movie.year || String(e.year) === String(movie.year)) &&
            (!movie.season_number || Number(e.season_number) === Number(movie.season_number))
        );

    if (dbMatch) {
      activeMovie = dbMatch;
    } else {
      activeMovie = {
        ...movie,
        folder_name: '',
        status: 'unlogged',
        tmdb_id: movie.tmdb_id || movie.id || 0,
        media_type: movie.media_type || 'movie',
        season_number: movie.season_number || (movie.media_type === 'tv' ? 1 : null),
        watch_status: ''
      };
    }
    viewMode = 'movie';
  }



  async function handleSaveTags(folderName, tags, clips) {
    await updateMovieTagsAndClips(folderName, tags, clips);
    await runAudit();
  }

  let syncStatus = '';

  async function handleSyncSidecars() {
    syncStatus = 'Writing NFOs…';
    statusMsg = '';
    try {
      const res = await syncAllJellyfinSidecars(diskFolders, (done, total) => {
        syncStatus = `Writing NFOs (${done}/${total})…`;
      });
      statusMsg = `Wrote movie.nfo & poster.jpg for ${res.written} of ${res.total} folders.${res.firstError ? ` Note: ${res.firstError}` : ''}`;
    } catch (err) {
      statusMsg = `NFO sync failed: ${err}`;
    } finally {
      syncStatus = '';
    }
  }

  async function handleExportJson() {
    try {
      const dateStamp = new Date().toISOString().slice(0, 10);
      const filePath = await save({
        defaultPath: `/Volumes/4TB0-SEAGATE/guppy-catalog-${dateStamp}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!filePath) return;

      statusMsg = 'Exporting catalog JSON…';
      const payload = await exportCatalogToJson();
      await writeTextFile(filePath, JSON.stringify(payload, null, 2));
      statusMsg = `Exported ${payload.total_entries} titles to ${filePath}`;
      setTimeout(() => { if (statusMsg.startsWith('Exported ')) statusMsg = ''; }, 4000);
    } catch (err) {
      statusMsg = `Export failed: ${err}`;
    }
  }

  let watchFilter = 'all'; // 'all' | 'unseen' | 'liked' | 'disliked' | 'unfinished'
  let catalogTypeFilter = 'all';

  function cycleWatchFilter() {
    const order = ['all', 'unseen', 'unfinished', 'liked', 'disliked'];
    watchFilter = order[(order.indexOf(watchFilter) + 1) % order.length];
  }


  async function handleWatchStatusChange(folderName, nextStatus) {
    databaseEntries = databaseEntries.map(e =>
      e.folder_name === folderName ? { ...e, watch_status: nextStatus } : e
    );
    if (activeMovie?.folder_name === folderName) {
      activeMovie = { ...activeMovie, watch_status: nextStatus };
    }
    try {
      await updateMovieWatchStatus(folderName, nextStatus);
    } catch (err) {
      statusMsg = `Watch status save failed: ${err}`;
    }
  }

  $: adultFilteredEntries = databaseEntries.filter(item => {
    const hasAdultTag = (item.tags || '').toLowerCase().split(',').map(t => t.trim()).includes('adult');
    return showAdultOnly ? hasAdultTag : !hasAdultTag;
  });

  $: visibleEntries = adultFilteredEntries.filter(item => {
    const ws = item.watch_status || '';
    if (watchFilter === 'unseen' && ws !== '') return false;
    if (watchFilter === 'liked' && ws !== 'liked') return false;
    if (watchFilter === 'disliked' && ws !== 'disliked') return false;
    if (watchFilter === 'unfinished' && ws !== 'unfinished') return false;
    return true;
  });


  onMount(runAudit);
</script>

<main class="container">
  <header>
    <div class="nav-left">
      <button
        type="button"
        class="adult-toggle"
        class:adult-active={showAdultOnly}
        on:mousedown={startAdultHold}
        on:mouseup={cancelAdultHold}
        on:mouseleave={cancelAdultHold}
        aria-label="Catalog mode"
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="5" fill="currentColor" />
          {#if adultProgress > 0}
            <circle
              cx="9"
              cy="9"
              r="7.5"
              fill="none"
              stroke="#111"
              stroke-width="1.5"
              stroke-dasharray="47.1"
              stroke-dashoffset={47.1 - adultProgress * 47.1}
              transform="rotate(-90 9 9)"
            />
          {/if}
        </svg>
      </button>

      <button
        type="button"
        class="brand-toggle"
        on:click={() => { viewHistory = []; activeMovie = null; activePersonData = null; viewMode = viewMode === 'collection' ? 'split' : 'collection'; }}
        title={viewMode === 'collection' ? 'Switch to Audit & Import' : 'Return to Catalog'}
      >
        Guppy
      </button>
    </div>

    <form class="person-search" on:submit|preventDefault={() => runUniversalSearch(personQuery)}>
      <input
        type="text"
        placeholder="Search title, director, or cast…"
        bind:value={personQuery}
      />
      <button type="submit" class="btn-secondary">Search</button>
    </form>

  </header>


  {#if statusMsg}<div class="error-banner">{statusMsg}</div>{/if}

  {#if showAddForm}
    <section class="add-section">
      <div class="section-bar">
        <h2>Add Title to Database</h2>
        <div class="bar-links">
          <button class="btn-text" on:click={clearAddForm}>Clear</button>
          <span class="sep">·</span>
          <button class="btn-text" on:click={() => showAddForm = false}>Close</button>
        </div>
      </div>
      <MovieCard
        item={{ key: 'wishlist', name: 'New Catalog Entry', isDirectory: false }}
        bind:data={inputs.wishlist}
        buttonLabel="Save Title"
        loading={loadingLookup.wishlist}
        results={searchResults.wishlist}
        onLookup={() => handleLookup('wishlist')}
        onWikiLookup={() => handleWikiLookup('wishlist')}
        onSelect={(m) => handleSelect('wishlist', m)}
        onSave={handleAddTitle}
        onPersonClick={openPersonPage}
      />
    </section>
  {/if}

  {#if viewMode === 'search'}
    <SearchResultsView
      results={universalResults}
      loading={loadingUniversal}
      {databaseEntries}
      {diskFolders}
      onSelectPerson={(name, id) => openPersonPage(name, id)}
      onPersonClick={openPersonPage}
      onOpenMovie={openMoviePage}
      onWatchStatus={handleWatchStatusChange}
      onAddWanted={async (film) => {
        await saveWantedMovie(film);
        await runAudit();
      }}
      onRemoveWanted={async (film) => {
        const match = film.media_type === 'tv'
          ? databaseEntries.find(
              d => d.status === 'wanted' && d.media_type === 'tv' &&
                Number(d.season_number) === Number(film.season_number || 1) &&
                (Number(d.tmdb_id) === Number(film.id) || d.title?.toLowerCase() === film.title?.toLowerCase())
            )
          : databaseEntries.find(
              d => d.status === 'wanted' && (d.media_type || 'movie') === 'movie' &&
                d.title?.toLowerCase() === film.title?.toLowerCase() && (!film.year || String(d.year) === String(film.year))
            );
        if (match) await handleDelete(match.folder_name);
      }}
      onAddWantedTv={async (show, seasonNum) => {
        await saveWantedTvSeason(show, seasonNum);
        await runAudit();
      }}
    />

  {:else if viewMode === 'movie' && activeMovie}
    <MovieDetailView
      movie={activeMovie}
      onDrive={Boolean(activeMovie.folder_name) && diskFolders.includes(activeMovie.folder_name)}
      onBack={goBack}
      onPersonClick={openPersonPage}
      onAddWanted={async (film) => {
        if (film.media_type === 'tv') {
          await saveWantedTvSeason(film, film.season_number || 1);
        } else {
          await saveWantedMovie(film);
        }
        await runAudit();
        const saved = databaseEntries.find(
          e => e.title?.toLowerCase() === film.title?.toLowerCase() && (!film.year || String(e.year) === String(film.year))
        );
        if (saved) activeMovie = saved;
      }}
      onSaveTags={async (fn, t, c) => {
        await handleSaveTags(fn, t, c);
        activeMovie = databaseEntries.find(e => e.folder_name === fn) || activeMovie;
      }}
      onWatchStatus={handleWatchStatusChange}
      onDelete={handleDelete}
      onSaveEpisodes={async (fn, eps) => {
        await updateSeasonEpisodes(fn, eps);
        await runAudit();
        activeMovie = databaseEntries.find(e => e.folder_name === fn) || activeMovie;
      }}
    />

  {:else if viewMode === 'person'}
    <PersonView
      personData={activePersonData}
      loading={loadingPerson}
      {databaseEntries}
      {diskFolders}
      {watchFilter}
      onSelectPerson={(name, id) => openPersonPage(name, id)}
      onPersonClick={openPersonPage}
      onOpenMovie={openMoviePage}
      onBack={goBack}
      onAddWanted={async (film, fallbackDirector) => {
        await saveWantedMovie({ ...film, director: film.director || fallbackDirector });
        await runAudit();
      }}
      onRemoveWanted={async (film) => {
        const match = film.media_type === 'tv'
          ? databaseEntries.find(
              d => d.status === 'wanted' && d.media_type === 'tv' &&
                Number(d.season_number) === Number(film.season_number || 1) &&
                (Number(d.tmdb_id) === Number(film.id) || d.title?.toLowerCase() === film.title?.toLowerCase())
            )
          : databaseEntries.find(
              d => d.status === 'wanted' && (d.media_type || 'movie') === 'movie' &&
                d.title?.toLowerCase() === film.title?.toLowerCase() && (!film.year || String(d.year) === String(film.year))
            );
        if (match) await handleDelete(match.folder_name);
      }}
      onAddWantedTv={async (show, seasonNum) => {
        await saveWantedTvSeason(show, seasonNum);
        await runAudit();
      }}
      onWatchStatus={handleWatchStatusChange}
    />


  {:else if viewMode === 'collection'}
    <CollectionView
      allEntries={adultFilteredEntries}
      databaseEntries={visibleEntries}
      {diskFolders}
      {searchResults}
      bind:watchFilter
      bind:typeFilter={catalogTypeFilter}
      onLookup={handleLookup}
      onWikiLookup={handleWikiLookup}
      onSelect={handleUpdate}
      onDelete={handleDelete}
      onPersonClick={openPersonPage}
      onSaveTags={handleSaveTags}
      onWatchStatus={handleWatchStatusChange}
      onOpenMovie={openMoviePage}
    />
  {:else}
    <AuditorView
      {orphans}
      databaseEntries={visibleEntries}
      {diskFolders}
      {importQueue}
      bind:inputs
      {searchResults}
      {loadingLookup}
      {saveErrors}
      {syncStatus}
      {showBulkForm}
      onPickImport={pickImportFolder}
      onToggleBulk={() => showBulkForm = !showBulkForm}
      onAudit={async (addedCount = 0) => {
        await runAudit();
        if (addedCount > 0) {
          statusMsg = `Added ${addedCount} ${addedCount === 1 ? 'title' : 'titles'} to Wanted.`;
          setTimeout(() => { if (statusMsg.startsWith('Added ')) statusMsg = ''; }, 3500);
        }
      }}
      onRescan={async () => {
        statusMsg = 'Rescanning library folders…';
        await runAudit();
        statusMsg = 'Library folders rescanned.';
        setTimeout(() => { if (statusMsg === 'Library folders rescanned.') statusMsg = ''; }, 2500);
      }}
      onSyncSidecars={handleSyncSidecars}
      onExportJson={handleExportJson}
      onClearImport={() => importQueue = []}
      onLookup={handleLookup}
      onWikiLookup={handleWikiLookup}
      onSelect={handleSelect}
      onSave={handleSave}
      onUpdateLogged={handleUpdate}
      onDeleteLogged={handleDelete}
      onPersonClick={openPersonPage}
      onSaveTags={handleSaveTags}
      onOpenMovie={openMoviePage}
    />
  {/if}



</main>
