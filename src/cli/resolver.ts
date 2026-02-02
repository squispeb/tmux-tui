/**
 * Bookmark resolver - resolves bookmarks to tmux targets
 */

import type { Bookmark, BookmarkResolution, TmuxTarget } from "../types/index.ts"
import type { TmuxAdapter } from "../tmux/index.ts"

/**
 * Resolve a bookmark to a valid tmux target
 * Tries IDs first, then fallback identifiers
 */
export async function resolveBookmark(
  bookmark: Bookmark,
  adapter: TmuxAdapter,
): Promise<BookmarkResolution> {
  // Try primary target (stable IDs)
  const idResult = await tryResolveById(bookmark, adapter)
  if (idResult) {
    return { resolved: true, method: "id", target: idResult }
  }

  // Try fallback (names/indexes)
  const fallbackResult = await tryResolveByFallback(bookmark, adapter)
  if (fallbackResult) {
    return { resolved: true, method: "fallback", target: fallbackResult }
  }

  // Try by cwd (if stored)
  if (bookmark.meta.cwd) {
    const cwdResult = await tryResolveByCwd(bookmark.meta.cwd, adapter)
    if (cwdResult) {
      return { resolved: true, method: "cwd", target: cwdResult }
    }
  }

  return { resolved: false, reason: "Could not resolve bookmark to a valid tmux target" }
}

/**
 * Try to resolve using stable IDs
 */
async function tryResolveById(
  bookmark: Bookmark,
  adapter: TmuxAdapter,
): Promise<TmuxTarget | null> {
  const { target, kind } = bookmark

  switch (kind) {
    case "session": {
      if (!target.sessionId) return null
      const session = await adapter.findSessionById(target.sessionId)
      return session ? { sessionId: session.sessionId } : null
    }

    case "window": {
      if (!target.windowId) return null
      const window = await adapter.findWindowById(target.windowId)
      return window ? { sessionId: window.sessionId, windowId: window.windowId } : null
    }

    case "pane": {
      if (!target.paneId) return null
      const pane = await adapter.findPaneById(target.paneId)
      return pane
        ? { sessionId: pane.sessionId, windowId: pane.windowId, paneId: pane.paneId }
        : null
    }

    default:
      return null
  }
}

/**
 * Try to resolve using fallback identifiers (names/indexes)
 */
async function tryResolveByFallback(
  bookmark: Bookmark,
  adapter: TmuxAdapter,
): Promise<TmuxTarget | null> {
  const { fallback, kind } = bookmark

  // First, try to find the session
  let session = null
  if (fallback.sessionName) {
    session = await adapter.findSessionByName(fallback.sessionName)
  }

  if (!session && kind === "session") {
    return null
  }

  if (kind === "session" && session) {
    return { sessionId: session.sessionId }
  }

  // For window/pane, we need the session
  if (!session) return null

  // Try to find the window
  let window = null

  // Try by name first
  if (fallback.windowName) {
    window = await adapter.findWindowByName(session.sessionId, fallback.windowName)
  }

  // Try by index if name didn't work
  if (!window && fallback.windowIndex !== undefined) {
    window = await adapter.findWindowByIndex(session.sessionId, fallback.windowIndex)
  }

  if (!window && (kind === "window" || kind === "pane")) {
    return null
  }

  if (kind === "window" && window) {
    return { sessionId: session.sessionId, windowId: window.windowId }
  }

  // For pane, we'd need additional logic to find by index
  // For now, just return the window as the best we can do
  if (kind === "pane" && window) {
    return { sessionId: session.sessionId, windowId: window.windowId }
  }

  return null
}

/**
 * Try to resolve by finding a pane with matching cwd
 */
async function tryResolveByCwd(cwd: string, adapter: TmuxAdapter): Promise<TmuxTarget | null> {
  const panes = await adapter.listPanes()

  // Find a pane with matching cwd
  const match = panes.find((p) => p.cwd === cwd)

  if (match) {
    return {
      sessionId: match.sessionId,
      windowId: match.windowId,
      paneId: match.paneId,
    }
  }

  return null
}
