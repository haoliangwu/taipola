import { describe, expect, it } from 'vitest'
import { SHORTCUT_GROUPS } from './shortcutHelp'
import { SHELL_COMMANDS, shortcutFor, type KeyStroke } from './shortcuts'

/**
 * The help panel's list, held against the actual bindings.
 *
 * A shortcut list is a claim, and this one is printed in a panel a reader trusts.
 * The welcome document advertised `Cmd/Ctrl + E` for a whole release after that
 * binding was gone; `README.md` had the same class of drift (its table said
 * Outdent was `⌘[` while the app had it the other way round, and the official
 * Typora table is what settled it). So the panel's entries are DATA, and this file
 * is the reason they stay true: every key it prints is fed back through
 * `shortcutFor`, and every command that exists has to be documented somewhere.
 */

const MODIFIERS: Array<[string, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey']> = [
  ['⌘', 'metaKey'],
  ['⌃', 'ctrlKey'],
  ['⇧', 'shiftKey'],
  ['⌥', 'altKey'],
]

/** The key names the app writes as glyphs, spelled the way a `KeyboardEvent` does. */
const KEY_NAMES: Record<string, string> = {
  '⏎': 'Enter',
  '⌫': 'Backspace',
  Esc: 'Escape',
}

/**
 * `⌘⇧K` → the `KeyStroke` that key press produces.
 *
 * The modifiers are consumed in ANY order, because the panel writes them the way
 * each shortcut is conventionally spelled (`⇧⌘⌫` but `⌥⌘U` and `⌃⇧\``), and the
 * order is not part of the binding.
 */
function strokeOf(keys: string): KeyStroke {
  const stroke: KeyStroke = { key: '' }
  let rest = keys
  for (;;) {
    const found = MODIFIERS.find(([glyph]) => rest.startsWith(glyph))
    if (!found) break
    stroke[found[1]] = true
    rest = rest.slice(found[0].length)
  }
  stroke.key = KEY_NAMES[rest] ?? rest
  return stroke
}

const entries = SHORTCUT_GROUPS.flatMap((group) => group.items)

describe('快捷键面板的数据', () => {
  it('每一行都有键位和说明', () => {
    for (const entry of entries) {
      expect(entry.keys, '键位不能为空').not.toBe('')
      expect(entry.name, `${entry.keys} 少了说明`).not.toBe('')
    }
  })

  it.each(entries.filter((entry) => entry.command !== undefined))(
    '$keys 真的执行 $command',
    (entry) => {
      expect(shortcutFor(strokeOf(entry.keys))).toBe(entry.command)
    },
  )

  it('每一个命令都在面板里出现过（新命令不能没有说明）', () => {
    const documented = new Set(entries.map((entry) => entry.command))
    const missing = SHELL_COMMANDS.filter((command) => !documented.has(command))
    expect(missing).toEqual([])
  })

  it('面板里没有重复的键位行（同一行写两遍就是两份会漂移的说明）', () => {
    const keys = entries.map((entry) => entry.keys)
    expect(keys.length).toBe(new Set(keys).size)
  })

  it('核对不了的那几行是明列的（多一行就得说清为什么）', () => {
    // The kernel's own keys (undo/redo, Tab in a list) and the mouse are not in
    // `shortcutFor` at all, so they cannot be checked by pressing them through it.
    // Listing them here means a new unverifiable row has to be added on purpose.
    const unverifiable = entries.filter((entry) => entry.command === undefined)
    expect(unverifiable.map((entry) => entry.keys)).toEqual([
      'Tab / ⇧Tab',
      '格子里右键',
      '⌘Z / ⌘⇧Z',
    ])
  })
})
