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
 *
 * The bindings follow Typora's macOS table (`.scratch/typora-menus/spec.md`):
 * the ⌃ family (⌃` ⌃⇧` ⌃M) is strictly Ctrl-only, the ⌥⌘ family takes
 * Meta-Alt (Ctrl-Alt is accepted too, inheriting the meta||ctrl convention),
 * and `Cmd+` arrives as `=` or `+` depending on the layout, with shift or
 * without — the section whose key it is must not depend on the keyboard.
 */

/**
 * Every command the shell can be asked to run — as a VALUE, not only as a type.
 *
 * The help panel has to document all of them (`shortcutHelp.ts`), and a test holds
 * that list to this one in both directions: every command appears in the panel, and
 * every key the panel prints really runs the command it is printed beside. A union
 * type alone cannot be iterated, so the list is data and the type is derived.
 */
export const SHELL_COMMANDS = [
  'blur',
  'bold',
  'italic',
  'strike',
  'inlineCode',
  'inlineMath',
  'link',
  'deleteLine',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'paragraph',
  'headingIncrease',
  'headingDecrease',
  'clearFormat',
  'quote',
  'orderedList',
  'unorderedList',
  'taskList',
  'indent',
  'outdent',
  'codeBlock',
  'footnotes',
  'linkReference',
  'hr',
  'table',
  'tableRowAbove',
  'tableRowBelow',
  'tableRowDelete',
  'save',
  'saveAs',
  'open',
  'openFolder',
  'newDocument',
  'toggleOutline',
] as const

export type ShellCommand = (typeof SHELL_COMMANDS)[number]

/** The parts of a `KeyboardEvent` the table reads. */
export interface KeyStroke {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
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
  const meta = stroke.metaKey === true
  const ctrl = stroke.ctrlKey === true
  const alt = stroke.altKey === true
  const mod = meta || ctrl
  const key = stroke.key.toLowerCase()

  if (!mod) return key === 'escape' ? 'blur' : null

  // ⌃ family (Typora's Control keys): Ctrl without Meta. `Cmd+` must not fire
  // these, so the branch is strict — that is what makes ⌃M not ⌘M. Non-⌃ keys
  // fall through, so Ctrl+Shift+= still reaches the increase binding below.
  if (ctrl && !meta) {
    if (key === '`') return stroke.shiftKey === true ? 'strike' : 'inlineCode'
    if (key === '~' && stroke.shiftKey === true) return 'strike'
    if (!stroke.shiftKey && key === 'm') return 'inlineMath'
  }

  // Shift is checked first and returns early: `Cmd+Shift+B` is not "bold with
  // shift", it is nothing. Only these bindings use shift.
  if (stroke.shiftKey === true) {
    // `Cmd+` is `Cmd+Shift+=` on US layouts; increase must not be lost to the
    // shift early-return. `+` is kept for layouts where Shift+= reports it.
    if (key === '=' || key === '+') return 'headingIncrease'
    // The shifted half of Typora's table row keys: ⇧⌘⏎ inserts above, ⇧⌘⌫ deletes
    // the row. The delete used to fall through to the browser, which deleted the
    // caret's line back to its start — it ate the CELL'S TEXT instead of the row
    // (`.scratch/table-ops/issues/03`).
    if (key === 'enter') return 'tableRowAbove'
    if (key === 'backspace') return 'tableRowDelete'
    if (key === 'k') return 'deleteLine'
    if (key === 's') return 'saveAs'
    if (key === 'o') return 'openFolder'
    // Shift+Backslash reports '|' in every browser I know of; '\\' is kept for
    // layouts where it does not. 只认 '\\' 是一个从来没生效过的绑定。
    if (key === '\\' || key === '|') return 'toggleOutline'
    return null
  }

  // ⌥⌘ family (Typora's paragraph keys): Meta-Alt, or Ctrl-Alt on the same
  // convention as every other mod binding.
  if (alt) {
    switch (key) {
      case 'q':
        return 'quote'
      case 'o':
        return 'orderedList'
      case 'u':
        return 'unorderedList'
      case 'x':
        return 'taskList'
      case 'c':
        return 'codeBlock'
      case 'r':
        return 'footnotes'
      case 'l':
        return 'linkReference'
      case 't':
        return 'table'
      case '-':
        return 'hr'
      default:
        return null
    }
  }

  switch (key) {
    // The unshifted half: ⌘⏎ inserts a row below (Typora's "Insert Row Below").
    case 'enter':
      return 'tableRowBelow'
    case 'b':
      return 'bold'
    case 'i':
      return 'italic'
    // ⌘E was the old inline-code key; Typora parity moved it to ⌃` above, and
    // 'e' deliberately binds nothing so the old muscle memory dies cleanly.
    case 'k':
      return 'link'
    case 's':
      return 'save'
    case 'o':
      return 'open'
    case 'n':
      return 'newDocument'
    case '0':
      return 'paragraph'
    // `Cmd+` is `=` unshifted or `+` shifted, per layout; both bind.
    case '=':
    case '+':
      return 'headingIncrease'
    case '-':
      return 'headingDecrease'
    case '\\':
      return 'clearFormat'
    case ']':
      return 'indent'
    case '[':
      return 'outdent'
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
