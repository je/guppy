<script>
  import MovieCard from '$lib/MovieCard.svelte';
  import LoggedCard from '$lib/LoggedCard.svelte';
  import BulkWantedModal from '$lib/BulkWantedModal.svelte';
  import { MEDIA_ROOT } from '$lib/guppyStore.js';

  export let orphans = [];
  export let databaseEntries = [];
  export let diskFolders = [];
  export let importQueue = [];
  export let inputs = {};
  export let searchResults = {};
  export let loadingLookup = {};
  export let syncStatus = '';
  export let showBulkForm = false;
  export let onPickImport;
  export let onRescan;
  export let onSyncSidecars;
  export let onExportJson;
  export let onClearImport;
  export let onLookup;
  export let onWikiLookup;
  export let onSelect;
  export let onSave;
  export let onUpdateLogged;
  export let onDeleteLogged;
  export let onPersonClick;
  export let onSaveTags;
  export let onOpenMovie;
  export let onWatchStatus;
  export let onToggleBulk;
  export let saveErrors = {};

  let confirmRewrite = false;
  let confirmRescan = false;

  $: ownedCount = databaseEntries.filter(i => i.status !== 'wanted' && diskFolders.includes(i.folder_name)).length;
  $: missingEntries = databaseEntries.filter(i => i.status !== 'wanted' && !diskFolders.includes(i.folder_name));
</script>

<div class="audit-bar">
  <button type="button" class="btn-secondary" on:click={onToggleBulk}>Add Titles</button>
  <button type="button" class="btn-secondary" on:click={onPickImport}>Import Folder</button>

  {#if !confirmRescan}
    <button
      type="button"
      class="btn-secondary"
      on:click={() => { confirmRescan = true; confirmRewrite = false; }}
    >
      Rescan Library Folders
    </button>
  {:else}
    <button
      type="button"
      class="btn-primary"
      on:click={() => { confirmRescan = false; onRescan(); }}
    >
      Confirm Rescan?
    </button>
    <button
      type="button"
      class="btn-secondary"
      on:click={() => { confirmRescan = false; }}
    >
      Cancel
    </button>
  {/if}

  {#if syncStatus}
    <button type="button" class="btn-secondary" disabled>{syncStatus}</button>
  {:else if !confirmRewrite}
    <button
      type="button"
      class="btn-secondary"
      disabled={ownedCount === 0}
      on:click={() => { confirmRewrite = true; confirmRescan = false; }}
    >
      Rewrite Metafiles
    </button>
  {:else}
    <button
      type="button"
      class="btn-primary"
      on:click={() => { confirmRewrite = false; onSyncSidecars(); }}
    >
      Confirm Rewrite ({ownedCount} Folders)?
    </button>
    <button
      type="button"
      class="btn-secondary"
      on:click={() => { confirmRewrite = false; }}
    >
      Cancel
    </button>
  {/if}

  <button type="button" class="btn-secondary" on:click={onExportJson}>Export JSON</button>
</div>

{#if showBulkForm}
  <BulkWantedModal
    {databaseEntries}
    {diskFolders}
    onClose={onToggleBulk}
    onComplete={onRescan}
  />
{/if}

{#if importQueue.length > 0}
  <section class="staged-section">
    <div class="section-bar">
      <h2>Staged Import <span class="count">({importQueue.length})</span></h2>
      <button class="btn-text" on:click={onClearImport}>Close</button>
    </div>
    {#each importQueue as item (item.key)}
      <MovieCard
        {item}
        bind:data={inputs[item.key]}
        buttonLabel={item.isDirectory ? 'Move, Rename & Log' : 'Pack & Log'}
        loading={Reflect.get(loadingLookup, item.key)}
        results={Reflect.get(searchResults, item.key)}
        onLookup={() => onLookup(item.key)}
        onWikiLookup={() => onWikiLookup(item.key)}
        onSelect={(m) => onSelect(item.key, m)}
        onSave={() => onSave(item)}
        error={Reflect.get(saveErrors, item.key) || ''}
        {onPersonClick}
      />
    {/each}
  </section>
{/if}

<div class="two-col">
  <section>
    <div class="section-bar"><h2>Unlogged on Drive <span class="count">({orphans.length})</span></h2></div>
    {#each orphans as folder (`root:${folder}`)}
      <MovieCard
        item={{ key: `root:${folder}`, name: folder, isDirectory: true, sourcePath: `${MEDIA_ROOT}/${folder}` }}
        bind:data={inputs[`root:${folder}`]}
        loading={Reflect.get(loadingLookup, `root:${folder}`)}
        results={Reflect.get(searchResults, `root:${folder}`)}
        onLookup={() => onLookup(`root:${folder}`)}
        onWikiLookup={() => onWikiLookup(`root:${folder}`)}
        onSelect={(m) => onSelect(`root:${folder}`, m)}
        onSave={() => onSave({ key: `root:${folder}`, name: folder, isDirectory: true, sourcePath: `${MEDIA_ROOT}/${folder}` })}
        error={Reflect.get(saveErrors, `root:${folder}`) || ''}
        {onPersonClick}
      />
    {:else}
      <p class="empty-note">All folders on drive are accounted for.</p>
    {/each}
  </section>

  <section>
    <div class="section-bar"><h2>Missing <span class="count">({missingEntries.length})</span></h2></div>
    {#each missingEntries as item (item.folder_name)}
      <LoggedCard
        {item}
        onDrive={false}
        results={Reflect.get(searchResults, `db:${item.folder_name}`)}
        onLookup={(t, y, d) => onLookup(`db:${item.folder_name}`, t, y, d)}
        onWikiLookup={(t, y, d) => onWikiLookup?.(`db:${item.folder_name}`, t, y, d)}
        onSelect={(m) => onUpdateLogged(item.folder_name, m)}
        onDelete={() => onDeleteLogged(item.folder_name)}
        {onPersonClick}
        {onSaveTags}
        {onOpenMovie}
        {onWatchStatus}
      />
    {:else}
      <p class="empty-note">No missing titles.</p>
    {/each}
  </section>
</div>
