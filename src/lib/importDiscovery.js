export async function discoverImportFolder(selected, existingInputs, {
  readDir,
  videoExts,
  inferMetadata,
  inferFolder,
  parseLooseTvFilename
}) {
  const entries = await readDir(selected);
  const items = [];
  const looseTvGroups = new Map();
  const inputs = { ...existingInputs };

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const isVideo = !entry.isDirectory && videoExts.some(ext => entry.name.toLowerCase().endsWith(ext));
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
      const subVideos = subEntries.filter(se =>
        !se.isDirectory &&
        !se.name.startsWith('.') &&
        videoExts.some(ext => se.name.toLowerCase().endsWith(ext))
      );
      const parsedSubs = subVideos
        .map(file => ({ file, tv: parseLooseTvFilename(file.name, entry.name) }))
        .filter(item => item.tv);
      if (parsedSubs.length > 0 && parsedSubs.length === subVideos.length) {
        subTvFiles = subVideos.map(file => ({
          name: file.name,
          sourcePath: `${selected}/${entry.name}/${file.name}`
        }));
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
    if (!Reflect.get(inputs, key)) {
      Reflect.set(
        inputs,
        key,
        subParsedTv
          ? {
              title: subParsedTv.title,
              year: subParsedTv.year,
              director: '',
              quality: '',
              media_type: 'tv',
              season_number: subParsedTv.season_number,
              watch_status: ''
            }
          : (entry.isDirectory
              ? await inferFolder(`${selected}/${entry.name}`, entry.name)
              : inferMetadata(entry.name))
      );
    }
  }

  for (const [normKey, group] of looseTvGroups.entries()) {
    const { parsedTv, files } = group;
    const season = String(parsedTv.season_number).padStart(2, '0');
    const label = `${parsedTv.title} - s${season} (${files.length} ${files.length === 1 ? 'episode' : 'episodes'})`;
    const key = `import:tv:${normKey}`;
    items.push({
      key,
      name: label,
      isDirectory: false,
      sourcePath: files.at(0).sourcePath,
      files
    });
    if (!Reflect.get(inputs, key)) {
      Reflect.set(inputs, key, {
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
  return { items, inputs };
}
