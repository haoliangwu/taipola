/**
 * React shell around the native editor kernel.
 *
 * This component renders the editable HOST element and nothing else. It never
 * renders children into it — the kernel (`src/editor/kernel.ts`) owns everything
 * below the host — so React and the browser can no longer fight over the same
 * DOM. Props are mirrored into the kernel through effects; the kernel reports
 * edits back through `onChange`.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorKernel, type BreakKind } from '../../editor/kernel'
import type { EditBuffers } from '../../core/editCommands'
import type { TableMenuState } from './TableMenu'

export interface EditorHandle {
  /** Moves the caret to the given 1-based source line and scrolls it into view. */
  goToLine: (line: number) => void
  focus: () => void
  /** Applies a source-level edit at the current selection. */
  applyEdit: (mutate: (buffer: EditBuffers) => void) => void
  /**
   * Applies a source-level edit to the whole document, at document offsets. For
   * edits that need to see past the caret's own block (the table commands).
   */
  applyDocumentEdit: (
    mutate: (doc: string, caret: number) => { doc: string; caret: number } | null,
  ) => void
  /** ⌘]/⌘[: list indent/outdent plus Typora's paragraph outdent, at the DOM selection. */
  applyIndent: (direction: 'in' | 'out') => void
  /** Replaces the whole document (opening a file, creating a new one). */
  setDocument: (text: string) => void
  /** Read-only session separator identities; the cut-1 acceptance matrix reads them. */
  getKinds: () => Map<number, BreakKind>
  /** Model caret offset; the IME cells assert the composition anchor rides clicks. */
  getCaret: () => number | null
  /** True while an IME composition is open. */
  isComposing: () => boolean
}

interface EditorProps {
  value: string
  onChange: (value: string) => void
  onCaretLineChange?: (line: number) => void
  /**
   * A right-click inside a TABLE, with the table's shape. Null-returning means
   * "not in a table", and the browser's own menu is left alone.
   */
  onTableMenu?: (state: TableMenuState) => void
  /**
   * Renders a markdown slice to the sanitized HTML the clipboard carries as
   * `text/html` beside the plain markdown (Typora's rich ⌘C). Passed through
   * to the kernel; omitted, copy stays plain-only.
   */
  renderClipboardHtml?: (markdown: string) => string
  readOnly?: boolean
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { value, onChange, onCaretLineChange, onTableMenu, renderClipboardHtml, readOnly = false },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const kernelRef = useRef<EditorKernel | null>(null)
  // Latest callbacks, read by the kernel without re-mounting it.
  const hooks = useRef({ onChange, onCaretLineChange, onTableMenu, renderClipboardHtml })
  hooks.current = { onChange, onCaretLineChange, onTableMenu, renderClipboardHtml }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const kernel = new EditorKernel({
      value,
      readOnly,
      onChange: (next) => hooks.current.onChange(next),
      onCaretLineChange: (line) => hooks.current.onCaretLineChange?.(line),
      renderClipboardHtml: (slice) => hooks.current.renderClipboardHtml?.(slice),
    })
    kernel.mount(host)
    kernelRef.current = kernel
    return () => {
      kernel.destroy()
      kernelRef.current = null
    }
    // Mount once: the kernel outlives every prop change and owns the DOM below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    kernelRef.current?.setReadOnly(readOnly)
  }, [readOnly])

  useEffect(() => {
    const kernel = kernelRef.current
    // Only an EXTERNAL change (file open, new document) may replace the model —
    // echoing our own `onChange` back through props must not reset the caret.
    if (kernel && kernel.getDoc() !== value) kernel.setDocument(value)
  }, [value])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => kernelRef.current?.focus(),
      goToLine: (line) => kernelRef.current?.goToLine(line),
      applyEdit: (mutate) => kernelRef.current?.applyEdit(mutate),
      applyDocumentEdit: (mutate) => kernelRef.current?.applyDocumentEdit(mutate),
      applyIndent: (direction) => kernelRef.current?.applyIndent(direction),
      setDocument: (text) => kernelRef.current?.setDocument(text),
      getKinds: () => kernelRef.current?.getKinds() ?? new Map(),
      getCaret: () => kernelRef.current?.getCaret() ?? null,
      isComposing: () => kernelRef.current?.isComposing() ?? false,
    }),
    [],
  )

  return (
    <div
      className="doc"
      ref={hostRef}
      contentEditable={!readOnly}
      role="textbox"
      aria-multiline="true"
      aria-label="Markdown 编辑器"
      spellCheck={false}
      // Right-clicking inside a table opens the table's own menu. The caret is
      // already where the click was: the button-2 `mousedown` runs the kernel's
      // hit test before `contextmenu` arrives.
      onContextMenu={(event) => {
        const table = kernelRef.current?.tableAtCaret()
        if (!table) return
        event.preventDefault()
        hooks.current.onTableMenu?.({ x: event.clientX, y: event.clientY, context: table })
      }}
    />
  )
})
