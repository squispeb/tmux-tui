/**
 * Integration tests for TmuxAdapter
 *
 * These tests use an isolated tmux server to verify the adapter
 * correctly interacts with tmux.
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test"
import { TmuxTestServer, isTmuxAvailable } from "../../src/tmux/test-utils.ts"

describe("TmuxAdapter Integration", () => {
  let server: TmuxTestServer
  let tmuxAvailable: boolean

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

  describe("listSessions", () => {
    test("returns sessions from test server", async () => {
      if (!tmuxAvailable) return

      const sessions = await server.adapter.listSessions()

      // Should have at least the initial test-init session
      expect(sessions.length).toBeGreaterThanOrEqual(1)

      // Find the test-init session
      const initSession = sessions.find((s) => s.sessionName === "test-init")
      expect(initSession).toBeTruthy()
      expect(initSession?.sessionId).toMatch(/^\$\d+$/)
    })

    test("returns newly created sessions", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("adapter-test-session")

      const sessions = await server.adapter.listSessions()
      const found = sessions.find((s) => s.sessionId === sessionId)

      expect(found).toBeTruthy()
      expect(found?.sessionName).toBe("adapter-test-session")
    })
  })

  describe("listWindows", () => {
    test("returns windows from all sessions", async () => {
      if (!tmuxAvailable) return

      const windows = await server.adapter.listWindows()

      // Should have at least one window
      expect(windows.length).toBeGreaterThanOrEqual(1)

      // Each window should have valid IDs
      for (const window of windows) {
        expect(window.windowId).toMatch(/^@\d+$/)
        expect(window.sessionId).toMatch(/^\$\d+$/)
      }
    })

    test("returns newly created windows", async () => {
      if (!tmuxAvailable) return

      // Create a session and window
      const sessionId = await server.createSession("window-test-session")
      const windowId = await server.createWindow(sessionId, "test-window")

      const windows = await server.adapter.listWindows()
      const found = windows.find((w) => w.windowId === windowId)

      expect(found).toBeTruthy()
      expect(found?.windowName).toBe("test-window")
      expect(found?.sessionId).toBe(sessionId)
    })
  })

  describe("listPanes", () => {
    test("returns panes from all sessions/windows", async () => {
      if (!tmuxAvailable) return

      const panes = await server.adapter.listPanes()

      // Should have at least one pane
      expect(panes.length).toBeGreaterThanOrEqual(1)

      // Each pane should have valid IDs
      for (const pane of panes) {
        expect(pane.paneId).toMatch(/^%\d+$/)
        expect(pane.windowId).toMatch(/^@\d+$/)
        expect(pane.sessionId).toMatch(/^\$\d+$/)
      }
    })

    test("returns new panes after split", async () => {
      if (!tmuxAvailable) return

      // Create a fresh session with a known window
      const sessionId = await server.createSession("pane-test-session")
      const windowId = await server.createWindow(sessionId, "pane-test-window")

      // Find the initial pane
      const panesBefore = await server.adapter.listPanes()
      const initialPane = panesBefore.find((p) => p.windowId === windowId)
      expect(initialPane).toBeTruthy()

      // Split the pane
      const newPaneId = await server.splitPane(initialPane!.paneId)

      // Verify the new pane exists
      const panesAfter = await server.adapter.listPanes()
      const newPane = panesAfter.find((p) => p.paneId === newPaneId)

      expect(newPane).toBeTruthy()
      expect(newPane?.windowId).toBe(windowId)
    })
  })

  describe("findSessionById", () => {
    test("finds existing session by ID", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("find-session-test")
      const found = await server.adapter.findSessionById(sessionId)

      expect(found).toBeTruthy()
      expect(found?.sessionId).toBe(sessionId)
      expect(found?.sessionName).toBe("find-session-test")
    })

    test("returns null for non-existent ID", async () => {
      if (!tmuxAvailable) return

      const found = await server.adapter.findSessionById("$99999")
      expect(found).toBeNull()
    })
  })

  describe("findWindowById", () => {
    test("finds existing window by ID", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("find-window-test")
      const windowId = await server.createWindow(sessionId, "target-window")

      const found = await server.adapter.findWindowById(windowId)

      expect(found).toBeTruthy()
      expect(found?.windowId).toBe(windowId)
      expect(found?.windowName).toBe("target-window")
    })

    test("returns null for non-existent ID", async () => {
      if (!tmuxAvailable) return

      const found = await server.adapter.findWindowById("@99999")
      expect(found).toBeNull()
    })
  })

  describe("findPaneById", () => {
    test("finds existing pane by ID", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("find-pane-test")
      const windowId = await server.createWindow(sessionId, "pane-window")

      // Get the pane that was created with the window
      const panes = await server.adapter.listPanes()
      const pane = panes.find((p) => p.windowId === windowId)
      expect(pane).toBeTruthy()

      const found = await server.adapter.findPaneById(pane!.paneId)

      expect(found).toBeTruthy()
      expect(found?.paneId).toBe(pane!.paneId)
    })

    test("returns null for non-existent ID", async () => {
      if (!tmuxAvailable) return

      const found = await server.adapter.findPaneById("%99999")
      expect(found).toBeNull()
    })
  })

  describe("findSessionByName", () => {
    test("finds session by name", async () => {
      if (!tmuxAvailable) return

      await server.createSession("named-session")
      const found = await server.adapter.findSessionByName("named-session")

      expect(found).toBeTruthy()
      expect(found?.sessionName).toBe("named-session")
    })

    test("returns null for non-existent name", async () => {
      if (!tmuxAvailable) return

      const found = await server.adapter.findSessionByName("non-existent-session-xyz")
      expect(found).toBeNull()
    })
  })

  describe("findWindowByName", () => {
    test("finds window by name in session", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("window-name-test")
      await server.createWindow(sessionId, "named-window")

      const found = await server.adapter.findWindowByName(sessionId, "named-window")

      expect(found).toBeTruthy()
      expect(found?.windowName).toBe("named-window")
    })

    test("returns null for non-existent name", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("window-name-test-2")
      const found = await server.adapter.findWindowByName(sessionId, "non-existent-window")

      expect(found).toBeNull()
    })
  })

  describe("findWindowByIndex", () => {
    test("finds window by index in session", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("window-index-test")

      // The first window (created with the session) should be at index 0 or 1
      const windows = await server.adapter.listWindows()
      const sessionWindows = windows.filter((w) => w.sessionId === sessionId)
      expect(sessionWindows.length).toBeGreaterThanOrEqual(1)

      const firstWindow = sessionWindows[0]!
      const found = await server.adapter.findWindowByIndex(sessionId, firstWindow.windowIndex)

      expect(found).toBeTruthy()
      expect(found?.windowId).toBe(firstWindow.windowId)
    })
  })

  describe("getState", () => {
    test("returns complete state snapshot", async () => {
      if (!tmuxAvailable) return

      const state = await server.adapter.getState()

      expect(state.sessions.length).toBeGreaterThan(0)
      expect(state.windows.length).toBeGreaterThan(0)
      expect(state.panes.length).toBeGreaterThan(0)

      // Verify referential integrity
      for (const window of state.windows) {
        const session = state.sessions.find((s) => s.sessionId === window.sessionId)
        expect(session).toBeTruthy()
      }

      for (const pane of state.panes) {
        const window = state.windows.find((w) => w.windowId === pane.windowId)
        expect(window).toBeTruthy()
      }
    })
  })
})
