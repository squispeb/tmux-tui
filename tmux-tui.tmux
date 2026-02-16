#!/usr/bin/env bash

repo="${TMUX_TUI_REPO:-$HOME/personal/tmux-tui}"
out="$repo/dist/tmux-tui"

command -v bun >/dev/null 2>&1 || exit 0
[ -d "$repo" ] || exit 0

if [ ! -f "$out" ] || find "$repo/src" -type f -name "*.ts" -newer "$out" -print -quit 2>/dev/null | grep -q .; then
  (cd "$repo" && bun build src/index.ts --compile --outfile=dist/tmux-tui >/dev/null 2>&1)
fi
