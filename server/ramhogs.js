// Programs that hold a lot of RAM next to a render (an Android emulator once held 7.4 GB of a 16 GB computer during a render).
// Renders, macOS itself, the Claude app and VideoHub are left out; nothing is ever closed from here, the user decides.
import { execFile } from 'node:child_process';

const NAMES = {
  'google chrome': 'Chrome (browser)', 'microsoft edge': 'Edge (browser)', firefox: 'Firefox', opera: 'Opera', 'brave browser': 'Brave', safari: 'Safari', arc: 'Arc',
  discord: 'Discord', steam: 'Steam', 'steam helper': 'Steam', obs: 'OBS', spotify: 'Spotify', telegram: 'Telegram', whatsapp: 'WhatsApp',
  'microsoft teams': 'Teams', slack: 'Slack', 'visual studio code': 'VS Code', code: 'VS Code', cursor: 'Cursor', xcode: 'Xcode', simulator: 'iOS Simulator',
  'adobe photoshop 2025': 'Photoshop', 'adobe premiere pro 2025': 'Premiere Pro', 'adobe after effects 2025': 'After Effects', 'davinci resolve': 'DaVinci Resolve',
  'final cut pro': 'Final Cut Pro', blender: 'Blender', docker: 'Docker', 'docker desktop': 'Docker', utm: 'UTM (virtual machine)', parallels: 'Parallels',
  'android studio': 'Android Studio', 'qemu-system-aarch64': 'Android emulator / virtual machine',
};
// never listed: macOS's own programs (anything under /System, /usr, /sbin, /bin, /Library/Apple), the Claude app, the
// render tools themselves
const SKIP = new Set(['kernel_task', 'launchd', 'windowserver', 'loginwindow', 'finder', 'dock', 'systemuiserver', 'controlcenter', 'spotlight',
  'notificationcenter', 'claude', 'node', 'ffmpeg', 'ffprobe', 'osascript', 'ps', 'terminal', 'iterm2']);
const SYSTEM = /^\/(System|usr|sbin|bin|Library\/Apple|private)\//;

// the app a process belongs to: the outermost ".app" in its path (Chrome's helpers count as Chrome), else its file name
export function appOf(exe) {
  const m = /\/([^/]+)\.app\//.exec(exe || '');
  return m ? m[1] : String(exe || '').split('/').pop();
}
const psRun = args => new Promise(resolve => execFile('ps', args, { maxBuffer: 32 << 20, timeout: 20000 }, (err, out) => resolve(err ? null : String(out))));

// rows: [{ pid, ppid, rssKB, exe }], args: Map pid → command line
export function group(rows, args = new Map()) {
  const byPid = new Map(rows.map(r => [r.pid, r]));
  // a browser process belongs to a headless render (or the VideoHub window) when the top process of its app says so
  const top = r => { let x = r, k = 0; while (k++ < 50) { const up = byPid.get(x.ppid); if (!up || appOf(up.exe) !== appOf(x.exe)) return x; x = up; } return x; };
  const ours = r => /--headless|--app=http:\/\/127\.0\.0\.1|puppeteer_dev_chrome_profile/.test(args.get(top(r).pid) || '') || /puppeteer_dev_chrome_profile/.test(args.get(r.pid) || '');
  const groups = new Map();
  for (const r of rows) {
    if (SYSTEM.test(r.exe)) continue;
    const app = appOf(r.exe), key = app.toLowerCase();
    if (!key || SKIP.has(key)) continue;
    if (/chrome|edge|brave|chromium/.test(key) && ours(r)) continue;
    const name = NAMES[key] || app;
    const g = groups.get(name) || { name, bytes: 0, procs: 0 };
    g.bytes += (r.rssKB || 0) * 1024; g.procs++; groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

async function scan() {
  const [main, cmds] = await Promise.all([psRun(['-axww', '-o', 'pid=,ppid=,rss=,comm=']), psRun(['-axww', '-o', 'pid=,args='])]);
  if (!main) return null;
  const rows = [];
  for (const l of main.split('\n')) { const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(l); if (m) rows.push({ pid: +m[1], ppid: +m[2], rssKB: +m[3], exe: m[4] }); }
  const args = new Map();
  for (const l of String(cmds || '').split('\n')) { const m = /^\s*(\d+)\s+(.*)$/.exec(l); if (m) args.set(+m[1], m[2]); }
  return group(rows, args);
}

let cache = { at: 0, list: [] }, running = null;

// cached list of programs over minBytes; refreshes in the background when older than maxAgeMs
export function ramHogs({ minBytes = 600 * 2 ** 20, maxAgeMs = 30e3 } = {}) {
  if (Date.now() - cache.at > maxAgeMs && !running) running = scan().then(l => { if (l) cache = { at: Date.now(), list: l }; running = null; });
  return cache.list.filter(g => g.bytes >= minBytes);
}

// the same, fresh (waits for a scan up to ~20 s)
export async function ramHogsNow(opts = {}) {
  if (Date.now() - cache.at > 10e3) { if (!running) running = scan().then(l => { if (l) cache = { at: Date.now(), list: l }; running = null; }); await running; }
  return ramHogs({ ...opts, maxAgeMs: 1e9 });
}

const gb = b => (b / 2 ** 30).toFixed(1) + ' GB';
// one sentence for the job log / Claude: big programs only (≥ 1.5 GB), or null
export function ramNote(list, availMB) {
  const big = list.filter(g => g.bytes >= 1.5 * 2 ** 30);
  if (!big.length) return null;
  return `Programs using RAM: ${big.map(g => `${g.name} ${gb(g.bytes)}`).join(', ')}${availMB ? ` (free RAM ${gb(availMB * 2 ** 20)})` : ''}. ` +
    'Closing them during rendering can speed up the render and keep your computer responsive (the user decides what to close).';
}
