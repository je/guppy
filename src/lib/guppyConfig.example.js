const HOST_IP = ['192', '168', '50', '164'].join('.');
const HOST_PORT = '3456';

export const GUPPY_CONFIG = {
  hostIp: HOST_IP,
  hostPort: HOST_PORT,
  hostMdns: 'your-host.local',
  serverUrl: `http://${HOST_IP}:${HOST_PORT}`,
  smbUser: 'guppy',
  smbShareName: 'jelly',
  localShareMount: '/Volumes/jelly',
  hostDriveRoot: '/Volumes/YOUR_DRIVE_NAME',
  hostJellyRoot: '/Volumes/YOUR_DRIVE_NAME/jelly',
  theMoviesRoot: '/Volumes/YOUR_DRIVE_NAME/jelly/the-movies',
  artFilmsRoot: '/Volumes/YOUR_DRIVE_NAME/jelly/art-films',
  tvRoot: '/Volumes/YOUR_DRIVE_NAME/jelly/tv-shows',
  deletedRoot: '/Volumes/YOUR_DRIVE_NAME/jelly/deleted',
  tmdbApiKey: 'YOUR_TMDB_API_KEY_HERE',
  videoExts: ['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm']
};
