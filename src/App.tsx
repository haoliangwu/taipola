import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { Outline } from './components/Outline'
import { computeStats, extractHeadings } from './lib/markdown'
import { WELCOME_DOC } from './lib/welcome'
import {
  UserCancelled,
  downloadAsFile,
  downloadHtml,
  loadDraft,
  openFile,
  saveDraft,
  saveFile,
  supportsFileSystemAccess,
  type DocumentFile,
} from './lib/files'
import { renderMarkdown } from './lib/markdown'
import { THEME_LABEL, useTheme } from './lib/theme'
import {
  TABLE_SNIPPET,
  deleteLine,
  insertLink,
  insertSnippet,
  toggleHeading,
  toggleInline,
  toggleInlineCode,
} from './lib/editCommands'

const DRAFT_DEBOUNCE_MS = 500
const OUTLINE_DEBOUNCE_MS = 200

export default function App() {
  const editorRef = useRef<EditorHandle>(null)

  const initial = useMemo(() => {
    const draft = loadDraft()
    if (draft) return { value: draft.content, name: draft.name }
    return { value: WELCOME_DOC, name: 'untitled.md' }
  }, [])

  const [value, setValue] = useState(initial.value)
  const [file, setFile] = useState<DocumentFile | null>(null)
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
  useEffect(() => {
    const timer = window.setTimeout(
      () => saveDraft({ content: value, name: fileName, savedAt: Date.now() }),
      DRAFT_DEBOUNCE_MS,
    )
    // The debounce timer dies the moment the page unloads: an edit made just
    // before refreshing could still be sitting in the timer, and reloading then
    // restores the STALE draft — observed as deleted text "coming back" after
    // a refresh. Flush synchronously on unload (localStorage writes are sync).
    const flush = () => saveDraft({ content: value, name: fileName, savedAt: Date.now() })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fileName, value])

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
    try {
      const result = await openFile()
      if (!result) return
      editorRef.current?.setDocument(result.content)
      setSavedValue(result.content)
      setFile(result.file)
      setFileName(result.file.name)
      setHeadings(extractHeadings(result.content))
      notify(`已打开 ${result.file.name}`)
    } catch (error) {
      notify(error instanceof UserCancelled ? '已取消' : `打开失败：${String(error)}`)
    }
  }, [notify])

  const handleSave = useCallback(
    async (forcePicker = false) => {
      try {
        const saved = await saveFile(value, file, forcePicker)
        if (saved === null && !supportsFileSystemAccess()) {
          notify('已下载文件')
          setSavedValue(value)
          return
        }
        if (saved) {
          setFile(saved)
          setFileName(saved.name)
        }
        setSavedValue(value)
        notify('已保存')
      } catch (error) {
        notify(error instanceof UserCancelled ? '已取消' : `保存失败：${String(error)}`)
      }
    },
    [file, notify, value],
  )

  const handleNew = useCallback(() => {
    if (dirty && !window.confirm('当前文档还没保存，确定新建吗？')) return
    const blank = '# 未命名\n\n'
    editorRef.current?.setDocument(blank)
    setSavedValue(blank)
    setFile(null)
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) {
        if (event.key === 'Escape') {
          (document.activeElement as HTMLElement | null)?.blur()
        }
        return
      }

      const key = event.key.toLowerCase()
      const run = (fn: () => void) => {
        event.preventDefault()
        fn()
      }

      if (event.shiftKey) {
        if (key === 'k') return run(commands.deleteLine)
        if (key === 's') return run(() => void handleSave(true))
        if (key === '\\') return run(() => setSidebarOpen((open) => !open))
        return
      }

      switch (key) {
        case 'b':
          return run(commands.bold)
        case 'i':
          return run(commands.italic)
        case 'e':
          return run(commands.code)
        case 'k':
          return run(commands.link)
        case 's':
          return run(() => void handleSave(false))
        case 'o':
          return run(() => void handleOpen())
        case 'n':
          return run(handleNew)
        default:
          if (key >= '1' && key <= '6') return run(commands.heading(Number(key)))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commands, handleNew, handleOpen, handleSave])

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
            onClick={() =>
              downloadHtml(renderMarkdown(value), fileName, fileName.replace(/\.\w+$/, ''))
            }
          >
            导出 HTML
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => downloadAsFile(value, fileName)}
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
          {supportsFileSystemAccess() ? '支持写回原文件' : '浏览器不支持写回，保存即下载'}
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
