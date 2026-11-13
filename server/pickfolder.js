// The Mac's own "Choose a folder" window (see mac.js), in front of every window. Returns the folder or null (cancelled).
import { pickFolder as macPick } from './mac.js';

export function pickFolder(start, title = 'Choose folder') {
  return macPick(start, title).catch(() => null);
}
