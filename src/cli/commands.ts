/**
 * CLI commands implementation
 */

import type { BookmarkKind } from "../types/index.ts"
import { TmuxAdapter, TmuxError, TmuxNoServerError, TmuxNotFoundError } from "../tmux/index.ts"
import { BookmarkStore } from "../storage/index.ts"
import { resolveBookmark } from "./resolver.ts"
import { runPicker } from "../tui/index.ts"

const adapter = new TmuxAdapter()
const store = new BookmarkStore()

/** Format a bookmark for display */
function formatBookmark(
  index: number,
  bookmark: { label: string; kind: string; target: { sessionId?: string; windowId?: string } },
  resolved: boolean,
): string {
  const status = resolved ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"
  const kindBadge = bookmark.kind.charAt(0).toUpperCase()
  return `${status} ${index + 1}. [${kindBadge}] ${bookmark.label}`
}

/**
 * Add a bookmark for the current window (default) or pane/session
 */
export async function cmdAdd(label: string, kind: BookmarkKind = "window"): Promise<void> {
  // Verify we're inside tmux
  const context = adapter.getContext()
  if (!context.insideTmux) {
    console.error("Error: must be inside tmux to add a bookmark")
    process.exit(1)
  }

  // Get current target based on kind
  let targetInfo: { sessionId: string; windowId?: string; paneId?: string; cwd?: string } | null =
    null

  switch (kind) {
    case "session": {
      const session = await adapter.getCurrentSession()
      if (!session) {
        console.error("Error: could not get current session")
        process.exit(1)
      }
      targetInfo = { sessionId: session.sessionId }
      break
    }

    case "window": {
      const window = await adapter.getCurrentWindow()
      const pane = await adapter.getCurrentPane()
      if (!window) {
        console.error("Error: could not get current window")
        process.exit(1)
      }
      targetInfo = {
        sessionId: window.sessionId,
        windowId: window.windowId,
        cwd: pane?.cwd,
      }
      break
    }

    case "pane": {
      const pane = await adapter.getCurrentPane()
      if (!pane) {
        console.error("Error: could not get current pane")
        process.exit(1)
      }
      targetInfo = {
        sessionId: pane.sessionId,
        windowId: pane.windowId,
        paneId: pane.paneId,
        cwd: pane.cwd,
      }
      break
    }
  }

  if (!targetInfo) {
    console.error("Error: could not determine target")
    process.exit(1)
  }

  // Get fallback info
  const pane = await adapter.getCurrentPane()
  const window = await adapter.getCurrentWindow()
  const session = await adapter.getCurrentSession()

  const fallback = {
    sessionName: session?.sessionName,
    windowIndex: window?.windowIndex,
    windowName: window?.windowName,
    paneIndex: pane?.paneIndex,
  }

  // Add bookmark
  const bookmark = await store.add(
    label,
    kind,
    {
      sessionId: targetInfo.sessionId,
      windowId: targetInfo.windowId,
      paneId: targetInfo.paneId,
    },
    fallback,
    targetInfo.cwd,
  )

  const bookmarks = await store.list()
  const slot = bookmarks.findIndex((b) => b.id === bookmark.id) + 1

  console.log(`Added bookmark [${slot}]: ${label} (${kind})`)
}

/**
 * Jump to a bookmark by slot number or label
 */
export async function cmdJump(target: string, client?: string): Promise<void> {
  // Try to parse as slot number first
  const slot = Number.parseInt(target, 10)

  const bookmark =
    !Number.isNaN(slot) && slot > 0
      ? await store.getBySlot(slot)
      : await store.getByLabel(target)

  if (!bookmark) {
    console.error(`Error: bookmark not found: ${target}`)
    process.exit(1)
  }

  // Resolve the bookmark
  const resolution = await resolveBookmark(bookmark, adapter)

  if (!resolution.resolved) {
    console.error(`Error: could not resolve bookmark: ${resolution.reason}`)
    process.exit(1)
  }

  // Update last used timestamp
  await store.touch(bookmark.id)

  // Update view state
  const state = await store.getState()
  if (state.lastViewedId !== bookmark.id) {
    await store.setState({ lastViewedId: bookmark.id, prevViewedId: state.lastViewedId })
  }

  // Switch to target
  try {
    await adapter.switchTo(resolution.target, client)
  } catch (e) {
    if (e instanceof TmuxError) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
    throw e
  }
}

/**
 * List all bookmarks
 */
export async function cmdList(countOnly = false): Promise<void> {
  const bookmarks = await store.list()

  if (countOnly) {
    console.log(bookmarks.length)
    return
  }

  if (bookmarks.length === 0) {
    console.log("No bookmarks yet. Use 'tmux-tui add <label>' to create one.")
    return
  }

  console.log("Bookmarks:")
  console.log("")

  for (let i = 0; i < bookmarks.length; i++) {
    const bookmark = bookmarks[i]
    if (!bookmark) continue

    // Check if bookmark is resolvable
    const resolution = await resolveBookmark(bookmark, adapter)
    console.log(formatBookmark(i, bookmark, resolution.resolved))

    // Show additional info
    if (bookmark.meta.cwd) {
      console.log(`     cwd: ${bookmark.meta.cwd}`)
    }
  }
}

/**
 * Remove a bookmark by slot number or label
 */
export async function cmdRemove(target: string): Promise<void> {
  // Try to parse as slot number first
  const slot = Number.parseInt(target, 10)

  let removed = false
  let label = target

  if (!Number.isNaN(slot) && slot > 0) {
    const bookmark = await store.getBySlot(slot)
    if (bookmark) {
      label = bookmark.label
      removed = await store.removeBySlot(slot)
    }
  } else {
    const bookmark = await store.getByLabel(target)
    if (bookmark) {
      removed = await store.remove(bookmark.id)
    }
  }

  if (removed) {
    console.log(`Removed bookmark: ${label}`)
  } else {
    console.error(`Error: bookmark not found: ${target}`)
    process.exit(1)
  }
}

/**
 * Rename a bookmark
 */
export async function cmdRename(target: string, newLabel: string): Promise<void> {
  // Try to parse as slot number first
  const slot = Number.parseInt(target, 10)

  const bookmark =
    !Number.isNaN(slot) && slot > 0
      ? await store.getBySlot(slot)
      : await store.getByLabel(target)

  if (!bookmark) {
    console.error(`Error: bookmark not found: ${target}`)
    process.exit(1)
  }

  const oldLabel = bookmark.label
  const renamed = await store.rename(bookmark.id, newLabel)

  if (renamed) {
    console.log(`Renamed bookmark: ${oldLabel} -> ${newLabel}`)
  } else {
    console.error("Error: failed to rename bookmark")
    process.exit(1)
  }
}

/**
 * Replace a bookmark at a slot
 */
export async function cmdReplace(
  slotStr: string,
  label: string,
  kind: BookmarkKind = "window",
): Promise<void> {
  const slot = Number.parseInt(slotStr, 10)

  if (Number.isNaN(slot) || slot < 1) {
    console.error("Error: slot must be a positive number")
    process.exit(1)
  }

  // Verify we're inside tmux
  const context = adapter.getContext()
  if (!context.insideTmux) {
    console.error("Error: must be inside tmux to replace a bookmark")
    process.exit(1)
  }

  // Get current target (same logic as add)
  let targetInfo: { sessionId: string; windowId?: string; paneId?: string; cwd?: string } | null =
    null

  switch (kind) {
    case "session": {
      const session = await adapter.getCurrentSession()
      if (!session) {
        console.error("Error: could not get current session")
        process.exit(1)
      }
      targetInfo = { sessionId: session.sessionId }
      break
    }

    case "window": {
      const window = await adapter.getCurrentWindow()
      const pane = await adapter.getCurrentPane()
      if (!window) {
        console.error("Error: could not get current window")
        process.exit(1)
      }
      targetInfo = {
        sessionId: window.sessionId,
        windowId: window.windowId,
        cwd: pane?.cwd,
      }
      break
    }

    case "pane": {
      const pane = await adapter.getCurrentPane()
      if (!pane) {
        console.error("Error: could not get current pane")
        process.exit(1)
      }
      targetInfo = {
        sessionId: pane.sessionId,
        windowId: pane.windowId,
        paneId: pane.paneId,
        cwd: pane.cwd,
      }
      break
    }
  }

  if (!targetInfo) {
    console.error("Error: could not determine target")
    process.exit(1)
  }

  // Get fallback info
  const pane = await adapter.getCurrentPane()
  const window = await adapter.getCurrentWindow()
  const session = await adapter.getCurrentSession()

  const fallback = {
    sessionName: session?.sessionName,
    windowIndex: window?.windowIndex,
    windowName: window?.windowName,
    paneIndex: pane?.paneIndex,
  }

  // Replace bookmark
  await store.replace(
    slot,
    label,
    kind,
    {
      sessionId: targetInfo.sessionId,
      windowId: targetInfo.windowId,
      paneId: targetInfo.paneId,
    },
    fallback,
    targetInfo.cwd,
  )

  console.log(`Replaced bookmark [${slot}]: ${label} (${kind})`)
}

/**
 * Show tmux state (for debugging)
 */
export async function cmdState(): Promise<void> {
  try {
    const available = await adapter.isAvailable()
    if (!available) {
      console.error("Error: tmux is not available or no server running")
      process.exit(1)
    }

    const state = await adapter.getState()
    console.log(JSON.stringify(state, null, 2))
  } catch (e) {
    if (e instanceof TmuxNotFoundError) {
      console.error("Error: tmux is not installed")
      process.exit(1)
    }
    if (e instanceof TmuxNoServerError) {
      console.error("Error: no tmux server running")
      process.exit(1)
    }
    throw e
  }
}

/**
 * Interactive TUI picker for bookmarks
 */
export async function cmdPick(client?: string): Promise<void> {
  const bookmarks = await store.list()

  if (bookmarks.length === 0) {
    console.log("No bookmarks yet. Use 'tmux-tui add <label>' to create one.")
    return
  }

  // Resolve all bookmarks to get their status
  const resolutions = await Promise.all(bookmarks.map((bookmark) => resolveBookmark(bookmark, adapter)))
  const resolvedStatus = resolutions.map((resolution) => resolution.resolved)

  const currentPane = await adapter.getCurrentPane()
  const currentWindowLabel = currentPane
    ? `${currentPane.sessionName}:${currentPane.windowIndex} ${currentPane.windowName}`
    : "unknown"
  const contextLine = `From ${currentWindowLabel}`
  const state = await store.getState()
  const lastAvailable = Boolean(state.prevViewedId)

  // Run the picker
  const result = await runPicker(bookmarks, resolvedStatus, {
    title: "Bookmarks",
    contextLine,
    lastAvailable,
  })

  if (result && result.action === "select") {
    // User selected a bookmark - jump to it
    const { bookmark } = result
    const resolution = await resolveBookmark(bookmark, adapter)

    if (!resolution.resolved) {
      console.error(`Error: could not resolve bookmark: ${resolution.reason}`)
      process.exit(1)
    }

    // Update last used timestamp
    await store.touch(bookmark.id)

    // Update view state
    if (state.lastViewedId !== bookmark.id) {
      await store.setState({ lastViewedId: bookmark.id, prevViewedId: state.lastViewedId })
    }

    // Switch to target
    try {
      await adapter.switchTo(resolution.target, client)
    } catch (e) {
      if (e instanceof TmuxError) {
        console.error(`Error: ${e.message}`)
        process.exit(1)
      }
      throw e
    }
  }

  if (result && result.action === "last") {
    if (!state.prevViewedId) {
      return
    }

    const prevBookmark = await store.get(state.prevViewedId)
    if (!prevBookmark) {
      return
    }

    const resolution = await resolveBookmark(prevBookmark, adapter)
    if (!resolution.resolved) {
      return
    }

    await store.touch(prevBookmark.id)

    await store.setState({ lastViewedId: prevBookmark.id, prevViewedId: state.lastViewedId })

    try {
      await adapter.switchTo(resolution.target, client)
    } catch (e) {
      if (e instanceof TmuxError) {
        return
      }
      throw e
    }
  }
}
