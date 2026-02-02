# AGENTS.md - tmux-tui

Guidelines for AI agents working on the tmux-tui codebase.

## Project Overview

A tmux bookmark and navigation tool built with **TypeScript**, **Bun**, and **OpenTUI**. Provides fast "bookmark and jump" functionality for tmux sessions, windows, and panes.

## Build & Development Commands

```bash
bun install                                          # Install dependencies
bun run src/index.ts                                 # Run the application
bun run typecheck                                    # Type checking
bun build src/index.ts --outdir=dist --target=bun   # Production build
```

## Testing Commands

```bash
bun test                           # Run all tests
bun test src/tmux                  # Run tests in a directory
bun test src/tmux/adapter.test.ts  # Run a single test file
bun test bookmark                  # Run tests matching pattern
```

## Linting & Formatting

```bash
bun run format     # Format code
bun run lint       # Lint code
```

## Project Structure

```
src/
├── index.ts       # CLI entry point
├── cli/           # CLI commands (add, jump, list, rm, rename, replace)
│   ├── commands.ts   # Command implementations
│   └── resolver.ts   # Bookmark resolution logic
├── tmux/          # tmux adapter (parsing, commands)
│   └── adapter.ts    # TmuxAdapter class
├── storage/       # Persistence (bookmarks.json)
│   └── store.ts      # BookmarkStore class
└── types/         # Shared TypeScript types
    ├── tmux.ts       # TmuxSession, TmuxWindow, TmuxPane
    └── bookmark.ts   # Bookmark, BookmarksFile
```

## Code Style Guidelines

### Imports

- Use explicit `.ts` extensions for local imports
- Use `type` keyword for type-only imports

```typescript
import { createCliRenderer } from "@opentui/core"
import { TmuxAdapter } from "./tmux/adapter.ts"
import type { Bookmark } from "./types/index.ts"
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `bookmark-store.ts` |
| Classes/Types | PascalCase | `TmuxAdapter`, `BookmarkItem` |
| Functions | camelCase | `resolveTarget()` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULT_CONFIG_PATH` |

### Type Definitions

- Prefer `interface` for object shapes, `type` for unions/aliases

```typescript
interface TmuxTarget {
  sessionId: string
  windowId?: string
}
type TargetKind = "session" | "window" | "pane" | "path"
```

### Error Handling

- Use custom error classes for domain-specific errors
- Always handle tmux command errors with helpful context

```typescript
class TmuxError extends Error {
  constructor(message: string, public readonly command: string) {
    super(`tmux error: ${message} (command: ${command})`)
    this.name = "TmuxError"
  }
}
```

### Async Patterns

- Use async/await over raw Promises; use `Promise.all` for parallel operations

```typescript
const [sessions, windows] = await Promise.all([
  adapter.listSessions(),
  adapter.listWindows()
])
```

### tmux Integration

- **Always use stable IDs** (`session_id`, `window_id`, `pane_id`) over names/indexes

```typescript
const FORMAT = "#{session_id}|#{window_id}|#{pane_id}|#{session_name}"

function parseTmuxLine(line: string): TmuxPane {
  const [sessionId, windowId, paneId, sessionName] = line.split("|")
  return { sessionId, windowId, paneId, sessionName }
}
```

### Storage & Persistence

- Store in `~/.config/tmux-tui/bookmarks.json` (XDG compliant)
- Use atomic writes (temp file + rename); include schema version

### Testing

- Co-locate test files: `foo.ts` -> `foo.test.ts`
- Mock tmux commands in unit tests

```typescript
import { describe, expect, test } from "bun:test"

describe("TmuxAdapter", () => {
  test("resolves bookmark by stable ID", async () => {
    const result = await adapter.resolveTarget({ sessionId: "$1" })
    expect(result.found).toBe(true)
  })
})
```

## Key Domain Concepts

### Bookmark Resolution Order

1. Try stable IDs (`session_id`, `window_id`, `pane_id`)
2. Fall back to names (`session_name`, `window_name`)

### Target Switching

- **Inside tmux**: `switch-client` + `select-window` + `select-pane`
- **Outside tmux**: `attach-session` then select window/pane

## Common Pitfalls

1. **Don't rely on window indexes** - they change when windows are reordered
2. **Don't assume tmux is running** - check and provide helpful errors
3. **Handle detached sessions** - bookmarks may point to clientless sessions
4. **Quote shell arguments** - session/window names can contain special chars
