/**
 * tmux adapter - executes commands and parses output
 */

import type {
  TmuxContext,
  TmuxPane,
  TmuxSession,
  TmuxState,
  TmuxTarget,
  TmuxWindow,
} from "../types/index.ts"

/** Error thrown when tmux command fails */
export class TmuxError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`tmux error: ${message}`)
    this.name = "TmuxError"
  }
}

/** Error thrown when tmux is not available */
export class TmuxNotFoundError extends Error {
  constructor() {
    super("tmux is not installed or not in PATH")
    this.name = "TmuxNotFoundError"
  }
}

/** Error thrown when no tmux server is running */
export class TmuxNoServerError extends Error {
  constructor() {
    super("no tmux server running")
    this.name = "TmuxNoServerError"
  }
}

/** Options for TmuxAdapter */
export interface TmuxAdapterOptions {
  /** Custom socket name (uses -L flag). Useful for testing with isolated servers. */
  socketName?: string
}

// Format strings for tmux commands
const SESSION_FORMAT = [
  "#{session_id}",
  "#{session_name}",
  "#{session_windows}",
  "#{session_attached}",
  "#{session_created}",
].join("|")

const WINDOW_FORMAT = [
  "#{window_id}",
  "#{window_index}",
  "#{window_name}",
  "#{session_id}",
  "#{session_name}",
  "#{window_active}",
  "#{window_panes}",
].join("|")

const PANE_FORMAT = [
  "#{pane_id}",
  "#{pane_index}",
  "#{window_id}",
  "#{window_index}",
  "#{window_name}",
  "#{session_id}",
  "#{session_name}",
  "#{pane_active}",
  "#{pane_current_path}",
  "#{pane_current_command}",
].join("|")

/**
 * Execute a tmux command and return stdout
 */
async function runTmux(args: string[], socketArgs: string[] = []): Promise<string> {
  const fullArgs = [...socketArgs, ...args]
  const proc = Bun.spawn(["tmux", ...fullArgs], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    const stderrLower = stderr.toLowerCase()

    // Check for specific error conditions
    if (stderrLower.includes("no server running")) {
      throw new TmuxNoServerError()
    }
    if (stderrLower.includes("command not found") || exitCode === 127) {
      throw new TmuxNotFoundError()
    }

    throw new TmuxError(
      stderr.trim() || `command failed with exit code ${exitCode}`,
      `tmux ${fullArgs.join(" ")}`,
      exitCode,
      stderr,
    )
  }

  return stdout
}

/**
 * Parse a session line from tmux list-sessions
 */
function parseSession(line: string): TmuxSession | null {
  const parts = line.split("|")
  if (parts.length < 5) return null

  const [sessionId, sessionName, windowCount, attached, created] = parts
  if (!sessionId || !sessionName) return null

  return {
    sessionId,
    sessionName,
    windowCount: Number.parseInt(windowCount ?? "0", 10),
    attached: attached === "1",
    created: Number.parseInt(created ?? "0", 10),
  }
}

/**
 * Parse a window line from tmux list-windows
 */
function parseWindow(line: string): TmuxWindow | null {
  const parts = line.split("|")
  if (parts.length < 7) return null

  const [windowId, windowIndex, windowName, sessionId, sessionName, active, paneCount] = parts
  if (!windowId || !sessionId) return null

  return {
    windowId,
    windowIndex: Number.parseInt(windowIndex ?? "0", 10),
    windowName: windowName ?? "",
    sessionId,
    sessionName: sessionName ?? "",
    active: active === "1",
    paneCount: Number.parseInt(paneCount ?? "0", 10),
  }
}

/**
 * Parse a pane line from tmux list-panes
 */
function parsePane(line: string): TmuxPane | null {
  const parts = line.split("|")
  if (parts.length < 10) return null

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
  if (!paneId || !windowId || !sessionId) return null

  return {
    paneId,
    paneIndex: Number.parseInt(paneIndex ?? "0", 10),
    windowId,
    windowIndex: Number.parseInt(windowIndex ?? "0", 10),
    windowName: windowName ?? "",
    sessionId,
    sessionName: sessionName ?? "",
    active: active === "1",
    cwd: cwd ?? "",
    currentCommand: currentCommand ?? "",
  }
}

/**
 * TmuxAdapter - main interface for interacting with tmux
 */
export class TmuxAdapter {
  /** Socket args to prepend to all tmux commands */
  private readonly socketArgs: string[]

  /** Socket name (if using custom socket) */
  readonly socketName?: string

  constructor(options?: TmuxAdapterOptions) {
    this.socketName = options?.socketName
    this.socketArgs = options?.socketName ? ["-L", options.socketName] : []
  }

  /**
   * Run a tmux command with this adapter's socket configuration
   */
  async run(args: string[]): Promise<string> {
    return runTmux(args, this.socketArgs)
  }

  /**
   * Check if tmux is available and a server is running
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.run(["list-sessions", "-F", "#{session_id}"])
      return true
    } catch (e) {
      if (e instanceof TmuxNotFoundError || e instanceof TmuxNoServerError) {
        return false
      }
      throw e
    }
  }

  /**
   * Get current tmux context (are we inside tmux? what session/window/pane?)
   */
  getContext(): TmuxContext {
    const tmux = process.env.TMUX
    const paneId = process.env.TMUX_PANE

    if (!tmux) {
      return { insideTmux: false }
    }

    // TMUX env var format: /path/to/socket,pid,session_index
    // We can get more precise info by querying tmux
    return {
      insideTmux: true,
      paneId: paneId,
      // We'll populate sessionId and windowId via getCurrentPane()
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<TmuxSession[]> {
    const output = await this.run(["list-sessions", "-F", SESSION_FORMAT])
    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map(parseSession)
      .filter((s): s is TmuxSession => s !== null)
  }

  /**
   * List all windows across all sessions
   */
  async listWindows(): Promise<TmuxWindow[]> {
    const output = await this.run(["list-windows", "-a", "-F", WINDOW_FORMAT])
    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map(parseWindow)
      .filter((w): w is TmuxWindow => w !== null)
  }

  /**
   * List all panes across all sessions/windows
   */
  async listPanes(): Promise<TmuxPane[]> {
    const output = await this.run(["list-panes", "-a", "-F", PANE_FORMAT])
    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map(parsePane)
      .filter((p): p is TmuxPane => p !== null)
  }

  /**
   * Get full tmux state snapshot
   */
  async getState(): Promise<TmuxState> {
    const [sessions, windows, panes] = await Promise.all([
      this.listSessions(),
      this.listWindows(),
      this.listPanes(),
    ])

    return { sessions, windows, panes }
  }

  /**
   * Get the current pane (only works when inside tmux)
   */
  async getCurrentPane(): Promise<TmuxPane | null> {
    const context = this.getContext()
    if (!context.insideTmux) {
      return null
    }

    const panes = await this.listPanes()
    // Find the pane matching our TMUX_PANE env var
    if (context.paneId) {
      return panes.find((p) => p.paneId === context.paneId) ?? null
    }

    // Fallback: find the active pane
    return panes.find((p) => p.active) ?? null
  }

  /**
   * Get the current window (only works when inside tmux)
   */
  async getCurrentWindow(): Promise<TmuxWindow | null> {
    const pane = await this.getCurrentPane()
    if (!pane) return null

    const windows = await this.listWindows()
    return windows.find((w) => w.windowId === pane.windowId) ?? null
  }

  /**
   * Get the current session (only works when inside tmux)
   */
  async getCurrentSession(): Promise<TmuxSession | null> {
    const pane = await this.getCurrentPane()
    if (!pane) return null

    const sessions = await this.listSessions()
    return sessions.find((s) => s.sessionId === pane.sessionId) ?? null
  }

  /**
   * Find a session by ID
   */
  async findSessionById(sessionId: string): Promise<TmuxSession | null> {
    const sessions = await this.listSessions()
    return sessions.find((s) => s.sessionId === sessionId) ?? null
  }

  /**
   * Find a window by ID
   */
  async findWindowById(windowId: string): Promise<TmuxWindow | null> {
    const windows = await this.listWindows()
    return windows.find((w) => w.windowId === windowId) ?? null
  }

  /**
   * Find a pane by ID
   */
  async findPaneById(paneId: string): Promise<TmuxPane | null> {
    const panes = await this.listPanes()
    return panes.find((p) => p.paneId === paneId) ?? null
  }

  /**
   * Find a session by name (fallback)
   */
  async findSessionByName(name: string): Promise<TmuxSession | null> {
    const sessions = await this.listSessions()
    return sessions.find((s) => s.sessionName === name) ?? null
  }

  /**
   * Find a window by name in a session (fallback)
   */
  async findWindowByName(sessionId: string, windowName: string): Promise<TmuxWindow | null> {
    const windows = await this.listWindows()
    return windows.find((w) => w.sessionId === sessionId && w.windowName === windowName) ?? null
  }

  /**
   * Find a window by index in a session (fallback)
   */
  async findWindowByIndex(sessionId: string, windowIndex: number): Promise<TmuxWindow | null> {
    const windows = await this.listWindows()
    return windows.find((w) => w.sessionId === sessionId && w.windowIndex === windowIndex) ?? null
  }

  /**
   * Switch to a target (session/window/pane)
   * Works differently depending on whether we're inside or outside tmux
   */
  async switchTo(target: TmuxTarget): Promise<void> {
    const context = this.getContext()

    if (context.insideTmux) {
      await this.switchToInsideTmux(target)
    } else {
      await this.switchToOutsideTmux(target)
    }
  }

  /**
   * Switch when inside tmux - uses switch-client and select-window/pane
   */
  private async switchToInsideTmux(target: TmuxTarget): Promise<void> {
    // If we have a session, switch to it
    if (target.sessionId) {
      await this.run(["switch-client", "-t", target.sessionId])
    }

    // If we have a window, select it
    if (target.windowId) {
      await this.run(["select-window", "-t", target.windowId])
    }

    // If we have a pane, select it
    if (target.paneId) {
      await this.run(["select-pane", "-t", target.paneId])
    }
  }

  /**
   * Switch when outside tmux - uses attach-session
   */
  private async switchToOutsideTmux(target: TmuxTarget): Promise<void> {
    const args = [...this.socketArgs, "attach-session"]

    // Determine what to attach to
    if (target.paneId) {
      args.push("-t", target.paneId)
    } else if (target.windowId) {
      args.push("-t", target.windowId)
    } else if (target.sessionId) {
      args.push("-t", target.sessionId)
    } else {
      throw new TmuxError("No target specified", "attach-session", 1, "")
    }

    // This will replace the current process with tmux attach
    const proc = Bun.spawn(["tmux", ...args], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })

    await proc.exited
  }
}
