import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { Outline } from './components/Outline'
import { computeStats, extractHeadings } from '../core/markdown'
import { WELCOME_DOC } from '../core/welcome'
import { createAutosave } from '../core/autosave'
import { shortcutFor, type ShellCommand } from '../core/shortcuts'
import { documents, type OpenDocument } from '../platform/documents'
import { THEME_LABEL, useTheme } from './useTheme'
import {
  TABLE_SNIPPET,
  deleteLine,
  insertLink,
  insertSnippet,
  toggleHeading,
  toggleInline,
  toggleInlineCode,
} from '../core/editCommands'

const OUTLINE_DEBOUNCE_MS = 200

export default function App() {
  const editorRef = useRef<EditorHandle>(null)

  const initial = useMemo(() => {
    const draft = documents.draft.load()
    if (draft) return { value: draft.content, name: draft.name }
    return { value: WELCOME_DOC, name: 'untitled.md' }
  }, [])

  const [value, setValue] = useState(initial.value)
  // Where the document lives, as far as the shell can tell: it holds this and
  // hands it back to `documents.save`. Whether it is backed by a writable file
  // handle is the adapter's business (platform/documents.ts).
  const [doc, setDoc] = useState<OpenDocument | null>(null)
  const [fileName, setFileName] = useState(initial.name)
  const [savedValue, setSavedValue] = useState(initial.value)
  const [caretLine, setCaretLine] = useState(1)
  const [headings, setHeadings] = useState(() => extractHeadings(initial.value))
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const theme = useTheme()

  const dirty = value !== savedValue
  const stats = useMemo(() => computeStats(value), [value])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2600)
  }, [])

  // --- outline (debounced: heading extraction is cheap but not free) ---------
  useEffect(() => {
    const timer = window.setTimeout(() => setHeadings(extractHeadings(value)), OUTLINE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [value])

  // --- draft persistence -----------------------------------------------------
  // The policy (debounce, and write now on unload) is `core/autosave.ts`; this is
  // the wiring: real localStorage, real timers, real unload events.
  const autosave = useMemo(
    () =>
      createAutosave({
        write: (draft) => documents.draft.save(draft),
        setTimer: (run, delayMs) => window.setTimeout(run, delayMs),
        clearTimer: (handle) => window.clearTimeout(handle),
        now: () => Date.now(),
      }),
    [],
  )

  useEffect(() => {
    autosave.schedule({ content: value, name: fileName })
    return () => autosave.cancel()
  }, [autosave, fileName, value])

  useEffect(() => {
    // The debounce timer dies the moment the page unloads: an edit made just
    // before refreshing could still be sitting in the timer, and reloading then
    // restores the STALE draft — observed as deleted text "coming back" after
    // a refresh. Flush synchronously on unload (localStorage writes are sync).
    // Registered once: the store remembers the pending draft, so these listeners
    // do not need re-registering on every keystroke.
    const flush = () => autosave.flush()
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
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // --- file actions ----------------------------------------------------------
  const handleOpen = useCallback(async () => {
    const result = await documents.open()
    if (result.status === 'cancelled') return
    if (result.status === 'failed') {
      notify(`打开失败：${String(result.error)}`)
      return
    }
    const { document, content } = result
    editorRef.current?.setDocument(content)
    setSavedValue(content)
    setDoc(document)
    setFileName(document.name)
    setHeadings(extractHeadings(content))
    notify(`已打开 ${document.name}`)
  }, [notify])

  const handleSave = useCallback(
    async (forcePicker = false) => {
      const result = await documents.save(doc, value, { forcePicker })
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
        setDoc(result.document)
        setFileName(result.document.name)
      }
      setSavedValue(value)
      notify(result.status === 'downloaded' ? '已下载文件' : '已保存')
    },
    [doc, notify, value],
  )

  const handleNew = useCallback(() => {
    if (dirty && !window.confirm('当前文档还没保存，确定新建吗？')) return
    const blank = '# 未命名\n\n'
    editorRef.current?.setDocument(blank)
    setSavedValue(blank)
    setDoc(null)
    setFileName('untitled.md')
    setHeadings(extractHeadings(blank))
    editorRef.current?.focus()
  }, [dirty])

  const applyEdit = useCallback((mutate: Parameters<EditorHandle['applyEdit']>[0]) => {
    editorRef.current?.applyEdit(mutate)
  }, [])

  const jumpToLine = useCallback((line: number) => {
    editorRef.current?.goToLine(line)
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
      quote: () => applyEdit((b) => insertSnippet(b, '> ')),
      list: () => applyEdit((b) => insertSnippet(b, '- ')),
      task: () => applyEdit((b) => insertSnippet(b, '- [ ] ')),
      codeBlock: () => applyEdit((b) => insertSnippet(b, '```\n\n```')),
    }),
    [applyEdit],
  )

  // Development helper: put the welcome document back after it has been
  // overwritten by whatever you were poking at. From the browser console:
  //   __welcome__()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const scope = window as typeof window & { __welcome__?: () => string }
    scope.__welcome__ = () => {
      editorRef.current?.setDocument(WELCOME_DOC)
      notify('已恢复欢迎文档')
      return WELCOME_DOC
    }
    return () => {
      delete scope.__welcome__
    }
  }, [notify])

  // Which key runs what is `core/shortcuts.ts` (pure, unit-tested); this table is
  // the other half — one place where a command name becomes an action.
  const shortcutActions = useMemo((): Record<ShellCommand, () => void> => {
    return {
      blur: () => (document.activeElement as HTMLElement | null)?.blur(),
      bold: commands.bold,
      italic: commands.italic,
      inlineCode: commands.code,
      link: commands.link,
      deleteLine: commands.deleteLine,
      heading1: commands.heading(1),
      heading2: commands.heading(2),
      heading3: commands.heading(3),
      heading4: commands.heading(4),
      heading5: commands.heading(5),
      heading6: commands.heading(6),
      save: () => void handleSave(false),
      saveAs: () => void handleSave(true),
      open: () => void handleOpen(),
      newDocument: handleNew,
      toggleOutline: () => setSidebarOpen((open) => !open),
    }
  }, [commands, handleNew, handleOpen, handleSave])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event)
      // null means the shell has no binding: no `preventDefault()`, so the
      // browser keeps its own (Cmd+P must still print).
      if (!shortcut) return
      event.preventDefault()
      shortcutActions[shortcut]()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcutActions])

  return (
    <div className="app">
      <header className="titlebar">
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
            <span className="doc-name">{fileName}</span>
            {dirty && <span className="doc-dot" title="有未保存的修改" />}
          </div>
        </div>

        <div className="toolbar" role="toolbar" aria-label="格式">
          <ToolButton label="B" title="加粗 (Cmd/Ctrl+B)" className="is-bold" onClick={commands.bold} />
          <ToolButton label="I" title="斜体 (Cmd/Ctrl+I)" className="is-italic" onClick={commands.italic} />
          <ToolButton label="S" title="删除线" className="is-strike" onClick={commands.strike} />
          <ToolButton label="‹›" title="行内代码 (Cmd/Ctrl+E)" onClick={commands.code} />
          <span className="toolbar-sep" />
          <ToolButton label="H1" title="一级标题 (Cmd/Ctrl+1)" onClick={commands.heading(1)} />
          <ToolButton label="H2" title="二级标题 (Cmd/Ctrl+2)" onClick={commands.heading(2)} />
          <ToolButton label="H3" title="三级标题 (Cmd/Ctrl+3)" onClick={commands.heading(3)} />
          <span className="toolbar-sep" />
          <ToolButton label="❝" title="引用" onClick={commands.quote} />
          <ToolButton label="•" title="无序列表" onClick={commands.list} />
          <ToolButton label="☑" title="任务列表" onClick={commands.task} />
          <ToolButton label="▦" title="插入表格" onClick={commands.table} />
          <ToolButton label="{}" title="代码块" onClick={commands.codeBlock} />
          <ToolButton label="🔗" title="链接 (Cmd/Ctrl+K)" onClick={commands.link} />
        </div>

        <div className="titlebar-right">
          <button
            type="button"
            className="text-button"
            onClick={theme.cycle}
            title={`主题：${THEME_LABEL[theme.theme]}（点击切换 浅色 → 深色 → 跟随系统）`}
          >
            {theme.theme === 'light' ? '☀' : theme.theme === 'dark' ? '☾' : '◐'}{' '}
            {THEME_LABEL[theme.theme]}
          </button>
          <button type="button" className="text-button" onClick={handleNew}>
            新建
          </button>
          <button type="button" className="text-button" onClick={() => void handleOpen()}>
            打开
          </button>
          <button type="button" className="text-button" onClick={() => void handleSave(false)}>
            保存
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => documents.exportHtml(value, fileName)}
          >
            导出 HTML
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => documents.exportMarkdown(value, fileName)}
          >
            导出 MD
          </button>
        </div>
      </header>

      <div className="body">
        {sidebarOpen && <Outline headings={headings} activeLine={caretLine} onJump={jumpToLine} />}
        <main className="workspace">
          <Editor
            ref={editorRef}
            value={value}
            onChange={setValue}
            onCaretLineChange={setCaretLine}
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
        <span className={dirty ? 'status-dirty' : 'status-clean'}>
          {dirty ? '未保存' : '已同步'}
        </span>
        <span className="status-hint">
          {documents.supportsWriteBack() ? '支持写回原文件' : '浏览器不支持写回，保存即下载'}
        </span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

interface ToolButtonProps {
  label: string
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
