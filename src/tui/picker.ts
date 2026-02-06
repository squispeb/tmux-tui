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
  onDelete?: (bookmark: Bookmark, index: number) => Promise<boolean>
  windowItems?: WindowItem[]
}

type PickerResult =
  | { action: "select"; bookmark: Bookmark; index: number }
  | { action: "last" }
  | { action: "window"; target: { sessionId?: string; windowId?: string; paneId?: string } }
  | null

interface WindowItem {
  label: string
  target: { sessionId?: string; windowId?: string; paneId?: string }
}

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
  return `${str.slice(0, maxLen - 1)}…`
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
  }

  // Normal row
  return `${box.vertical} ${statusColor}${statusIcon}${ansi.reset} ${ansi.dim}${slot}.${ansi.reset} [${ansi.fg.yellow}${kindBadge}${ansi.reset}] ${pad(label, labelWidth)} ${box.vertical}`
}

function formatWindowItem(
  item: WindowItem,
  index: number,
  selected: boolean,
  width: number,
): string {
  const statusIcon = "•"
  const statusColor = ansi.fg.cyan
  const kindBadge = "W"
  const slot = `${index + 1}`

  const fixedWidth = 13
  const labelWidth = Math.max(10, width - fixedWidth)
  const label = truncate(item.label, labelWidth)

  if (selected) {
    const content = ` ${statusIcon} ${slot}. [${kindBadge}] ${pad(label, labelWidth)} `
    return `${box.vertical}${ansi.bg256(236)}${ansi.fg.cyan}${ansi.bold}${content}${ansi.reset}${box.vertical}`
  }

  return `${box.vertical} ${statusColor}${statusIcon}${ansi.reset} ${ansi.dim}${slot}.${ansi.reset} [${ansi.fg.yellow}${kindBadge}${ansi.reset}] ${pad(label, labelWidth)} ${box.vertical}`
}

/**
 * Draw the picker UI
 */
function draw(
  items: PickerItem[],
  selectedIndex: number,
  title: string,
  requestedWidth: number,
  contextLine?: string,
  lastAvailable?: boolean,
  deleteAvailable?: boolean,
  windowItems?: WindowItem[],
  windowMode?: boolean,
  filterText?: string,
): void {
  const { rows, cols } = getTerminalSize()
  const margin = cols >= 6 ? 1 : 0
  const boxWidth = Math.max(4, Math.min(requestedWidth, cols - margin * 2))
  const contentWidth = boxWidth - 2 // Subtract border
  const activeItems = windowMode && windowItems ? windowItems : items
  const infoLine = windowMode ? `Search: ${filterText ?? ""}` : contextLine
  const hasInfoLine = Boolean(infoLine && infoLine.length > 0)
  const fixedLines = 1 + (hasInfoLine ? 1 : 0) + 1 + 1 + 1
  const boxHeight = fixedLines
  const topPad = rows >= boxHeight + margin * 2 ? margin : 0
  const bottomPad = rows >= boxHeight + margin * 2 ? margin : 0
  const padLeft = " ".repeat(margin)
  const padRight = " ".repeat(margin)
  const availableLines = Math.max(1, rows - (topPad + bottomPad) - fixedLines)
  const totalItems = activeItems.length
  const visibleCount = Math.min(Math.max(1, totalItems), availableLines)
  const startIndex =
    totalItems > visibleCount
      ? Math.min(
          Math.max(0, selectedIndex - Math.floor(visibleCount / 2)),
          totalItems - visibleCount,
        )
      : 0

  // Build output buffer
  let output = ""

  // Hide cursor and move to top
  output += ansi.hideCursor
  output += ansi.moveTo(1, 1)
  output += ansi.clearScreen

  if (topPad > 0) {
    output += "\n".repeat(topPad)
  }

  // Title bar
  const titleCore = truncate(title, Math.max(0, contentWidth - 2))
  const titleText = titleCore.length > 0 ? ` ${titleCore} ` : ""
  const titlePadding = Math.max(0, contentWidth - titleText.length)
  const titleLeftPad = Math.floor(titlePadding / 2)
  const titleRightPad = titlePadding - titleLeftPad

  output += `${padLeft}${ansi.fg.cyan}${box.topLeft}${box.horizontal.repeat(titleLeftPad)}${ansi.bold}${titleText}${ansi.reset}${ansi.fg.cyan}${box.horizontal.repeat(titleRightPad)}${box.topRight}${ansi.reset}${padRight}\n`

  if (hasInfoLine && infoLine) {
    const contextText = pad(` ${truncate(infoLine, Math.max(0, contentWidth - 1))}`, contentWidth)
    output += `${padLeft}${box.vertical}${ansi.dim}${contextText}${ansi.reset}${box.vertical}${padRight}\n`
  }

  // Items
  if (totalItems === 0) {
    const emptyMsg = windowMode ? "No windows found" : "No bookmarks yet"
    const msgPad = Math.floor((contentWidth - emptyMsg.length) / 2)
    output += `${padLeft}${box.vertical}${" ".repeat(msgPad)}${ansi.dim}${emptyMsg}${ansi.reset}${" ".repeat(contentWidth - msgPad - emptyMsg.length)}${box.vertical}${padRight}\n`
  } else {
    for (let i = 0; i < visibleCount; i++) {
      const realIndex = startIndex + i
      const isSelected = realIndex === selectedIndex
      if (windowMode && windowItems) {
        const item = windowItems[realIndex]!
        output += `${padLeft}${formatWindowItem(item, realIndex, isSelected, boxWidth)}${padRight}\n`
      } else {
        const item = items[realIndex]!
        output += `${padLeft}${formatItem(item, realIndex, isSelected, boxWidth)}${padRight}\n`
      }
    }
  }

  // Separator
  output += `${padLeft}${ansi.fg.cyan}${box.teeLeft}${box.horizontal.repeat(contentWidth)}${box.teeRight}${ansi.reset}${padRight}\n`

  // Help line
  const helpParts: string[] = []
  if (windowMode) {
    helpParts.push("up/down")
    helpParts.push("Enter")
    helpParts.push("Bksp")
    helpParts.push("Esc/q:back")
  } else {
    if (lastAvailable) helpParts.push("Tab:last")
    helpParts.push("j/k")
    helpParts.push("1-9/Enter")
    if (deleteAvailable) helpParts.push("d:del")
    if (windowItems && windowItems.length > 0) helpParts.push("/:win")
    helpParts.push("q")
  }
  const helpRaw = ` ${helpParts.join("  ")} `
  const helpText = pad(truncate(helpRaw, contentWidth), contentWidth)
  output += `${padLeft}${box.vertical}${ansi.dim}${helpText}${ansi.reset}${box.vertical}${padRight}\n`

  // Bottom border
  output += `${padLeft}${ansi.fg.cyan}${box.bottomLeft}${box.horizontal.repeat(contentWidth)}${box.bottomRight}${ansi.reset}${padRight}\n`

  if (bottomPad > 0) {
    output += "\n".repeat(bottomPad)
  }

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
    onDelete,
    windowItems: initialWindowItems,
  } = options
  const deleteAvailable = Boolean(onDelete)
  const hasWindows = Boolean(initialWindowItems && initialWindowItems.length > 0)

  // Prepare items
  const items: PickerItem[] = bookmarks.map((bookmark, i) => ({
    bookmark,
    resolved: resolvedStatus[i] ?? false,
    display: bookmark.label,
  }))

  let selectedIndex = 0
  let running = true
  let result: PickerResult = null
  let windowMode = false
  let filterText = ""
  const baseWindowItems = initialWindowItems ? [...initialWindowItems] : undefined
  let windowItems = baseWindowItems
  const applyWindowFilter = (nextFilter: string) => {
    filterText = nextFilter
    const filtered =
      baseWindowItems?.filter((item) =>
        item.label.toLowerCase().includes(filterText.toLowerCase()),
      ) ?? []
    windowItems = filtered
    selectedIndex = 0
  }

  // Initial draw
  draw(
    items,
    selectedIndex,
    title,
    width,
    contextLine,
    lastAvailable,
    deleteAvailable,
    windowItems,
    windowMode,
    filterText,
  )

  while (running) {
    const key = await readKey()

    switch (key) {
      case "/":
        if (hasWindows) {
          windowMode = true
          selectedIndex = 0
          applyWindowFilter("")
        }
        break

      case "j":
      case "\x1b[B": // Down arrow
        if (!windowMode && items.length > 0) {
          selectedIndex = (selectedIndex + 1) % items.length
        }
        if (windowMode && key === "\x1b[B" && windowItems && windowItems.length > 0) {
          selectedIndex = (selectedIndex + 1) % windowItems.length
        }
        break

      case "k":
      case "\x1b[A": // Up arrow
        if (!windowMode && items.length > 0) {
          selectedIndex = (selectedIndex - 1 + items.length) % items.length
        }
        if (windowMode && key === "\x1b[A" && windowItems && windowItems.length > 0) {
          selectedIndex = (selectedIndex - 1 + windowItems.length) % windowItems.length
        }
        break

      case "g": // Go to top
        if (!windowMode) {
          selectedIndex = 0
        }
        break

      case "G": // Go to bottom
        if (!windowMode) {
          selectedIndex = Math.max(0, items.length - 1)
        }
        break

      case "\r": // Enter
      case "\n":
        if (windowMode && windowItems && windowItems.length > 0) {
          const item = windowItems[selectedIndex]!
          result = { action: "window", target: item.target }
          running = false
        } else if (items.length > 0) {
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
      case "9": {
        if (windowMode) break
        const num = Number.parseInt(key, 10) - 1
        if (num < items.length) {
          const item = items[num]!
          result = { action: "select", bookmark: item.bookmark, index: num }
          running = false
        }
        break
      }

      case "\t": // Tab
      case "\x1b[Z": // Shift-Tab
      case "\x09": // Ctrl+I
        if (lastAvailable) {
          result = { action: "last" }
          running = false
        }
        break

      case "d":
        if (!windowMode && items.length > 0 && onDelete) {
          const item = items[selectedIndex]!
          const deleted = await onDelete(item.bookmark, selectedIndex)
          if (deleted) {
            items.splice(selectedIndex, 1)
            if (selectedIndex >= items.length) {
              selectedIndex = Math.max(0, items.length - 1)
            }
          }
        }
        break

      case "\x7f": // Backspace
      case "\b":
        if (windowMode && filterText.length > 0) {
          applyWindowFilter(filterText.slice(0, -1))
        }
        break

      case "q":
        if (windowMode) {
          windowMode = false
          filterText = ""
          windowItems = baseWindowItems
          selectedIndex = 0
          break
        }
        running = false
        break

      case "\x1b": // Escape
      case "\x03": // Ctrl+C
        if (windowMode) {
          windowMode = false
          filterText = ""
          windowItems = baseWindowItems
          selectedIndex = 0
          break
        }
        running = false
        break
    }

    if (
      windowMode &&
      key.length === 1 &&
      key >= " " &&
      key <= "~" &&
      !["/", "q", "\t", "\r", "\n"].includes(key)
    ) {
      applyWindowFilter(filterText + key)
    }

    if (running) {
      draw(
        items,
        selectedIndex,
        title,
        width,
        contextLine,
        lastAvailable,
        deleteAvailable,
        windowItems,
        windowMode,
        filterText,
      )
    }
  }

  // Cleanup
  process.stdout.write(ansi.clearScreen)
  process.stdout.write(ansi.moveTo(1, 1))
  process.stdout.write(ansi.showCursor)

  return result
}
