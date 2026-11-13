#!/bin/zsh
# VideoHub update: pulls the newest code into this folder (git), installs packages and refreshes what setup installed
# (the skill, the rule, the app). Keeps this Mac's data/ (settings, render queue, caches) and every project's notes.
#   ./update.sh [--dry-run]
HUB="${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
DRY=0; [[ "$1" == "--dry-run" ]] && DRY=1
cd "$HUB" || exit 1
echo "== VideoHub update: $HUB"
PORT="$(node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(c.port||7788)}catch{console.log(7788)}' "$HUB/data/config.json")"
URL="http://127.0.0.1:$PORT"
# not while something renders or cleans (the hub is stopped under it)
if curl -fs -m 2 "$URL/api/ping" >/dev/null 2>&1; then
  BUSY="$(curl -fs -m 5 "$URL/api/jobs" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((Array.isArray(j)?j:j.jobs||[]).filter(x=>["running","queued"].includes(x.state)).length)}catch{console.log(0)}})')"
  if [[ "$BUSY" != "0" ]]; then echo "$BUSY render(s) running or queued. Run this again when they are done; nothing was changed."; exit 2; fi
fi
GIT="$(command -v git)"; [[ -x /Applications/Xcode.app/Contents/Developer/usr/bin/git ]] && GIT=/Applications/Xcode.app/Contents/Developer/usr/bin/git
if [[ -d .git && -n "$GIT" ]]; then
  if (( DRY )); then echo "  [dry run] would: git pull --ff-only"; else "$GIT" pull --ff-only || { echo "git pull failed (local changes?). Nothing else was changed."; exit 1; }; fi
else
  echo "This folder is not a git clone: copy the new code over it yourself, then run this again."
fi
# stop this install's server (only node processes running <this folder>/server/hub.js); the next use starts the new code
for pid in $(pgrep -f "$HUB/server/hub.js"); do
  if (( DRY )); then echo "  [dry run] would: stop the VideoHub server (pid $pid)"; else kill "$pid" 2>/dev/null && echo "VideoHub server stopped (pid $pid)"; fi
done
if (( DRY )); then ./setup.sh --dry-run; else ./setup.sh --yes; fi
