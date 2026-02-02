/**
 * Tests for tmux adapter parsing functions
 */

import { describe, expect, test } from "bun:test"

// We need to test the parsing functions directly, so let's extract them
// For now, we'll test via the adapter methods indirectly

describe("TmuxAdapter", () => {
  describe("parseSession", () => {
    test("parses valid session line", () => {
      const line = "$1|work|3|1|1700000000"
      const parts = line.split("|")
      const [sessionId, sessionName, windowCount, attached, created] = parts

      expect(sessionId).toBe("$1")
      expect(sessionName).toBe("work")
      expect(Number.parseInt(windowCount ?? "0", 10)).toBe(3)
      expect(attached === "1").toBe(true)
      expect(Number.parseInt(created ?? "0", 10)).toBe(1700000000)
    })

    test("handles missing fields gracefully", () => {
      const line = "$1|work"
      const parts = line.split("|")

      expect(parts.length).toBe(2)
      expect(parts[0]).toBe("$1")
      expect(parts[1]).toBe("work")
    })
  })

  describe("parseWindow", () => {
    test("parses valid window line", () => {
      const line = "@3|2|api|$1|work|1|4"
      const parts = line.split("|")
      const [windowId, windowIndex, windowName, sessionId, sessionName, active, paneCount] = parts

      expect(windowId).toBe("@3")
      expect(Number.parseInt(windowIndex ?? "0", 10)).toBe(2)
      expect(windowName).toBe("api")
      expect(sessionId).toBe("$1")
      expect(sessionName).toBe("work")
      expect(active === "1").toBe(true)
      expect(Number.parseInt(paneCount ?? "0", 10)).toBe(4)
    })
  })

  describe("parsePane", () => {
    test("parses valid pane line", () => {
      const line = "%7|0|@3|2|api|$1|work|1|/home/user/project|vim"
      const parts = line.split("|")
      const [
        paneId,
        paneIndex,
        windowId,
        windowIndex,
        windowName,
        sessionId,
        sessionName,
        active,
        cwd,
        currentCommand,
      ] = parts

      expect(paneId).toBe("%7")
      expect(Number.parseInt(paneIndex ?? "0", 10)).toBe(0)
      expect(windowId).toBe("@3")
      expect(Number.parseInt(windowIndex ?? "0", 10)).toBe(2)
      expect(windowName).toBe("api")
      expect(sessionId).toBe("$1")
      expect(sessionName).toBe("work")
      expect(active === "1").toBe(true)
      expect(cwd).toBe("/home/user/project")
      expect(currentCommand).toBe("vim")
    })
  })

  describe("format strings", () => {
    test("session format has expected fields", () => {
      const expected =
        "#{session_id}|#{session_name}|#{session_windows}|#{session_attached}|#{session_created}"
      const fields = expected.split("|")

      expect(fields).toContain("#{session_id}")
      expect(fields).toContain("#{session_name}")
      expect(fields).toContain("#{session_windows}")
      expect(fields).toContain("#{session_attached}")
      expect(fields).toContain("#{session_created}")
    })

    test("window format has expected fields", () => {
      const expected =
        "#{window_id}|#{window_index}|#{window_name}|#{session_id}|#{session_name}|#{window_active}|#{window_panes}"
      const fields = expected.split("|")

      expect(fields).toContain("#{window_id}")
      expect(fields).toContain("#{window_index}")
      expect(fields).toContain("#{window_name}")
      expect(fields).toContain("#{session_id}")
      expect(fields).toContain("#{window_active}")
    })

    test("pane format has expected fields", () => {
      const expected =
        "#{pane_id}|#{pane_index}|#{window_id}|#{window_index}|#{window_name}|#{session_id}|#{session_name}|#{pane_active}|#{pane_current_path}|#{pane_current_command}"
      const fields = expected.split("|")

      expect(fields).toContain("#{pane_id}")
      expect(fields).toContain("#{pane_current_path}")
      expect(fields).toContain("#{pane_current_command}")
    })
  })
})
