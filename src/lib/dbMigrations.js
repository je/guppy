const migrations = [
  {
    version: 1,
    name: 'baseline-catalog-schema',
    async up(db) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS wishlist_videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_name TEXT UNIQUE,
          title TEXT,
          year INTEGER,
          quality TEXT,
          imdb_id TEXT,
          poster_url TEXT,
          director TEXT,
          cast_list TEXT,
          overview TEXT,
          status TEXT DEFAULT 'owned',
          tags TEXT,
          clips TEXT,
          watch_status TEXT DEFAULT '',
          media_type TEXT DEFAULT 'movie',
          season_number INTEGER DEFAULT 0,
          episodes_json TEXT DEFAULT '',
          tmdb_id INTEGER DEFAULT 0,
          runtime TEXT DEFAULT '',
          countries TEXT DEFAULT '',
          genres TEXT DEFAULT ''
        )
      `);

      const videoColumns = [
        ['quality', 'TEXT'],
        ['imdb_id', 'TEXT'],
        ['poster_url', 'TEXT'],
        ['director', 'TEXT'],
        ['cast_list', 'TEXT'],
        ['overview', 'TEXT'],
        ['status', "TEXT DEFAULT 'owned'"],
        ['tags', 'TEXT'],
        ['clips', 'TEXT'],
        ['watch_status', "TEXT DEFAULT ''"],
        ['media_type', "TEXT DEFAULT 'movie'"],
        ['season_number', 'INTEGER DEFAULT 0'],
        ['episodes_json', "TEXT DEFAULT ''"],
        ['tmdb_id', 'INTEGER DEFAULT 0'],
        ['runtime', "TEXT DEFAULT ''"],
        ['countries', "TEXT DEFAULT ''"],
        ['genres', "TEXT DEFAULT ''"]
      ];
      await addMissingColumns(db, 'wishlist_videos', videoColumns);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS activity_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          action TEXT,
          title TEXT,
          detail TEXT DEFAULT '',
          undo_payload TEXT DEFAULT ''
        )
      `);
      await addMissingColumns(db, 'activity_log', [['undo_payload', "TEXT DEFAULT ''"]]);
    }
  },
  {
    version: 2,
    name: 'imdb-id-provenance-and-folder-backfill',
    async up(db) {
      await addMissingColumns(db, 'wishlist_videos', [['imdb_id_source', "TEXT DEFAULT ''"]]);

      const rows = await db.select(
        `SELECT id, folder_name, imdb_id, tags FROM wishlist_videos
         WHERE imdb_id IS NULL OR TRIM(imdb_id) = ''`
      );
      for (const row of rows) {
        const match = String(row.folder_name || '').match(/\[imdbid-(tt\d{6,9})\]/i);
        if (!match) continue;
        await db.execute(
          `UPDATE wishlist_videos SET imdb_id = ?, imdb_id_source = ? WHERE id = ?`,
          [match[1].toLowerCase(), 'folder-name', row.id]
        );
      }
    }
  }
];

async function addMissingColumns(db, tableName, columns) {
  const rows = await db.select(`SELECT name FROM pragma_table_info('${tableName}')`);
  const existing = new Set(rows.map(row => row.name));
  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      try {
        await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
      } catch (err) {
        const refreshedRows = await db.select(`SELECT name FROM pragma_table_info('${tableName}')`);
        if (!refreshedRows.some(row => row.name === name)) throw err;
      }
    }
  }
}

export async function runDbMigrations(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  const appliedRows = await db.select('SELECT version FROM schema_migrations');
  const appliedVersions = appliedRows.map(row => Number(row.version));
  if (appliedVersions.some(version => !Number.isInteger(version) || version < 1)) {
    throw new Error('The database migration history contains an invalid version.');
  }

  const latestApplied = Math.max(0, ...appliedVersions);
  const latestKnown = migrations.at(-1)?.version || 0;
  if (latestApplied > latestKnown) {
    throw new Error(`Database schema version ${latestApplied} is newer than this app supports (${latestKnown}).`);
  }

  const applied = new Set(appliedVersions);
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    try {
      await migration.up(db);
      try {
        await db.execute(
          'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
          [migration.version, migration.name]
        );
      } catch (err) {
        const existing = await db.select(
          'SELECT version FROM schema_migrations WHERE version = ?',
          [migration.version]
        );
        if (existing.length === 0) throw err;
      }
    } catch (err) {
      throw new Error(
        `Database migration ${migration.version} (${migration.name}) failed: ${String(err?.message || err)}`,
        { cause: err }
      );
    }
  }
}
