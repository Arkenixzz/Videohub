// VideoHub setup for macOS: a short guided install (setup.sh / SETUP.command run this). Safe to run again: it updates
// instead of duplicating, keeps every answer already given and never moves or overwrites your folders or settings.
//   ./setup.sh [--dry-run] [--yes] [answers...]
//   --dry-run              ask nothing, assume the recommended answers and print every step; change nothing outside this folder
//   --yes                  accept every recommended answer, ask nothing
// Answers (each question has one; "ask" = ask when needed, the default):
//   --workspace <folder>               where your video work lives (default ~/Documents/VideoHub)
//   --watch-found ask|yes|no           also watch video folders found on the Desktop / in Documents (recommended: no)
//   --gpu-encoder ask|yes|no           render with the Mac's video encoder (VideoToolbox) when it works (recommended: yes)
//   --global-rule ask|yes|no           add the "review before rendering" rule to ~/.claude/CLAUDE.md (recommended: yes)
//   --shortcut ask|yes|no              VideoHub.app in ~/Applications, with its icon (recommended: yes)
//   --startup ask|yes|no               start VideoHub (server only, no window) when you log in (recommended: no)
//   --example ask|yes|no               add the example film (recommended: yes)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const INIT = path.join(HUB, 'scripts', 'init-config.mjs');
const CLAUDE_HOME = path.join(HOME, '.claude');
const APP = path.join(HOME, 'Applications', 'VideoHub.app');
const BEGIN = '<!-- videohub:begin (added by VideoHub setup; remove with uninstall.sh) -->', END = '<!-- videohub:end -->';

// ---------- options
const argv = process.argv.slice(2), opt = {};
const ASK = ['watch-found', 'gpu-encoder', 'global-rule', 'shortcut', 'startup', 'example'];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run' || a === '--test') opt.dryRun = true;
  else if (a === '--yes' || a === '-y') opt.yes = true;
  else if (a === '--workspace') opt.workspace = argv[++i];
  else if (ASK.includes(a.slice(2)) && ['ask', 'yes', 'no'].includes(argv[i + 1])) opt[a.slice(2)] = argv[++i];
  else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).slice(0, 13).map(l => l.slice(3)).join('\n')); process.exit(0); }
  else { console.error(`Unknown option: ${a}  (./setup.sh --help)`); process.exit(2); }
}
const DRY = !!opt.dryRun, QUIET = DRY || !!opt.yes;

// ---------- output
const C = { cyan: 36, green: 32, yellow: 33, red: 31, gray: 90, white: 97, blue: 94 };
const say = (m = '', c = null) => console.log(c && process.stdout.isTTY ? `\x1b[${C[c]}m${m}\x1b[0m` : m);
const plan = m => say(`  [dry run] would: ${m}`, 'blue');
const q = m => { say(); say(m, 'white'); };
const rl = QUIET ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
async function yesNo(question, preset, recommended) {
  if (preset === 'yes') return true; if (preset === 'no') return false;
  if (QUIET) { say(`${question} -> ${recommended ? 'yes' : 'no'} (recommended)`, 'gray'); return recommended; }
  for (; ;) {
    const a = (await rl.question(`${question} ${recommended ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
    if (!a) return recommended;
    if (/^(y|yes|o|oui)$/.test(a)) return true; if (/^(n|no|non)$/.test(a)) return false;
    say('  Please type y (yes) or n (no), or press Enter for the recommended answer.', 'yellow');
  }
}
const node = (args, o = {}) => { const r = spawnSync(process.execPath, args, { encoding: 'utf8', ...o }); try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { error: (r.stderr || r.stdout || 'no answer').trim().slice(0, 400) }; } };
const which = name => { for (const d of [...(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin']) { const f = path.join(d, name); if (d && fs.existsSync(f)) return f; } return null; };
const todo = [];

// answers this Mac already gave (a second run does not ask them again); data/ is per machine, never in git
const answersFile = path.join(HUB, 'data', 'setup-answers.json');
let answers = {}; try { answers = JSON.parse(fs.readFileSync(answersFile, 'utf8')); } catch { }

say(`== VideoHub setup: ${HUB}`, 'cyan');
if (DRY) say('Dry run: no questions, the recommended answers, nothing outside this folder is changed.', 'yellow');
else if (opt.yes) say('Using the recommended answer for every question.', 'yellow');
else say('A few plain questions follow. Press Enter to take the recommended answer shown in [brackets].');

// 1. tools (setup.sh already checked Node 22+)
const again = 'double-click SETUP.command again.';
say(`Node.js ${process.version}: ok`, 'green');
const brew = which('brew');
const ff = which('ffmpeg');
if (ff) say(`ffmpeg: ok (${ff})`, 'green');
else {
  say('ffmpeg is missing. VideoHub still lists your films, but it needs ffmpeg to make videos (renders), previews and frame pictures.', 'yellow');
  if (brew) say('  Install it: open Terminal, paste this line and press Enter:   brew install ffmpeg', 'yellow');
  else say('  Install Homebrew first (https://brew.sh: copy the line on that page into Terminal), then:   brew install ffmpeg', 'yellow');
  say(`  Then ${again}`, 'yellow');
  todo.push(`Install ffmpeg (renders need it): ${brew ? '' : 'Homebrew from https://brew.sh, then '}brew install ffmpeg - then run setup again`);
}
const { findBrowsers } = await import('../server/mac.js');
const B = findBrowsers(), browser = B.chrome || B.edge || B.brave || B.chromium;
if (browser) say(`Browser for rendering: ok (${browser})`, 'green');
else {
  say('No Google Chrome or Microsoft Edge found. Renders draw every frame in one of them (invisibly), so they need one.', 'yellow');
  say(`  Install Chrome from https://www.google.com/chrome/${brew ? '  (or: brew install --cask google-chrome)' : ''}, ${again}`, 'yellow');
  todo.push('Install Chrome or Edge (renders use it) - then run setup again');
}
function findClaude() {
  const onPath = which('claude'); if (onPath) return onPath;
  for (const f of [path.join(HOME, '.claude', 'local', 'claude'), path.join(HOME, '.local', 'bin', 'claude')]) if (fs.existsSync(f)) return f;
  // the Claude desktop app's own copy: ~/Library/Application Support/Claude/claude-code/<version>/.../claude, newest first
  const base = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code');
  let vers = []; try { vers = fs.readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); } catch { }
  for (const v of vers) {
    const stack = [path.join(base, v)];
    for (let n = 0; stack.length && n < 400; n++) {
      const d = stack.pop(); let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of es) { const f = path.join(d, e.name); if (e.isFile() && e.name === 'claude') return f; if (e.isDirectory()) stack.push(f); }
    }
  }
  return null;
}
const claude = findClaude();
if (claude) say(`Claude Code: ok (${claude})`, 'green');
else say('Claude Code was not found. VideoHub works without it, but Claude Code is what writes the films: https://claude.com/claude-code (the Claude tools are registered in ~/.claude.json anyway).', 'yellow');

// 2. packages (inside this folder)
if (DRY) plan(`npm install in ${HUB}`);
else {
  const npm = path.join(path.dirname(process.execPath), 'npm');
  const r = spawnSync(fs.existsSync(npm) ? npm : 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: HUB, stdio: 'inherit' });
  if (r.status !== 0) { say('npm install failed (see above).', 'red'); process.exit(1); }
  say('Packages: ok', 'green');
}

// 3. the workspace, folders found on this Mac and render speed: asked here, decided and written by scripts/init-config.mjs
const st = node([INIT, '--state']);
if (st.error) { say(st.error, 'red'); process.exit(1); }
let ws = null, watch = [], enc = null;
if (st.installed) { say(); say(`Your video work lives in: ${st.workspace}  (already set; change single folders in VideoHub > Settings)`, 'green'); }
else {
  q('Where should your video work live?');
  say('  One folder holds everything VideoHub makes: your films, every finished video (outputs), sounds, thumbnails', 'gray');
  say(`  and an archive for old versions. Recommended: ${st.defaultWorkspace}`, 'gray');
  ws = opt.workspace || (QUIET ? st.defaultWorkspace : null);
  for (; ;) {
    if (!ws) { const a = (await rl.question('  Press Enter for the recommended folder, or type another full path: ')).trim().replace(/^["'](.*)["']$/, '$1'); ws = a || st.defaultWorkspace; }
    const chk = node([INIT, '--check', ws]);
    if (chk.ok) break;
    say(`  ${chk.why || chk.error}`, 'yellow');
    if (opt.workspace || QUIET) process.exit(1);
    ws = null;
  }
  say(`  Workspace: ${ws}`, 'green');
  if ((st.discovered || []).length) {
    q('VideoHub found folders that look like video work:');
    for (const d of st.discovered) say(`  - ${d.path}`, 'gray');
    say('  It can list the films in them too (it never moves or changes them). You can also turn them on later in', 'gray');
    say('  VideoHub > Settings > Watched folders.', 'gray');
    if (await yesNo('  Watch these folders as well?', opt['watch-found'], false)) watch = st.discovered.map(d => d.path);
  }
}
if (st.encoder) say(`Render speed: ${st.encoder} (already set; change it in VideoHub > Settings > Render speed)`, 'green');
else if (!ff) { enc = 'auto'; say('Render speed: decided once ffmpeg is installed (run setup again then).', 'yellow'); }
else {
  const det = node([INIT, '--detect', '--ffmpeg', ff, ...(DRY ? ['--dry-run'] : [])]);
  const hw = (det.available || []).filter(x => x !== 'x264');
  if (hw.length) {
    q(`Your Mac (${(det.gpus || [])[0] || 'its graphics'}) can encode video in hardware (VideoToolbox).`);
    enc = await yesNo('  Use it for renders? Usually faster, and your processor stays free.', opt['gpu-encoder'], true) ? 'auto' : 'x264';
  } else { enc = 'auto'; say(); say('Renders will use the processor (the Mac\'s video encoder did not pass its test encode).', 'gray'); }
}
const initArgs = [INIT];
if (ws) initArgs.push('--workspace', ws);
for (const w of watch) initArgs.push('--watch', w);
if (enc) initArgs.push('--encoder', enc);
if (DRY) initArgs.push('--dry-run');
const res = node(initArgs);
if (res.error) { say(res.error, 'red'); process.exit(1); }
for (const line of res.actions || []) { if (line.startsWith('would ')) plan(line.slice(6)); else say(`  ${line}`, 'gray'); }
const wsNow = res.workspace;

// 4. MCP server "videohub" for every Claude Code session (user scope)
const mcp = path.join(HUB, 'server', 'mcp.js');
if (DRY) plan(`register the MCP server: claude mcp add --scope user videohub -- node "${mcp}"  (or write it into ~/.claude.json)`);
else {
  let ok = false;
  if (claude) {
    spawnSync(claude, ['mcp', 'remove', 'videohub', '--scope', 'user'], { stdio: 'ignore' });
    ok = spawnSync(claude, ['mcp', 'add', '--scope', 'user', 'videohub', '--', process.execPath, mcp], { stdio: 'ignore' }).status === 0;
  }
  if (!ok) {
    // no CLI: merge into ~/.claude.json ourselves (backup first); never replace a file that is not readable JSON
    const cj = path.join(HOME, '.claude.json');
    try {
      let j = {};
      if (fs.existsSync(cj)) { j = JSON.parse(fs.readFileSync(cj, 'utf8')); fs.copyFileSync(cj, cj + '.videohub-backup'); }
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        j.mcpServers = { ...(j.mcpServers || {}), videohub: { type: 'stdio', command: process.execPath, args: [mcp], env: {} } };
        fs.writeFileSync(cj, JSON.stringify(j, null, 2)); ok = true;
      }
    } catch { }
  }
  if (ok) say('Claude tools (MCP server "videohub") registered; new Claude Code sessions will see the hub_* tools', 'green');
  else todo.push(`The MCP server could not be registered: claude mcp add --scope user videohub -- "${process.execPath}" "${mcp}"`);
}

// 5. the skill Claude reads (~/.claude/skills/videohub), with this install's path filled in
const sk = path.join(CLAUDE_HOME, 'skills', 'videohub');
if (DRY) plan(`copy skill/videohub to ${sk} (with {{VIDEOHUB_DIR}} = ${HUB})`);
else {
  fs.mkdirSync(sk, { recursive: true });
  for (const f of fs.readdirSync(path.join(HUB, 'skill', 'videohub'))) {
    const src = path.join(HUB, 'skill', 'videohub', f); if (!fs.statSync(src).isFile()) continue;
    fs.writeFileSync(path.join(sk, f), fs.readFileSync(src, 'utf8').split('{{VIDEOHUB_DIR}}').join(HUB));
  }
  say(`Skill installed: ${sk}`, 'green');
}

// 6. the global rule: every Claude Code session on this Mac reviews films in VideoHub before rendering.
//    Kept between marker lines in ~/.claude/CLAUDE.md, replaced on the next run, removed by uninstall.sh.
const cm = path.join(CLAUDE_HOME, 'CLAUDE.md');
const rule = fs.readFileSync(path.join(HUB, 'claude', 'global-rule.md'), 'utf8').split('{{VIDEOHUB_DIR}}').join(HUB).trim();
const cur = fs.existsSync(cm) ? fs.readFileSync(cm, 'utf8') : '';
const rx = new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
let wantRule = opt['global-rule'] || 'ask';
if (wantRule === 'ask' && rx.test(cur)) wantRule = 'yes';                    // added on an earlier run: refreshed, not asked again
else if (wantRule === 'ask' && answers.globalRule === 'no') wantRule = 'no';  // declined on an earlier run
if (wantRule === 'ask') {
  q('Should Claude show you every new film in VideoHub before it renders?');
  say('  This adds a short rule to your Claude instructions (~/.claude/CLAUDE.md): Claude opens each new film in', 'gray');
  say('  VideoHub\'s live preview and waits for your notes before making the video. uninstall.sh removes it again.', 'gray');
  wantRule = await yesNo('  Add the rule?', 'ask', true) ? 'yes' : 'no';
}
answers.globalRule = wantRule;
if (wantRule === 'yes') {
  const block = `${BEGIN}\n${rule}\n${END}`;
  const next = rx.test(cur) ? cur.replace(rx, () => block) : cur.trim() ? cur.trimEnd() + '\n\n' + block + '\n' : block + '\n';
  if (DRY) { plan(`write this block into ${cm} (replacing an older VideoHub block if there is one):`); say(block, 'gray'); }
  else {
    fs.mkdirSync(CLAUDE_HOME, { recursive: true });
    if (fs.existsSync(cm)) fs.copyFileSync(cm, cm + '.videohub-backup');
    fs.writeFileSync(cm, next);
    say(`Global rule added to ${cm} (backup: CLAUDE.md.videohub-backup)`, 'green');
  }
} else say('Global rule skipped (run setup again with --global-rule yes to add it later).');

// 7. VideoHub.app in ~/Applications (Spotlight, Launchpad, and you can drag it to the Dock): runs open.sh, no Terminal
const appMine = () => { try { return fs.readFileSync(path.join(APP, 'Contents', 'Resources', 'videohub-dir.txt'), 'utf8').trim() === HUB; } catch { return false; } };
const wantApp = opt.shortcut && opt.shortcut !== 'ask' ? opt.shortcut === 'yes' : appMine() ? true : answers.shortcut === 'no' ? false
  : (q('An app in your Applications folder opens VideoHub with a click (you can also drag it to the Dock).'), await yesNo('  Make the VideoHub app?', 'ask', true));
answers.shortcut = wantApp ? 'yes' : 'no';
if (wantApp) {
  if (DRY) plan(`create ${APP} (runs "${path.join(HUB, 'open.sh')}")`);
  else {
    try {
      const script = `do shell script "/bin/zsh -lc " & quoted form of ${JSON.stringify(path.join(HUB, 'open.sh'))} & " > /dev/null 2>&1 &"`;
      fs.mkdirSync(path.dirname(APP), { recursive: true });
      if (fs.existsSync(APP) && !appMine()) throw new Error(`${APP} exists and belongs to another VideoHub folder; it was left as it is`);
      fs.rmSync(APP, { recursive: true, force: true });
      execFileSync('osacompile', ['-o', APP, '-e', script], { stdio: 'ignore' });
      const res = path.join(APP, 'Contents', 'Resources');
      fs.writeFileSync(path.join(res, 'videohub-dir.txt'), HUB + '\n');
      const icns = path.join(HUB, 'data', 'VideoHub.icns');
      try { if (!fs.existsSync(icns)) (await import('./make-icon.mjs')).makeIcon(icns); fs.copyFileSync(icns, path.join(res, 'applet.icns')); } catch (e) { say(`  (no icon: ${e.message})`, 'gray'); }
      // a changed Info.plist / icon is picked up once the bundle date changes
      const now = new Date(); fs.utimesSync(APP, now, now);
      spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', APP], { stdio: 'ignore' });
      say(`VideoHub app: ${APP}`, 'green');
    } catch (e) { say(`The VideoHub app could not be made: ${e.message}`, 'yellow'); todo.push(`Open VideoHub with: ${path.join(HUB, 'open.sh')}`); }
  }
}

// 8. start at login: off unless chosen (it can also be switched on later on VideoHub's Renders page)
const mac = await import('../server/mac.js');
const hasRun = mac.loginItemOn(HUB);
const wantRun = opt.startup && opt.startup !== 'ask' ? opt.startup === 'yes' : hasRun ? true : answers.startup ? answers.startup === 'yes'
  : (q('VideoHub can start quietly when you log in (no window), so Claude\'s tools and the render queue are always ready.'), await yesNo('  Start VideoHub at login?', 'ask', false));
answers.startup = wantRun ? 'yes' : 'no';
if (wantRun !== hasRun) {
  if (DRY) plan(wantRun ? `write the LaunchAgent ${mac.launchAgentFile()}` : `remove the LaunchAgent ${mac.launchAgentFile()}`);
  else { mac.setLoginItem(wantRun, HUB); say(wantRun ? 'VideoHub starts at login (server only, no window)' : 'VideoHub no longer starts at login', 'green'); }
} else if (wantRun) say('VideoHub starts at login (already set).', 'green');

// 9. the example film: a 10-second film that shows the whole loop (the same copy as the Welcome panel's button)
const exHave = fs.existsSync(path.join(wsNow, 'films', 'hello-film', 'index.html'));
const wantEx = opt.example && opt.example !== 'ask' ? opt.example === 'yes' : (exHave || answers.example) ? false
  : (q('Add the example film so you can try VideoHub right away? (a 10-second film; delete it whenever you like)'), await yesNo('  Add it?', 'ask', true));
if (!answers.example) answers.example = wantEx || exHave ? 'yes' : 'no';
if (wantEx) {
  if (DRY) plan(`copy examples/hello-film into ${path.join(wsNow, 'films')} (unless it is there already)`);
  else {
    const ex = node([INIT, '--example']);
    if (ex.error) say(`The example film could not be added: ${ex.error}  (the Welcome panel in VideoHub offers it too)`, 'yellow');
    else if (ex.kept) say(`The example film is already there: ${ex.target || ex.path}`, 'green');
    else say(`Example film added: ${ex.path || ex.target}`, 'green');
  }
}

// remember the answers (a second run shows them instead of asking)
if (DRY) plan(`remember the answers in ${answersFile}`);
else { fs.mkdirSync(path.dirname(answersFile), { recursive: true }); fs.writeFileSync(answersFile, JSON.stringify(answers, null, 1)); }
rl?.close();

say();
say('== Done. What now:', 'cyan');
say(`  Your video work lives in  ${wsNow}  (films, outputs, sounds, thumbnails, archive; README.txt says what each is).`);
say(wantApp ? '  Open VideoHub from your Applications folder (or Spotlight: type "VideoHub").' : `  Open VideoHub: ${path.join(HUB, 'open.sh')}`);
say('  Start a NEW Claude Code session (sessions already open do not see VideoHub\'s tools).');
if (wantEx || exHave) say('  First thing to try: click the "hello-film" card in VideoHub, press Space to play it, click a frame to leave a note.');
else say('  First thing to try: ask Claude Code "make me a 10-second animated title as a VideoHub film" and watch it appear in VideoHub.');
if (DRY) { say(); say('Dry run finished: nothing outside this folder was changed.', 'yellow'); }
if (todo.length) { say(); say('Left for you to do:', 'yellow'); for (const t of todo) say(` - ${t}`, 'yellow'); }
