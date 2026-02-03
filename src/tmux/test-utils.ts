/**
 * Test utilities for tmux integration tests
 *
 * Provides a TmuxTestServer class that manages an isolated tmux server
 * for testing, preventing interference with user's actual tmux sessions.
 */

import { TmuxAdapter, TmuxNoServerError } from "./adapter.ts"

/**
 * Generates a unique socket name for test isolation
 */
function generateSocketName(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `tmux-tui-test-${timestamp}-${random}`
}

/**
 * TmuxTestServer - manages an isolated tmux server for testing
 *
 * Usage:
 * ```typescript
 * const server = new TmuxTestServer()
 * await server.start()
 * try {
 *   // Run tests using server.adapter
 *   const sessions = await server.adapter.listSessions()
 * } finally {
 *   await server.stop()
 * }
 * ```
 */
export class TmuxTestServer {
  /** Unique socket name for this test server */
  readonly socketName: string

  /** TmuxAdapter configured for this test server */
  readonly adapter: TmuxAdapter

  /** Whether the server has been started */
  private started = false

  constructor(socketName?: string) {
    this.socketName = socketName ?? generateSocketName()
    this.adapter = new TmuxAdapter({ socketName: this.socketName })
  }

  /**
   * Start the test server by creating an initial session
   * tmux servers are created implicitly when the first session is created
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("Test server already started")
    }

    // Create an initial session to start the server
    // -d: don't attach, -s: session name, -x/-y: window size
    await this.runTmux(["new-session", "-d", "-s", "test-init", "-x", "120", "-y", "40"])
    this.started = true
  }

  /**
   * Stop the test server by killing all sessions
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return
    }

    try {
      // Kill the entire server
      await this.runTmux(["kill-server"])
    } catch (e) {
      // Ignore errors if server is already dead
      if (!(e instanceof TmuxNoServerError)) {
        throw e
      }
    }

    this.started = false
  }

  /**
   * Run a raw tmux command on this test server
   */
  async runTmux(args: string[]): Promise<string> {
    return this.adapter.run(args)
  }

  /**
   * Create a new session and return its ID
   */
  async createSession(name: string): Promise<string> {
    // Create session detached
    await this.runTmux(["new-session", "-d", "-s", name, "-x", "120", "-y", "40"])

    // Get the session ID
    const session = await this.adapter.findSessionByName(name)
    if (!session) {
      throw new Error(`Failed to create session: ${name}`)
    }

    return session.sessionId
  }

  /**
   * Create a new window in a session and return its ID
   */
  async createWindow(sessionTarget: string, name: string): Promise<string> {
    // Create window
    await this.runTmux(["new-window", "-t", sessionTarget, "-n", name])

    // Find the window by name (in the most recent session if sessionTarget is a name)
    const windows = await this.adapter.listWindows()
    const window = windows.find((w) => w.windowName === name)

    if (!window) {
      throw new Error(`Failed to create window: ${name}`)
    }

    return window.windowId
  }

  /**
   * Split a pane and return the new pane's ID
   */
  async splitPane(target: string, vertical = false): Promise<string> {
    const flag = vertical ? "-v" : "-h"

    // Get pane count before split
    const panesBefore = await this.adapter.listPanes()

    // Split the pane
    await this.runTmux(["split-window", flag, "-t", target])

    // Get pane count after split
    const panesAfter = await this.adapter.listPanes()

    // Find the new pane (it wasn't in the before list)
    const beforeIds = new Set(panesBefore.map((p) => p.paneId))
    const newPane = panesAfter.find((p) => !beforeIds.has(p.paneId))

    if (!newPane) {
      throw new Error("Failed to find new pane after split")
    }

    return newPane.paneId
  }

  /**
   * Send keys to a pane (without pressing Enter)
   */
  async sendKeys(target: string, keys: string): Promise<void> {
    await this.runTmux(["send-keys", "-t", target, keys])
  }

  /**
   * Send keys to a pane and press Enter
   */
  async sendKeysEnter(target: string, keys: string): Promise<void> {
    await this.runTmux(["send-keys", "-t", target, keys, "Enter"])
  }

  /**
   * Rename a session
   */
  async renameSession(target: string, newName: string): Promise<void> {
    await this.runTmux(["rename-session", "-t", target, newName])
  }

  /**
   * Rename a window
   */
  async renameWindow(target: string, newName: string): Promise<void> {
    await this.runTmux(["rename-window", "-t", target, newName])
  }

  /**
   * Kill a session
   */
  async killSession(target: string): Promise<void> {
    await this.runTmux(["kill-session", "-t", target])
  }

  /**
   * Kill a window
   */
  async killWindow(target: string): Promise<void> {
    await this.runTmux(["kill-window", "-t", target])
  }

  /**
   * Kill a pane
   */
  async killPane(target: string): Promise<void> {
    await this.runTmux(["kill-pane", "-t", target])
  }

  /**
   * Select (activate) a window
   */
  async selectWindow(target: string): Promise<void> {
    await this.runTmux(["select-window", "-t", target])
  }

  /**
   * Select (activate) a pane
   */
  async selectPane(target: string): Promise<void> {
    await this.runTmux(["select-pane", "-t", target])
  }

  /**
   * Get the current working directory of a pane
   */
  async getPaneCwd(target: string): Promise<string> {
    const output = await this.runTmux([
      "display-message",
      "-t",
      target,
      "-p",
      "#{pane_current_path}",
    ])
    return output.trim()
  }

  /**
   * Change directory in a pane
   */
  async changePaneDirectory(target: string, dir: string): Promise<void> {
    await this.sendKeysEnter(target, `cd ${dir}`)
    // Small delay to let the command execute
    await new Promise((r) => setTimeout(r, 100))
  }
}

/**
 * Check if tmux is available on this system
 */
export async function isTmuxAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["tmux", "-V"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

/**
 * Skip test if tmux is not available
 * Use this at the start of integration tests
 */
export async function skipIfNoTmux(): Promise<void> {
  const available = await isTmuxAvailable()
  if (!available) {
    console.log("Skipping test: tmux is not available")
    process.exit(0)
  }
}
