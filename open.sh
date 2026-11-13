#!/bin/zsh
# Opens VideoHub: starts the server if it is not running, then an app window (Chrome/Edge --app, else the default
# browser). --server: just the server, no window. VideoHub.app (made by setup) runs this.
HUB="${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE="$(command -v node)"
if [[ -z "$NODE" ]]; then
  osascript -e 'display alert "VideoHub" message "Node.js was not found. Run SETUP.command in the VideoHub folder."' >/dev/null 2>&1
  exit 1
fi
PORT="$("$NODE" -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(c.port||7788)}catch{console.log(7788)}' "$HUB/data/config.json")"
URL="http://127.0.0.1:$PORT"
alive() { curl -fs -m 1 "$URL/api/ping" >/dev/null 2>&1 }
if ! alive; then
  mkdir -p "$HUB/data"
  (cd "$HUB" && nohup "$NODE" "$HUB/server/hub.js" >>"$HUB/data/hub.log" 2>&1 &)
  for i in {1..40}; do alive && break; sleep 0.25; done
fi
[[ "$1" == "--server" ]] && exit 0
# the window: through the hub (an open VideoHub window just comes to the front; else Chrome/Edge in app mode)
curl -fs -m 5 -X POST -H 'Content-Type: application/json' -d '{"hash":"#/"}' "$URL/api/show" >/dev/null 2>&1 || open "$URL"
