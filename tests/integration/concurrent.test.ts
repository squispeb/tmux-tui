/**
 * Integration tests for concurrent access
 *
 * Tests multiple processes/operations accessing the bookmarks file simultaneously
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TmuxTestServer, isTmuxAvailable } from "../../src/tmux/test-utils.ts"
import { BookmarkStore } from "../../src/storage/store.ts"
import type { BookmarksFile } from "../../src/types/index.ts"

describe("Concurrent Access Integration", () => {
  let server: TmuxTestServer
  let tmuxAvailable: boolean
  let tempDir: string
  let bookmarksPath: string

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
    bookmarksPath = join(tempDir, "bookmarks.json")
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  describe("Multiple store instances", () => {
    test("two stores see each other's changes", async () => {
      if (!tmuxAvailable) return

      const store1 = new BookmarkStore(bookmarksPath)
      const store2 = new BookmarkStore(bookmarksPath)

      const sessionId = await server.createSession("concurrent-session")

      // Store 1 adds a bookmark
      const bookmark = await store1.add(
        "from-store1",
        "session",
        { sessionId },
        { sessionName: "concurrent-session" },
      )

      // Store 2 should see it
      const bookmarks = await store2.list()
      expect(bookmarks).toHaveLength(1)
      expect(bookmarks[0]!.label).toBe("from-store1")

      // Store 2 adds another
      await store2.add(
        "from-store2",
        "session",
        { sessionId },
        { sessionName: "concurrent-session" },
      )

      // Store 1 should see both
      const allBookmarks = await store1.list()
      expect(allBookmarks).toHaveLength(2)
    })

    test("rename is visible across stores", async () => {
      if (!tmuxAvailable) return

      const store1 = new BookmarkStore(bookmarksPath)
      const store2 = new BookmarkStore(bookmarksPath)

      const sessionId = await server.createSession("rename-concurrent-session")

      // Store 1 adds
      const bookmark = await store1.add(
        "original",
        "session",
        { sessionId },
        { sessionName: "rename-concurrent-session" },
      )

      // Store 2 renames
      await store2.rename(bookmark.id, "renamed")

      // Store 1 should see the new name
      const updated = await store1.get(bookmark.id)
      expect(updated?.label).toBe("renamed")
    })

    test("remove is visible across stores", async () => {
      if (!tmuxAvailable) return

      const store1 = new BookmarkStore(bookmarksPath)
      const store2 = new BookmarkStore(bookmarksPath)

      const sessionId = await server.createSession("remove-concurrent-session")

      // Store 1 adds
      const bookmark = await store1.add(
        "to-remove",
        "session",
        { sessionId },
        { sessionName: "remove-concurrent-session" },
      )

      // Verify both see it
      expect(await store1.list()).toHaveLength(1)
      expect(await store2.list()).toHaveLength(1)

      // Store 2 removes
      await store2.remove(bookmark.id)

      // Store 1 should see it's gone
      const remaining = await store1.list()
      expect(remaining).toHaveLength(0)
    })
  })

  describe("Concurrent writes", () => {
    test("parallel additions don't corrupt the file", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("parallel-add-session")

      // Create multiple stores
      const stores = Array.from({ length: 5 }, () => new BookmarkStore(bookmarksPath))

      // Each store adds a bookmark concurrently
      // Note: Due to race conditions (read-modify-write without locking),
      // not all bookmarks may be saved. This is expected behavior.
      // What matters is the file isn't corrupted.
      const addPromises = stores.map((store, i) =>
        store.add(`parallel-${i}`, "session", { sessionId }, { sessionName: "parallel-add-session" })
      )

      // Wait for all to complete
      await Promise.all(addPromises)

      // Read the final state
      const finalStore = new BookmarkStore(bookmarksPath)
      const bookmarks = await finalStore.list()

      // At least one write should succeed (last one wins)
      expect(bookmarks.length).toBeGreaterThanOrEqual(1)

      // Verify file is valid JSON (not corrupted)
      const content = await readFile(bookmarksPath, "utf-8")
      const parsed: BookmarksFile = JSON.parse(content)
      expect(parsed.version).toBe(1)
      expect(Array.isArray(parsed.items)).toBe(true)
    })

    test("parallel reads don't interfere with each other", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("parallel-read-session")
      const store = new BookmarkStore(bookmarksPath)

      // Add some bookmarks first
      for (let i = 0; i < 10; i++) {
        await store.add(`item-${i}`, "session", { sessionId }, { sessionName: "parallel-read-session" })
      }

      // Create multiple stores for reading
      const stores = Array.from({ length: 10 }, () => new BookmarkStore(bookmarksPath))

      // Read from all stores concurrently
      const readPromises = stores.map((s) => s.list())
      const results = await Promise.all(readPromises)

      // All should return the same data
      for (const bookmarks of results) {
        expect(bookmarks).toHaveLength(10)
      }
    })

    test("parallel getBySlot returns consistent results", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("parallel-slot-session")
      const store = new BookmarkStore(bookmarksPath)

      // Add bookmarks
      await store.add("first", "session", { sessionId }, { sessionName: "parallel-slot-session" })
      await store.add("second", "session", { sessionId }, { sessionName: "parallel-slot-session" })
      await store.add("third", "session", { sessionId }, { sessionName: "parallel-slot-session" })

      // Read slot 2 from multiple stores concurrently
      const stores = Array.from({ length: 10 }, () => new BookmarkStore(bookmarksPath))
      const readPromises = stores.map((s) => s.getBySlot(2))
      const results = await Promise.all(readPromises)

      // All should return "second"
      for (const bookmark of results) {
        expect(bookmark).toBeTruthy()
        expect(bookmark!.label).toBe("second")
      }
    })
  })

  describe("File integrity", () => {
    test("atomic writes prevent corruption during rapid writes", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("atomic-session")
      const store = new BookmarkStore(bookmarksPath)

      // Add initial bookmark
      await store.add("initial", "session", { sessionId }, { sessionName: "atomic-session" })

      // Perform many rapid writes
      // Note: These will race and some may be lost, but file shouldn't corrupt
      const writePromises: Promise<unknown>[] = []
      for (let i = 0; i < 20; i++) {
        writePromises.push(
          store.add(`rapid-${i}`, "session", { sessionId }, { sessionName: "atomic-session" })
        )
      }

      await Promise.all(writePromises)

      // File should be valid JSON (not corrupted)
      const content = await readFile(bookmarksPath, "utf-8")
      expect(() => JSON.parse(content)).not.toThrow()

      const parsed: BookmarksFile = JSON.parse(content)
      expect(parsed.version).toBe(1)
      // Items should be an array (structure intact)
      expect(Array.isArray(parsed.items)).toBe(true)
      // At least one item should exist
      expect(parsed.items.length).toBeGreaterThanOrEqual(1)
    })

    test("file survives mixed read/write operations", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("mixed-ops-session")
      const store = new BookmarkStore(bookmarksPath)

      // Add some initial bookmarks sequentially first to ensure file exists
      for (let i = 0; i < 5; i++) {
        await store.add(`initial-${i}`, "session", { sessionId }, { sessionName: "mixed-ops-session" })
      }

      // Mix of reads and writes - these may race but file shouldn't corrupt
      const operations: Promise<unknown>[] = []

      for (let i = 0; i < 10; i++) {
        // Add
        operations.push(
          store.add(`added-${i}`, "session", { sessionId }, { sessionName: "mixed-ops-session" })
        )
        // Read
        operations.push(store.list())
        // Get by slot
        operations.push(store.getBySlot((i % 5) + 1))
      }

      await Promise.all(operations)

      // Final read should work
      const bookmarks = await store.list()
      expect(bookmarks.length).toBeGreaterThan(0)

      // File should be valid
      const content = await readFile(bookmarksPath, "utf-8")
      const parsed: BookmarksFile = JSON.parse(content)
      expect(parsed.version).toBe(1)
    })
  })

  describe("Fresh store instances", () => {
    test("new store instance reads existing file correctly", async () => {
      if (!tmuxAvailable) return

      const sessionId = await server.createSession("fresh-instance-session")

      // First store writes
      const store1 = new BookmarkStore(bookmarksPath)
      await store1.add("bookmark-1", "session", { sessionId }, { sessionName: "fresh-instance-session" })
      await store1.add("bookmark-2", "session", { sessionId }, { sessionName: "fresh-instance-session" })

      // Create a completely new store instance (simulating new process)
      const store2 = new BookmarkStore(bookmarksPath)
      
      const bookmarks = await store2.list()
      expect(bookmarks).toHaveLength(2)
      expect(bookmarks[0]!.label).toBe("bookmark-1")
      expect(bookmarks[1]!.label).toBe("bookmark-2")
    })

    test("store handles non-existent file gracefully", async () => {
      if (!tmuxAvailable) return

      // Point to a file that doesn't exist yet
      const newPath = join(tempDir, "new-bookmarks.json")
      const store = new BookmarkStore(newPath)

      // Read should return empty
      const bookmarks = await store.list()
      expect(bookmarks).toHaveLength(0)

      // Write should create the file
      const sessionId = await server.createSession("new-file-session")
      await store.add("first", "session", { sessionId }, { sessionName: "new-file-session" })

      // File should exist now
      const file = Bun.file(newPath)
      expect(await file.exists()).toBe(true)

      // And be valid
      const content = await file.json()
      expect(content.version).toBe(1)
      expect(content.items).toHaveLength(1)
    })
  })
})
