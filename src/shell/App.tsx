import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { TableMenu, type TableMenuCommand, type TableMenuState } from './components/TableMenu'
import { TreeMenu, type TreeMenuCommand, type TreeMenuState } from './components/TreeMenu'
import { HelpPanel } from './components/HelpPanel'
import { Sidebar } from './components/Sidebar'
import type { TreeEditing } from './components/FileTree'
import {
  BoldIcon,
  BulletListIcon,
  CodeBlockIcon,
  ExportIcon,
  FolderIcon,
  HeadingIcon,
  HelpIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  NewIcon,
  OpenIcon,
  OrderedListIcon,
  QuoteIcon,
  SaveIcon,
  StrikeIcon,
  SunIcon,
  MoonIcon,
  SystemIcon,
  TableIcon,
  TaskListIcon,
} from './components/icons'
import { computeStats, extractHeadings } from '../core/markdown'
import {
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  tableAt,
  type TableEdit,
} from '../core/tables'
import { WELCOME_DOC, WELCOME_NAME } from '../core/welcome'
import { createAutosave, draftSlotKey } from '../core/autosave'
import { createWriteBack, type WriteBack, type WriteBackStopReason } from '../core/writeBack'
import { shortcutFor, type ShellCommand } from '../core/shortcuts'
import { documents, type OpenDocument } from '../platform/documents'
import { folders, type FolderEntry } from '../platform/folder'
import type { FolderPlacement } from '../core/fileTree'
import { childPath, parentOf } from '../core/fileTree'
import { THEME_LABEL, useTheme } from './useTheme'
import { useFileTree } from './useFileTree'
import { useSidebarPanel } from './useSidebarPanel'
import {
  TABLE_SNIPPET,
  changeHeadingLevel,
  clearFormat,
  deleteLine,
  indentSelection,
  insertFootnote,
  insertHr,
  insertLink,
  insertLinkReference,
  insertSnippet,
  toggleBlockPrefix,
  toggleHeading,
  toggleInline,
  toggleInlineCode,
  toggleInlineMath,
} from '../core/editCommands'

const OUTLINE_DEBOUNCE_MS = 200

/**
 * Every table command as one source edit, in one place.
 *
 * The keyboard bindings and the context menu both name a command here rather than
 * calling `core/tables.ts` themselves, so "insert a row below" cannot come to mean
 * two different things depending on which entry the user found.
 */
const TABLE_MUTATIONS: Record<
  TableMenuCommand,
  (doc: string, offset: number) => TableEdit | null
> = {
  rowAbove: (doc, offset) => insertTableRow(doc, offset, 'above'),
  rowBelow: (doc, offset) => insertTableRow(doc, offset, 'below'),
  // The header row and the rule row are the table's structure, not rows of it, so
  // "delete the current row" has nothing to take there — the gesture that has
  // been erasing rows one by one erases the WHOLE table instead, which is the
  // only way ⇧⌘⌫ can keep going until nothing is left (a table whose header is
  // gone is not a table). The context menu keeps its 删除本行 disabled on those
  // rows and points at 删除表格 instead (`.scratch/table-ops/issues/05`).
  rowDelete: (doc, offset) => {
    const table = tableAt(doc, offset)
    if (!table) return null
    return table.line === table.headerLine || table.line === table.delimiterLine
      ? deleteTable(doc, offset)
      : deleteTableRow(doc, offset)
  },
  columnLeft: (doc, offset) => insertTableColumn(doc, offset, 'left'),
  columnRight: (doc, offset) => insertTableColumn(doc, offset, 'right'),
  columnDelete: (doc, offset) => deleteTableColumn(doc, offset),
  delete: (doc, offset) => deleteTable(doc, offset),
}

/**
 * The narrow-screen breakpoint, mirrored in `styles.css`.
 *
 * Media queries cannot read a custom property, so the number lives in both
 * files. It is needed here because two of the drawer's behaviours are not
 * expressible in CSS: jumping to a heading closes it, and Escape closes it —
 * the second one only on a narrow screen, since on desktop Escape is `blur`.
 */
const NARROW_QUERY = '(max-width: 900px)'

function isNarrowScreen(): boolean {
  return window.matchMedia(NARROW_QUERY).matches
}

/**
 * The two export formats, written down once.
 *
 * Both the desktop group and the narrow screen's mini group offer export as a
 * menu (the narrow one always did; the desktop one used to be two direct text
 * buttons, and became a menu when the header went icon-only). They are separate
 * menus in the DOM, but they must offer the same two formats under the same
 * labels — that half lives here.
 */
const EXPORT_FORMATS = [
  { label: '导出 HTML', write: (value: string, name: string) => documents.exportHtml(value, name) },
  { label: '导出 MD', write: (value: string, name: string) => documents.exportMarkdown(value, name) },
] as const

/** What `新建` starts from: a document with no file behind it yet. */
const NEW_DOC = { content: '# 未命名\n\n', name: 'untitled.md' }

/**
 * The file a document is backed by: the handle the seam handed over, and when
 * that file was last modified as of reading it.
 *
 * Held as ONE value, because the two are only ever true together. Split into two
 * pieces of state, there is a render in which the document has a handle and the
 * PREVIOUS document's timestamp, and nothing downstream can tell.
 */
interface OpenFile {
  readonly document: OpenDocument
  readonly modifiedAt: number
}

/**
 * What the user is told when the automatic writes give up.
 *
 * One sentence per reason, written down together so that a new reason cannot be
 * added without one.
 */
const WRITE_BACK_STOP_MESSAGE: Record<WriteBackStopReason, string> = {
  declined: '磁盘上的文件被别的程序改过，已停止自动写回；内容留在草稿里',
  failed: '写回文件失败，已停止自动写回；内容留在草稿里，可以手动保存',
  missing: '找不到这个文件（可能已被删除或移动），已停止自动写回；内容留在草稿里，可以手动保存',
}

export default function App() {
  const editorRef = useRef<EditorHandle>(null)

  /**
   * Whether the user has adopted ANY document this load, by hand — a picked
   * file, a tree click, 新建, the welcome reset. The remembered file only ever
   * replaces the pristine welcome document; once the user has chosen, the
   * memory has no business choosing for them.
   */
  const touchedRef = useRef(false)

  const initial = useMemo(() => {
    // The slot written last is the document that was being edited, and it is the
    // only one a reload can put back: a file handle does not survive a reload
    // (see the folder ticket — persisting one is a separate decision).
    const key = documents.draft.active()
    const slot = key ? documents.draft.load(key) : null
    if (slot) {
      return { value: slot.content, name: slot.name, root: slot.root, path: slot.path, restored: true }
    }
    return { value: WELCOME_DOC, name: WELCOME_NAME, root: null, path: null, restored: false }
  }, [])

  const [value, setValue] = useState(initial.value)
  /**
   * Where the document lives, as far as the shell can tell.
   *
   * The shell holds it and hands it back to `documents.save`; whether it is
   * backed by a writable handle is the adapter's business
   * (platform/documents.ts), and whether content can reach it on its own is the
   * `canWriteBack` capability below.
   */
  const [file, setFile] = useState<OpenFile | null>(null)
  const [fileName, setFileName] = useState(initial.name)
  /**
   * Where the document sits inside the folder it was opened from, or null when it
   * did not come from one. It is half of the draft slot's identity — `草稿/notes.md`
   * and `发布/notes.md` in one folder are two documents, not one.
   *
   * A restored slot carries its own root and path, so a document put back on load
   * keeps writing into the slot it came from even before the folder is opened
   * again. Whether that is also what the title bar SHOWS is a separate question:
   * see `inOpenFolder`.
   */
  const [filePlacement, setFilePlacement] = useState<FolderPlacement | null>(
    initial.root !== null && initial.path !== null
      ? { root: initial.root, path: initial.path }
      : null,
  )
  /**
   * The last content known to be in the file — null while the document has never
   * had one. A slot restored on load is content that reached no file, so it
   * starts UNSAVED: `dirty` is the truth the title bar and the draft slot are
   * built on, and pretending otherwise would hide the one copy there is.
   */
  const [savedValue, setSavedValue] = useState<string | null>(
    initial.restored ? null : initial.value,
  )
  const [caretLine, setCaretLine] = useState(1)
  const [headings, setHeadings] = useState(() => extractHeadings(initial.value))
  // Open by default on a desktop, where the outline is a column beside the
  // document. On a narrow screen it is a drawer that covers the document, so it
  // starts closed — the canvas is what the user came for.
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowScreen())
  // The two export menus — desktop (`.titlebar-right`) and narrow screen
  // (`.titlebar-mini`) — each keep their own open flag and ref: only one is ever
  // visible, but both may be in the DOM at once, and one boolean cannot say WHICH
  // menu an outside click is about to close.
  const [exportOpen, setExportOpen] = useState(false)
  const [desktopExportOpen, setDesktopExportOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const desktopMenuRef = useRef<HTMLDivElement>(null)
  const [toast, setToast] = useState<string | null>(null)
  const theme = useTheme()

  const dirty = value !== savedValue
  const stats = useMemo(() => computeStats(value), [value])
  /**
   * Which slot this document's unwritten content belongs to: the folder it came
   * from plus its path inside it, or its display name when it has no folder.
   */
  const draftKey = draftSlotKey(filePlacement, fileName)
  /**
   * Whether the content can reach a file on its own.
   *
   * When it can, switching documents throws nothing away and therefore asks
   * nothing. When it cannot — a platform with no write-back, a document with no
   * file behind it, a slot restored on load that has no handle yet — the old
   * prompts stay, because they are the only thing between the user and lost work.
   */
  const canWriteBack = documents.canWriteBack && file !== null

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2600)
  }, [])

  // --- the sidebar's two panels ----------------------------------------------
  const { panel, setPanel } = useSidebarPanel()
  // Read on demand and cached until 刷新; see `useFileTree` for why there is no
  // watching (the platform offers no change notifications).
  const tree = useFileTree(notify)
  // An offered folder (stored, but its permission needs one click) is a 文件
  // panel concern: bring the tree into view just like opening a folder does, or
  // the offer would sit in a panel nobody is looking at.
  useEffect(() => {
    if (tree.resumePrompt) setPanel('files')
  }, [setPanel, tree.resumePrompt])
  /** Whether this platform can open a folder at all — a plain capability check. */
  const canOpenFolder = folders.canOpen()
  /**
   * Whether the document on screen came from the folder that is open.
   *
   * Both halves are needed: no folder handle survives a reload, so a restored slot
   * remembers where its document came from while no tree is on screen; and opening
   * a DIFFERENT folder must not make the document look like it lives there.
   */
  const inOpenFolder =
    filePlacement !== null && tree.root !== null && tree.root.name === filePlacement.root
  /** Where the document on screen sits inside the open folder, or null. */
  const activePath = inOpenFolder && filePlacement !== null ? filePlacement.path : null
  /**
   * Whether a row of the tree holds content that never reached its file.
   *
   * The slot key is the folder root plus the path inside it, the same rule the
   * open document uses, which is why the two agree about which row is which.
   */
  const hasDraft = useCallback(
    (entry: FolderEntry) =>
      documents.draft.has(
        draftSlotKey(tree.root === null ? null : { root: tree.root.name, path: entry.path }, entry.name),
      ),
    [tree.root],
  )

  // --- outline (debounced: heading extraction is cheap but not free) ---------
  useEffect(() => {
    const timer = window.setTimeout(() => setHeadings(extractHeadings(value)), OUTLINE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [value])

  // --- draft persistence -----------------------------------------------------
  // The policy (debounce, one slot per document, write now on unload) is
  // `core/autosave.ts`; this is the wiring: real localStorage, real timers, real
  // unload events.
  const autosave = useMemo(
    () =>
      createAutosave({
        write: (key, draft) => documents.draft.save(key, draft),
        // Read before every write, per slot: this is how the policy tells its own
        // last write from another tab's on the SAME document.
        peek: (key) => documents.draft.load(key),
        remove: (key) => documents.draft.remove(key),
        onForeignDraft: () => notify('另一个标签页也改过这份草稿，已被当前内容覆盖'),
        setTimer: (run, delayMs) => window.setTimeout(run, delayMs),
        clearTimer: (handle) => window.clearTimeout(handle),
        now: () => Date.now(),
      }),
    [notify],
  )

  /** The slot of the document on screen right now — the only one the callbacks below may touch. */
  const currentKeyRef = useRef(draftKey)
  useEffect(() => {
    currentKeyRef.current = draftKey
  }, [draftKey])

  /**
   * Writing the content into its file while the user types, so that switching
   * documents is not a lossy operation and no longer has to ask.
   *
   * `core/writeBack.ts` owns the four decisions (debounce, one question when the
   * file changed underneath, giving up after a write that did not happen, never
   * writing a superseded text twice); this is the wiring.
   */
  const writeBack = useMemo(() => {
    if (!canWriteBack || file === null) return null
    return createWriteBack({
      openedAt: file.modifiedAt,
      currentModifiedAt: () => documents.modifiedAt(file.document),
      write: async (text) => (await documents.save(file.document, text)).status === 'saved',
      confirmOverwrite: () => window.confirm(`磁盘上的「${fileName}」被别的程序改过，确定覆盖吗？`),
      onWritten: (text) => {
        // The slot holds content that is now in the file — unless something newer
        // got into it while the write was in flight, which is why the check is by
        // content and not by "we just wrote".
        autosave.forgetUnlessNewer(draftKey, text)
        // The user may have switched documents while this was being written:
        // marking the NEW document saved with the OLD text would be a lie.
        if (currentKeyRef.current !== draftKey) return
        setSavedValue(text)
      },
      onStopped: (reason) => notify(WRITE_BACK_STOP_MESSAGE[reason]),
      setTimer: (run, delayMs) => window.setTimeout(run, delayMs),
      clearTimer: (handle) => window.clearTimeout(handle),
    })
  }, [autosave, canWriteBack, draftKey, file, fileName, notify])

  const writeBackRef = useRef<WriteBack | null>(null)
  useEffect(() => {
    writeBackRef.current = writeBack
  }, [writeBack])

  /** The slot the content would go into if the document is dirty right now. */
  const unwrittenKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!dirty) {
      // Clean: nothing is unwritten, so the slot has nothing to hold. Forgetting
      // the key that WAS dirty (rather than the current one) is what covers
      // "save as", where the document is clean under a new name by the time this
      // runs.
      const key = unwrittenKeyRef.current
      if (key !== null) {
        autosave.forget(key)
        unwrittenKeyRef.current = null
      }
      return
    }
    unwrittenKeyRef.current = draftKey
    // The slot records where the document came from, so that a reload can put it
    // back and the tree can mark it as having something unwritten.
    autosave.schedule(draftKey, {
      content: value,
      name: fileName,
      root: filePlacement?.root ?? null,
      path: filePlacement?.path ?? null,
    })
    return () => autosave.cancel()
  }, [autosave, dirty, draftKey, fileName, filePlacement, value])

  useEffect(() => {
    // The other half of "content reaches its file on its own". Nothing to do
    // while the document is clean, and nothing to do when there is no file to
    // write into — that is the whole of `canWriteBack`.
    if (!writeBack || !dirty) return
    writeBack.schedule(value)
    return () => writeBack.cancel()
  }, [writeBack, dirty, value])

  useEffect(() => {
    // The debounce timer dies the moment the page unloads: an edit made just
    // before refreshing could still be sitting in the timer, and reloading then
    // restores the STALE draft — observed as deleted text "coming back" after
    // a refresh. Flush synchronously on unload (localStorage writes are sync).
    // Registered once: the stores remember the pending content, so these
    // listeners do not need re-registering on every keystroke.
    const flush = () => {
      autosave.flush()
      // Started, not awaited: `pagehide` has no time to wait. The slot written
      // just above is what covers a write that never gets to finish.
      writeBackRef.current?.flush()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [autosave])

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      // With write-back the content is on its way into the file by itself, so
      // leaving the page is not a way to lose it and there is nothing to warn
      // about. Without it, the draft is the only copy and the browser's question
      // is the last line of defence.
      if (canWriteBack) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [canWriteBack, dirty])

  // --- file actions ----------------------------------------------------------
  /**
   * The one place that asks before unsaved work is thrown away.
   *
   * Every lossy operation goes through it; a call site says what it is about to
   * do, and nothing else. That is the whole point: written at the call sites
   * instead — `if (dirty && !confirm(...)) return`, copied next to the operation
   * — 「新建」 asked and 「打开」 did not, and the user, educated by one prompt,
   * trusted the operation that had none. The next lossy operation (drag-and-drop,
   * a template, an import) will be added by someone reading this.
   *
   * `dirty` is `value !== savedValue`, the same truth the title-bar dot and the
   * status bar read. A second "has it been edited?" flag would be a second answer
   * to one question, and the two would drift.
   *
   * The *ordering* stays at the call sites, because it genuinely differs: an
   * operation with a file picker must pick first and ask about THAT file, while
   * one with no picker asks before it does anything. So this decides, and the
   * caller decides when.
   *
   * It is skipped entirely when the content can reach its file on its own
   * (`canWriteBack`): then replacing the document throws nothing away, and a
   * question with no consequence is just an interruption. The prompt survives
   * exactly where it still buys something — a document with no file behind it,
   * where the draft slot is the only copy there is.
   */
  const confirmDiscard = useCallback(
    (action: string): boolean =>
      !dirty || canWriteBack || window.confirm(`当前文档还没保存，确定${action}吗？`),
    [canWriteBack, dirty],
  )

  /**
   * Hands the current document over before another one replaces it.
   *
   * Two things have to happen first: the slot has to be written (synchronously —
   * it is the only copy if the file write below does not get there), and the file
   * write has to be started (not awaited: it finishes while the screen has
   * already moved on, and its callbacks know which document it belonged to).
   */
  const leaveDocument = useCallback(() => {
    autosave.flush()
    writeBackRef.current?.flush()
  }, [autosave])

  /**
   * Adopt what an open handed back.
   *
   * Both open paths end here — the picker, and a click on a row of the folder tree
   * — so "what switching does to the screen" is written once. `origin` is where
   * the document came from: null for a picked file, its place in the folder for
   * one clicked in the tree.
   */
  const adoptOpened = useCallback(
    (
      document: OpenDocument,
      content: string,
      modifiedAt: number,
      origin: FolderPlacement | null,
    ) => {
      touchedRef.current = true
      leaveDocument()
      editorRef.current?.setDocument(content)
      setSavedValue(content)
      setFile({ document, modifiedAt })
      setFileName(document.name)
      setFilePlacement(origin)
      setHeadings(extractHeadings(content))
    },
    [leaveDocument],
  )

  const handleOpen = useCallback(async () => {
    const result = await documents.open()
    if (result.status === 'cancelled') return
    if (result.status === 'failed') {
      notify(`打开失败：${String(result.error)}`)
      return
    }
    const { document, content, modifiedAt } = result
    // Asked AFTER the picker, unlike 新建: the question is worth answering only
    // about a file that exists, and it can then name both sides of the trade.
    // A dismissed picker never gets here, so declining it costs no prompt.
    if (!confirmDiscard(`丢弃改动并打开「${document.name}」`)) return
    adoptOpened(document, content, modifiedAt, null)
    notify(`已打开 ${document.name}`)
  }, [adoptOpened, confirmDiscard, notify])

  /** Opens a document the tree already holds a handle for — no picker, no search. */
  const handleOpenEntry = useCallback(
    async (entry: FolderEntry) => {
      const result = await documents.openEntry({ name: entry.name, handle: entry.handle })
      if (result.status === 'cancelled') return
      if (result.status === 'failed') {
        notify(`打开失败：${String(result.error)}`)
        return
      }
      if (!confirmDiscard(`丢弃改动并打开「${result.document.name}」`)) return
      adoptOpened(result.document, result.content, result.modifiedAt, {
        root: tree.root?.name ?? '',
        path: entry.path,
      })
      notify(`已打开 ${result.document.name}`)
      // The file just opened is the one a reload should put back (best effort).
      tree.rememberFile(entry.path)
      // On a narrow screen the sidebar is a drawer covering the document, so
      // opening one has to get out of the way — the same reason a jump from the
      // outline closes it.
      if (isNarrowScreen()) setSidebarOpen(false)
    },
    [adoptOpened, confirmDiscard, notify, tree.rememberFile, tree.root],
  )

  /**
   * The file the last session had open comes back with its folder — by path,
   * never by handle (see `savedFolder.ts`): once the tree is up, re-read it
   * exactly like a tree click, so the automatic write-back arms fresh.
   *
   * Three situations keep their own document on screen: the user has already
   * adopted one this load (`touched`), the content on screen has not reached
   * its file (`dirty` — the draft slot, the only copy), or the document already
   * came from this folder. Only the pristine welcome document is ever swapped,
   * and a remembered file that no longer resolves is passed over in silence.
   */
  useEffect(() => {
    const root = tree.root
    const lastFile = tree.lastFile
    if (root === null || lastFile === null) return
    if (touchedRef.current || dirty || inOpenFolder) return
    let cancelled = false
    void (async () => {
      const entry = await folders.fileAt(root, lastFile)
      if (cancelled || entry === null) return
      // `touched` is a ref on purpose, so a choice made while the handle was
      // being re-found (新建, a hand save) changes no effect dep and would sail
      // straight past the checks above. The state-backed guards need no second
      // check here: any flip of theirs re-renders, restarts this effect and
      // cancels this run through `cancelled`.
      if (touchedRef.current) return
      await handleOpenEntry(entry)
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [dirty, handleOpenEntry, inOpenFolder, tree.lastFile, tree.root])

  /**
   * Opens a folder, and shows the panel that folder is for.
   *
   * Cancelling changes NOTHING — not even which panel is on screen — so the panel
   * switch waits for a folder to actually be there.
   */
  const openFolder = tree.openFolder
  const handleOpenFolder = useCallback(async () => {
    if (await openFolder()) setPanel('files')
  }, [openFolder, setPanel])

  const handleSave = useCallback(
    async (forcePicker = false) => {
      // The shell owns the display name, so it hands it over: with no file handle
      // there is nothing else to name the saved document after.
      const result = await documents.save(file?.document ?? null, value, {
        forcePicker,
        name: fileName,
      })
      if (result.status === 'cancelled') {
        // The user declined — dismissing the picker, or refusing the write
        // permission. Nothing was written, so the document stays dirty.
        notify('已取消')
        return
      }
      if (result.status === 'failed') {
        notify(`保存失败：${String(result.error)}`)
        return
      }
      if (result.status === 'saved') {
        // A file that has just been created or written has a new modification
        // time, and that is the one the automatic writes must compare against.
        // Read BEFORE the state changes, so that the handle and its timestamp
        // never appear in different renders. A file whose time cannot be read is
        // recorded as "no file": without a baseline, an automatic write could not
        // tell its own work from somebody else's.
        const modifiedAt = await documents.modifiedAt(result.document)
        setFile(modifiedAt === null ? null : { document: result.document, modifiedAt })
        setFileName(result.document.name)
      }
      // A hand save is a choice, exactly like opening a document: the remembered
      // file must not come back and swap out what the user just saved. Without
      // this, a restored draft saved by hand turns `dirty` false and re-arms the
      // auto-open (the dirty guard exists to protect the only copy, which a save
      // has just created a second one of).
      touchedRef.current = true
      setSavedValue(value)
      // Whatever the automatic writes were waiting to do, the user has just done
      // it by hand.
      writeBackRef.current?.savedByHand()
      notify(result.status === 'downloaded' ? '已下载文件' : '已保存')
    },
    [file, fileName, notify, value],
  )

  /**
   * Adopt a document that has no file behind it — the welcome document, or a new
   * one. Clearing the file is the point rather than bookkeeping: it is what stops
   * a later save from writing the new text into whatever file was open before,
   * and what keeps the automatic writes away from a document whose content has no
   * destination yet.
   */
  const adoptDocument = useCallback(
    (content: string, name: string) => {
      touchedRef.current = true
      leaveDocument()
      editorRef.current?.setDocument(content)
      setSavedValue(content)
      setFile(null)
      setFilePlacement(null)
      setFileName(name)
      setHeadings(extractHeadings(content))
    },
    [leaveDocument],
  )

  const handleNew = useCallback(() => {
    // No picker on this path, so there is nothing to pick before asking: the
    // question comes first, and 新建 is the operation that has always asked.
    if (!confirmDiscard('新建')) return
    adoptDocument(NEW_DOC.content, NEW_DOC.name)
    editorRef.current?.focus()
  }, [adoptDocument, confirmDiscard])

  const applyEdit = useCallback((mutate: Parameters<EditorHandle['applyEdit']>[0]) => {
    editorRef.current?.applyEdit(mutate)
  }, [])

  /**
   * The table commands go through the DOCUMENT-level edit, not `applyEdit`: a
   * table is one block, but the blank lines around it are not, so deleting a table
   * has to be able to take one of them along.
   */
  const applyDocumentEdit = useCallback(
    (run: (doc: string, offset: number) => TableEdit | null) => {
      editorRef.current?.applyDocumentEdit(run)
    },
    [],
  )

  /**
   * The table menu: opened by a right-click inside a table, closed by a click
   * anywhere else or by running one of its commands.
   */
  const [tableMenu, setTableMenu] = useState<TableMenuState | null>(null)

  /** The keyboard reference, behind the titlebar's 帮助 button (desktop only). */
  const [helpOpen, setHelpOpen] = useState(false)

  // --- folder tree: right-click menu and the inline edit it starts ----------
  const [treeMenu, setTreeMenu] = useState<TreeMenuState | null>(null)
  const [treeEditing, setTreeEditing] = useState<TreeEditing | null>(null)

  /** 删除：a confirm first — the filesystem has no recycle bin behind this. */
  const deleteTreeFile = useCallback(
    async (entry: FolderEntry) => {
      if (!window.confirm(`确定删除「${entry.name}」吗？删除不会进回收站。`)) return
      if (await tree.removeFile(entry.path)) notify(`已删除 ${entry.name}`)
    },
    [notify, tree.removeFile],
  )

  /** The two menus are siblings with the same habits: Escape and an outside
      click close the menu; choosing an item closes it and does the thing. */
  const runTreeMenuCommand = useCallback(
    (command: TreeMenuCommand, entry: FolderEntry) => {
      if (command === 'createFile') setTreeEditing({ kind: 'create', dirPath: entry.path })
      else if (command === 'rename') setTreeEditing({ kind: 'rename', entry })
      else void deleteTreeFile(entry)
    },
    [deleteTreeFile],
  )

  const handleTreeRowMenu = useCallback((entry: FolderEntry, x: number, y: number) => {
    setTreeMenu({ x, y, entry })
  }, [])

  const handleTreeEditCancel = useCallback(() => {
    setTreeEditing(null)
  }, [])

  /** A validated name (`core/fileTree` said it was fine to use). */
  const handleTreeEditSubmit = useCallback(
    (name: string) => {
      if (treeEditing === null) return
      setTreeEditing(null)
      void (async () => {
        if (treeEditing.kind === 'create') {
          const entry = await tree.createFile(treeEditing.dirPath, name)
          if (entry === null) return
          notify(`已新建 ${entry.name}`)
          // A new file IS a new document: adopt it exactly like a tree click.
          await handleOpenEntry(entry)
        } else {
          const { entry } = treeEditing
          const renamed = await tree.renameFile(entry.path, name)
          if (!renamed) return
          notify(`已重命名为 ${name}`)
          // The open document, when it was the renamed file, follows the file:
          // its title is the name, and a reload must find it at the new path.
          if (activePath === entry.path) {
            setFileName(name)
            setFilePlacement((placement) =>
              placement === null ? placement : { ...placement, path: childPath(parentOf(entry.path), name) },
            )
            tree.rememberFile(childPath(parentOf(entry.path), name))
          }
        }
      })()
    },
    [activePath, handleOpenEntry, notify, tree, treeEditing],
  )

  const runTableCommand = useCallback(
    (command: TableMenuCommand) => {
      setTableMenu(null)
      // The same mutations the keyboard commands use — one definition of what
      // "insert a row below" means, whichever entry asked for it.
      applyDocumentEdit(TABLE_MUTATIONS[command])
      // The caret placement focuses the root, but a command that DECLINED (删除本行
      // on the header row) places no caret at all, and the focus is still on the
      // menu button that is about to unmount.
      editorRef.current?.focus()
    },
    [applyDocumentEdit],
  )

  const jumpToLine = useCallback((line: number) => {
    editorRef.current?.goToLine(line)
    // On a narrow screen the outline is a drawer covering the document, so
    // jumping has to get out of the way. On desktop it is a column beside the
    // document and stays open.
    if (isNarrowScreen()) setSidebarOpen(false)
  }, [])

  // --- formatting toolbar & shortcuts ---------------------------------------
  const commands = useMemo(
    () => ({
      bold: () => applyEdit((b) => toggleInline(b, '**')),
      italic: () => applyEdit((b) => toggleInline(b, '*')),
      strike: () => applyEdit((b) => toggleInline(b, '~~')),
      code: () => applyEdit((b) => toggleInlineCode(b)),
      link: () => applyEdit((b) => insertLink(b)),
      heading: (level: number) => () => applyEdit((b) => toggleHeading(b, level)),
      deleteLine: () => applyEdit((b) => deleteLine(b)),
      table: () => applyEdit((b) => insertSnippet(b, TABLE_SNIPPET)),
      // Row commands, on the same road as every other command: a `{doc, caret}`
      // from `core/tables.ts` applied to the document (and a no-op outside a
      // table).
      tableRowAbove: () => applyDocumentEdit(TABLE_MUTATIONS.rowAbove),
      tableRowBelow: () => applyDocumentEdit(TABLE_MUTATIONS.rowBelow),
      tableRowDelete: () => applyDocumentEdit(TABLE_MUTATIONS.rowDelete),
      quote: () => applyEdit((b) => toggleBlockPrefix(b, 'quote')),
      list: () => applyEdit((b) => toggleBlockPrefix(b, 'ul')),
      orderedList: () => applyEdit((b) => toggleBlockPrefix(b, 'ol')),
      task: () => applyEdit((b) => toggleBlockPrefix(b, 'task')),
      codeBlock: () => applyEdit((b) => insertSnippet(b, '```\n\n```')),
      clearFormat: () => applyEdit((b) => clearFormat(b)),
      headingIncrease: () => applyEdit((b) => changeHeadingLevel(b, -1)),
      headingDecrease: () => applyEdit((b) => changeHeadingLevel(b, 1)),
      indent: () => applyEdit((b) => indentSelection(b, 'in')),
      outdent: () => applyEdit((b) => indentSelection(b, 'out')),
      footnotes: () => applyEdit((b) => insertFootnote(b)),
      linkReference: () => applyEdit((b) => insertLinkReference(b)),
      hr: () => applyEdit((b) => insertHr(b)),
      inlineMath: () => applyEdit((b) => toggleInlineMath(b)),
    }),
    [applyEdit],
  )

  // Put the welcome document back after it has been overwritten by whatever you
  // were poking at. From the browser console:
  //   __welcome__()
  //
  // Deliberately in the PRODUCTION bundle too, not behind `import.meta.env.DEV`:
  // the deployed demo is where poking at the welcome document actually loses it,
  // and there is nothing here to protect — it resets the caller's own draft and
  // touches no server. The plan is to remove the helper outright rather than to
  // gate it, so gating it now would only be work thrown away.
  useEffect(() => {
    const scope = window as typeof window & { __welcome__?: () => string }
    scope.__welcome__ = () => {
      // Restores the whole welcome document, not just its text: the title bar
      // said the name of whatever file was open, which made the helper look like
      // it had only half worked.
      adoptDocument(WELCOME_DOC, WELCOME_NAME)
      notify('已恢复欢迎文档')
      return WELCOME_DOC
    }
    return () => {
      delete scope.__welcome__
    }
  }, [adoptDocument, notify])

  // Which key runs what is `core/shortcuts.ts` (pure, unit-tested); this table is
  // the other half — one place where a command name becomes an action.
  const shortcutActions = useMemo((): Record<ShellCommand, () => void> => {
    return {
      blur: () => (document.activeElement as HTMLElement | null)?.blur(),
      bold: commands.bold,
      italic: commands.italic,
      strike: commands.strike,
      inlineCode: commands.code,
      link: commands.link,
      deleteLine: commands.deleteLine,
      heading1: commands.heading(1),
      heading2: commands.heading(2),
      heading3: commands.heading(3),
      heading4: commands.heading(4),
      heading5: commands.heading(5),
      heading6: commands.heading(6),
      paragraph: commands.heading(0),
      headingIncrease: commands.headingIncrease,
      headingDecrease: commands.headingDecrease,
      clearFormat: commands.clearFormat,
      quote: commands.quote,
      orderedList: commands.orderedList,
      unorderedList: commands.list,
      taskList: commands.task,
      indent: commands.indent,
      outdent: commands.outdent,
      codeBlock: commands.codeBlock,
      footnotes: commands.footnotes,
      linkReference: commands.linkReference,
      hr: commands.hr,
      table: commands.table,
      tableRowAbove: commands.tableRowAbove,
      tableRowBelow: commands.tableRowBelow,
      tableRowDelete: commands.tableRowDelete,
      inlineMath: commands.inlineMath,
      save: () => void handleSave(false),
      saveAs: () => void handleSave(true),
      open: () => void handleOpen(),
      openFolder: () => void handleOpenFolder(),
      newDocument: handleNew,
      toggleOutline: () => setSidebarOpen((open) => !open),
    }
  }, [commands, handleNew, handleOpen, handleOpenFolder, handleSave])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event)
      // null means the shell has no binding: no `preventDefault()`, so the
      // browser keeps its own (Cmd+P must still print).
      if (!shortcut) return
      // Escape goes to whatever is layered over the document first — the export
      // menu, then a narrow screen's drawer. Both swallow the shell's `blur`:
      // closing the layer is what the key means there. Dispatching through the
      // table keeps `shortcuts.ts` the one place that says which key is which
      // command.
      if (shortcut === 'blur' && (exportOpen || desktopExportOpen || (sidebarOpen && isNarrowScreen()))) {
        if (exportOpen) setExportOpen(false)
        else if (desktopExportOpen) setDesktopExportOpen(false)
        else setSidebarOpen(false)
        return
      }
      // Escape is the exception: swallowing it takes the key away from the IME
      // and the browser, which use it to cancel a composition. Blurring is the
      // whole command, so it needs no default suppressed.
      if (shortcut !== 'blur') event.preventDefault()
      shortcutActions[shortcut]()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcutActions, sidebarOpen, exportOpen, desktopExportOpen])

  // Crossing the breakpoint mid-session (a rotation, a resized window) adopts
  // that mode's default: a column that has just become a drawer must not sit on
  // top of the document, and a drawer that has just become a column should be
  // there. Only a crossing re-decides — inside one mode the user's own toggle
  // stands.
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    const onCross = () => setSidebarOpen(!query.matches)
    query.addEventListener('change', onCross)
    return () => query.removeEventListener('change', onCross)
  }, [])

  // The export menu closes the way a menu does: a click anywhere outside it.
  // Clicks inside are left alone — the items close it themselves, and the
  // toggle has to be able to close it by being clicked again. (Escape is handled
  // above, with the other keys.)
  useEffect(() => {
    if (!exportOpen && !desktopExportOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (
        target &&
        !menuRef.current?.contains(target) &&
        !desktopMenuRef.current?.contains(target)
      ) {
        setExportOpen(false)
        setDesktopExportOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [exportOpen, desktopExportOpen])

  return (
    <div className="app">
      <header className="titlebar" data-sidebar={sidebarOpen ? 'on' : 'off'}>
        <div className="titlebar-left">
          <button
            type="button"
            className="icon-button"
            onClick={() => setSidebarOpen((open) => !open)}
            title="显示/隐藏大纲 (Cmd/Ctrl+Shift+\)"
            aria-label="切换大纲"
          >
            <span className="icon-lines" />
          </button>
          <div className="doc-title">
            <span
              className="doc-name"
              title={
                inOpenFolder && filePlacement !== null
                  ? `${filePlacement.root}/${filePlacement.path}`
                  : fileName
              }
            >
              {inOpenFolder && filePlacement !== null ? filePlacement.path : fileName}
            </span>
            {dirty && <span className="doc-dot" title="有未保存的修改" />}
          </div>
        </div>

        {/* The format toolbar lives in the titlebar again — but centred on the
            DOCUMENT column's axis, not the window's. `.titlebar-left` mirrors
            the outline's width with the outline open, so `.titlebar-center`
            starts exactly where the workspace starts and the pill centres on the
            same line as the text. (It spent a while at the top of the workspace,
            which centred it right but cost the document a row of screen.) The
            command strip is pinned to the centre band's right edge — the same
            column as the workspace, so it sits over the document's right margin.
            Narrow screens hide all of this with the rest of the desktop
            furniture and get `.titlebar-mini` below. */}
        <div className="titlebar-center">
          <div className="toolbar" role="toolbar" aria-label="格式">
            {/* Every button in this row is an SVG on the one 16-unit grid. The
                text labels (`B I S H1 H2 H3`) became `<text>` inside that same
                frame: a letterform is the honest icon for "bold", but as bare
                labels their ink was whatever the toolbar's own font-size made
                it — which is how `🔗` and `☑` ended up in the same row at sizes
                nobody chose. */}
            <ToolButton label={<BoldIcon />} title="加粗 (Cmd/Ctrl+B)" onClick={commands.bold} />
            <ToolButton label={<ItalicIcon />} title="斜体 (Cmd/Ctrl+I)" onClick={commands.italic} />
            <ToolButton label={<StrikeIcon />} title="删除线 (Ctrl+Shift+`)" onClick={commands.strike} />
            <span className="toolbar-sep" />
            <ToolButton label={<HeadingIcon level={1} />} title="一级标题 (Cmd/Ctrl+1)" onClick={commands.heading(1)} />
            <ToolButton label={<HeadingIcon level={2} />} title="二级标题 (Cmd/Ctrl+2)" onClick={commands.heading(2)} />
            <ToolButton label={<HeadingIcon level={3} />} title="三级标题 (Cmd/Ctrl+3)" onClick={commands.heading(3)} />
            <span className="toolbar-sep" />
            {/* Everything below is a PICTURE, so it is drawn. The glyphs they
                used to be (`‹› ❝ • ☑ ▦ {}`) each carried their own weight and
                size — `▦` was a solid block, `•` a speck, `❝` oversized —
                because a font glyph's ink is whatever that font decides. See
                `Glyph`. */}
            <ToolButton label={<InlineCodeIcon />} title="行内代码 (Ctrl+`)" onClick={commands.code} />
            <ToolButton label={<QuoteIcon />} title="引用 (Alt+Cmd/Ctrl+Q)" onClick={commands.quote} />
            <ToolButton label={<BulletListIcon />} title="无序列表 (Alt+Cmd/Ctrl+U)" onClick={commands.list} />
            <ToolButton label={<OrderedListIcon />} title="有序列表 (Alt+Cmd/Ctrl+O)" onClick={commands.orderedList} />
            <ToolButton label={<TaskListIcon />} title="任务列表 (Alt+Cmd/Ctrl+X)" onClick={commands.task} />
            <ToolButton label={<TableIcon />} title="插入表格 (Alt+Cmd/Ctrl+T)" onClick={commands.table} />
            <ToolButton label={<CodeBlockIcon />} title="代码块 (Alt+Cmd/Ctrl+C)" onClick={commands.codeBlock} />
            <ToolButton label={<LinkIcon />} title="链接 (Cmd/Ctrl+K)" onClick={commands.link} />
          </div>
        </div>

        <div className="titlebar-right">
            <button
              type="button"
              className="icon-button"
              onClick={theme.cycle}
              title={`主题：${THEME_LABEL[theme.theme]}（点击切换 浅色 → 深色 → 跟随系统）`}
              aria-label="切换主题"
            >
              {theme.theme === 'light' ? (
                <SunIcon />
              ) : theme.theme === 'dark' ? (
                <MoonIcon />
              ) : (
                <SystemIcon />
              )}
            </button>
            <button type="button" className="icon-button" onClick={handleNew} title="新建" aria-label="新建">
              <NewIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void handleOpen()}
              title="打开"
              aria-label="打开"
            >
              <OpenIcon />
            </button>
            {canOpenFolder && (
              <button
                type="button"
                className="icon-button"
                onClick={() => void handleOpenFolder()}
                title="打开文件夹"
                aria-label="打开文件夹"
              >
                <FolderIcon />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={() => void handleSave(false)}
              title="保存"
              aria-label="保存"
            >
              <SaveIcon />
            </button>
            <div className="mini-export" ref={desktopMenuRef}>
              <button
                type="button"
                className="icon-button"
                onClick={() => setDesktopExportOpen((open) => !open)}
                title="导出"
                aria-label="导出"
                aria-expanded={desktopExportOpen}
                aria-haspopup="menu"
              >
                <ExportIcon />
              </button>
              {desktopExportOpen && (
                <div className="mini-menu" role="menu">
                  {EXPORT_FORMATS.map((format) => (
                    <button
                      key={format.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setDesktopExportOpen(false)
                        format.write(value, fileName)
                      }}
                    >
                      {format.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* The keyboard reference, at the far right of the desktop header. Not in
                the mini group: a phone has no keyboard to look keys up for, and the
                panel needs width the narrow header does not have. */}
            <div className="help-anchor">
              <button
                type="button"
                className="icon-button"
                onClick={() => setHelpOpen((open) => !open)}
                title="快捷键"
                aria-label="快捷键"
                aria-expanded={helpOpen}
                aria-haspopup="dialog"
              >
                <HelpIcon />
              </button>
              {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
            </div>
          </div>

        {/* Narrow screens only (`.titlebar-mini`): the format toolbar is desktop
            furniture, and these are the commands a phone cannot do without. New
            and open belong here because they are the document's lifecycle, and
            open genuinely works on a phone — with no File System Access API the
            adapter falls back to `<input type="file">` for reading. Export is a
            menu rather than two buttons: five icons beside a file name do not fit
            on a 360px screen. The theme toggle stays desktop-only: it is a
            preference, and `system` already follows the phone's own setting. */}
        <div className="titlebar-mini">
          <button
            type="button"
            className="icon-button"
            onClick={handleNew}
            title="新建"
            aria-label="新建"
          >
            <NewIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void handleOpen()}
            title="打开"
            aria-label="打开"
          >
            <OpenIcon />
          </button>
          {canOpenFolder && (
            <button
              type="button"
              className="icon-button"
              onClick={() => void handleOpenFolder()}
              title="打开文件夹"
              aria-label="打开文件夹"
            >
              <FolderIcon />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={() => void handleSave(false)}
            title="保存"
            aria-label="保存"
          >
            <SaveIcon />
          </button>
          <div className="mini-export" ref={menuRef}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setExportOpen((open) => !open)}
              title="导出"
              aria-label="导出"
              aria-expanded={exportOpen}
              aria-haspopup="menu"
            >
              <ExportIcon />
            </button>
            {exportOpen && (
              <div className="mini-menu" role="menu">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    key={format.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false)
                      format.write(value, fileName)
                    }}
                  >
                    {format.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="body">
        {sidebarOpen && (
          <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        )}
        {sidebarOpen && (
          <Sidebar
            panel={panel}
            onPanelChange={setPanel}
            canOpenFolder={canOpenFolder}
            tree={tree}
            activePath={activePath}
            hasDraft={hasDraft}
            onOpenEntry={(entry) => void handleOpenEntry(entry)}
            onOpenFolder={() => void handleOpenFolder()}
            onNewFile={() => setTreeEditing({ kind: 'create', dirPath: '' })}
            editing={treeEditing}
            onRowMenu={handleTreeRowMenu}
            onEditSubmit={handleTreeEditSubmit}
            onEditCancel={handleTreeEditCancel}
            onTreeError={notify}
            headings={headings}
            activeLine={caretLine}
            onJump={jumpToLine}
          />
        )}
        {/* A narrow-screen drawer covers the workspace: the scrim blocks the
            mouse, and `inert` takes the covered editor out of the tab order and
            out of the accessibility tree — Tab must stay within the drawer and
            the titlebar (its toggle is the second way out). On desktop the
            outline is a column, no drawer, so the condition never fires. The
            titlebar and statusbar are never covered and stay reachable. */}
        <main className="workspace" inert={isNarrowScreen() && sidebarOpen}>
          <Editor
            ref={editorRef}
            value={value}
            onChange={setValue}
            onCaretLineChange={setCaretLine}
            onTableMenu={setTableMenu}
          />
        </main>
      </div>

      <footer className="statusbar">
        <span>{stats.words} 词</span>
        <span>{stats.chars} 字符</span>
        <span>{stats.lines} 行</span>
        <span className="statusbar-spacer" />
        <span>约 {stats.readingMinutes} 分钟读完</span>
        <span>行 {caretLine}</span>
        {/* Only the warning is stated. "已同步" claimed a synchronisation that does
            not exist here — `savedValue` tracks the last write to a FILE, while the
            draft is written to localStorage continuously, so the word described
            neither. Nothing is lost by saying nothing when all is well: a save still
            announces itself with a toast, and the title bar carries the dirty dot. */}
        {dirty && <span className="status-dirty">未保存</span>}
      </footer>

      {tableMenu && (
        <TableMenu
          state={tableMenu}
          onCommand={runTableCommand}
          onClose={() => setTableMenu(null)}
        />
      )}

      {treeMenu && (
        <TreeMenu
          state={treeMenu}
          onCommand={(command, entry) => {
            setTreeMenu(null)
            runTreeMenuCommand(command, entry)
          }}
          onClose={() => setTreeMenu(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

interface ToolButtonProps {
  /**
   * What the button shows. A string for the glyph labels (`B`, `H1`, `☑`), or an
   * icon element for the one command with no glyph that fits (see `LinkIcon`).
   * The accessible name always comes from `title`, never from this.
   */
  label: ReactNode
  title: string
  className?: string
  onClick: () => void
}

function ToolButton({ label, title, className = '', onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-button ${className}`}
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()} // keep the caret where it was
      onClick={onClick}
    >
      {label}
    </button>
  )
}
