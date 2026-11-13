// VideoHub's render protection, built into the hub (plain Node + macOS's own tools: ps, renice, taskpolicy, vm_stat).
// What it does on a Mac:
//  - every render VideoHub's queue starts runs at a lower priority (nice 10), which macOS passes on to every process the
//    render starts later (Chrome, ffmpeg). macOS has no CPU affinity, so a "share of the cores" cannot be set: the
//    Quiet preset (CapActive ≤ 50) puts renders on the background QoS instead (on Apple Silicon: the efficiency cores).
//  - available RAM is watched (vm_stat, not os.freemem(), which macOS keeps near zero on purpose): below PauseMB the
//    newest render slows down (background QoS), below CriticalMB every render does; when RAM is
//    back they return to normal speed, oldest first
//  - Slow down / Normal speed / Stop per render on the Renders page
// It does not freeze (pause) renders, and it does not watch renders started outside VideoHub's queue.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { APPDATA, HUB_DIR, readJson, processAlive } from './util.js';
import { availableMem, lastAvailableMem, setTreePriority, killTree, loginItemOn, setLoginItem } from './mac.js';

const RG = path.join(APPDATA, 'VideoHub');   // settings.txt (and history.log, if an older tool wrote one)
const MB = 1048576;

// ---------- settings (settings.txt, key=value). VideoHub is its only UI.
const SETTINGS = path.join(RG, 'settings.txt');
const DEFAULTS = { CapActive: 100, CapIdle: 100, IdleMin: 2, PauseMB: 700, CriticalMB: 500, SlowCapPct: 5, LowPrio: 1 };
// "Start at login": a LaunchAgent that starts the VideoHub server (no window) at log-in (mac.js)
function readKv() {
  const kv = {}; let txt = ''; try { txt = fs.readFileSync(SETTINGS, 'utf8').replace(/^\uFEFF/, ''); } catch { }
  for (const l of txt.split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return kv;
}
function current() {
  const kv = readKv(), out = {};
  for (const [k, d] of Object.entries(DEFAULTS)) out[k] = kv[k] != null && kv[k] !== '' && Number.isFinite(+kv[k]) ? +kv[k] : d;
  return out;
}
let S = current();
export async function guardSettings() {
  const out = current();
  out.Startup = loginItemOn(HUB_DIR);
  out.exe = null; out.builtIn = true;
  return out;
}
export async function saveGuardSettings(patch) {
  const kv = readKv();
  for (const k of Object.keys(DEFAULTS)) if (patch[k] != null) kv[k] = String(typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : Math.round(+patch[k]));
  fs.mkdirSync(RG, { recursive: true });
  fs.writeFileSync(SETTINGS, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n'));
  if (patch.Startup != null) setLoginItem(!!patch.Startup, HUB_DIR);
  guardCommand('reload');
  return guardSettings();
}
// there is no agent program any more (kept for callers and old UIs)
export const guardExe = () => null;

// ---------- the renders VideoHub started (the queue tells us: guardTrack) and what was applied to them
const tracked = new Map();   // root pid -> { rootPid, start, cwd, project, what, slow: null|'RAM'|'manual', applied, changedAt }
let timer = null, lastRamChange = 0, updated = null;
export function guardTrack(pid, info = {}) {
  if (!pid) return;
  tracked.set(pid, { rootPid: pid, start: new Date().toISOString(), cwd: info.cwd || '', project: info.project || '', what: info.what || '', slow: null, applied: null, changedAt: 0 });
  if (timer) apply(tracked.get(pid)).catch(() => { });
}

// Two levers. nice (0 normal, 10 low): macOS lets a user lower a priority but never raise it again, so it is only the
// render's starting priority ("Run renders at low priority"). The background QoS (taskpolicy -b / -B: on Apple Silicon
// the efficiency cores, low disk priority) can be set and lifted at any time: Quiet, slow mode and "Slow down" use it.
const NICE = { BelowNormal: 10, Normal: 0 };
function wanted(r) {
  if (!timer) return { prio: 'Normal', background: false };   // protection off (the hub is closing): background lifted
  return { prio: S.LowPrio ? 'BelowNormal' : 'Normal', background: !!r.slow || S.CapActive <= 50 };
}
// the whole process tree of the render, once per change (never a poll). Processes the render starts later inherit both.
async function apply(r, force = false) {
  const w = wanted(r), key = w.prio + '/' + (w.background ? 'bg' : 'fg');
  if (!force && r.applied === key) return;
  r.applied = key;
  await setTreePriority(r.rootPid, NICE[w.prio], w.background);
}

// every 3 s while protection is on: forget renders that ended, slow down / restore for RAM
async function tick() {
  for (const [pid] of tracked) if (!processAlive(pid)) tracked.delete(pid);
  const free = (await availableMem()) / MB, list = [...tracked.values()].sort((a, b) => a.start.localeCompare(b.start));
  updated = new Date().toISOString();
  if (!list.length || Date.now() - lastRamChange < 20e3) return;   // one change at a time, then 20 s to settle (no ping-pong)
  const ram = list.filter(r => r.slow === 'RAM'), normal = list.filter(r => !r.slow);
  let pick = null, slow = null;
  if (free < S.CriticalMB && normal.length) { pick = normal[0]; slow = 'RAM'; }                         // even the oldest
  else if (free < S.PauseMB && normal.length > 1) { pick = normal[normal.length - 1]; slow = 'RAM'; }   // the newest first
  else if (free > S.PauseMB + 500 && ram.length) { pick = ram[0]; slow = null; }                       // back, oldest first
  if (!pick) return;
  pick.slow = slow; lastRamChange = Date.now();
  apply(pick).catch(() => { });
}

// live state (same shape the old agent wrote to state.json)
export function guardState() {
  if (!timer) return { running: false, reason: 'render protection is off' };
  const free = lastAvailableMem() / MB;
  return {
    running: true, builtIn: true, updated: updated || new Date().toISOString(), age: 0,
    ramAvailMB: Math.round(free), ramTotalMB: Math.round(os.totalmem() / MB), cpu: null, capNow: S.CapActive, hotkeys: false,
    pauseMB: S.PauseMB, criticalMB: S.CriticalMB, slowCapPct: S.SlowCapPct,
    renders: [...tracked.values()].map(r => ({ rootPid: r.rootPid, start: r.start, project: r.project, cwd: r.cwd, cmd: '', what: r.what, slow: r.slow, paused: false, cpu: null, ramMB: null })),
    settings: { ...S },
  };
}

// Renders page buttons and old callers. Freezing is gone: "pause" now slows the render down to the minimum instead.
export function guardCommand(action, rootPid) {
  const pick = rootPid ? [tracked.get(+rootPid)].filter(Boolean) : [...tracked.values()];
  let note = null;
  if (action === 'reload') { S = current(); for (const r of tracked.values()) apply(r).catch(() => { }); return { ok: true, note }; }
  if (action === 'kill') { for (const r of pick) killTree(r.rootPid).catch(() => { }); return { ok: true, note }; }
  if (/^(pause|pauseAll|slow)$/.test(action)) { if (action !== 'slow') note = 'Pausing is no longer available: the render was slowed down to the minimum instead.'; for (const r of pick) { r.slow = 'manual'; apply(r).catch(() => { }); } }
  else if (/^(resume|resumeAll|normal)$/.test(action)) for (const r of pick) { r.slow = null; apply(r).catch(() => { }); }
  else return { ok: false, note: 'unknown command' };
  if (!timer) note = 'Render protection is off right now.';
  return { ok: true, note };
}

// on while VideoHub is used (a page is open or a render runs); off when the hub idles out: renders back to normal
export async function guardProcRunning() { return !!timer; }
export async function ensureGuard() {
  if (timer) return false;
  S = current(); timer = setInterval(() => tick().catch(() => { }), 3000); timer.unref(); availableMem().then(() => tick()).catch(() => { });
  for (const r of tracked.values()) apply(r, true).catch(() => { });
  return true;
}
export async function quitGuard() {
  if (!timer) return true;
  clearInterval(timer); timer = null;
  await Promise.all([...tracked.values()].map(r => apply(r, true).catch(() => { })));
  return true;
}

// ---------- the old agent's history.log (renders it saw end, also outside the queue): still read, no longer written
// "2026-10-23 18:07:04  BİTTİ     <session>  [<project>]  <what>  <dur>  %NN". Parsed once, kept by size+mtime.
const parseLine = l => {
  const m = l.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s+(\S+(?: \([^)]*\))?)\s+(.*)$/);
  if (!m) return null;
  const rest = m[3], pm = rest.match(/\[([^\]]*)\]/);
  return { at: m[1].replace(' ', 'T'), event: m[2].trim(), session: pm ? rest.slice(0, pm.index).trim() : '', project: pm ? pm[1] : '', detail: pm ? rest.slice(pm.index + pm[0].length).trim() : rest };
};
let hist = null;
export function guardHistory(limit = 400) {
  const f = path.join(RG, 'history.log');
  let st; try { st = fs.statSync(f); } catch { return []; }
  if (!hist || hist.size !== st.size || hist.mtime !== st.mtimeMs) {
    try { hist = { size: st.size, mtime: st.mtimeMs, all: fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(parseLine) }; } catch { return []; }
  }
  return hist.all.slice(-limit).filter(Boolean).reverse();
}

// Snipp writes <cikti>\.renders\<name>.json (RenderStatus v1) for every export
export function snippRenders() {
  const out = [];
  for (const r of config().roots) {
    if (r.enabled === false) continue;
    const dir = path.join(r.path, '.renders');
    let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const j = readJson(path.join(dir, f)); if (!j) continue;
      let mtime = 0; try { mtime = fs.statSync(path.join(dir, f)).mtimeMs; } catch { }
      out.push({ source: 'snipp', name: f.replace(/\.json$/, ''), state: j.state, progress: j.progress, label: j.label, output: j.output, error: j.error, updated: mtime });
    }
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, 50);
}
