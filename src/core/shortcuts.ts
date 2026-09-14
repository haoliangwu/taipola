/**
 * The shell's keyboard shortcuts, as a pure function.
 *
 * A keystroke in, a command name out — no DOM, no React, so the whole table is
 * testable in the node layer. `shell/App.tsx` keeps the other half: mapping a
 * command name to the function that performs it. Splitting it that way is what
 * makes "which key runs what" assertable at all; it used to be a switch inside a
 * `keydown` listener, reachable only through a real browser and never covered.
 *
 * This is the shell's half of the keyboard, not all of it. `Tab` / `Shift+Tab`
 * (list indent) and `Cmd/Ctrl+Z` (undo, redo) belong to the editor kernel, which
 * handles them on its own host — they are editing commands, not app commands.
 * What is here is what `README.md` lists under 快捷键, including the
 * combinations that deliberately do nothing.
 */

export type ShellCommand =
  | 'blur'
  | 'bold'
  | 'italic'
  | 'inlineCode'
  | 'link'
  | 'deleteLine'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'save'
  | 'saveAs'
  | 'open'
  | 'openFolder'
  | 'newDocument'
  | 'toggleOutline'

/** The parts of a `KeyboardEvent` the table reads. */
export interface KeyStroke {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

/**
 * The command a keystroke means, or null when the shell leaves it alone.
 *
 * A null result matters as much as a command: the caller must NOT call
 * `preventDefault()` for it, so the browser keeps its own binding (`Cmd+P` for
 * print, for instance). Only `Escape` works without a modifier, and it
 * deliberately does not work with one.
 */
export function shortcutFor(stroke: KeyStroke): ShellCommand | null {
  const mod = stroke.metaKey === true || stroke.ctrlKey === true
  const key = stroke.key.toLowerCase()

  if (!mod) return key === 'escape' ? 'blur' : null

  // Shift is checked first and returns early: `Cmd+Shift+B` is not "bold with
  // shift", it is nothing. Only these four bindings use shift.
  if (stroke.shiftKey === true) {
    if (key === 'k') return 'deleteLine'
    if (key === 's') return 'saveAs'
    if (key === 'o') return 'openFolder'
    // Shift+Backslash reports '|' in every browser I know of; '\\' is kept for
    // layouts where it does not. 只认 '\\' 是一个从来没生效过的绑定。
    if (key === '\\' || key === '|') return 'toggleOutline'
    return null
  }

  switch (key) {
    case 'b':
      return 'bold'
    case 'i':
      return 'italic'
    case 'e':
      return 'inlineCode'
    case 'k':
      return 'link'
    case 's':
      return 'save'
    case 'o':
      return 'open'
    case 'n':
      return 'newDocument'
    case '1':
      return 'heading1'
    case '2':
      return 'heading2'
    case '3':
      return 'heading3'
    case '4':
      return 'heading4'
    case '5':
      return 'heading5'
    case '6':
      return 'heading6'
    default:
      return null
  }
}
