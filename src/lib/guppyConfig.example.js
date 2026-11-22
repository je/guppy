const HOST_IP = ['192', '168', '50', '164'].join('.');
const HOST_PORT = '3456';

export const GUPPY_CONFIG = {
  hostIp: HOST_IP,
  hostPort: HOST_PORT,
  hostMdns: 'nmm.local',
  serverUrl: `http://${HOST_IP}:${HOST_PORT}`,
  smbUser: 'guppy',
  smbShareName: 'jelly',
  localShareMount: '/Volumes/jelly',
  hostDriveRoot: '/Volumes/4TB0-SEAGATE',
  hostJellyRoot: '/Volumes/4TB0-SEAGATE/jelly',
  theMoviesRoot: '/Volumes/4TB0-SEAGATE/jelly/the-movies',
  artFilmsRoot: '/Volumes/4TB0-SEAGATE/jelly/art-films',
  tvRoot: '/Volumes/4TB0-SEAGATE/jelly/tv-shows',
  deletedRoot: '/Volumes/4TB0-SEAGATE/jelly/deleted',
  tmdbApiKey: 'YOUR_TMDB_API_KEY_HERE',
  videoExts: ['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm']
};
