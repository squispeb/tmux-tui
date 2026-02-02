/**
 * Bookmark storage - persistence layer with atomic writes
 */

import { mkdir, rename, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import type {
  Bookmark,
  BookmarkKind,
  BookmarksFile,
  TmuxFallback,
  TmuxTarget,
} from "../types/index.ts"
import { CURRENT_SCHEMA_VERSION } from "../types/index.ts"

/** Default config directory following XDG spec */
const DEFAULT_CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "tmux-tui",
)

/** Default bookmarks file path */
const DEFAULT_BOOKMARKS_PATH = join(DEFAULT_CONFIG_DIR, "bookmarks.json")

/** Generate a UUID v4 */
function generateId(): string {
  return crypto.randomUUID()
}

/** Get current Unix timestamp */
function now(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * BookmarkStore - manages reading and writing bookmarks
 */
export class BookmarkStore {
  private readonly path: string

  constructor(path: string = DEFAULT_BOOKMARKS_PATH) {
    this.path = path
  }

  /**
   * Get the bookmarks file path
   */
  getPath(): string {
    return this.path
  }

  /**
   * Ensure config directory exists
   */
  private async ensureDir(): Promise<void> {
    const dir = dirname(this.path)
    await mkdir(dir, { recursive: true })
  }

  /**
   * Read bookmarks file, returning empty state if it doesn't exist
   */
  async read(): Promise<BookmarksFile> {
    try {
      const file = Bun.file(this.path)
      const exists = await file.exists()

      if (!exists) {
        return { version: CURRENT_SCHEMA_VERSION, items: [] }
      }

      const content = await file.json()
      return this.migrate(content as BookmarksFile)
    } catch (e) {
      // If file doesn't exist or is invalid, return empty state
      if (e instanceof SyntaxError) {
        console.error("Warning: bookmarks file is corrupted, starting fresh")
        return { version: CURRENT_SCHEMA_VERSION, items: [] }
      }
      throw e
    }
  }

  /**
   * Migrate bookmarks file to current schema version
   */
  private migrate(data: BookmarksFile): BookmarksFile {
    // Currently only version 1, so no migrations needed
    if (data.version === CURRENT_SCHEMA_VERSION) {
      return data
    }

    // Future migrations would go here
    // For now, just update the version
    return { ...data, version: CURRENT_SCHEMA_VERSION }
  }

  /**
   * Write bookmarks file atomically (write to temp file, then rename)
   */
  async write(data: BookmarksFile): Promise<void> {
    await this.ensureDir()

    const tempPath = `${this.path}.tmp.${process.pid}`

    try {
      // Write to temp file
      await Bun.write(tempPath, JSON.stringify(data, null, 2))

      // Atomic rename
      await rename(tempPath, this.path)
    } catch (e) {
      // Clean up temp file on failure
      try {
        await unlink(tempPath)
      } catch {
        // Ignore cleanup errors
      }
      throw e
    }
  }

  /**
   * List all bookmarks
   */
  async list(): Promise<Bookmark[]> {
    const data = await this.read()
    return data.items
  }

  /**
   * Get a bookmark by ID
   */
  async get(id: string): Promise<Bookmark | null> {
    const data = await this.read()
    return data.items.find((b) => b.id === id) ?? null
  }

  /**
   * Get a bookmark by label
   */
  async getByLabel(label: string): Promise<Bookmark | null> {
    const data = await this.read()
    return data.items.find((b) => b.label === label) ?? null
  }

  /**
   * Get a bookmark by slot index (1-based)
   */
  async getBySlot(slot: number): Promise<Bookmark | null> {
    const data = await this.read()
    const index = slot - 1
    if (index < 0 || index >= data.items.length) {
      return null
    }
    return data.items[index] ?? null
  }

  /**
   * Add a new bookmark
   */
  async add(
    label: string,
    kind: BookmarkKind,
    target: TmuxTarget,
    fallback: TmuxFallback,
    cwd?: string,
  ): Promise<Bookmark> {
    const data = await this.read()

    const bookmark: Bookmark = {
      id: generateId(),
      label,
      kind,
      target,
      fallback,
      meta: {
        cwd,
        host: process.env.HOSTNAME ?? process.env.HOST,
        lastUsed: now(),
        createdAt: now(),
      },
    }

    data.items.push(bookmark)
    await this.write(data)

    return bookmark
  }

  /**
   * Remove a bookmark by ID
   */
  async remove(id: string): Promise<boolean> {
    const data = await this.read()
    const index = data.items.findIndex((b) => b.id === id)

    if (index === -1) {
      return false
    }

    data.items.splice(index, 1)
    await this.write(data)

    return true
  }

  /**
   * Remove a bookmark by slot index (1-based)
   */
  async removeBySlot(slot: number): Promise<boolean> {
    const data = await this.read()
    const index = slot - 1

    if (index < 0 || index >= data.items.length) {
      return false
    }

    data.items.splice(index, 1)
    await this.write(data)

    return true
  }

  /**
   * Update a bookmark's label
   */
  async rename(id: string, newLabel: string): Promise<boolean> {
    const data = await this.read()
    const bookmark = data.items.find((b) => b.id === id)

    if (!bookmark) {
      return false
    }

    bookmark.label = newLabel
    await this.write(data)

    return true
  }

  /**
   * Replace a bookmark at a slot index (1-based)
   */
  async replace(
    slot: number,
    label: string,
    kind: BookmarkKind,
    target: TmuxTarget,
    fallback: TmuxFallback,
    cwd?: string,
  ): Promise<Bookmark | null> {
    const data = await this.read()
    const index = slot - 1

    if (index < 0) {
      return null
    }

    const bookmark: Bookmark = {
      id: generateId(),
      label,
      kind,
      target,
      fallback,
      meta: {
        cwd,
        host: process.env.HOSTNAME ?? process.env.HOST,
        lastUsed: now(),
        createdAt: now(),
      },
    }

    // Extend array if needed
    while (data.items.length <= index) {
      // This shouldn't happen in normal use, but handle it gracefully
      data.items.push(bookmark)
      await this.write(data)
      return bookmark
    }

    data.items[index] = bookmark
    await this.write(data)

    return bookmark
  }

  /**
   * Update last used timestamp
   */
  async touch(id: string): Promise<void> {
    const data = await this.read()
    const bookmark = data.items.find((b) => b.id === id)

    if (bookmark) {
      bookmark.meta.lastUsed = now()
      await this.write(data)
    }
  }

  /**
   * Reorder bookmarks by moving a bookmark from one slot to another
   */
  async move(fromSlot: number, toSlot: number): Promise<boolean> {
    const data = await this.read()
    const fromIndex = fromSlot - 1
    const toIndex = toSlot - 1

    if (
      fromIndex < 0 ||
      fromIndex >= data.items.length ||
      toIndex < 0 ||
      toIndex >= data.items.length
    ) {
      return false
    }

    const [bookmark] = data.items.splice(fromIndex, 1)
    if (!bookmark) {
      return false
    }

    data.items.splice(toIndex, 0, bookmark)
    await this.write(data)

    return true
  }
}
