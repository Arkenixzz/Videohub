// Everything VideoHub asks of macOS, in one place: Finder, the Trash, notifications, the folder picker, processes,
// memory, graphics cards and the login item. The rest of the server stays plain Node.
// Self-contained (no import from util.js), so util.js can use it too.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

const NO_WINDOW = () => !!process.env.VIDEOHUB_NO_WINDOW;
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 << 20, ...opts }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}
const detach = (cmd, args) => new Promise((resolve, reject) => {
  const c = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  c.once('error', reject);
  c.once('spawn', () => { c.unref(); resolve(); });
});

// ---------- Finder
// a folder or file opened with its default app (Finder for a folder), or a file shown selected in its Finder window
export const openCommand = (target, select = false) => ({ command: 'open', args: select ? ['-R', target] : [target] });
export function openPath(target, select = false) {
  if (NO_WINDOW()) return Promise.resolve();
  const c = openCommand(target, select);
  return detach(c.command, c.args);
}
export const reveal = (target) => openPath(target, true);

// ---------- browsers: VideoHub's window is a Chromium "app" window (no tabs, no address bar); renders drive one headless
export const BROWSER_PATHS = [
  ['chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['edge', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  ['brave', 'Brave Browser.app/Contents/MacOS/Brave Browser'],
  ['chromium', 'Chromium.app/Contents/MacOS/Chromium'],
];
export function findBrowsers() {
  const out = {};
  for (const [key, rel] of BROWSER_PATHS) {
    for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      const f = path.join(dir, rel);
      if (!out[key] && fs.existsSync(f)) out[key] = f;
    }
  }
  return out;
}
export function openAppWindow(url, exe) {
  if (NO_WINDOW()) return Promise.resolve();
  // a running Chrome takes the new window over from this short-lived process
  if (exe) return detach(exe, ['--app=' + url]).catch(() => detach('open', [url]));
  return detach('open', [url]);
}

// ---------- AppleScript
// an AppleScript string literal
export const asString = (s) => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
export function notify(title, text) {
  if (NO_WINDOW()) return;
  try { spawn('osascript', ['-e', `display notification ${asString(text)} with title ${asString(title)}`], { detached: true, stdio: 'ignore' }).unref(); } catch { }
}
// the Mac's own "Choose a folder" window, brought to the front. Returns the folder (no trailing /) or null (cancelled)
export async function pickFolder(start, title = 'Choose folder') {
  if (NO_WINDOW()) return null;
  const lines = ['tell me to activate'];
  const from = start && fs.existsSync(start) ? ` default location (POSIX file ${asString(start)})` : '';
  lines.push(`POSIX path of (choose folder with prompt ${asString(title)}${from})`);
  const r = await run('osascript', lines.flatMap(l => ['-e', l]));
  const p = r.code === 0 ? r.stdout.trim() : '';
  return p ? (p.length > 1 ? p.replace(/\/+$/, '') : p) : null;
}

// ---------- the Trash
// NSFileManager's trashItemAtURL through JavaScript for Automation: the same as Finder's "Move to Trash", without asking
// for Finder automation rights. One osascript for the whole list, one JSON line per item as it goes:
// {n, ok, error}. A volume without a Trash (network drives) fails, and the item stays: never a permanent delete.
const TRASH_JXA = `
ObjC.import('Foundation');
function run(argv) {
  const out = $.NSFileHandle.fileHandleWithStandardOutput;
  const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
  const items = JSON.parse(text);
  const fm = $.NSFileManager.defaultManager;
  for (let n = 0; n < items.length; n++) {
    // $() holders for the out-parameters: null or Ref() here crash osascript (segfault) when the call fails
    const err = $();
    let ok = false, msg = null;
    try { ok = fm.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(items[n]), $(), err); } catch (e) { msg = String(e); }
    if (!ok && !msg) { try { msg = err.localizedDescription.js; } catch (e) { msg = 'Could not move it to the Trash.'; } }
    out.writeData($(JSON.stringify({ n: n, ok: !!ok, error: ok ? null : msg }) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
  }
}`;
// onItem(index, ok, error) for each path; resolves when the list is done (a stuck run ends after 5 min without progress)
export function trashStream(paths, onItem, tmpDir = os.tmpdir()) {
  return new Promise((resolve) => {
    if (!paths.length) return resolve();
    const listFile = path.join(tmpDir, `vh-trash-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(listFile, JSON.stringify(paths));
    const p = spawn('osascript', ['-l', 'JavaScript', '-e', TRASH_JXA, listFile]);
    let buf = '', err = '', seen = 0, timer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { try { p.kill(); } catch { } }, 5 * 60e3); };
    arm();
    p.stdout.on('data', d => {
      buf += d; let k;
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
        if (!line.startsWith('{')) continue;
        try { const j = JSON.parse(line); seen = Math.max(seen, j.n + 1); onItem(j.n, j.ok, j.error); arm(); } catch { }
      }
    });
    p.stderr.on('data', d => { err += d; });
    const done = () => {
      clearTimeout(timer); try { fs.unlinkSync(listFile); } catch { }
      for (let i = seen; i < paths.length; i++) onItem(i, false, (err.trim().split('\n').pop() || 'The Trash did not answer (timeout or error).').slice(0, 300));
      resolve();
    };
    p.on('close', done);
    p.on('error', e => { err += String(e.message || e); });
  });
}
export async function trash(paths) {
  const res = new Array(paths.length).fill(null);
  await trashStream(paths, (i, ok, error) => { res[i] = { path: paths[i], ok, error }; });
  return res;
}

// ---------- processes
// `ps -axo pid=,ppid=,rss=,comm=` → [{ pid, ppid, rssKB, name, exe }]; comm is the full program path and may hold spaces
export function parsePs(out) {
  const list = [];
  for (const l of String(out || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(l); if (!m) continue;
    list.push({ pid: +m[1], ppid: +m[2], rssKB: +m[3], exe: m[4], name: path.basename(m[4]) });
  }
  return list;
}
export async function listProcesses() {
  const r = await run('ps', ['-axo', 'pid=,ppid=,rss=,comm=']);
  return r.code === 0 ? parsePs(r.stdout) : [];
}
// root and every process below it, root first
export function descendants(list, root) {
  const kids = new Map();
  for (const p of list) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p.pid); }
  const out = [root], seen = new Set(out);
  for (let i = 0; i < out.length; i++) for (const k of kids.get(out[i]) || []) if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out;
}
export const processTree = async (pid) => descendants(await listProcesses(), +pid);
export async function killTree(pid) {
  const ids = await processTree(pid);
  for (const i of ids.slice().reverse()) { try { process.kill(i, 'SIGTERM'); } catch { } }
  setTimeout(() => { for (const i of ids) { try { process.kill(i, 0); process.kill(i, 'SIGKILL'); } catch { } } }, 3000).unref();
  return ids;
}
// Mac priorities: nice (a user can only lower it: raising it back fails quietly) and the background QoS (on Apple
// Silicon: the efficiency cores only, low disk and network priority; reversible). Processes started later inherit both.
export async function setTreePriority(pid, nice, background) {
  const ids = await processTree(pid);
  for (const i of ids) {
    try { os.setPriority(i, nice); } catch { }
    await run('taskpolicy', [background ? '-b' : '-B', '-p', String(i)]);
  }
  return ids;
}

// ---------- memory
// what macOS can give to a new program at once: free + inactive + speculative pages. os.freemem() counts only the
// "free" pages, which macOS keeps near zero on purpose (file cache), so it cannot be used to decide anything.
export function parseVmStat(out) {
  const s = String(out || '');
  const page = +(/page size of (\d+) bytes/.exec(s)?.[1] || 4096);
  const get = (k) => +((new RegExp('Pages ' + k + ':\\s+(\\d+)')).exec(s)?.[1] || 0);
  const pages = get('free') + get('inactive') + get('speculative');
  return pages ? pages * page : null;
}
let memCache = { at: 0, bytes: null };
export async function availableMem() {
  if (Date.now() - memCache.at < 1000 && memCache.bytes != null) return memCache.bytes;
  const r = await run('vm_stat', []);
  const b = r.code === 0 ? parseVmStat(r.stdout) : null;
  memCache = { at: Date.now(), bytes: b ?? os.freemem() };
  return memCache.bytes;
}
export const lastAvailableMem = () => memCache.bytes ?? os.freemem();

// ---------- graphics
export async function gpuNames() {
  const r = await run('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 15000 });
  try { return (JSON.parse(r.stdout).SPDisplaysDataType || []).map(g => g.sppci_model || g._name).filter(Boolean); } catch { return []; }
}

// ---------- start at login: a LaunchAgent that starts the VideoHub server (no window) when the user logs in
export const LAUNCH_LABEL = 'com.videohub.server';
export const launchAgentFile = (home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents', LAUNCH_LABEL + '.plist');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function launchAgentPlist(hubDir, node = process.execPath) {
  const env = ['/opt/homebrew/bin', '/usr/local/bin', path.dirname(node), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const PATH = [...new Set(env)].join(':');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(path.join(hubDir, 'server', 'hub.js'))}</string></array>
  <key>WorkingDirectory</key><string>${xml(hubDir)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(PATH)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(hubDir, 'data', 'hub.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(hubDir, 'data', 'hub.log'))}</string>
</dict>
</plist>
`;
}
// is VideoHub (this install) started at login?
export function loginItemOn(hubDir, home = os.homedir()) {
  try { return fs.readFileSync(launchAgentFile(home), 'utf8').includes(xml(path.join(hubDir, 'server', 'hub.js'))); } catch { return false; }
}
// writes or removes the file only: it takes effect at the next login (loading it now would start a second hub)
export function setLoginItem(on, hubDir, home = os.homedir()) {
  const f = launchAgentFile(home);
  if (on) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, launchAgentPlist(hubDir)); }
  else if (loginItemOn(hubDir, home)) fs.rmSync(f, { force: true });
  return loginItemOn(hubDir, home);
}
