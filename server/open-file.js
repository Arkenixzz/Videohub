import fs from 'node:fs';
import path from 'node:path';
import { openCommand, openPath } from './mac.js';

// `open` opens videos with their default app, without a shell. "file" opens only media (video, audio, pictures): a
// .command/.app/.sh inside a film folder would run through its association. "folder" shows anything in the Finder.
export const OPENABLE = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v', '.avi', '.wav', '.mp3', '.m4a', '.ogg', '.aac', '.flac', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
export function openPlan(file, how = 'file') {
  if (typeof file !== 'string' || !file || /["\r\n\0]/.test(file)) throw Object.assign(new Error('Invalid file path'), { code: 400 });
  if (!['file', 'folder'].includes(how)) throw Object.assign(new Error('Invalid open action'), { code: 400 });
  const target = path.resolve(file);
  let st; try { st = fs.statSync(target); } catch { throw Object.assign(new Error('The file has been moved or deleted. Refresh the list.'), { code: 404 }); }
  if (how === 'file' && st.isFile() && !OPENABLE.has(path.extname(target).toLowerCase())) throw Object.assign(new Error('Only videos, sounds and pictures can be opened from VideoHub; use "Show in Finder".'), { code: 400 });
  if (how === 'file' && st.isDirectory() && /\.app$/i.test(target)) throw Object.assign(new Error('Apps cannot be opened from VideoHub; use "Show in Finder".'), { code: 400 });
  const select = how === 'folder' && st.isFile();
  return { target, how, select, ...openCommand(target, select) };
}

export async function openFile(file, how) {
  const plan = openPlan(file, how);
  await openPath(plan.target, plan.select);
  return { ok: true, path: plan.target, how: plan.how, select: plan.select };
}
