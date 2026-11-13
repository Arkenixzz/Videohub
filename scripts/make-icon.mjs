// VideoHub's icon (a dark tile with a gauge), drawn as SVG, rendered by headless Chrome (transparent corners) and
// packed by macOS's own sips + iconutil.
//   node scripts/make-icon.mjs <out.icns>          (setup writes data/VideoHub.icns for VideoHub.app)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findBrowsers } from '../server/mac.js';

// the same drawing as the Windows icon, on Apple's icon grid (an 824 px tile in a 1024 px canvas)
export function iconSvg() {
  const T = 100, S = 824, cx = 512, cy = T + S * 0.62, r = S * 0.33, pw = S * 0.085;
  const at = deg => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)].map(v => v.toFixed(1)).join(' ');
  const len = r * 0.82, a = -140 * Math.PI / 180, nx = (cx + len * Math.cos(a)).toFixed(1), ny = (cy + len * Math.sin(a)).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect x="${T}" y="${T}" width="${S}" height="${S}" rx="${S * 0.225}" fill="#1e222c"/>
<g fill="none" stroke-linecap="round" stroke-width="${pw.toFixed(1)}">
<path d="M ${at(180)} A ${r} ${r} 0 0 1 ${at(300)}" stroke="#ebebf0"/>
<path d="M ${at(300)} A ${r} ${r} 0 0 1 ${at(360)}" stroke="#e8742c"/>
<line x1="${cx}" y1="${cy.toFixed(1)}" x2="${nx}" y2="${ny}" stroke="#e8742c" stroke-width="${(pw * 0.9).toFixed(1)}"/>
</g>
<circle cx="${cx}" cy="${cy.toFixed(1)}" r="${(S * 0.065).toFixed(1)}" fill="#ebebf0"/>
</svg>`;
}

export function makeIcon(out) {
  const b = findBrowsers(), exe = b.chrome || b.edge || b.brave || b.chromium;
  if (!exe) throw new Error('no Chrome/Edge to draw the icon with');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-icon-'));
  try {
    const svg = path.join(tmp, 'icon.svg'), png = path.join(tmp, 'icon.png'), set = path.join(tmp, 'VideoHub.iconset');
    fs.writeFileSync(svg, iconSvg());
    execFileSync(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', '--window-size=1024,1024',
      `--user-data-dir=${path.join(tmp, 'profile')}`, `--screenshot=${png}`, 'file://' + svg], { stdio: 'ignore', timeout: 60000 });
    fs.mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(s), String(s), png, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), png, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync('iconutil', ['-c', 'icns', set, '-o', out], { stdio: 'ignore' });
    return out;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/make-icon.mjs <out.icns>'); process.exit(2); }
  console.log(makeIcon(path.resolve(out)));
}
