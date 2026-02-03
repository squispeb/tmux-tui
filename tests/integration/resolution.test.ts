/**
 * Integration tests for bookmark resolution fallbacks
 *
 * Tests the resolution chain: ID → name fallback → cwd fallback
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TmuxTestServer, isTmuxAvailable } from "../../src/tmux/test-utils.ts"
import { BookmarkStore } from "../../src/storage/store.ts"
import { resolveBookmark } from "../../src/cli/resolver.ts"
import type { TmuxTarget, TmuxFallback, Bookmark } from "../../src/types/index.ts"

describe("Resolution Fallback Integration", () => {
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

  describe("ID resolution", () => {
    test("resolves session by ID", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("id-res-session")

      const bookmark = await store.add(
        "test",
        "session",
        { sessionId },
        { sessionName: "id-res-session" },
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)

      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.sessionId).toBe(sessionId)
      }
    })

    test("resolves window by ID", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("id-res-window-session")
      const windowId = await server.createWindow(sessionId, "id-res-window")

      const bookmark = await store.add(
        "test",
        "window",
        { sessionId, windowId },
        { sessionName: "id-res-window-session", windowName: "id-res-window" },
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)

      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.windowId).toBe(windowId)
      }
    })

    test("resolves pane by ID", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("id-res-pane-session")
      const windowId = await server.createWindow(sessionId, "id-res-pane-window")

      const panes = await server.adapter.listPanes()
      const pane = panes.find((p) => p.windowId === windowId)
      expect(pane).toBeTruthy()

      const bookmark = await store.add(
        "test",
        "pane",
        { sessionId, windowId, paneId: pane!.paneId },
        { sessionName: "id-res-pane-session", windowName: "id-res-pane-window" },
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)

      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.paneId).toBe(pane!.paneId)
      }
    })
  })

  describe("Name fallback resolution", () => {
    test("falls back to session name when ID is invalid", async () => {
      if (!tmuxAvailable) return

      // Create a session
      const sessionId = await server.createSession("fallback-session")

      // Create bookmark with an INVALID session ID but valid name
      const fakeId = "$99999"
      const bookmark = await store.add(
        "test",
        "session",
        { sessionId: fakeId },
        { sessionName: "fallback-session" },
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)

      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("fallback")
        // The resolved target should have the real session ID
        expect(resolution.target.sessionId).toBe(sessionId)
      }
    })

    test("falls back to window name when window ID is invalid", async () => {
      if (!tmuxAvailable) return

      // Create a session and window
      const sessionId = await server.createSession("fallback-window-session")
      const windowId = await server.createWindow(sessionId, "fallback-window")

      // Create bookmark with INVALID window ID but valid names
      const fakeWindowId = "@99999"
      const bookmark = await store.add(
        "test",
        "window",
        { sessionId, windowId: fakeWindowId },
        { sessionName: "fallback-window-session", windowName: "fallback-window" },
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)

      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("fallback")
        expect(resolution.target.sessionId).toBe(sessionId)
        expect(resolution.target.windowId).toBe(windowId)
      }
    })

    test("falls back to window index when name doesn't match", async () => {
      if (!tmuxAvailable) return

      // Create a session and window
      const sessionId = await server.createSession("index-fallback-session")
      const windowId = await server.createWindow(sessionId, "original-name")

      // Get the window's index
      const window = await server.adapter.findWindowById(windowId)
      expect(window).toBeTruthy()

      // Rename the window so the name fallback won't match
      await server.renameWindow(windowId, "renamed-window")

      // Create bookmark with INVALID window ID, wrong name, but correct index
      const fakeWindowId = "@99999"
      const bookmark = await store.add(
        "test",
        "window",
        { sessionId, windowId: fakeWindowId },
        {
          sessionName: "index-fallback-session",
          windowName: "original-name", // This won't match anymore
          windowIndex: window!.windowIndex, // But this will
        },
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)

      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("fallback")
        expect(resolution.target.windowId).toBe(windowId)
      }
    })
  })

  describe("CWD fallback resolution", () => {
    test("falls back to cwd when ID and name fail", async () => {
      if (!tmuxAvailable) return

      // Create a session
      const sessionId = await server.createSession("cwd-fallback-session")
      const windowId = await server.createWindow(sessionId, "cwd-window")

      // Get the pane
      const panes = await server.adapter.listPanes()
      const pane = panes.find((p) => p.windowId === windowId)
      expect(pane).toBeTruthy()

      // Get the pane's cwd
      const cwd = await server.getPaneCwd(pane!.paneId)
      expect(cwd).toBeTruthy()

      // Create bookmark with INVALID IDs, wrong names, but correct cwd
      const bookmark = await store.add(
        "test",
        "pane",
        { sessionId: "$99999", windowId: "@99999", paneId: "%99999" },
        { sessionName: "non-existent-session", windowName: "non-existent-window" },
        cwd,
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)

      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("cwd")
        // Should find a pane with the matching cwd
        expect(resolution.target.sessionId).toBeTruthy()
        expect(resolution.target.windowId).toBeTruthy()
        expect(resolution.target.paneId).toBeTruthy()
      }
    })
  })

  describe("Resolution failure", () => {
    test("fails when nothing resolves", async () => {
      if (!tmuxAvailable) return

      // Create bookmark with all invalid identifiers
      const bookmark = await store.add(
        "test",
        "session",
        { sessionId: "$99999" },
        { sessionName: "completely-nonexistent-session-xyz123" },
        "/nonexistent/path/that/doesnt/exist",
      )

      const resolution = await resolveBookmark(bookmark, server.adapter)

      expect(resolution.resolved).toBe(false)
      if (!resolution.resolved) {
        expect(resolution.reason).toBeTruthy()
      }
    })

    test("fails when session deleted", async () => {
      if (!tmuxAvailable) return

      // Create and then delete a session
      const sessionId = await server.createSession("deleted-session")

      const bookmark = await store.add(
        "test",
        "session",
        { sessionId },
        { sessionName: "deleted-session" },
      )

      // Verify it resolves before deletion
      const beforeDelete = await resolveBookmark(bookmark, server.adapter)
      expect(beforeDelete.resolved).toBe(true)

      // Delete the session
      await server.killSession(sessionId)

      // Now it should fail
      const afterDelete = await resolveBookmark(bookmark, server.adapter)
      expect(afterDelete.resolved).toBe(false)
    })

    test("fails when window deleted", async () => {
      if (!tmuxAvailable) return

      // Create a session with multiple windows (so we can delete one)
      const sessionId = await server.createSession("delete-window-session")
      const keepWindowId = await server.createWindow(sessionId, "keep-window")
      const deleteWindowId = await server.createWindow(sessionId, "delete-window")

      const bookmark = await store.add(
        "test",
        "window",
        { sessionId, windowId: deleteWindowId },
        { sessionName: "delete-window-session", windowName: "delete-window" },
      )

      // Verify it resolves before deletion
      const beforeDelete = await resolveBookmark(bookmark, server.adapter)
      expect(beforeDelete.resolved).toBe(true)

      // Delete the window
      await server.killWindow(deleteWindowId)

      // Now it should fail (both ID and name are gone)
      const afterDelete = await resolveBookmark(bookmark, server.adapter)
      expect(afterDelete.resolved).toBe(false)
    })
  })

  describe("Resolution after rename", () => {
    test("still resolves by ID after session rename", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("original-name")

      const bookmark = await store.add(
        "test",
        "session",
        { sessionId },
        { sessionName: "original-name" },
      )

      // Rename the session
      await server.renameSession(sessionId, "new-name")

      // Should still resolve by ID
      const resolution = await resolveBookmark(bookmark, server.adapter)
      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.sessionId).toBe(sessionId)
      }
    })

    test("still resolves by ID after window rename", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("rename-window-session")
      const windowId = await server.createWindow(sessionId, "original-window-name")

      const bookmark = await store.add(
        "test",
        "window",
        { sessionId, windowId },
        { sessionName: "rename-window-session", windowName: "original-window-name" },
      )

      // Rename the window
      await server.renameWindow(windowId, "new-window-name")

      // Should still resolve by ID
      const resolution = await resolveBookmark(bookmark, server.adapter)
      expect(resolution.resolved).toBe(true)
      if (resolution.resolved) {
        expect(resolution.method).toBe("id")
        expect(resolution.target.windowId).toBe(windowId)
      }
    })
  })
})
