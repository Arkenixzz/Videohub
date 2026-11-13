#!/bin/bash
# VideoHub setup - double-click in the Finder to install (see README.md)
cd "$(dirname "$0")" || exit 1
./setup.sh "$@"
echo
read -n 1 -s -r -p "Press any key to close this window."
echo
