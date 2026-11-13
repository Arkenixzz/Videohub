#!/bin/bash
# VideoHub setup for macOS (see README.md). Checks Node.js, then runs the guided install (scripts/setup.mjs).
#   ./setup.sh [--dry-run] [--yes] [--workspace <folder>] [--gpu-encoder yes|no] ...     (./setup.sh --help)
HUB="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE="$(command -v node)"
MAJOR=0
[ -n "$NODE" ] && MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$MAJOR" -lt 22 ]; then
  echo
  if [ -n "$NODE" ]; then echo "Node.js is too old here (version $MAJOR; VideoHub needs 22 or newer)."; else echo "Node.js is missing."; fi
  echo "VideoHub is a small program written for Node.js, so it cannot run without it."
  if command -v brew >/dev/null 2>&1; then
    echo "Install it: open Terminal, paste this line and press Enter:"
    echo "    brew install node"
  else
    echo "Install it from https://nodejs.org (the LTS version, the macOS installer)."
  fi
  echo "When it has finished, run setup again (double-click SETUP.command)."
  exit 1
fi
exec "$NODE" "$HUB/scripts/setup.mjs" "$@"
