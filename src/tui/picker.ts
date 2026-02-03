/**
 * TUI Picker - Interactive bookmark selector with box drawing
 */

import type { Bookmark } from "../types/index.ts"

// ANSI escape codes
const ESC = "\x1b"
const CSI = `${ESC}[`

const ansi = {
  // Cursor
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
  moveToCol: (col: number) => `${CSI}${col}G`,
  clearScreen: `${CSI}2J`,
  clearLine: `${CSI}2K`,

  // Colors
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,

  // Foreground colors
  fg: {
    black: `${CSI}30m`,
    red: `${CSI}31m`,
    green: `${CSI}32m`,
    yellow: `${CSI}33m`,
    blue: `${CSI}34m`,
    magenta: `${CSI}35m`,
    cyan: `${CSI}36m`,
    white: `${CSI}37m`,
    gray: `${CSI}90m`,
  },

  // Background colors
  bg: {
    black: `${CSI}40m`,
    red: `${CSI}41m`,
    green: `${CSI}42m`,
    yellow: `${CSI}43m`,
    blue: `${CSI}44m`,
    magenta: `${CSI}45m`,
    cyan: `${CSI}46m`,
    white: `${CSI}47m`,
    gray: `${CSI}100m`,
  },

  // 256 color
  fg256: (n: number) => `${CSI}38;5;${n}m`,
  bg256: (n: number) => `${CSI}48;5;${n}m`,
}

// Box drawing characters (Unicode)
const box = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  teeLeft: "├",
  teeRight: "┤",
}

interface PickerItem {
  bookmark: Bookmark
  resolved: boolean
  display: string
}

interface PickerOptions {
  title?: string
  width?: number
  contextLine?: string
  lastAvailable?: boolean
  onSelect?: (bookmark: Bookmark, index: number) => Promise<void>
}

type PickerResult =
  | { action: "select"; bookmark: Bookmark; index: number }
  | { action: "last" }
  | null

/**
 * Get terminal size
 */
function getTerminalSize(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  }
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + "…"
}

/**
 * Pad string to exact length
 */
function pad(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len)
  return str + " ".repeat(len - str.length)
}

/**
 * Format a bookmark for display in the picker
 */
function formatItem(item: PickerItem, index: number, selected: boolean, width: number): string {
  const { bookmark, resolved } = item
  const statusIcon = resolved ? "✓" : "✗"
  const statusColor = resolved ? ansi.fg.green : ansi.fg.red
  const kindBadge = bookmark.kind.charAt(0).toUpperCase()
  const slot = `${index + 1}`

  // Calculate available width for label (subtract borders, padding, status, slot, kind badge)
  // "│ ✓ 1. [W] label │" = 2 (borders) + 2 (padding) + 2 (status+space) + 3 (slot+dot+space) + 4 ([X] ) = 13
  const fixedWidth = 13
  const labelWidth = Math.max(10, width - fixedWidth)

  const label = truncate(bookmark.label, labelWidth)

  if (selected) {
    // Highlighted row - keep borders outside the highlight
    const content = ` ${statusIcon} ${slot}. [${kindBadge}] ${pad(label, labelWidth)} `
    return `${box.vertical}${ansi.bg256(236)}${ansi.fg.cyan}${ansi.bold}${content}${ansi.reset}${box.vertical}`
  } else {
    // Normal row
    return `${box.vertical} ${statusColor}${statusIcon}${ansi.reset} ${ansi.dim}${slot}.${ansi.reset} [${ansi.fg.yellow}${kindBadge}${ansi.reset}] ${pad(label, labelWidth)} ${box.vertical}`
  }
}

/**
 * Draw the picker UI
 */
function draw(
  items: PickerItem[],
  selectedIndex: number,
  title: string,
  width: number,
  contextLine?: string,
  lastAvailable?: boolean,
): void {
  const { rows } = getTerminalSize()
  const contentWidth = width - 2 // Subtract border

  // Build output buffer
  let output = ""

  // Hide cursor and move to top
  output += ansi.hideCursor
  output += ansi.moveTo(1, 1)
  output += ansi.clearScreen

  // Top margin (1 space padding from popup border)
  output += "\n"

  // Left margin prefix (1 space padding from popup border)
  const margin = " "

  // Title bar
  const titleText = ` ${title} `
  const titlePadding = Math.max(0, contentWidth - titleText.length)
  const leftPad = Math.floor(titlePadding / 2)
  const rightPad = titlePadding - leftPad

  output += `${margin}${ansi.fg.cyan}${box.topLeft}${box.horizontal.repeat(leftPad)}${ansi.bold}${titleText}${ansi.reset}${ansi.fg.cyan}${box.horizontal.repeat(rightPad)}${box.topRight}${ansi.reset}\n`

  if (contextLine) {
    const contextText = pad(` ${truncate(contextLine, contentWidth - 1)}`, contentWidth)
    output += `${margin}${box.vertical}${ansi.dim}${contextText}${ansi.reset}${box.vertical}\n`
  }

  // Items
  if (items.length === 0) {
    const emptyMsg = "No bookmarks yet"
    const msgPad = Math.floor((contentWidth - emptyMsg.length) / 2)
    output += `${margin}${box.vertical}${" ".repeat(msgPad)}${ansi.dim}${emptyMsg}${ansi.reset}${" ".repeat(contentWidth - msgPad - emptyMsg.length)}${box.vertical}\n`
  } else {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      const isSelected = i === selectedIndex
      output += margin + formatItem(item, i, isSelected, width) + "\n"
    }
  }

  // Separator
  output += `${margin}${ansi.fg.cyan}${box.teeLeft}${box.horizontal.repeat(contentWidth)}${box.teeRight}${ansi.reset}\n`

  // Help line
  const helpText = lastAvailable
    ? " Tab/Shift-Tab:last  j/k  1-9/Enter  q:quit "
    : " j/k  1-9/Enter  q:quit "
  const helpPad = Math.max(0, contentWidth - helpText.length)
  output += `${margin}${box.vertical}${ansi.dim}${helpText}${ansi.reset}${" ".repeat(helpPad)}${box.vertical}\n`

  // Bottom border
  output += `${margin}${ansi.fg.cyan}${box.bottomLeft}${box.horizontal.repeat(contentWidth)}${box.bottomRight}${ansi.reset}\n`

  // Write to stdout
  process.stdout.write(output)
}

/**
 * Read a single keypress
 */
async function readKey(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")

    const onData = (key: string) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener("data", onData)
      resolve(key)
    }

    stdin.once("data", onData)
  })
}

/**
 * Run the interactive picker
 * Returns the selected bookmark or null if cancelled
 */
export async function runPicker(
  bookmarks: Bookmark[],
  resolvedStatus: boolean[],
  options: PickerOptions = {},
): Promise<PickerResult> {
  const {
    title = "Bookmarks",
    width = Math.min(60, getTerminalSize().cols - 4),
    contextLine,
    lastAvailable = false,
    onSelect,
  } = options

  // Prepare items
  const items: PickerItem[] = bookmarks.map((bookmark, i) => ({
    bookmark,
    resolved: resolvedStatus[i] ?? false,
    display: bookmark.label,
  }))

  let selectedIndex = 0
  let running = true
  let result: PickerResult = null

  // Initial draw
  draw(items, selectedIndex, title, width, contextLine, lastAvailable)

  while (running) {
    const key = await readKey()

    switch (key) {
      case "j":
      case "\x1b[B": // Down arrow
        if (items.length > 0) {
          selectedIndex = (selectedIndex + 1) % items.length
        }
        break

      case "k":
      case "\x1b[A": // Up arrow
        if (items.length > 0) {
          selectedIndex = (selectedIndex - 1 + items.length) % items.length
        }
        break

      case "g": // Go to top
        selectedIndex = 0
        break

      case "G": // Go to bottom
        selectedIndex = Math.max(0, items.length - 1)
        break

      case "\r": // Enter
      case "\n":
        if (items.length > 0) {
          const item = items[selectedIndex]!
          result = { action: "select", bookmark: item.bookmark, index: selectedIndex }
          running = false
        }
        break

      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        const num = parseInt(key, 10) - 1
        if (num < items.length) {
          const item = items[num]!
          result = { action: "select", bookmark: item.bookmark, index: num }
          running = false
        }
        break

      case "\t": // Tab
      case "\x1b[Z": // Shift-Tab
      case "\x09": // Ctrl+I
        if (lastAvailable) {
          result = { action: "last" }
          running = false
        }
        break

      case "q":
      case "\x1b": // Escape
      case "\x03": // Ctrl+C
        running = false
        break

      case "d": // Delete
        // TODO: Implement delete
        break
    }

    if (running) {
      draw(items, selectedIndex, title, width, contextLine, lastAvailable)
    }
  }

  // Cleanup
  process.stdout.write(ansi.clearScreen)
  process.stdout.write(ansi.moveTo(1, 1))
  process.stdout.write(ansi.showCursor)

  return result
}
