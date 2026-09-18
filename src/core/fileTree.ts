/**
 * What a folder shows: which entries are worth a row, and in what order.
 *
 * Pure on purpose — no browser API, no React — so the two rules that are actually
 * decisions can be pinned in the node layer:
 *
 * - the tree shows **documents and folders only**. A folder of Markdown sits next
 *   to images, scripts and build output, and a tree that lists all of it is a tree
 *   nobody reads. `.md` / `.markdown` only, case-insensitively, because a file
 *   copied from elsewhere may be `.MD`;
 * - the order is **folders first, then names, case-insensitively**. Deterministic
 *   rather than whatever order the filesystem handed over, so the same folder
 *   looks the same on every visit.
 */

/** A row of the tree: what it is called, where it sits, and which it is. */
export interface TreeEntry {
  readonly name: string
  /** Path relative to the folder root, `/`-separated. */
  readonly path: string
  readonly kind: 'file' | 'directory'
}

/**
 * Where a document sits: the folder it was opened from, and its path inside it.
 *
 * One named thing rather than a `root` and a `path` passed around loose, because
 * they are only ever meaningful together — and because they are half of a draft
 * slot's identity (`draftSlotKey`), so anything that carries one carries both.
 */
export interface FolderPlacement {
  readonly root: string
  readonly path: string
}

/**
 * The extensions the tree shows.
 *
 * Narrower than what the picker accepts on purpose: `打开` also takes `.txt` and
 * `.mdown` (`MD_TYPES` in `platform/documents.ts`), because someone opening a
 * notes file by hand means it. A TREE, on the other hand, lists what the folder
 * is for, and a directory of `.txt` next to its Markdown is a directory of
 * things this editor is not for.
 */
const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const

/**
 * Directory names that are never worth a row. `node_modules` is the one that
 * actually shows up next to Markdown in practice (a README beside a project).
 */
const HIDDEN_DIRECTORIES = new Set(['node_modules'])

/**
 * Whether a name is one the tree keeps to itself.
 *
 * Everything starting with a dot is out — `.git`, `.obsidian`, editor state — and
 * so is `node_modules`. This is a display rule, not a permission: nothing here
 * stops the rest of the application from reading such a file if it is opened
 * directly.
 */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.') || HIDDEN_DIRECTORIES.has(name)
}

export function isMarkdownName(name: string): boolean {
  const lower = name.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** `章节` + `一.md` → `章节/一.md`; a name at the root stays a name. */
export function childPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

/** `章节/一.md` → `章节`, `一.md` → `''`. The inverse of `childPath`. */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** `章节/一.md` → `一.md`. The tail of a path. */
export function lastSegment(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? path : path.slice(slash + 1)
}

/* -------------------------------------------------------------------------- */
/*  naming a new or renamed document                                           */
/* -------------------------------------------------------------------------- */

/** `笔记` → `笔记.md`; `笔记.md` and `笔记.MARKDOWN` already end in the kept set. */
export function ensureMarkdownExtension(name: string): string {
  return isMarkdownName(name) ? name : `${name}.md`
}

/**
 * A free name next to `base`: `untitled.md` when it is free, otherwise
 * `untitled 2.md`, `untitled 3.md`… A directory of five `untitled`s is far more
 * likely than a user who wants to count them by hand.
 */
export function firstFreeName(taken: ReadonlySet<string>, base: string): string {
  if (!taken.has(base)) return base
  const stem = base.slice(0, base.lastIndexOf('.'))
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${base.slice(base.lastIndexOf('.'))}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Why a name may not become a row, or null when it may.
 *
 * The rules an editor adds on top of the filesystem's: a name that would vanish
 * from the tree (hidden, `node_modules`), a name that breaks the path shape
 * (`/`, `\`), and a name already taken by a sibling row. `exclude` names the
 * entry being renamed, so its own name is not a collision.
 */
export function editNameError(
  name: string,
  taken: ReadonlySet<string>,
  exclude: string | null,
): string | null {
  if (name.trim() === '') return '名字不能为空'
  if (name.includes('/') || name.includes('\\')) return '名字不能包含 / 或 \\'
  if (name === '.' || name === '..') return '这个名字不能用'
  if (isHiddenName(name)) return '这个名字开头的文件不会显示在树里'
  if (taken.has(name) && name !== exclude) return '这个名字已经存在'
  return null
}

/**
 * The rows of one directory, in the order they should be shown.
 *
 * Generic in the entry type so that whatever the platform layer attached to a row
 * (a file handle, in practice) survives the filtering — this module has no
 * business knowing about it.
 */
export function visibleEntries<T extends TreeEntry>(entries: readonly T[]): T[] {
  return entries
    .filter((entry) => !isHiddenName(entry.name))
    .filter((entry) => entry.kind === 'directory' || isMarkdownName(entry.name))
    .sort(compareEntries)
}

function compareEntries(a: TreeEntry, b: TreeEntry): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  const left = a.name.toLowerCase()
  const right = b.name.toLowerCase()
  if (left !== right) return left < right ? -1 : 1
  // Equal ignoring case: fall back to the exact names, so that the order is a
  // property of the entries rather than of the order they arrived in.
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}
