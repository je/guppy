import { readDir } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const MEDIA_ROOT = "/Volumes/4TB0-SEAGATE/jelly/art-films";
export const TMDB_API_KEY = "dfb20686272aa46d95f96be6322a767b";
export const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm'];

export function extractQuality(str) {
  if (!str) return '';
  const lower = str.toLowerCase();
  let res = '';
  if (/\b(2160p|4k|uhd)\b/.test(lower)) res = '2160p';
  else if (/\b(1080p|1080i)\b/.test(lower)) res = '1080p';
  else if (/\b720p\b/.test(lower)) res = '720p';
  else if (/\b(480p|576p)\b/.test(lower)) res = '480p';

  let src = '';
  if (/\b(bluray|blu-ray|bdrip|brrip)\b/.test(lower)) src = 'BluRay';
  else if (/\b(web-dl|webdl|webrip|web)\b/.test(lower)) src = 'WEBDL';
  else if (/\b(dvdrip|dvd)\b/.test(lower)) src = 'DVD';
  else if (/\bhdtv\b/.test(lower)) src = 'HDTV';
  else if (/\bvhs\b/.test(lower)) src = 'VHS';

  if (src && res) return `${src}-${res}`;
  if (src) return src;
  if (res) return res;
  return '';
}

export function inferMetadata(rawName) {
  let cleaned = rawName.replace(/\.[^/.]+$/, '');
  const imdbMatch = cleaned.match(/\[imdbid-(tt\d+)\]/i);
  const imdb_id = imdbMatch ? imdbMatch.at(1) : '';
  const quality = extractQuality(cleaned);

  cleaned = cleaned.replace(/\[[^\]]*\]/g, '').trim();

  const yearMatch = cleaned.match(/[\(\.\s_-]?(19\d{2}|20\d{2})[\)\.\s_-]?/);
  let year = yearMatch ? String(yearMatch.at(1)) : '';
  let rawTitle = cleaned;

  if (yearMatch) {
    const beforeYear = cleaned.slice(0, yearMatch.index).trim();
    const afterYear = cleaned.slice(yearMatch.index + yearMatch.at(0).length).trim();
    if (beforeYear.length > 0) rawTitle = beforeYear;
    else if (afterYear.length > 0) rawTitle = afterYear;
    else { rawTitle = year; year = ''; }
  }

  rawTitle = rawTitle.replace(/\b(2160p|4K|1080p|720p|480p|360p|BluRay|BDRip|BRRip|WEB-DL|WEBRip|DVDRip|DVD|HDTV|VHS|x264|x265|HEVC|AAC|AC3)\b.*$/i, '');
  const title = rawTitle.replace(/^[-\s._]+/, '').replace(/[-\s._]+$/, '').replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

  return { title, year, quality, poster_url: '', imdb_id, director: '', cast_list: '', overview: '' };
}

export async function inferFolderWithContents(folderPath, folderName) {
  const meta = inferMetadata(folderName);
  if (!meta.quality) {
    try {
      const innerFiles = await readDir(folderPath);
      for (const f of innerFiles) {
        if (!f.isDirectory && VIDEO_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))) {
          const innerQual = extractQuality(f.name);
          if (innerQual) { meta.quality = innerQual; break; }
        }
      }
    } catch (_) {}
  }
  return meta;
}

export async function fetchEnrichedMovie(movie) {
  const host = ["api", "themoviedb", "org"].join(".");
  const path = ["3", "movie", movie.id].join("/");
  const url = new URL(`https://${host}/${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("append_to_response", "credits");

  const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  const details = await res.json();
  const directorObj = details.credits?.crew?.find(c => c.job === 'Director');
  const topCast = (details.credits?.cast || []).slice(0, 5).map(c => c.name).join(', ');
  const posterBase = ["https:/", "image.tmdb.org", "t", "p", "w300"].join("/");

  return {
    ...movie,
    title: movie.title,
    year: movie.release_date ? movie.release_date.slice(0, 4) : '',
    poster_url: movie.poster_path ? posterBase + movie.poster_path : '',
    imdb_id: details.imdb_id || '',
    director: directorObj ? directorObj.name : '',
    cast_list: topCast,
    overview: details.overview || ''
  };
}

export async function searchTmdbMovies(title, year, director) {
  const host = ["api", "themoviedb", "org"].join(".");
  const path = ["3", "search", "movie"].join("/");
  const url = new URL(`https://${host}/${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("query", String(title).trim());

  const cleanYear = String(year || '').replace(/\D/g, '').slice(0, 4);
  if (cleanYear.length === 4) url.searchParams.set("year", cleanYear);

  const res = await tauriFetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
  const rawText = await res.text();
  if (!res.ok || rawText.trim().startsWith('<')) {
    throw new Error(`TMDb Error (${res.status}): ${rawText.slice(0, 100)}`);
  }

  const data = JSON.parse(rawText);
  const dirQuery = String(director || '').toLowerCase().trim();
  const candidates = (data.results || []).slice(0, dirQuery ? 10 : 5);
  let enriched = await Promise.all(candidates.map(m => fetchEnrichedMovie(m)));

  if (dirQuery) {
    const dirMatches = enriched.filter(m => m.director.toLowerCase().includes(dirQuery));
    enriched = (dirMatches.length > 0 ? dirMatches : enriched).slice(0, 5);
  }
  return enriched;
}
