/**
 * Types for bookmark storage
 */

import type { TmuxFallback, TmuxTarget } from "./tmux.ts"

/** Bookmark target kind */
export type BookmarkKind = "session" | "window" | "pane"

/** Metadata stored with bookmark */
export interface BookmarkMeta {
  /** Working directory at time of bookmark */
  cwd?: string
  /** Hostname where bookmark was created */
  host?: string
  /** Unix timestamp of last use */
  lastUsed: number
  /** Unix timestamp of creation */
  createdAt: number
}

/** A single bookmark entry */
export interface Bookmark {
  /** Unique identifier (UUID) */
  id: string
  /** User-defined label */
  label: string
  /** What kind of target this bookmarks */
  kind: BookmarkKind
  /** Primary target using stable tmux IDs */
  target: TmuxTarget
  /** Fallback identifiers for when IDs don't resolve */
  fallback: TmuxFallback
  /** Additional metadata */
  meta: BookmarkMeta
}

/** Resolution status when looking up a bookmark */
export type BookmarkResolution =
  | { resolved: true; method: "id" | "fallback" | "cwd"; target: TmuxTarget }
  | { resolved: false; reason: string }

/** Bookmarks file schema */
export interface BookmarksFile {
  /** Schema version for migrations */
  version: number
  /** List of bookmarks */
  items: Bookmark[]
}

/** Current schema version */
export const CURRENT_SCHEMA_VERSION = 1
