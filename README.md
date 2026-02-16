# tmux-tui

[![TPM](https://img.shields.io/badge/TPM-plugin-blue)](https://github.com/tmux-plugins/tpm)
[![Release](https://img.shields.io/github/v/release/squispeb/tmux-tui?display_name=tag)](https://github.com/squispeb/tmux-tui/releases)

Fast bookmark and jump tool for tmux with a TUI picker.

## Quick install (TPM)

```tmux
set -g @plugin 'squispeb/tmux-tui'
set -g @TMUX_TUI_REPO "$HOME/personal/tmux-tui"
```

Then press `prefix + I` and reload tmux.

## Requirements

- tmux (3.2+ recommended for popups)
- Bun

## Build

```bash
bun install
bun build src/index.ts --compile --outfile=dist/tmux-tui
```

## Run

```bash
./dist/tmux-tui help
./dist/tmux-tui add "work" --window
./dist/tmux-tui pick
```

## TPM installation

This repo ships a `tmux-tui.tmux` plugin script that rebuilds the binary
when sources are newer. TPM loads `*.tmux` files on tmux start/reload.

1) Add to `~/.config/tmux/tmux.conf`:

```tmux
set -g @plugin 'tmux-plugins/tpm'
set -g @plugin 'squispeb/tmux-tui'
set -g @TMUX_TUI_REPO "$HOME/personal/tmux-tui"
```

2) Install with `prefix + I`.

3) Reload tmux:

```bash
tmux source-file ~/.config/tmux/tmux.conf
```

### Local (developer) install

If you want to use a local checkout instead of a GitHub repo, create a
symlink so TPM can find it:

```bash
ln -sfn "$HOME/personal/tmux-tui" "$HOME/.tmux/plugins/tmux-tui"
```

Then set your plugin entry to the local name:

```tmux
set -g @plugin 'tmux-tui'
set -g @TMUX_TUI_REPO "$HOME/personal/tmux-tui"
```

## tmux keybinds (example)

```tmux
bind-key a command-prompt -p "Bookmark label:" "run-shell 'TMUX_PANE=#{pane_id} ~/personal/tmux-tui/dist/tmux-tui add \"%%\"'"
bind-key A command-prompt -p "Bookmark pane:" "run-shell 'TMUX_PANE=#{pane_id} ~/personal/tmux-tui/dist/tmux-tui add \"%%\" --pane'"
bind-key g run-shell 'h=$(($(~/personal/tmux-tui/dist/tmux-tui list --count 2>/dev/null || echo 0) + 9)); [ $h -lt 10 ] && h=10; tmux display-popup -E -w 42 -h $h "~/personal/tmux-tui/dist/tmux-tui pick --client #{client_tty}"'
bind-key G command-prompt -p "Jump to slot:" "run-shell '~/personal/tmux-tui/dist/tmux-tui jump %% --client #{client_tty}'"
```

## Development

```bash
bun run src/index.ts
bun test
```
