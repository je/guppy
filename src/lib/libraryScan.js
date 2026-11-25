const LIST_CATALOG_QUERY = 'SELECT * FROM wishlist_videos ORDER BY title ASC';

function directoryNames(entries) {
  return entries
    .filter(entry => entry.isDirectory && !entry.name.startsWith('.') && entry.name !== 'deleted')
    .map(entry => entry.name);
}

export async function scanLibrary({
  initDb,
  readDir,
  roots,
  isRemote,
  reconcileTvEpisodesOnDisk
}) {
  const db = await initDb();
  let databaseEntries = await db.select(LIST_CATALOG_QUERY);
  const theMovieFolders = directoryNames(await readDir(roots.movies).catch(() => []));
  const artMovieFolders = isRemote
    ? []
    : directoryNames(await readDir(roots.media).catch(() => []));
  const movieFolders = [...new Set([...theMovieFolders, ...artMovieFolders])].sort();
  const tvFolders = directoryNames(await readDir(roots.tv).catch(() => [])).sort();

  if (!isRemote) {
    await reconcileTvEpisodesOnDisk();
    databaseEntries = await db.select(LIST_CATALOG_QUERY);
  }

  const diskFolders = [...new Set([...movieFolders, ...tvFolders])].sort();
  const databaseFolderNames = new Set(databaseEntries.map(entry => entry.folder_name));
  const orphans = movieFolders.filter(folder => !databaseFolderNames.has(folder));
  const orphanRoots = Object.fromEntries(orphans.map(folder => [
    folder,
    theMovieFolders.includes(folder) ? roots.movies : roots.media
  ]));

  return { databaseEntries, diskFolders, orphans, orphanRoots };
}
