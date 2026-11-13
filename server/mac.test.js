import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePs, descendants, parseVmStat, launchAgentPlist, launchAgentFile, loginItemOn, setLoginItem, asString, openCommand, trash } from './mac.js';
import { appOf, group } from './ramhogs.js';

test('ps output: program paths with spaces, root first then every process below it', () => {
  const rows = parsePs(`    1     0  12000 /sbin/launchd
  500     1 300000 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  501   500  90000 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)
  600   500   1000 /opt/homebrew/bin/ffmpeg
  601   600    500 /bin/sh
  700     1    800 /usr/local/bin/node
garbage line`);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[1], { pid: 500, ppid: 1, rssKB: 300000, exe: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', name: 'Google Chrome' });
  assert.equal(rows[2].name, 'Google Chrome Helper (Renderer)');
  assert.deepEqual(descendants(rows, 500), [500, 501, 600, 601]);
  assert.deepEqual(descendants(rows, 700), [700]);
  assert.deepEqual(descendants(rows, 999), [999]);   // gone: just itself
});

test('vm_stat: available = free + inactive + speculative pages, in bytes, with the page size it reports', () => {
  const out = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3000.
Pages active:                             90000.
Pages inactive:                           88000.
Pages speculative:                         1000.
Pages throttled:                              0.
Pages wired down:                         70000.
Pages purgeable:                           2000.`;
  assert.equal(parseVmStat(out), (3000 + 88000 + 1000) * 16384);
  assert.equal(parseVmStat('nothing here'), null);
});

test('RAM list: a program is its outermost app (helpers count), macOS and VideoHub\'s own browsers are left out', () => {
  assert.equal(appOf('/Applications/Google Chrome.app/Contents/Frameworks/X.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper'), 'Google Chrome');
  assert.equal(appOf('/usr/local/bin/qemu-system-aarch64'), 'qemu-system-aarch64');
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', helper = '/Applications/Google Chrome.app/Contents/Frameworks/H.app/Contents/MacOS/Google Chrome Helper';
  const rows = [
    { pid: 10, ppid: 1, rssKB: 1048576, exe: chrome }, { pid: 11, ppid: 10, rssKB: 1048576, exe: helper },
    { pid: 20, ppid: 1, rssKB: 4194304, exe: chrome }, { pid: 21, ppid: 20, rssKB: 4194304, exe: helper },   // a headless render
    { pid: 30, ppid: 1, rssKB: 9000000, exe: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder' },
    { pid: 40, ppid: 1, rssKB: 2097152, exe: '/Applications/Discord.app/Contents/MacOS/Discord' },
    { pid: 50, ppid: 1, rssKB: 2097152, exe: '/Applications/Claude.app/Contents/MacOS/Claude' },
  ];
  const g = group(rows, new Map([[20, chrome + ' --headless=new --user-data-dir=/tmp/x']]));
  assert.deepEqual(g.map(x => [x.name, x.bytes / 2 ** 30, x.procs]), [['Chrome (browser)', 2, 2], ['Discord', 2, 1]]);
});

test('start at login: a LaunchAgent for this install only, written and removed as a file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-la-')), hub = '/Users/me/Video & Hub';
  try {
    const xml = launchAgentPlist(hub, '/usr/local/bin/node');
    assert.match(xml, /<string>com\.videohub\.server<\/string>/);
    assert.match(xml, /<string>\/Users\/me\/Video &amp; Hub\/server\/hub\.js<\/string>/);
    assert.match(xml, /\/opt\/homebrew\/bin:\/usr\/local\/bin/);
    assert.equal(loginItemOn(hub, home), false);
    assert.equal(setLoginItem(true, hub, home), true); assert.ok(fs.existsSync(launchAgentFile(home)));
    assert.equal(loginItemOn('/another/VideoHub', home), false);
    setLoginItem(false, '/another/VideoHub', home); assert.ok(fs.existsSync(launchAgentFile(home)), 'another install never removes ours');
    assert.equal(setLoginItem(false, hub, home), false); assert.ok(!fs.existsSync(launchAgentFile(home)));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('AppleScript strings and Finder commands are quoted, never run through a shell', () => {
  assert.equal(asString('say "hi" \\ there\nnext'), '"say \\"hi\\" \\\\ there next"');
  assert.deepEqual(openCommand('/a b/c.mp4'), { command: 'open', args: ['/a b/c.mp4'] });
  assert.deepEqual(openCommand('/a b/c.mp4', true), { command: 'open', args: ['-R', '/a b/c.mp4'] });
});

// moves a real file to your Trash: only when asked (VIDEOHUB_TEST_TRASH=1 npm test)
test('the Trash: moved, or a plain reason when it cannot be (nothing is ever deleted outright)', { skip: !process.env.VIDEOHUB_TEST_TRASH }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-trash-')), f = path.join(d, 'é « x ».txt');
  fs.writeFileSync(f, 'x');
  try {
    const r = await trash([f, path.join(d, 'missing.txt')]);
    assert.equal(r[0].ok, true); assert.ok(!fs.existsSync(f));
    assert.equal(r[1].ok, false); assert.ok(r[1].error);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
