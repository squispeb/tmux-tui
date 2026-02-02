Below is a concrete build plan for a “better tmux-harpoon” focused on reliability, window-level targets, and a first-class TUI (OpenTUI). I’m assuming your pain is what many “bookmark” tools hit: stale targets, inconsistent switching behavior, and weak UX around sessions vs windows vs panes.

---

## 0) Define the product you’re building

### Core promise

A fast “bookmark and jump” tool for tmux that:

* bookmarks **targets** (session / window / pane / cwd)
* jumps reliably even when things move (renames, index shifts, detached clients)
* offers a good picker UI (OpenTUI), ideally in a tmux popup

tmux-harpoon’s scope is mainly session bookmarks (and optionally tracking a pane). ([GitHub][1])
You’re expanding that into a more general “workspace marks” manager.

### Target primitives

Use tmux’s stable IDs rather than names/indexes when possible:

* **session_id** (stable) and **window_id / pane_id** (stable)
  tmux exposes these via format strings (`session_id`, `window_id`, `window_index`, `window_name`, etc.). ([GitHub][2])

---

## 1) UX spec (what the user can do)

### MVP actions (must be rock solid)

1. Add bookmark for:

   * current **pane**
   * current **window**
   * current **session**
2. Jump to bookmark:

   * if inside tmux: `switch-client` + `select-window`/`select-pane`
   * if outside tmux: `attach-session` then select window/pane
3. List bookmarks (CLI output + TUI list)
4. Remove bookmark
5. Replace bookmark slot (like harpoon’s replace)

### Quality-of-life actions (V1)

* Rename bookmark label
* Reorder bookmarks
* “Jump last” (MRU)
* “Resolve” a bookmark if window was renamed or index changed (use IDs)

### Stretch actions (V2)

* “Create if missing” (if a bookmark points to a project path, create session/window and cd)
* Profiles (per host, per repo)
* Hooks: auto-update metadata when tmux state changes

---

## 2) Architecture: split into 3 layers

### Layer A — tmux adapter (pure logic)

A small library that:

* **discovers** tmux state (sessions/windows/panes)
* **executes** actions (switch/select/attach)
* **parses** tmux output into typed objects

Implementation detail:

* Use `tmux list-windows -a -F ...` and `tmux list-panes -a -F ...` with format variables. ([GitHub][2])
  This is the same foundation used by popular fzf-based switchers; it’s proven and fast. ([GitHub][3])

Also keep a “tmux UI fallback” in your pocket:

* tmux has a built-in `display-menu` popup mechanism that can run commands for entries, which is a good minimal/no-deps fallback. ([DJ Adams][4])

### Layer B — persistence (boring and correct)

* Store in `~/.config/<tool>/bookmarks.json` (XDG)
* Atomic writes (write temp + rename)
* Schema versioning + migrations
* Locking to avoid concurrent write clobber (two tmux clients)

Data model suggestion:

```json
{
  "version": 1,
  "items": [
    {
      "id": "uuid",
      "label": "work api",
      "kind": "pane|window|session|path",
      "tmux": {
        "session_id": "$1",
        "window_id": "@3",
        "pane_id": "%7",
        "fallback": {
          "session_name": "work",
          "window_index": 2,
          "window_name": "api"
        }
      },
      "meta": {
        "cwd": "/home/you/repo",
        "host": "machine-name",
        "last_used": 1700000000
      }
    }
  ]
}
```

Design goal: jump using IDs; if missing, fall back to names/index; if still missing, optionally create.

### Layer C — UX front-ends

1. CLI (`tool add`, `tool jump`, `tool rm`, `tool list`, etc.)
2. TUI picker (OpenTUI)
3. tmux integration (keybinds + popup)

---

## 3) TUI plan using OpenTUI

OpenTUI is a TypeScript TUI framework and explicitly recommends a bun-based quick start (`bun create tui`). ([GitHub][5])
It also clearly states it’s “in development” / not production ready, so plan accordingly (pin versions, expect API churn). ([GitHub][6])

### TUI screen layout (simple but powerful)

* Top: search input
* Middle-left: bookmarks list (filter as you type)
* Middle-right: preview (resolved target details: `session/window/pane`, cwd, status)
* Bottom: key hints

Keymap:

* Enter: jump
* a: add current target (pane/window) (calls CLI)
* d: delete selected bookmark
* r: rename
* m: move/reorder mode
* Esc/q: exit

### Launching inside tmux

Use a popup-based UX (requires tmux popup support; many tools use this pattern with `fzf-tmux` as well). ([Reddit][7])
If popup is not available, fall back to a split pane or full-screen.

---

## 4) tmux integration (the part that “feels native”)

### Provide a TPM-style install

* A `plugin.tmux` that binds keys and calls your binary.
* Also support standalone installation (copy binary, add tmux binds manually), like tmux-harpoon does. ([GitHub][1])

### Recommended keybind set (example)

* `<prefix> h` → open picker (popup)
* `<prefix> H` → add current pane as bookmark
* `<prefix> 1..9` → jump to slot

Also consider offering a “menu mode” fallback with `display-menu` for environments where your TUI can’t run. ([DJ Adams][4])

---

## 5) Reliability strategy (what makes it “better” than tmux-harpoon)

### Use stable IDs first

When switching, prefer:

* `switch-client -t <session_id>` then `select-window -t <window_id>` then `select-pane -t <pane_id>`

Only fall back to:

* session name + window index/name

This is the single biggest win for robustness (renames and index shifts stop breaking bookmarks), and tmux format variables make it doable. ([GitHub][2])

### Add a resolver

When a bookmark doesn’t resolve:

1. Try IDs
2. Try fallbacks (session_name + window_name)
3. Try fuzzy match by cwd (if you store cwd)
4. If configured: create session/window and cd

### Health checks

* A `tool doctor` command:

  * lists unresolved marks
  * offers fix actions (rebind to current pane/window)

---

## 6) Implementation sequence (step-by-step)

### Step 1 — Prototype the tmux adapter (no UI)

* Commands:

  * `state`: dump sessions/windows/panes as JSON (using `list-windows -a -F ...`, `list-panes -a -F ...`)
  * `jump`: accepts a structured target and performs attach/switch/select

Use tmux formats to collect IDs and names. ([GitHub][2])

### Step 2 — Add persistence

* JSON file with atomic writes + schema version
* `add`, `rm`, `list`, `rename`, `replace`, `reorder`

### Step 3 — Add tmux bindings (manual first)

* `run-shell` binds to call the binary
* Implement popup launching if possible; otherwise split

### Step 4 — Build the OpenTUI picker

* Read bookmarks + live tmux state
* Resolve targets in real time
* Provide preview + jump

OpenTUI quick start via bun and its React renderer are documented via the repo and npm packages. ([GitHub][5])

### Step 5 — Package as a tmux plugin

* TPM structure
* Document variables (paths, default keys, popup preference)

### Step 6 — Add polish features

* MRU ordering
* “create if missing”
* import/export
* hooks (optional)

---

## 7) Testing approach that prevents regressions

* Unit tests:

  * parsing of tmux output
  * resolver logic
  * storage migrations
* Integration tests:

  * spawn a tmux server in CI and validate:

    * add mark
    * rename window
    * still jump via IDs
* Manual “chaos” checklist:

  * detach/attach, rename session, reorder windows, kill window, recreate

---

## 8) What I’d copy from existing ecosystem (so you don’t reinvent mistakes)

* “fzf manages tmux environment” style tools demonstrate the state/query approach works well at scale (sessions/windows/panes). ([GitHub][3])
* tmux-harpoon’s UX model (slots, add/remove/replace) is a good mental model, but you’ll improve the backend reliability and broaden target types. ([GitHub][8])
* tmux `display-menu` is a good lowest-common-denominator fallback UI. ([DJ Adams][4])

---

If you want, I can turn this plan into a concrete repo scaffold:

* folder structure
* TypeScript types for tmux state + bookmarks
* exact tmux format strings to capture `session_id/window_id/pane_id`
* command interface (`tool add --pane`, `tool jump <id>`, `tool tui`) and tmux binds that call it

Tell me whether you want the first release to prioritize **window bookmarks** or **pane bookmarks** as the default (both are supported, but one should be the “happy path”).

[1]: https://github.com/Chaitanyabsprip/tmux-harpoon?utm_source=chatgpt.com "Chaitanyabsprip/tmux-harpoon"
[2]: https://github.com/greymd/tmux-xpanes/wiki/Tmux-Format?utm_source=chatgpt.com "Tmux Format · greymd/tmux-xpanes Wiki"
[3]: https://github.com/sainnhe/tmux-fzf?utm_source=chatgpt.com "sainnhe/tmux-fzf: Use fzf to manage your tmux work ..."
[4]: https://qmacro.org/blog/posts/2021/08/12/session-switching-with-the-tmux-menu/?utm_source=chatgpt.com "Session switching with the tmux menu - DJ Adams"
[5]: https://github.com/anomalyco/opentui?utm_source=chatgpt.com "OpenTUI is a library for building terminal user interfaces ..."
[6]: https://github.com/anomalyco/opentui/blob/main/README.md?utm_source=chatgpt.com "opentui/README.md at main · anomalyco ..."
[7]: https://www.reddit.com/r/tmux/comments/kvf2n4/tmux_and_fzf_fuzzy_tmux_sessionwindowpane_switcher/?utm_source=chatgpt.com "tmux and fzf: fuzzy tmux session/window/pane switcher"
[8]: https://github.com/Chaitanyabsprip/tmux-harpoon/blob/main/harpoon?utm_source=chatgpt.com "Chaitanyabsprip/tmux-harpoon"

