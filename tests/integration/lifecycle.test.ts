/**
 * Integration tests for bookmark lifecycle
 *
 * Tests the full flow: add → list → jump → rename → remove
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TmuxTestServer, isTmuxAvailable } from "../../src/tmux/test-utils.ts"
import { BookmarkStore } from "../../src/storage/store.ts"
import { resolveBookmark } from "../../src/cli/resolver.ts"
import type { TmuxTarget, TmuxFallback } from "../../src/types/index.ts"

describe("Bookmark Lifecycle Integration", () => {
  let server: TmuxTestServer
  let tmuxAvailable: boolean
  let tempDir: string
  let store: BookmarkStore

  beforeAll(async () => {
    tmuxAvailable = await isTmuxAvailable()
    if (!tmuxAvailable) {
      console.log("Skipping integration tests: tmux not available")
      return
    }

    server = new TmuxTestServer()
    await server.start()
  })

  afterAll(async () => {
    if (tmuxAvailable && server) {
      await server.stop()
    }
  })

  beforeEach(async () => {
    if (!tmuxAvailable) return

    // Create a fresh temp directory for each test's bookmarks
    tempDir = await mkdtemp(join(tmpdir(), "tmux-tui-test-"))
    store = new BookmarkStore(join(tempDir, "bookmarks.json"))
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  describe("Session bookmarks", () => {
    test("add → list → resolve → remove lifecycle", async () => {
      if (!tmuxAvailable) return

      // Create a test session
      const sessionId = await server.createSession("lifecycle-session")
      const session = await server.adapter.findSessionById(sessionId)
      expect(session).toBeTruthy()

      // 1. Add bookmark
      const target: TmuxTarget = { sessionId }
      const fallback: TmuxFallback = { sessionName: "lifecycle-session" }
      const bookmark = await store.add("my-session", "session", target, fallback)

      expect(bookmark.id).toBeTruthy()
      expect(bookmark.label).toBe("my-session")
      expect(bookmark.kind).toBe("session")
      expect(bookmark.target.sessionId).toBe(sessionId)

      // 2. List bookmarks
      const bookmarks = await store.list()
      expect(bookmarks).toHaveLength(1)
      expect(bookmarks[0]!.id).toBe(bookmark.id)

      // 3. Resolve bookmark
      const resolution = await resolveBookmark(bookmark, server.adapter)
      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.sessionId).toBe(sessionId)
      }

      // 4. Rename bookmark
      const renamed = await store.rename(bookmark.id, "renamed-session")
      expect(renamed).toBe(true)

      const renamedBookmark = await store.get(bookmark.id)
      expect(renamedBookmark?.label).toBe("renamed-session")

      // 5. Remove bookmark
      const removed = await store.remove(bookmark.id)
      expect(removed).toBe(true)

      const afterRemove = await store.list()
      expect(afterRemove).toHaveLength(0)
    })
  })

  describe("Window bookmarks", () => {
    test("add → list → resolve → remove lifecycle", async () => {
      if (!tmuxAvailable) return

      // Create a test session and window
      const sessionId = await server.createSession("window-lifecycle-session")
      const windowId = await server.createWindow(sessionId, "lifecycle-window")

      const window = await server.adapter.findWindowById(windowId)
      expect(window).toBeTruthy()

      // 1. Add bookmark
      const target: TmuxTarget = { sessionId, windowId }
      const fallback: TmuxFallback = {
        sessionName: "window-lifecycle-session",
        windowName: "lifecycle-window",
        windowIndex: window!.windowIndex,
      }
      const bookmark = await store.add("my-window", "window", target, fallback)

      expect(bookmark.id).toBeTruthy()
      expect(bookmark.kind).toBe("window")
      expect(bookmark.target.windowId).toBe(windowId)

      // 2. List bookmarks
      const bookmarks = await store.list()
      expect(bookmarks).toHaveLength(1)

      // 3. Resolve bookmark
      const resolution = await resolveBookmark(bookmark, server.adapter)
      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.sessionId).toBe(sessionId)
        expect(resolution.target.windowId).toBe(windowId)
      }

      // 4. Remove bookmark
      const removed = await store.remove(bookmark.id)
      expect(removed).toBe(true)
    })
  })

  describe("Pane bookmarks", () => {
    test("add → list → resolve → remove lifecycle", async () => {
      if (!tmuxAvailable) return

      // Create a test session, window, and split pane
      const sessionId = await server.createSession("pane-lifecycle-session")
      const windowId = await server.createWindow(sessionId, "pane-window")

      // Get the initial pane
      const panes = await server.adapter.listPanes()
      const initialPane = panes.find((p) => p.windowId === windowId)
      expect(initialPane).toBeTruthy()

      // Split to create another pane
      const newPaneId = await server.splitPane(initialPane!.paneId)
      const newPane = await server.adapter.findPaneById(newPaneId)
      expect(newPane).toBeTruthy()

      // 1. Add bookmark for the new pane
      const target: TmuxTarget = {
        sessionId,
        windowId,
        paneId: newPaneId,
      }
      const fallback: TmuxFallback = {
        sessionName: "pane-lifecycle-session",
        windowName: "pane-window",
        windowIndex: newPane!.windowIndex,
      }
      const bookmark = await store.add("my-pane", "pane", target, fallback)

      expect(bookmark.id).toBeTruthy()
      expect(bookmark.kind).toBe("pane")
      expect(bookmark.target.paneId).toBe(newPaneId)

      // 2. Resolve bookmark
      const resolution = await resolveBookmark(bookmark, server.adapter)
      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.paneId).toBe(newPaneId)
      }

      // 3. Remove bookmark
      const removed = await store.remove(bookmark.id)
      expect(removed).toBe(true)
    })
  })

  describe("Multiple bookmarks", () => {
    test("manages multiple bookmarks across different sessions", async () => {
      if (!tmuxAvailable) return

      // Create multiple sessions
      const sessionId1 = await server.createSession("multi-session-1")
      const sessionId2 = await server.createSession("multi-session-2")
      const sessionId3 = await server.createSession("multi-session-3")

      // Add bookmarks for each
      const bm1 = await store.add(
        "session-1",
        "session",
        { sessionId: sessionId1 },
        { sessionName: "multi-session-1" },
      )

      const bm2 = await store.add(
        "session-2",
        "session",
        { sessionId: sessionId2 },
        { sessionName: "multi-session-2" },
      )

      const bm3 = await store.add(
        "session-3",
        "session",
        { sessionId: sessionId3 },
        { sessionName: "multi-session-3" },
      )

      // List all bookmarks
      const bookmarks = await store.list()
      expect(bookmarks).toHaveLength(3)

      // Access by slot
      const slot1 = await store.getBySlot(1)
      const slot2 = await store.getBySlot(2)
      const slot3 = await store.getBySlot(3)

      expect(slot1?.id).toBe(bm1.id)
      expect(slot2?.id).toBe(bm2.id)
      expect(slot3?.id).toBe(bm3.id)

      // Access by label
      const byLabel = await store.getByLabel("session-2")
      expect(byLabel?.id).toBe(bm2.id)

      // Resolve each
      for (const bm of [bm1, bm2, bm3]) {
        const resolution = await resolveBookmark(bm, server.adapter)
        expect(resolution.resolved).toBe(true)
      }

      // Remove middle one
      await store.removeBySlot(2)
      const afterRemove = await store.list()
      expect(afterRemove).toHaveLength(2)
      expect(afterRemove[0]!.id).toBe(bm1.id)
      expect(afterRemove[1]!.id).toBe(bm3.id)

      // Now slot 2 is session-3
      const newSlot2 = await store.getBySlot(2)
      expect(newSlot2?.id).toBe(bm3.id)
    })

    test("reorders bookmarks with move", async () => {
      if (!tmuxAvailable) return

      // Create sessions and bookmarks
      const sessionId1 = await server.createSession("move-session-1")
      const sessionId2 = await server.createSession("move-session-2")
      const sessionId3 = await server.createSession("move-session-3")

      const bm1 = await store.add(
        "first",
        "session",
        { sessionId: sessionId1 },
        { sessionName: "move-session-1" },
      )

      const bm2 = await store.add(
        "second",
        "session",
        { sessionId: sessionId2 },
        { sessionName: "move-session-2" },
      )

      const bm3 = await store.add(
        "third",
        "session",
        { sessionId: sessionId3 },
        { sessionName: "move-session-3" },
      )

      // Initial order: first, second, third
      let bookmarks = await store.list()
      expect(bookmarks.map((b) => b.label)).toEqual(["first", "second", "third"])

      // Move first to third position
      await store.move(1, 3)

      // New order: second, third, first
      bookmarks = await store.list()
      expect(bookmarks.map((b) => b.label)).toEqual(["second", "third", "first"])
    })
  })

  describe("Replace bookmark", () => {
    test("replaces existing bookmark at slot", async () => {
      if (!tmuxAvailable) return

      // Create two sessions
      const sessionId1 = await server.createSession("replace-session-1")
      const sessionId2 = await server.createSession("replace-session-2")

      // Add initial bookmark
      const original = await store.add(
        "original",
        "session",
        { sessionId: sessionId1 },
        { sessionName: "replace-session-1" },
      )

      // Verify it's at slot 1
      const slot1 = await store.getBySlot(1)
      expect(slot1?.id).toBe(original.id)

      // Replace it
      const replacement = await store.replace(
        1,
        "replacement",
        "session",
        { sessionId: sessionId2 },
        { sessionName: "replace-session-2" },
      )

      expect(replacement).toBeTruthy()
      expect(replacement?.label).toBe("replacement")

      // Old bookmark should be gone
      const oldBookmark = await store.get(original.id)
      expect(oldBookmark).toBeNull()

      // New bookmark should be at slot 1
      const newSlot1 = await store.getBySlot(1)
      expect(newSlot1?.id).toBe(replacement!.id)

      // List should only have one item
      const bookmarks = await store.list()
      expect(bookmarks).toHaveLength(1)
    })
  })

  describe("Touch updates lastUsed", () => {
    test("updates lastUsed timestamp when touched", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("touch-session")

      const bookmark = await store.add(
        "touchable",
        "session",
        { sessionId },
        { sessionName: "touch-session" },
      )

      const originalLastUsed = bookmark.meta.lastUsed

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 1100))

      // Touch the bookmark
      await store.touch(bookmark.id)

      // Verify lastUsed is updated
      const updated = await store.get(bookmark.id)
      expect(updated?.meta.lastUsed).toBeGreaterThan(originalLastUsed)
    })
  })
})
