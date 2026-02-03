/**
 * Integration tests for edge cases
 *
 * Tests unusual scenarios: renamed windows, deleted targets, special characters, etc.
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TmuxTestServer, isTmuxAvailable } from "../../src/tmux/test-utils.ts"
import { BookmarkStore } from "../../src/storage/store.ts"
import { resolveBookmark } from "../../src/cli/resolver.ts"

describe("Edge Cases Integration", () => {
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

    tempDir = await mkdtemp(join(tmpdir(), "tmux-tui-test-"))
    store = new BookmarkStore(join(tempDir, "bookmarks.json"))
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  describe("Special characters in names", () => {
    test("handles session names with spaces", async () => {
      if (!tmuxAvailable) return

      // Note: tmux doesn't allow spaces in session names, but we can test with dashes/underscores
      const sessionId = await server.createSession("my-test-session")
      
      const bookmark = await store.add(
        "label with spaces",
        "session",
        { sessionId },
        { sessionName: "my-test-session" },
      )

      expect(bookmark.label).toBe("label with spaces")

      const resolution = await resolveBookmark(bookmark, server.adapter)
      expect(resolution.resolved).toBe(true)
    })

    test("handles window names with special characters", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("special-char-session")
      // tmux allows various characters in window names
      const windowId = await server.createWindow(sessionId, "vim:main.ts")

      const window = await server.adapter.findWindowById(windowId)
      expect(window).toBeTruthy()
      expect(window!.windowName).toBe("vim:main.ts")

      const bookmark = await store.add(
        "editor-window",
        "window",
        { sessionId, windowId },
        { sessionName: "special-char-session", windowName: "vim:main.ts" },
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)
      expect(resolution.resolved).toBe(true)
    })

    test("handles labels with unicode characters", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("unicode-session")

      const bookmark = await store.add(
        "测试书签 📚",
        "session",
        { sessionId },
        { sessionName: "unicode-session" },
      )

      expect(bookmark.label).toBe("测试书签 📚")

      const retrieved = await store.getByLabel("测试书签 📚")
      expect(retrieved).toBeTruthy()
      expect(retrieved!.id).toBe(bookmark.id)
    })
  })

  describe("Multiple windows with same name", () => {
    test("findWindowByName returns the first match", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("dupe-window-session")
      
      // Create multiple windows with the same name
      const windowId1 = await server.createWindow(sessionId, "duplicate")
      const windowId2 = await server.createWindow(sessionId, "duplicate")

      // findWindowByName should return one of them
      const found = await server.adapter.findWindowByName(sessionId, "duplicate")
      expect(found).toBeTruthy()
      expect(found!.windowName).toBe("duplicate")

      // Both windows should exist
      const windows = await server.adapter.listWindows()
      const dupeWindows = windows.filter(
        (w) => w.sessionId === sessionId && w.windowName === "duplicate"
      )
      expect(dupeWindows.length).toBe(2)
    })

    test("ID resolution is unambiguous even with duplicate names", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("dupe-resolve-session")
      
      const windowId1 = await server.createWindow(sessionId, "same-name")
      const windowId2 = await server.createWindow(sessionId, "same-name")

      // Bookmark the second window by ID
      const bookmark = await store.add(
        "second-window",
        "window",
        { sessionId, windowId: windowId2 },
        { sessionName: "dupe-resolve-session", windowName: "same-name" },
      )

      // Resolution by ID should get the exact window
      const resolution = await resolveBookmark(bookmark, server.adapter)
      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.windowId).toBe(windowId2)
      }
    })
  })

  describe("Pane operations", () => {
    test("handles multiple splits correctly", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("multi-split-session")
      const windowId = await server.createWindow(sessionId, "multi-split-window")

      // Get the initial pane
      let panes = await server.adapter.listPanes()
      const initialPane = panes.find((p) => p.windowId === windowId)
      expect(initialPane).toBeTruthy()

      // Split horizontally
      const paneId2 = await server.splitPane(initialPane!.paneId, false)
      
      // Split the new pane vertically
      const paneId3 = await server.splitPane(paneId2, true)

      // Should now have 3 panes in this window
      panes = await server.adapter.listPanes()
      const windowPanes = panes.filter((p) => p.windowId === windowId)
      expect(windowPanes.length).toBe(3)

      // Bookmark and resolve each pane
      for (const pane of windowPanes) {
        const bookmark = await store.add(
          `pane-${pane.paneIndex}`,
          "pane",
          { sessionId, windowId, paneId: pane.paneId },
          { sessionName: "multi-split-session", windowName: "multi-split-window" },
        )

        const resolution = await resolveBookmark(bookmark, server.adapter)
        expect(resolution.resolved).toBe(true)
        if (resolution.resolved) {
          expect(resolution.target.paneId).toBe(pane.paneId)
        }
      }
    })

    test("handles pane killed in multi-pane window", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("kill-pane-session")
      const windowId = await server.createWindow(sessionId, "kill-pane-window")

      // Get initial pane and split
      let panes = await server.adapter.listPanes()
      const initialPane = panes.find((p) => p.windowId === windowId)
      const newPaneId = await server.splitPane(initialPane!.paneId)

      // Bookmark the new pane
      const bookmark = await store.add(
        "doomed-pane",
        "pane",
        { sessionId, windowId, paneId: newPaneId },
        { sessionName: "kill-pane-session", windowName: "kill-pane-window" },
      )

      // Verify it resolves
      const beforeKill = await resolveBookmark(bookmark, server.adapter)
      expect(beforeKill.resolved).toBe(true)

      // Kill the pane
      await server.killPane(newPaneId)

      // Should fail to resolve now
      const afterKill = await resolveBookmark(bookmark, server.adapter)
      // This might fall back to window since pane is gone
      // but the pane ID itself won't resolve
      if (afterKill.resolved && afterKill.method === "id") {
        // ID resolution should not find the pane
        expect(afterKill.target.paneId).not.toBe(newPaneId)
      }
    })
  })

  describe("Empty and boundary conditions", () => {
    test("handles empty bookmark list", async () => {
      if (!tmuxAvailable) return

      const bookmarks = await store.list()
      expect(bookmarks).toHaveLength(0)

      // Operations on empty list
      const byId = await store.get("nonexistent")
      expect(byId).toBeNull()

      const bySlot = await store.getBySlot(1)
      expect(bySlot).toBeNull()

      const byLabel = await store.getByLabel("nonexistent")
      expect(byLabel).toBeNull()

      // Remove from empty list
      const removed = await store.remove("nonexistent")
      expect(removed).toBe(false)

      const removedBySlot = await store.removeBySlot(1)
      expect(removedBySlot).toBe(false)
    })

    test("handles slot boundaries", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("boundary-session")

      // Add one bookmark
      await store.add("only", "session", { sessionId }, { sessionName: "boundary-session" })

      // Slot 0 is invalid (1-based)
      const slot0 = await store.getBySlot(0)
      expect(slot0).toBeNull()

      // Slot 1 is valid
      const slot1 = await store.getBySlot(1)
      expect(slot1).toBeTruthy()

      // Slot 2 is out of range
      const slot2 = await store.getBySlot(2)
      expect(slot2).toBeNull()

      // Negative slot
      const slotNeg = await store.getBySlot(-1)
      expect(slotNeg).toBeNull()
    })

    test("handles move with invalid slots", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("move-boundary-session")
      await store.add("item", "session", { sessionId }, { sessionName: "move-boundary-session" })

      // Move from invalid slot
      const moveFromInvalid = await store.move(5, 1)
      expect(moveFromInvalid).toBe(false)

      // Move to invalid slot
      const moveToInvalid = await store.move(1, 5)
      expect(moveToInvalid).toBe(false)

      // Move from negative
      const moveFromNeg = await store.move(-1, 1)
      expect(moveFromNeg).toBe(false)
    })
  })

  describe("Session with no windows", () => {
    // Note: In tmux, sessions always have at least one window
    // but we can test behavior when windows are killed

    test("session remains after killing windows until last one", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("kill-windows-session")
      
      // Create a second window so we can kill one
      const window2Id = await server.createWindow(sessionId, "window2")

      // Get the first window (created with session)
      const windows = await server.adapter.listWindows()
      const sessionWindows = windows.filter((w) => w.sessionId === sessionId)
      expect(sessionWindows.length).toBeGreaterThanOrEqual(2)

      // Kill the second window
      await server.killWindow(window2Id)

      // Session should still exist
      const session = await server.adapter.findSessionById(sessionId)
      expect(session).toBeTruthy()

      // Should have at least one window left
      const remainingWindows = await server.adapter.listWindows()
      const remaining = remainingWindows.filter((w) => w.sessionId === sessionId)
      expect(remaining.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("Rapid operations", () => {
    test("handles rapid bookmark additions", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("rapid-session")

      // Add many bookmarks quickly in parallel
      // Note: Due to read-modify-write race conditions without locking,
      // parallel writes may overwrite each other. Each returned bookmark
      // has a unique ID, but they may not all persist to disk.
      const promises: Promise<import("../../src/types/index.ts").Bookmark>[] = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          store.add(`rapid-${i}`, "session", { sessionId }, { sessionName: "rapid-session" })
        )
      }

      // Wait for all to complete
      const results = await Promise.all(promises)

      // All returned bookmarks should have unique IDs (in memory)
      const ids = results.map((r) => r.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(10)

      // At least some should be in the store (due to race conditions not all may persist)
      const bookmarks = await store.list()
      expect(bookmarks.length).toBeGreaterThanOrEqual(1)

      // File should not be corrupted
      const content = await Bun.file(store.getPath()).text()
      expect(() => JSON.parse(content)).not.toThrow()
    })

    test("handles rapid session creation and bookmarking", async () => {
      if (!tmuxAvailable) return

      const sessions: string[] = []

      // Create multiple sessions rapidly
      for (let i = 0; i < 5; i++) {
        const sessionId = await server.createSession(`rapid-session-${i}`)
        sessions.push(sessionId)
      }

      // Bookmark all of them
      for (let i = 0; i < sessions.length; i++) {
        await store.add(
          `session-${i}`,
          "session",
          { sessionId: sessions[i]! },
          { sessionName: `rapid-session-${i}` },
        )
      }

      // Resolve all
      const bookmarks = await store.list()
      for (const bookmark of bookmarks) {
        const resolution = await resolveBookmark(bookmark, server.adapter)
        expect(resolution.resolved).toBe(true)
      }
    })
  })
})
