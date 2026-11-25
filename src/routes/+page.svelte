<script>
  import '$lib/guppy.css';
  import { onMount } from 'svelte';
  import { save, open } from '@tauri-apps/plugin-dialog';
  import MovieCard from '$lib/MovieCard.svelte';
  import CollectionView from '$lib/CollectionView.svelte';
  import AuditorView from '$lib/AuditorView.svelte';
  import PersonView from '$lib/PersonView.svelte';
  import MovieDetailView from '$lib/MovieDetailView.svelte';
  import SearchResultsView from '$lib/SearchResultsView.svelte';
  import GuppyHeader from '$lib/GuppyHeader.svelte';
  import { GUPPY_CONFIG, MEDIA_ROOT, TV_ROOT, THE_MOVIES_ROOT, VIDEO_EXTS, readDir, writeTextFile, initDb, inferMetadata, inferFolder, searchTmdb, findTmdbByImdbId, searchWikipediaMovie, fetchPersonFilmography, saveToLibrary, saveWantedMovie, updateExistingMovie, updateMovieTagsAndClips, syncAllJellyfinSidecars, removeMovieFromLibrary, updateMovieWatchStatus, undoActivity, searchUniversal, searchTmdbTv, fetchTvSeasonDetails, saveTvSeasonToLibrary, saveWantedTvSeason, updateSeasonEpisodes, computeSeasonWatchStatus, parseLooseTvFilename, exportCatalogToJson, reconcileTvEpisodesOnDisk, backfillMissingTvMetadata, backfillMissingMovieMetadata, fetchEnrichedTvShow, logActivity, writeJellyfinTvSidecars, isRemoteClient, getConnectionStatus, mountSharedDrive,migrateNonAdultMovies } from '$lib/guppyStore.js';

  let viewMode = 'collection';
  let prevViewMode = 'collection';
  $: if (viewMode !== prevViewMode) {
    if (prevViewMode === 'split' && viewMode !== 'split') {
      importQueue = [];
      showAddForm = false;
      showBulkForm = false;
      inputs = { ...inputs, wishlist: { title: '', year: '', director: '', quality: '', poster_url: '', imdb_id: '', cast_list: '', overview: '' } };
    }
    prevViewMode = viewMode;
  }
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
  let statusTimer = null;
  let undoNotice = null;
  let undoTimer = null;
  let undoBusy = false;
  let stagedCompletionToken = 0;
  function showStagedImportSuccess(key, message) {
    const token = ++stagedCompletionToken;
    importQueue = importQueue.map(item =>
      item.key === key ? { ...item, successMessage: message, successToken: token } : item
    );
    setTimeout(() => {
      importQueue = importQueue.filter(item => item.key !== key || item.successToken !== token);
    }, 4000);
  }
  function flashStatus(msg) {
    statusMsg = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (statusMsg === msg) statusMsg = '';
    }, 4000);
  }
  function offerUndo(activityId, message) {
    if (!activityId) return;
    undoNotice = { id: activityId, message };
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      if (undoNotice?.id === activityId) undoNotice = null;
    }, 8000);
  }
  async function handleUndoActivity(activityId) {
    if (undoBusy) return;
    undoBusy = true;
    try {
      await undoActivity(activityId);
      void runAudit();
      undoNotice = { id: null, message: 'Action undone.' };
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => {
        if (undoNotice?.message === 'Action undone.') undoNotice = null;
      }, 4000);
    } catch (err) {
      if (undoNotice?.id === activityId) {
        undoNotice = { id: activityId, message: `Undo failed: ${String(err)}` };
      }
      throw err;
    } finally {
      undoBusy = false;
    }
  }
  let personQuery = '';
  let showBulkForm = false;
  let auditResetNonce = 0;
  let openMetafilesNonce = 0;
  let activeAuditHealthFilter = '';
  let showAdultOnly = false;
  let isRemote = true;
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
    if (isRemote) {
      showAdultOnly = false;
      adultProgress = 0;
      return;
    }
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

  let auditRunning = false;
  let auditQueued = false;

  async function runAudit() {
    if (auditRunning) {
      auditQueued = true;
      return;
    }
    auditRunning = true;
    try {
      do {
        auditQueued = false;
        try {
      const db = await initDb();
      databaseEntries = await db.select("SELECT * FROM wishlist_videos ORDER BY title ASC");
      const theMovieEntries = await readDir(THE_MOVIES_ROOT).catch(() => []);
      const theMovieFolders = theMovieEntries
        .filter(e => e.isDirectory && !e.name.startsWith('.') && e.name !== 'deleted')
        .map(e => e.name);

      const artMovieEntries = !isRemote ? await readDir(MEDIA_ROOT).catch(() => []) : [];
      const artMovieFolders = artMovieEntries
        .filter(e => e.isDirectory && !e.name.startsWith('.') && e.name !== 'deleted')
        .map(e => e.name);

      const movieFolders = [...new Set([...theMovieFolders, ...artMovieFolders])].sort();

      const tvEntries = await readDir(TV_ROOT).catch(() => []);
      const tvFolders = tvEntries
        .filter(e => e.isDirectory && !e.name.startsWith('.') && e.name !== 'deleted')
        .map(e => e.name)
        .sort();

      diskFolders = [...new Set([...movieFolders, ...tvFolders])].sort();
      if (!isRemote) {
        await reconcileTvEpisodesOnDisk();
        databaseEntries = await db.select("SELECT * FROM wishlist_videos ORDER BY title ASC");
      }
      if (activeMovie?.folder_name) {
        const refreshed = databaseEntries.find(e => e.folder_name === activeMovie.folder_name);
        if (refreshed) activeMovie = refreshed;
      }
      const inDb = databaseEntries.map(r => r.folder_name);
      orphans = movieFolders.filter(f => !inDb.includes(f));

      const nextInputs = { ...inputs };
      if (!isRemote) for (const folder of orphans) {
        const key = `root:${folder}`;
        const orphanRoot = theMovieFolders.includes(folder) ? THE_MOVIES_ROOT : MEDIA_ROOT;
        if (!Reflect.get(nextInputs, key)) Reflect.set(nextInputs, key, await inferFolder(`${orphanRoot}/${folder}`, folder));
      }
      inputs = nextInputs;
      statusMsg = '';
        } catch (err) { statusMsg = `Scan error: ${err}`; }
      } while (auditQueued);
    } finally {
      auditRunning = false;
    }
  }

  async function pickImportFolder() {
    try {
      const selected = await open({ directory: true, multiple: false, defaultPath: GUPPY_CONFIG.hostJellyRoot });
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
          const parsedTv = parseLooseTvFilename(entry.name, '');
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

        let subTvFiles = [];
        let subParsedTv = null;
        if (entry.isDirectory) {
          const subEntries = await readDir(`${selected}/${entry.name}`).catch(() => []);
          const subVideos = subEntries.filter(se => !se.isDirectory && !se.name.startsWith('.') && VIDEO_EXTS.some(ext => se.name.toLowerCase().endsWith(ext)));
          const parsedSubs = subVideos.map(sv => ({ file: sv, tv: parseLooseTvFilename(sv.name, entry.name) })).filter(x => x.tv);
          if (parsedSubs.length > 0 && parsedSubs.length === subVideos.length) {
            subTvFiles = subVideos.map(sv => ({ name: sv.name, sourcePath: `${selected}/${entry.name}/${sv.name}` }));
            subParsedTv = parsedSubs.at(0).tv;
          }
        }
        const key = `import:${entry.name}`;
        items.push({
          key,
          name: entry.name,
          isDirectory: entry.isDirectory,
          sourcePath: `${selected}/${entry.name}`,
          ...(subTvFiles.length > 0 ? { files: subTvFiles } : {})
        });
        if (!Reflect.get(nextInputs, key)) {
          Reflect.set(
            nextInputs,
            key,
            subParsedTv
              ? { title: subParsedTv.title, year: subParsedTv.year, director: '', quality: '', media_type: 'tv', season_number: subParsedTv.season_number, watch_status: '' }
              : (entry.isDirectory ? await inferFolder(`${selected}/${entry.name}`, entry.name) : inferMetadata(entry.name))
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
      showBulkForm = false;
      auditResetNonce += 1;
      importQueue = items;
      viewMode = 'split';

      for (let i = 0; i < items.length; i += 3) {
        await Promise.all(items.slice(i, i + 3).map(item => handleLookup(item.key)));
      }
    } catch (err) { statusMsg = `Import error: ${err}`; }
  }

  async function handleLookup(key, t = '', y = '', d = '', mediaOverride = '', limit = 8) {
    const cur = Reflect.get(inputs, key);
    const dbItem = key.startsWith('db:')
      ? databaseEntries.find(item => `db:${item.folder_name}` === key)
      : null;
    const mediaType = mediaOverride || cur?.media_type || dbItem?.media_type || 'movie';
    const isTv = mediaType === 'tv';

    const title = t || cur?.title || dbItem?.title;
    const year = y || cur?.year || dbItem?.year;
    const director = d || cur?.director || dbItem?.director;
    if (!title && !year && !director) { statusMsg = "Enter a Title, Year, or Director first."; return; }
    loadingLookup = { ...loadingLookup, [key]: true };
    statusMsg = '';
    const pendingResults = { ...searchResults };
    Reflect.deleteProperty(pendingResults, key);
    searchResults = pendingResults;
    try {
      const ttMatch = String(title || '').match(/\b(tt\d{6,9})\b/i);
      if (ttMatch) {
        const cleanTt = ttMatch.at(1).toLowerCase();
        const found = await findTmdbByImdbId(cleanTt);
        if (found.length > 0) {
          searchResults = { ...searchResults, [key]: found };
        } else if (dbItem) {
          const updated = await handleUpdate(dbItem.folder_name, {
            ...dbItem,
            imdb_id: cleanTt,
            imdb_id_source: 'imdb-id-lookup'
          });
          if (updated) flashStatus(`Attached IMDb ID ${cleanTt}`);
        } else if (cur) {
          inputs = { ...inputs, [key]: { ...cur, imdb_id: cleanTt, imdb_id_source: 'imdb-id-lookup' } };
          flashStatus(`Attached IMDb ID ${cleanTt}`);
        } else {
          statusMsg = `IMDb ID ${cleanTt} did not match a TMDb title.`;
        }
        return;
      }
      const res = isTv
        ? await searchTmdbTv(title, year)
        : await searchTmdb(title, year, director, limit);
      searchResults = { ...searchResults, [key]: res };
      if (res.length === 0) statusMsg = `No ${isTv ? 'TV' : 'movie'} matches found. Check the title/year and try again.`;
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
    const pendingResults = { ...searchResults };
    Reflect.deleteProperty(pendingResults, key);
    searchResults = pendingResults;
    try {
      const res = await searchWikipediaMovie(title, year, director);
      searchResults = { ...searchResults, [key]: res };
      if (res.length === 0) statusMsg = 'No Wikipedia matches found.';
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
      saveErrors = { ...saveErrors, [item.key]: 'Enter both Title and Year.' };
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
      const watchLabels = { liked: 'Seen & Liked', unfinished: 'Unfinished', disliked: 'Seen & Disliked' };
      const wLabel = watchLabels[entry.watch_status] || 'Unseen';
      const doneMsg = `Imported "${entry.title || item.name}" (${wLabel})`;
      showStagedImportSuccess(item.key, doneMsg);
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

  async function handleUpdate(oldFolder, movie, showStatus = true) {
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
        const tvMeta = tvId
          ? await fetchEnrichedTvShow(tvId).catch(() => ({}))
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
        const castList = seasonData.cast_list || movie.cast_list || tvMeta.cast_list || existing?.cast_list || '';
        const imdbId = seasonData.imdb_id || movie.imdb_id || tvMeta.imdb_id || existing?.imdb_id || '';
        const imdbIdSource = seasonData.imdb_id
          ? 'tmdb'
          : (movie.imdb_id_source || tvMeta.imdb_id_source || existing?.imdb_id_source || (imdbId ? 'provided' : ''));
        const director = movie.director || tvMeta.director || existing?.director || '';

        await db.execute(
          `UPDATE wishlist_videos
           SET title = ?, year = ?, poster_url = ?, overview = ?, cast_list = ?, director = ?, imdb_id = ?, tmdb_id = ?, episodes_json = ?, watch_status = ?, media_type = 'tv', season_number = ?, imdb_id_source = ?
           WHERE folder_name = ?`,
          [movie.title, seasonYear, posterUrl, overview, castList, director, imdbId, tvId, JSON.stringify(mergedEpisodes), rolledWatch, seasonNum, imdbIdSource, oldFolder]
        );

        await logActivity('Updated Metadata', `${movie.title} · Season ${seasonNum}`, imdbId || '');

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
        Reflect.deleteProperty(next, oldFolder);
        searchResults = next;
        await runAudit();
        return {
          ...existing,
          ...movie,
          title: movie.title,
          year: seasonYear,
          folder_name: oldFolder,
          imdb_id: imdbId,
          imdb_id_source: imdbIdSource
        };
      }

      const updatedEntry = await updateExistingMovie(oldFolder, existing, movie, diskFolders.includes(oldFolder));
      const resolvedTt = updatedEntry?.imdb_id || movie.imdb_id || '';
      await logActivity('Updated Metadata', movie.title, resolvedTt);
      const next = { ...searchResults };
      Reflect.deleteProperty(next, `db:${oldFolder}`);
      Reflect.deleteProperty(next, oldFolder);
      searchResults = next;
      await runAudit();
      if (showStatus && ['failed', 'incomplete'].includes(updatedEntry?.imdb_lookup_status)) {
        const lookupOutcome = updatedEntry.imdb_lookup_status === 'incomplete' ? 'was incomplete' : 'failed';
        statusMsg = `Metadata updated, but IMDb lookup ${lookupOutcome}: ${updatedEntry.imdb_lookup_error || 'lookup service unavailable.'}`;
      } else if (showStatus && !updatedEntry?.imdb_id) {
        statusMsg = `Metadata updated, but no IMDb ID match was found for "${updatedEntry?.title || movie.title}".`;
      }
      return updatedEntry;
    } catch (err) {
      statusMsg = `Update failed: ${err}`;
      return false;
    }
  }

  async function handleDelete(folderName) {
    try {
      const isOnDisk = diskFolders.includes(folderName);
      const targetItem = databaseEntries.find(e => e.folder_name === folderName);
      const activityId = await removeMovieFromLibrary(folderName, isOnDisk);
      await runAudit();
      offerUndo(activityId, `Removed "${targetItem?.title || folderName}".`);
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
    const isSwitchingMatchPill = viewMode === 'person' && Boolean(personId) && Boolean(activePersonData?.queryName);
    const searchTerm = isSwitchingMatchPill ? activePersonData.queryName : cleanName;

    if (viewMode !== 'person') {
      viewHistory = [...viewHistory, viewMode];
    }
    activePersonData = { name: cleanName, queryName: searchTerm, directed: [], acted: [], tvShows: [], matches: [] };
    loadingPerson = true;
    statusMsg = '';
    viewMode = 'person';

    try {
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
    const activityId = await updateMovieTagsAndClips(folderName, tags, clips);
    const hasAdult = String(tags || '').toLowerCase().split(',').map(s => s.trim()).includes('adult');
    if (isRemote && hasAdult) {
      databaseEntries = databaseEntries.filter(e => e.folder_name !== folderName);
      if (activeMovie?.folder_name === folderName) activeMovie = null;
    } else {
      databaseEntries = databaseEntries.map(e =>
        e.folder_name === folderName ? { ...e, tags, clips } : e
      );
    }
    await runAudit();
    return activityId;
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
        defaultPath: `${String(GUPPY_CONFIG.hostJellyRoot || '').replace(/\/+$/, '').replace(/\/[^/]+$/, '') || GUPPY_CONFIG.hostJellyRoot}/guppy-catalog-${dateStamp}.json`,
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
  let catalogCollectionFilter = 'collected';
  let catalogSearchFilter = '';
  let confirmRewrite = false;
  let confirmRescan = false;

  $: ownedCount = visibleEntries.filter(i => i.status !== 'wanted' && diskFolders.includes(i.folder_name)).length;

  $: catalogCountPool = (adultFilteredEntries.length > 0 ? adultFilteredEntries : visibleEntries).filter(item => {
    if (catalogTypeFilter === 'movie' && (item.media_type || 'movie') !== 'movie') return false;
    if (catalogTypeFilter === 'tv' && item.media_type !== 'tv') return false;
    if (catalogCollectionFilter === 'collected' && item.status === 'wanted') return false;
    if (catalogCollectionFilter === 'wanted' && item.status !== 'wanted') return false;
    const q = catalogSearchFilter.toLowerCase().trim();
    if (!q) return true;
    return [item.title, item.director, item.cast_list, item.tags, item.clips, item.episodes_json, String(item.year)]
      .some(v => v?.toLowerCase().includes(q));
  });

  $: listedCount = catalogCountPool.length;
  $: unwatchedCount = catalogCountPool.filter(i => !i.watch_status || i.watch_status === '').length;
  $: unfinishedCount = catalogCountPool.filter(i => i.watch_status === 'unfinished').length;
  $: likedCount = catalogCountPool.filter(i => i.watch_status === 'liked').length;
  $: hatedCount = catalogCountPool.filter(i => i.watch_status === 'disliked').length;

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
      const activityId = await updateMovieWatchStatus(folderName, nextStatus);
      const title = databaseEntries.find(e => e.folder_name === folderName)?.title || folderName;
      offerUndo(activityId, `Updated watch status for "${title}".`);
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

  let connStatus = { mode: 'checking', serverUrl: '', serverOk: false, driveMounted: false };
  let mountingDrive = false;

  async function refreshConnectionStatus() {
    connStatus = await getConnectionStatus();
    isRemote = connStatus.mode === 'remote';
    if (isRemote) showAdultOnly = false;
  }

  let refreshingConnection = false;
  async function handleRefreshConnection() {
    if (refreshingConnection) return;
    refreshingConnection = true;
    try {
      await refreshConnectionStatus();
      await runAudit();
    } catch (err) {
      statusMsg = `Refresh failed: ${err}`;
    } finally {
      refreshingConnection = false;
    }
  }

  async function handleRetryMissingMetadata() {
    const db = await initDb();
    const missingBeforeRows = await db.select(
      `SELECT imdb_id, tags FROM wishlist_videos WHERE imdb_id IS NULL OR TRIM(imdb_id) = ''`
    );
    const missingBefore = missingBeforeRows.length;
    const errors = [];
    let updated = false;
    try {
      updated = await backfillMissingTvMetadata() || updated;
    } catch (err) {
      errors.push(String(err?.message || err));
    }
    try {
      updated = await backfillMissingMovieMetadata() || updated;
    } catch (err) {
      errors.push(String(err?.message || err));
    }
    await runAudit();
    const missingAfterRows = await db.select(
      `SELECT imdb_id, tags FROM wishlist_videos WHERE imdb_id IS NULL OR TRIM(imdb_id) = ''`
    );
    const remaining = missingAfterRows.length;
    if (errors.length > 0) {
      throw new Error(`${errors.join(' ')} ${remaining} catalog entries still lack IMDb IDs.`);
    }
    return {
      updated,
      resolved: Math.max(0, missingBefore - remaining),
      remaining
    };
  }

  async function handleMountDrive() {
    mountingDrive = true;
    try {
      await mountSharedDrive();
    } catch (err) {
      statusMsg = `Mount failed: ${err}`;
    } finally {
      mountingDrive = false;
      await refreshConnectionStatus();
    }
  }

  onMount(async () => {
    await refreshConnectionStatus();
    if (!connStatus.serverOk) {
      setTimeout(() => { refreshConnectionStatus(); }, 1500);
    }
    await runAudit();
    if (!isRemote) {
      let updatedTv = false;
      let updatedMovies = false;
      let movedMovies = 0;
      const metadataErrors = [];
      try {
        updatedTv = await backfillMissingTvMetadata();
      } catch (err) {
        metadataErrors.push(String(err?.message || err));
      }
      try {
        updatedMovies = await backfillMissingMovieMetadata();
      } catch (err) {
        metadataErrors.push(String(err?.message || err));
      }
      try {
        movedMovies = await migrateNonAdultMovies();
      } catch (err) {
        metadataErrors.push(String(err?.message || err));
      }
      if (updatedTv || updatedMovies || movedMovies > 0) {
        await runAudit();
      }
      if (metadataErrors.length > 0) statusMsg = `Metadata refresh warning: ${metadataErrors.join(' ')}`;
    }
    const evSource = new EventSource(`${GUPPY_CONFIG.serverUrl}/api/events`);
    evSource.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data || '{}');
        if (msg.type === 'db_changed' && !showAddForm && !showBulkForm) {
          runAudit();
        }
      } catch (_) {}
    };
    return () => {
      evSource.close();
    };
  });

</script>

<main class="container">
  <GuppyHeader
    {viewMode}
    {isRemote}
    {connStatus}
    {mountingDrive}
    {showAdultOnly}
    {adultProgress}
    {watchFilter}
    {listedCount}
    {unwatchedCount}
    {unfinishedCount}
    {likedCount}
    {hatedCount}
    {showBulkForm}
    {importQueue}
    {activeAuditHealthFilter}
    {refreshingConnection}
    bind:personQuery
    onMountDrive={handleMountDrive}
    onRefresh={handleRefreshConnection}
    onSwitchAudit={() => { viewHistory = []; activeMovie = null; activePersonData = null; viewMode = 'split'; }}
    onReturnCatalog={() => { viewHistory = []; activeMovie = null; activePersonData = null; viewMode = 'collection'; }}
    onAdultMousedown={startAdultHold}
    onAdultMouseup={cancelAdultHold}
    onAdultMouseleave={cancelAdultHold}
    onWatchFilter={(filter) => { watchFilter = filter; activeMovie = null; viewMode = 'collection'; }}
    onFileLibrary={() => { showBulkForm = false; importQueue = []; activeAuditHealthFilter = ''; auditResetNonce += 1; }}
    onPickImport={pickImportFolder}
    onToggleBulk={() => { const next = !showBulkForm; showBulkForm = next; if (next) { importQueue = []; activeAuditHealthFilter = ''; auditResetNonce += 1; } }}
    onUniversalSearch={runUniversalSearch}
  />


  {#if undoNotice}
    <div class="success-banner undo-status-banner" role="status">
      <span>{undoNotice.message}</span>
      {#if undoNotice.id}
        <button type="button" class="btn btn-sm" disabled={undoBusy} on:click={() => handleUndoActivity(undoNotice.id)}>
          {undoBusy ? 'Undoing…' : 'Undo'}
        </button>
      {/if}
    </div>
  {/if}
  {#if statusMsg}<div class="error-banner" role="alert">{statusMsg}</div>{/if}

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
      databaseEntries={visibleEntries}
      allDatabaseEntries={databaseEntries}
      {diskFolders}
      {searchResults}
      onSelectPerson={(name, id) => openPersonPage(name, id)}
      onPersonClick={openPersonPage}
      onOpenMovie={openMoviePage}
      onWatchStatus={handleWatchStatusChange}
      onLookup={handleLookup}
      onWikiLookup={handleWikiLookup}
      onSelect={handleUpdate}
      onDelete={handleDelete}
      onSaveTags={handleSaveTags}
      onAddWanted={async (film) => {
        const activityId = await saveWantedMovie(film);
        await runAudit();
        offerUndo(activityId, `Added "${film.title}" to Wanted.`);
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
        const activityId = await saveWantedTvSeason(show, seasonNum);
        await runAudit();
        offerUndo(activityId, `Added "${show.title}" season ${seasonNum} to Wanted.`);
      }}
    />

  {:else if viewMode === 'movie' && activeMovie}
    <MovieDetailView
      movie={activeMovie}
      onDrive={Boolean(activeMovie.folder_name) && diskFolders.includes(activeMovie.folder_name)}
      onBack={goBack}
      onPersonClick={openPersonPage}
      onAddWanted={async (film) => {
        let activityId;
        if (film.media_type === 'tv') {
          activityId = await saveWantedTvSeason(film, film.season_number || 1);
        } else {
          activityId = await saveWantedMovie(film);
        }
        await runAudit();
        offerUndo(activityId, `Added "${film.title}" to Wanted.`);
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
        const episodesJson = JSON.stringify(eps);
        const rolledWatch = computeSeasonWatchStatus(eps);
        databaseEntries = databaseEntries.map(e =>
          e.folder_name === fn ? { ...e, episodes_json: episodesJson, watch_status: rolledWatch } : e
        );
        if (activeMovie?.folder_name === fn) {
          activeMovie = { ...activeMovie, episodes_json: episodesJson, watch_status: rolledWatch };
        }
        await updateSeasonEpisodes(fn, eps);
        await runAudit();
        activeMovie = databaseEntries.find(e => e.folder_name === fn) || activeMovie;
      }}
    />

  {:else if viewMode === 'person'}
    <PersonView
      personData={activePersonData}
      loading={loadingPerson}
      databaseEntries={visibleEntries}
      allDatabaseEntries={databaseEntries}
      {diskFolders}
      {searchResults}
      {watchFilter}
      onSelectPerson={(name, id) => openPersonPage(name, id)}
      onPersonClick={openPersonPage}
      onBack={goBack}
      onOpenMovie={openMoviePage}
      onWatchStatus={handleWatchStatusChange}
      onLookup={handleLookup}
      onWikiLookup={handleWikiLookup}
      onSelect={handleUpdate}
      onDelete={handleDelete}
      onSaveTags={handleSaveTags}
      onAddWanted={async (film, fallbackDirector = '') => {
        const activityId = await saveWantedMovie({
          ...film,
          director: film.director || fallbackDirector
        });
        await runAudit();
        offerUndo(activityId, `Added "${film.title}" to Wanted.`);
      }}
      onRemoveWanted={async (film) => {
        const match = databaseEntries.find(
          d => d.status === 'wanted' && (d.media_type || 'movie') === 'movie' &&
            d.title?.toLowerCase() === film.title?.toLowerCase() && (!film.year || String(d.year) === String(film.year))
        );
        if (match) await handleDelete(match.folder_name);
      }}
      onAddWantedTv={async (show, seasonNum) => {
        const activityId = await saveWantedTvSeason(show, seasonNum);
        await runAudit();
        offerUndo(activityId, `Added "${show.title}" season ${seasonNum} to Wanted.`);
      }}
    />

  {:else if viewMode === 'collection'}
    <CollectionView
      databaseEntries={visibleEntries}
      {diskFolders}
      {searchResults}
      bind:typeFilter={catalogTypeFilter}
      bind:collectionFilter={catalogCollectionFilter}
      bind:searchFilter={catalogSearchFilter}
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
      onLookupMore={(key, nextLimit) => handleLookup(key, '', '', '', '', nextLimit)}
      {orphans}
      {databaseEntries}
      {diskFolders}
      {importQueue}
      bind:inputs
      {searchResults}
      {loadingLookup}
      {saveErrors}
      {showBulkForm}
      {auditResetNonce}
      {openMetafilesNonce}
      bind:activeHealthFilter={activeAuditHealthFilter}
      {syncStatus}
      {ownedCount}
      onRewriteMetafiles={handleSyncSidecars}
      onRescanLibrary={async () => {
        statusMsg = 'Rescanning library folders…';
        await runAudit();
        statusMsg = 'Library folders rescanned.';
        setTimeout(() => { if (statusMsg === 'Library folders rescanned.') statusMsg = ''; }, 2500);
      }}
      onExportJson={handleExportJson}
      onRetryMissingMetadata={handleRetryMissingMetadata}
      onClearSubViews={() => { showBulkForm = false; importQueue = []; }}
      onToggleBulk={() => { const next = !showBulkForm; showBulkForm = next; if (next) { importQueue = []; auditResetNonce += 1; } }}
      onAudit={async (addedCount = 0) => {
        await runAudit();
        if (addedCount > 0) {
          statusMsg = `Added ${addedCount} ${addedCount === 1 ? 'title' : 'titles'} to Wanted.`;
          setTimeout(() => { if (statusMsg.startsWith('Added ')) statusMsg = ''; }, 3500);
        }
      }}
      onClearImport={() => importQueue = []}
      onUndoActivity={handleUndoActivity}
      onLookup={handleLookup}
      onWikiLookup={handleWikiLookup}
      onSelect={handleSelect}
      onSave={handleSave}
      onUpdateLogged={(folderName, movie) => handleUpdate(folderName, movie, false)}
      onDeleteLogged={handleDelete}
      onPersonClick={openPersonPage}
      onSaveTags={handleSaveTags}
      onOpenMovie={openMoviePage}
    />
  {/if}



</main>
