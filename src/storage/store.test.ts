/**
 * Tests for bookmark storage
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { BookmarkStore } from "./store.ts"
import { CURRENT_SCHEMA_VERSION } from "../types/index.ts"

describe("BookmarkStore", () => {
  let tempDir: string
  let store: BookmarkStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tmux-tui-test-"))
    store = new BookmarkStore(join(tempDir, "bookmarks.json"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe("read", () => {
    test("returns empty state for non-existent file", async () => {
      const data = await store.read()

      expect(data.version).toBe(CURRENT_SCHEMA_VERSION)
      expect(data.items).toEqual([])
    })
  })

  describe("add", () => {
    test("adds a bookmark", async () => {
      const bookmark = await store.add(
        "work api",
        "window",
        { sessionId: "$1", windowId: "@3" },
        { sessionName: "work", windowIndex: 2, windowName: "api" },
        "/home/user/project",
      )

      expect(bookmark.label).toBe("work api")
      expect(bookmark.kind).toBe("window")
      expect(bookmark.target.sessionId).toBe("$1")
      expect(bookmark.target.windowId).toBe("@3")
      expect(bookmark.fallback.sessionName).toBe("work")
      expect(bookmark.meta.cwd).toBe("/home/user/project")
      expect(bookmark.id).toBeTruthy()
    })

    test("persists bookmarks to disk", async () => {
      await store.add("test", "window", { sessionId: "$1" }, { sessionName: "test" })

      // Create new store instance to verify persistence
      const newStore = new BookmarkStore(store.getPath())
      const bookmarks = await newStore.list()

      expect(bookmarks.length).toBe(1)
      expect(bookmarks[0]?.label).toBe("test")
    })
  })

  describe("list", () => {
    test("returns empty array when no bookmarks", async () => {
      const bookmarks = await store.list()
      expect(bookmarks).toEqual([])
    })

    test("returns all bookmarks in order", async () => {
      await store.add("first", "window", { sessionId: "$1" }, {})
      await store.add("second", "window", { sessionId: "$2" }, {})
      await store.add("third", "window", { sessionId: "$3" }, {})

      const bookmarks = await store.list()

      expect(bookmarks.length).toBe(3)
      expect(bookmarks[0]?.label).toBe("first")
      expect(bookmarks[1]?.label).toBe("second")
      expect(bookmarks[2]?.label).toBe("third")
    })
  })

  describe("get", () => {
    test("returns bookmark by id", async () => {
      const added = await store.add("test", "window", { sessionId: "$1" }, {})
      const found = await store.get(added.id)

      expect(found).toBeTruthy()
      expect(found?.label).toBe("test")
    })

    test("returns null for non-existent id", async () => {
      const found = await store.get("non-existent-id")
      expect(found).toBeNull()
    })
  })

  describe("getByLabel", () => {
    test("returns bookmark by label", async () => {
      await store.add("work api", "window", { sessionId: "$1" }, {})
      const found = await store.getByLabel("work api")

      expect(found).toBeTruthy()
      expect(found?.label).toBe("work api")
    })

    test("returns null for non-existent label", async () => {
      const found = await store.getByLabel("non-existent")
      expect(found).toBeNull()
    })
  })

  describe("getBySlot", () => {
    test("returns bookmark by 1-based slot", async () => {
      await store.add("first", "window", { sessionId: "$1" }, {})
      await store.add("second", "window", { sessionId: "$2" }, {})

      expect((await store.getBySlot(1))?.label).toBe("first")
      expect((await store.getBySlot(2))?.label).toBe("second")
    })

    test("returns null for out-of-range slot", async () => {
      await store.add("test", "window", { sessionId: "$1" }, {})

      expect(await store.getBySlot(0)).toBeNull()
      expect(await store.getBySlot(2)).toBeNull()
      expect(await store.getBySlot(-1)).toBeNull()
    })
  })

  describe("remove", () => {
    test("removes bookmark by id", async () => {
      const added = await store.add("test", "window", { sessionId: "$1" }, {})
      const removed = await store.remove(added.id)

      expect(removed).toBe(true)
      expect(await store.list()).toEqual([])
    })

    test("returns false for non-existent id", async () => {
      const removed = await store.remove("non-existent-id")
      expect(removed).toBe(false)
    })
  })

  describe("removeBySlot", () => {
    test("removes bookmark by 1-based slot", async () => {
      await store.add("first", "window", { sessionId: "$1" }, {})
      await store.add("second", "window", { sessionId: "$2" }, {})

      const removed = await store.removeBySlot(1)

      expect(removed).toBe(true)
      const remaining = await store.list()
      expect(remaining.length).toBe(1)
      expect(remaining[0]?.label).toBe("second")
    })

    test("returns false for out-of-range slot", async () => {
      await store.add("test", "window", { sessionId: "$1" }, {})

      expect(await store.removeBySlot(0)).toBe(false)
      expect(await store.removeBySlot(5)).toBe(false)
    })
  })

  describe("rename", () => {
    test("renames bookmark", async () => {
      const added = await store.add("old name", "window", { sessionId: "$1" }, {})
      const renamed = await store.rename(added.id, "new name")

      expect(renamed).toBe(true)
      const found = await store.get(added.id)
      expect(found?.label).toBe("new name")
    })

    test("returns false for non-existent id", async () => {
      const renamed = await store.rename("non-existent-id", "new name")
      expect(renamed).toBe(false)
    })
  })

  describe("move", () => {
    test("moves bookmark from one slot to another", async () => {
      await store.add("first", "window", { sessionId: "$1" }, {})
      await store.add("second", "window", { sessionId: "$2" }, {})
      await store.add("third", "window", { sessionId: "$3" }, {})

      const moved = await store.move(1, 3)

      expect(moved).toBe(true)
      const bookmarks = await store.list()
      expect(bookmarks[0]?.label).toBe("second")
      expect(bookmarks[1]?.label).toBe("third")
      expect(bookmarks[2]?.label).toBe("first")
    })

    test("returns false for out-of-range slots", async () => {
      await store.add("test", "window", { sessionId: "$1" }, {})

      expect(await store.move(0, 1)).toBe(false)
      expect(await store.move(1, 5)).toBe(false)
      expect(await store.move(5, 1)).toBe(false)
    })
  })

  describe("touch", () => {
    test("updates lastUsed timestamp", async () => {
      const added = await store.add("test", "window", { sessionId: "$1" }, {})
      const originalTime = added.meta.lastUsed

      // Wait a tiny bit to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10))

      await store.touch(added.id)

      const updated = await store.get(added.id)
      expect(updated?.meta.lastUsed).toBeGreaterThanOrEqual(originalTime)
    })
  })
})
