/**
 * The shortcut reference the help panel shows — as DATA, not as markup.
 *
 * It lives in `core/` because it is a claim about the keyboard, and a claim like
 * that drifts: the welcome document advertised `Cmd/Ctrl + E` for a whole release
 * after that binding was gone. Every entry that names a `command` here is checked
 * against `shortcutFor` by the test beside this file, so a key can never be
 * documented as doing something the app does not do — and every `ShellCommand` has
 * to appear somewhere, so a new command cannot ship undocumented.
 *
 * The two kinds of entry that cannot be checked that way say so by leaving
 * `command` out: the kernel's own keys (undo, redos, Tab in a list) and the mouse
 * (the table's right-click menu) are not in `shortcutFor` at all.
 */
import type { ShellCommand } from './shortcuts'

/** Which icon to draw beside an entry — the toolbar's icons, by name. */
export type IconName =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'link'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'quote'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'table'
  | 'save'
  | 'new'
  | 'open'
  | 'folder'

export interface ShortcutEntry {
  /** The key combination, written the way the app writes keys (`⌘⇧K`). */
  keys: string
  /** What it does. */
  name: string
  /** The command it runs — checked against `shortcutFor` when present. */
  command?: ShellCommand
  /** The icon the toolbar shows for it, when it has one. */
  icon?: IconName
}

export interface ShortcutGroup {
  title: string
  items: ShortcutEntry[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '格式',
    items: [
      { keys: '⌘B', name: '加粗', command: 'bold', icon: 'bold' },
      { keys: '⌘I', name: '斜体', command: 'italic', icon: 'italic' },
      { keys: '⌃⇧`', name: '删除线', command: 'strike', icon: 'strike' },
      { keys: '⌃`', name: '行内代码', command: 'inlineCode', icon: 'inlineCode' },
      { keys: '⌃M', name: '行内数学', command: 'inlineMath' },
      { keys: '⌘K', name: '链接', command: 'link', icon: 'link' },
      { keys: '⌘\\', name: '清除行内格式', command: 'clearFormat' },
    ],
  },
  {
    title: '标题',
    items: [
      { keys: '⌘1', name: '一级标题', command: 'heading1', icon: 'heading1' },
      { keys: '⌘2', name: '二级标题', command: 'heading2', icon: 'heading2' },
      { keys: '⌘3', name: '三级标题', command: 'heading3', icon: 'heading3' },
      { keys: '⌘4', name: '四级标题', command: 'heading4' },
      { keys: '⌘5', name: '五级标题', command: 'heading5' },
      { keys: '⌘6', name: '六级标题', command: 'heading6' },
      { keys: '⌘0', name: '还原成普通段落', command: 'paragraph' },
      { keys: '⌘=', name: '标题升一级', command: 'headingIncrease' },
      { keys: '⌘-', name: '标题降一级', command: 'headingDecrease' },
    ],
  },
  {
    title: '列表',
    items: [
      { keys: '⌥⌘U', name: '无序列表', command: 'unorderedList', icon: 'bulletList' },
      { keys: '⌥⌘O', name: '有序列表', command: 'orderedList', icon: 'orderedList' },
      { keys: '⌥⌘X', name: '任务列表', command: 'taskList', icon: 'taskList' },
      { keys: '⌘]', name: '缩进', command: 'indent' },
      { keys: '⌘[', name: '反缩进', command: 'outdent' },
      { keys: 'Tab / ⇧Tab', name: '列表项缩进 / 反缩进（也是表格里走格子）' },
    ],
  },
  {
    title: '块',
    items: [
      { keys: '⌥⌘Q', name: '引用', command: 'quote', icon: 'quote' },
      { keys: '⌥⌘C', name: '代码块', command: 'codeBlock', icon: 'codeBlock' },
      { keys: '⌥⌘T', name: '插入表格', command: 'table', icon: 'table' },
      { keys: '⌥⌘-', name: '水平线', command: 'hr' },
      { keys: '⌥⌘R', name: '脚注', command: 'footnotes' },
      { keys: '⌥⌘L', name: '链接引用', command: 'linkReference' },
    ],
  },
  {
    title: '表格',
    items: [
      { keys: '⌘⏎', name: '在下方插入一行', command: 'tableRowBelow' },
      { keys: '⇧⌘⏎', name: '在上方插入一行', command: 'tableRowAbove' },
      { keys: '⇧⌘⌫', name: '删除当前行', command: 'tableRowDelete' },
      { keys: '格子里右键', name: '增删列、删除整张表' },
    ],
  },
  {
    title: '文件与视图',
    items: [
      { keys: '⌘S', name: '保存', command: 'save', icon: 'save' },
      { keys: '⌘⇧S', name: '另存为', command: 'saveAs' },
      { keys: '⌘O', name: '打开文件', command: 'open', icon: 'open' },
      { keys: '⌘⇧O', name: '打开文件夹', command: 'openFolder', icon: 'folder' },
      { keys: '⌘N', name: '新建', command: 'newDocument', icon: 'new' },
      { keys: '⌘⇧K', name: '删除整行', command: 'deleteLine' },
      { keys: '⌘⇧\\', name: '大纲开关', command: 'toggleOutline' },
      { keys: '⌘Z / ⌘⇧Z', name: '撤销 / 重做' },
      { keys: 'Esc', name: '离开编辑区', command: 'blur' },
    ],
  },
]
