#!/usr/bin/env bun
/**
 * tmux-tui - A fast bookmark and jump tool for tmux
 */

import type { BookmarkKind } from "./types/index.ts"
import {
  cmdAdd,
  cmdJump,
  cmdList,
  cmdRemove,
  cmdRename,
  cmdReplace,
  cmdState,
} from "./cli/index.ts"

const HELP = `
tmux-tui - A fast bookmark and jump tool for tmux

USAGE:
    tmux-tui <command> [options]

COMMANDS:
    add <label> [--window|--pane|--session]
        Add a bookmark for the current window (default), pane, or session

    jump <slot|label>
        Jump to a bookmark by slot number (1-based) or label

    list
        List all bookmarks with resolution status

    rm <slot|label>
        Remove a bookmark by slot number or label

    rename <slot|label> <new-label>
        Rename a bookmark

    replace <slot> <label> [--window|--pane|--session]
        Replace the bookmark at slot with current target

    state
        Output tmux state as JSON (for debugging)

    help
        Show this help message

EXAMPLES:
    tmux-tui add "work api"           # Bookmark current window as "work api"
    tmux-tui add "editor" --pane      # Bookmark current pane as "editor"
    tmux-tui jump 1                   # Jump to bookmark slot 1
    tmux-tui jump "work api"          # Jump to bookmark by label
    tmux-tui list                     # List all bookmarks
    tmux-tui rm 1                     # Remove bookmark at slot 1
    tmux-tui rename 1 "new name"      # Rename bookmark at slot 1
    tmux-tui replace 1 "updated"      # Replace slot 1 with current window
`.trim()

function parseKind(args: string[]): BookmarkKind {
  if (args.includes("--pane") || args.includes("-p")) return "pane"
  if (args.includes("--session") || args.includes("-s")) return "session"
  return "window" // default
}

function filterFlags(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("-"))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP)
    return
  }

  try {
    switch (command) {
      case "add": {
        const label = filterFlags(args.slice(1))[0]
        if (!label) {
          console.error("Error: label required")
          console.error("Usage: tmux-tui add <label> [--window|--pane|--session]")
          process.exit(1)
        }
        const kind = parseKind(args)
        await cmdAdd(label, kind)
        break
      }

      case "jump":
      case "j": {
        const target = args[1]
        if (!target) {
          console.error("Error: target required")
          console.error("Usage: tmux-tui jump <slot|label>")
          process.exit(1)
        }
        await cmdJump(target)
        break
      }

      case "list":
      case "ls":
      case "l": {
        await cmdList()
        break
      }

      case "rm":
      case "remove":
      case "delete": {
        const target = args[1]
        if (!target) {
          console.error("Error: target required")
          console.error("Usage: tmux-tui rm <slot|label>")
          process.exit(1)
        }
        await cmdRemove(target)
        break
      }

      case "rename":
      case "mv": {
        const target = args[1]
        const newLabel = args[2]
        if (!target || !newLabel) {
          console.error("Error: target and new label required")
          console.error("Usage: tmux-tui rename <slot|label> <new-label>")
          process.exit(1)
        }
        await cmdRename(target, newLabel)
        break
      }

      case "replace": {
        const slot = args[1]
        const label = filterFlags(args.slice(2))[0]
        if (!slot || !label) {
          console.error("Error: slot and label required")
          console.error("Usage: tmux-tui replace <slot> <label> [--window|--pane|--session]")
          process.exit(1)
        }
        const kind = parseKind(args)
        await cmdReplace(slot, label, kind)
        break
      }

      case "state": {
        await cmdState()
        break
      }

      default:
        console.error(`Unknown command: ${command}`)
        console.error("Run 'tmux-tui help' for usage")
        process.exit(1)
    }
  } catch (e) {
    if (e instanceof Error) {
      console.error(`Error: ${e.message}`)
    } else {
      console.error("An unexpected error occurred")
    }
    process.exit(1)
  }
}

main()
