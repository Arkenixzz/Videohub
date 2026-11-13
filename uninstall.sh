#!/bin/zsh
# VideoHub uninstall: undoes what setup did on this Mac. Your films, their notes (.videohub folders), the outputs
# folder and this VideoHub folder itself are NOT touched; delete the folder yourself afterwards if you want.
# Everything removed goes to the Trash (never deleted outright).
#   ./uninstall.sh [--dry-run]
HUB="${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
DRY=0; [[ "$1" == "--dry-run" ]] && DRY=1
say() { print -r -- "$1" }
doit() { if (( DRY )); then say "  [dry run] would: $1"; else eval "$2" && say "done: $1"; fi }
toTrash() { node -e 'import(process.argv[1]).then(async m=>{const r=await m.trash([process.argv[2]]);if(!r[0].ok){console.error(r[0].error);process.exit(1)}})' "$HUB/server/mac.js" "$1" }
say "== VideoHub uninstall: $HUB"
# 1. stop this install's server
for pid in $(pgrep -f "$HUB/server/hub.js"); do doit "stop the VideoHub server (pid $pid)" "kill $pid"; done
# 2. Claude: MCP server, skill, global rule - only when they belong to THIS install (another VideoHub folder keeps its own)
MCP="$HUB/server/mcp.js"; CJ="$HOME/.claude.json"
if [[ -f "$CJ" ]] && grep -qF "$MCP" "$CJ"; then
  doit "remove the MCP server \"videohub\" from $CJ (backup: .claude.json.videohub-backup)" \
    "cp \"$CJ\" \"$CJ.videohub-backup\" && node -e 'const fs=require(\"fs\"),f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,\"utf8\"));if(j.mcpServers){delete j.mcpServers.videohub;fs.writeFileSync(f,JSON.stringify(j,null,2))}' \"$CJ\""
else say 'The registered MCP server "videohub" is not this install (or none is registered): left alone.'; fi
SK="$HOME/.claude/skills/videohub"
if [[ -f "$SK/SKILL.md" ]]; then
  if grep -qF "$HUB" "$SK/SKILL.md"; then doit "move the skill folder $SK to the Trash" "toTrash \"$SK\""; else say "The skill in $SK belongs to another install: left alone."; fi
fi
CM="$HOME/.claude/CLAUDE.md"
if [[ -f "$CM" ]] && grep -q '<!-- videohub:begin' "$CM" && grep -qF "$HUB" "$CM"; then
  doit "remove the VideoHub rule block from $CM (backup: CLAUDE.md.videohub-backup)" \
    "cp \"$CM\" \"$CM.videohub-backup\" && node -e 'const fs=require(\"fs\"),f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,\"utf8\").replace(/\\n?\\n?<!-- videohub:begin[\\s\\S]*?<!-- videohub:end -->\\n?/,\"\\n\").replace(/^\\n+/,\"\"))' \"$CM\""
fi
# 3. the app and the login item
APP="$HOME/Applications/VideoHub.app"
if [[ -d "$APP" ]] && [[ "$(cat "$APP/Contents/Resources/videohub-dir.txt" 2>/dev/null)" == "$HUB" ]]; then doit "move $APP to the Trash" "toTrash \"$APP\""; fi
LA="$HOME/Library/LaunchAgents/com.videohub.server.plist"
if [[ -f "$LA" ]] && grep -qF "$HUB/server/hub.js" "$LA"; then doit "move the start-at-login entry $LA to the Trash" "toTrash \"$LA\""; fi
say ''
say '== Done. Left in place: this folder (with data/), your films and their .videohub notes, the outputs folder,'
say '   and ~/Library/Application Support/VideoHub (render protection settings). Delete them yourself if you want them gone.'
