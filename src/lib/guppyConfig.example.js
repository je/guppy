const env = typeof import.meta !== 'undefined' ? (import.meta.env || {}) : {};
const HOST_IP = env.VITE_GUPPY_HOST_IP || '192.168.1.100';
const HOST_PORT = env.VITE_GUPPY_HOST_PORT || '3456';

export const GUPPY_CONFIG = {
  hostIp: HOST_IP,
  hostPort: HOST_PORT,
  hostMdns: env.VITE_GUPPY_HOST_MDNS || 'your-host.local',
  serverUrl: `http://${HOST_IP}:${HOST_PORT}`,
  smbUser: env.VITE_GUPPY_SMB_USER || 'guppy',
  smbShareName: env.VITE_GUPPY_SMB_SHARE || 'jelly',
  localShareMount: env.VITE_GUPPY_LOCAL_SHARE || '/Volumes/jelly',
  hostDriveRoot: env.VITE_GUPPY_HOST_DRIVE || '/Volumes/YOUR_DRIVE_NAME',
  hostJellyRoot: (env.VITE_GUPPY_HOST_DRIVE || '/Volumes/YOUR_DRIVE_NAME') + '/jelly',
  theMoviesRoot: (env.VITE_GUPPY_HOST_DRIVE || '/Volumes/YOUR_DRIVE_NAME') + '/jelly/the-movies',
  artFilmsRoot: (env.VITE_GUPPY_HOST_DRIVE || '/Volumes/YOUR_DRIVE_NAME') + '/jelly/art-films',
  tvRoot: (env.VITE_GUPPY_HOST_DRIVE || '/Volumes/YOUR_DRIVE_NAME') + '/jelly/tv-shows',
  deletedRoot: (env.VITE_GUPPY_HOST_DRIVE || '/Volumes/YOUR_DRIVE_NAME') + '/jelly/deleted',
  lanApiToken: env.VITE_GUPPY_LAN_API_TOKEN || 'replace-with-a-random-local-token',
  tmdbApiKey: env.VITE_GUPPY_TMDB_API_KEY || 'YOUR_TMDB_API_KEY_HERE',
  tmdbApiBase: ['https:/', 'api.themoviedb.org', '3'].join('/'),
  tmdbImgBase: ['https:/', 'image.tmdb.org', 't', 'p', 'w300'].join('/'),
  wikidataApiBase: 'https://www.wikidata.org/w/api.php',
  imdbSuggestBase: 'https://v2.sg.media-imdb.com/suggestion',
  videoExts: ['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm']
};
