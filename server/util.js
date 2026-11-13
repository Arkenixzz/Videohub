// Shared helpers: paths, JSON files, child processes, ffprobe with a cache.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowsers } from './mac.js';

export const HUB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// VIDEOHUB_DATA_DIR: npm test keeps its config, caches and queue out of the install's own data folder
export const DATA_DIR = process.env.VIDEOHUB_DATA_DIR ? path.resolve(process.env.VIDEOHUB_DATA_DIR) : path.join(HUB_DIR, 'data');
export const HOME = os.homedir();
// iCloud "Desktop & Documents" keeps these paths, so they are always the ones in the home folder
export const DESKTOP = path.join(HOME, 'Desktop');
export const DOCUMENTS = path.join(HOME, 'Documents');
export const APPDATA = path.join(HOME, 'Library', 'Application Support');
export const TEMP = os.tmpdir();
fs.mkdirSync(DATA_DIR, { recursive: true });

export const idOf = p => crypto.createHash('sha1').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 12);
export const norm = p => path.resolve(p).toLowerCase();
// compare real paths (cached): symlinks, and macOS's own /var → /private/var, /tmp → /private/tmp. A path that does not
// exist yet is its deepest existing folder's real path plus the rest, so it compares the same way as its parent.
// Case-insensitive, like the default APFS volume.
const realCache = new Map();
function realOf(p) {
  const abs = path.resolve(p);
  for (let cur = abs, rest = ''; ;) {
    try { return path.join(fs.realpathSync.native(cur), rest); } catch { }
    const up = path.dirname(cur); if (up === cur) return abs;
    rest = rest ? path.join(path.basename(cur), rest) : path.basename(cur); cur = up;
  }
}
const realNorm = p => { const k = norm(p); let r = realCache.get(k); if (r === undefined) { r = realOf(p).toLowerCase(); if (fs.existsSync(p)) realCache.set(k, r); } return r; };
export const isInside = (child, parent) => { const c = realNorm(child), p = realNorm(parent); return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep); };
// does a command line or path refer to a path inside this install? Never by folder name: films live in Documents\VideoHub\films
// and the install folder can have any name (a GitHub ZIP unpacks as VideoHub-main). Case-insensitive, both slash styles.
const slashes = s => String(s || '').toLowerCase().replace(/[\\/]+/g, '/');
export const refersToHub = (s, hub = HUB_DIR) => new RegExp(slashes(hub).replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:/|["\'\\s]|$)').test(slashes(s));
export const shortPath = p => (isInside(p, DESKTOP) ? path.relative(DESKTOP, p) : isInside(p, HOME) ? '~/' + path.relative(HOME, p) : p) || p;

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}
// write via a temp file so readers never see half a file
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 << 20, ...opts }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

export async function pLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- tools on this Mac
function which(name, extra = []) {
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(extra);
  for (const d of dirs) { const f = path.join(d, name); if (d && fs.existsSync(f)) return f; }
  return null;
}
// Homebrew's folders too: a hub started from the Dock or at login has a short PATH
const BREW = ['/opt/homebrew/bin', '/usr/local/bin'];
const BROWSERS = findBrowsers();
export const TOOLS = {
  ffmpeg: which('ffmpeg', BREW) || 'ffmpeg',
  ffprobe: which('ffprobe', BREW) || 'ffprobe',
  node: process.execPath,
  // the browser VideoHub opens its window in (an app window): Chrome (or Brave, Chromium) first, else Edge
  chrome: BROWSERS.chrome || BROWSERS.brave || BROWSERS.chromium || null,
  edge: BROWSERS.edge || null,
};
export const browserExe = () => TOOLS.chrome || TOOLS.edge;

// ---------- ffprobe with a persistent cache (path + size + mtime)
const PROBE_CACHE = path.join(DATA_DIR, 'probe-cache.json');
let probeCache = readJson(PROBE_CACHE, {});
let probeDirty = false;
export function flushProbeCache() { if (probeDirty) { writeJson(PROBE_CACHE, probeCache); probeDirty = false; } }
export async function probe(file, st) {
  st = st || fs.statSync(file);
  const key = norm(file), sig = st.size + ':' + Math.round(st.mtimeMs);
  const hit = probeCache[key];
  if (hit && hit.sig === sig) return hit.info;
  const r = await run(TOOLS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file]);
  let info = { ok: false };
  try {
    const j = JSON.parse(r.stdout), v = (j.streams || []).find(s => s.codec_type === 'video');
    const [a, b] = String(v?.r_frame_rate || '0/1').split('/').map(Number);
    info = {
      ok: !!v, dur: +(+j.format?.duration || 0).toFixed(2), bitrate: +j.format?.bit_rate || 0,
      w: v?.width || 0, h: v?.height || 0, fps: b ? Math.round(a / b * 100) / 100 : 0,
      audio: (j.streams || []).some(s => s.codec_type === 'audio'),
    };
  } catch { }
  probeCache[key] = { sig, info }; probeDirty = true;
  return info;
}

// quick content fingerprint for duplicate detection: size + first and last 1 MB
export async function fingerprint(file, size) {
  const fd = await fsp.open(file, 'r');
  try {
    const n = Math.min(size, 1 << 20), a = Buffer.alloc(n), b = Buffer.alloc(n);
    await fd.read(a, 0, n, 0); await fd.read(b, 0, n, Math.max(0, size - n));
    return crypto.createHash('sha1').update(a).update(b).update(String(size)).digest('hex');
  } finally { await fd.close(); }
}

export function processAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

export const fmtGB = b => (b / 1073741824).toFixed(b >= 10 * 1073741824 ? 0 : 1) + ' GB';
export const now = () => new Date().toISOString();
