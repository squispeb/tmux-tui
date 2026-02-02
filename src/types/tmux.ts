/**
 * Types for tmux state representation
 */

/** tmux session with stable ID */
export interface TmuxSession {
  /** Stable session ID (e.g., "$0", "$1") */
  sessionId: string
  /** Session name (user-defined, can change) */
  sessionName: string
  /** Number of windows in session */
  windowCount: number
  /** Whether session is attached */
  attached: boolean
  /** Creation timestamp */
  created: number
}

/** tmux window with stable ID */
export interface TmuxWindow {
  /** Stable window ID (e.g., "@0", "@1") */
  windowId: string
  /** Window index (can change when reordered) */
  windowIndex: number
  /** Window name (can change) */
  windowName: string
  /** Parent session ID */
  sessionId: string
  /** Parent session name */
  sessionName: string
  /** Whether this is the active window */
  active: boolean
  /** Number of panes */
  paneCount: number
}

/** tmux pane with stable ID */
export interface TmuxPane {
  /** Stable pane ID (e.g., "%0", "%1") */
  paneId: string
  /** Pane index within window */
  paneIndex: number
  /** Parent window ID */
  windowId: string
  /** Window index */
  windowIndex: number
  /** Window name */
  windowName: string
  /** Parent session ID */
  sessionId: string
  /** Session name */
  sessionName: string
  /** Whether this is the active pane */
  active: boolean
  /** Current working directory */
  cwd: string
  /** Current command running in pane */
  currentCommand: string
}

/** Full tmux state snapshot */
export interface TmuxState {
  sessions: TmuxSession[]
  windows: TmuxWindow[]
  panes: TmuxPane[]
}

/** Target for jump operations - uses IDs when available */
export interface TmuxTarget {
  sessionId?: string
  windowId?: string
  paneId?: string
}

/** Fallback identifiers when IDs don't resolve */
export interface TmuxFallback {
  sessionName?: string
  windowIndex?: number
  windowName?: string
  paneIndex?: number
}

/** Current tmux context (where the user is right now) */
export interface TmuxContext {
  /** Whether we're running inside tmux */
  insideTmux: boolean
  /** Current session ID (if inside tmux) */
  sessionId?: string
  /** Current window ID (if inside tmux) */
  windowId?: string
  /** Current pane ID (if inside tmux) */
  paneId?: string
}
