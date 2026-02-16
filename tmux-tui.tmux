#!/usr/bin/env bash

get_tmux_option() {
  local option="$1"
  local default_value="$2"
  local value
  value="$(tmux show-option -gqv "$option")"
  if [ -n "$value" ]; then
    echo "$value"
  else
    echo "$default_value"
  fi
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_opt="$(get_tmux_option "@tmux_tui_repo" "")"
repo_opt_upper="$(get_tmux_option "@TMUX_TUI_REPO" "")"
repo_default="$script_dir"
repo="${repo_opt:-${repo_opt_upper:-$repo_default}}"

bin_opt="$(get_tmux_option "@tmux_tui_bin" "")"
out="$repo/dist/tmux-tui"
bin="${bin_opt:-$out}"

command -v bun >/dev/null 2>&1 || exit 0
[ -d "$repo" ] || exit 0

if [ ! -f "$out" ] || find "$repo/src" -type f -name "*.ts" -newer "$out" -print -quit 2>/dev/null | grep -q .; then
  (cd "$repo" && bun build src/index.ts --compile --outfile=dist/tmux-tui >/dev/null 2>&1)
fi

auto_bind="$(get_tmux_option "@tmux_tui_auto_bind" "on")"
if [ "$auto_bind" = "off" ]; then
  exit 0
fi

key_pick="$(get_tmux_option "@tmux_tui_key_pick" "g")"
key_add="$(get_tmux_option "@tmux_tui_key_add" "a")"
key_add_pane="$(get_tmux_option "@tmux_tui_key_add_pane" "A")"
key_jump="$(get_tmux_option "@tmux_tui_key_jump" "G")"

popup_width="$(get_tmux_option "@tmux_tui_popup_width" "42")"
popup_extra="$(get_tmux_option "@tmux_tui_popup_extra_lines" "9")"
popup_min_height="$(get_tmux_option "@tmux_tui_popup_min_height" "10")"

pick_cmd="h=\$((\$(\"$bin\" list --count 2>/dev/null || echo 0) + $popup_extra)); [ \$h -lt $popup_min_height ] && h=$popup_min_height; tmux display-popup -E -w $popup_width -h \$h \"$bin pick --client #{client_tty}\""

tmux bind-key "$key_pick" run-shell -b "$pick_cmd"
tmux bind-key "$key_add" command-prompt -p "Bookmark label:" "run-shell 'TMUX_PANE=#{pane_id} $bin add \"%%\"'"
tmux bind-key "$key_add_pane" command-prompt -p "Bookmark pane:" "run-shell 'TMUX_PANE=#{pane_id} $bin add \"%%\" --pane'"
tmux bind-key "$key_jump" command-prompt -p "Jump to slot:" "run-shell '$bin jump %% --client #{client_tty}'"
