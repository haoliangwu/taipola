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
import { EditorKernel } from '../../editor/kernel'
import type { EditBuffers } from '../../core/editCommands'

export interface EditorHandle {
  /** Moves the caret to the given 1-based source line and scrolls it into view. */
  goToLine: (line: number) => void
  focus: () => void
  /** Applies a source-level edit at the current selection. */
  applyEdit: (mutate: (buffer: EditBuffers) => void) => void
  /** Replaces the whole document (opening a file, creating a new one). */
  setDocument: (text: string) => void
}

interface EditorProps {
  value: string
  onChange: (value: string) => void
  onCaretLineChange?: (line: number) => void
  readOnly?: boolean
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { value, onChange, onCaretLineChange, readOnly = false },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const kernelRef = useRef<EditorKernel | null>(null)
  // Latest callbacks, read by the kernel without re-mounting it.
  const hooks = useRef({ onChange, onCaretLineChange })
  hooks.current = { onChange, onCaretLineChange }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const kernel = new EditorKernel({
      value,
      readOnly,
      onChange: (next) => hooks.current.onChange(next),
      onCaretLineChange: (line) => hooks.current.onCaretLineChange?.(line),
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
      setDocument: (text) => kernelRef.current?.setDocument(text),
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
    />
  )
})
