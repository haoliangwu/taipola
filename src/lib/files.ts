/**
 * File access helpers.
 *
 * Prefers the File System Access API (real "Save" back to the same handle,
 * like a desktop app); falls back to <input type=file> + Blob download where it
 * is unavailable (Firefox, Safari).
 */

export interface DocumentFile {
  name: string
  handle: FileSystemFileHandle | null
}

export interface FileSystemFileHandle {
  readonly name: string
  getFile(): Promise<File>
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

export interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>
  close(): Promise<void>
}

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  multiple?: boolean
  id?: string
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: FilePickerAcceptType[]
  id?: string
}

interface FileSystemAccessWindow {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
}

const MD_TYPES: FilePickerAcceptType[] = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.txt'] } },
]

export const supportsFileSystemAccess = (): boolean =>
  typeof (window as FileSystemAccessWindow).showOpenFilePicker === 'function'

function pickers(): FileSystemAccessWindow {
  return window as unknown as FileSystemAccessWindow
}

export class UserCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'UserCancelled'
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Opens a file via the picker; returns null when the user cancels. */
export async function openFile(): Promise<{ file: DocumentFile; content: string } | null> {
  const api = pickers()

  if (api.showOpenFilePicker) {
    try {
      const [handle] = await api.showOpenFilePicker({ types: MD_TYPES, id: 'taipola-doc' })
      const file = await handle.getFile()
      return { file: { name: handle.name, handle }, content: await file.text() }
    } catch (error) {
      if (isAbort(error)) return null
      throw error
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.mdown,.txt,text/markdown,text/plain'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      resolve({ file: { name: file.name, handle: null }, content: await file.text() })
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * Writes `content` to `handle` when we hold one, otherwise downloads it.
 * Returns the (possibly newly created) file identity.
 */
export async function saveFile(
  content: string,
  current: DocumentFile | null,
  forcePicker = false,
): Promise<DocumentFile | null> {
  const api = pickers()

  if (api.showSaveFilePicker && (forcePicker || !current?.handle)) {
    try {
      const handle = await api.showSaveFilePicker({
        suggestedName: current?.name ?? 'untitled.md',
        types: MD_TYPES,
        id: 'taipola-doc',
      })
      await writeHandle(handle, content)
      return { name: handle.name, handle }
    } catch (error) {
      if (isAbort(error)) return null
      throw error
    }
  }

  if (current?.handle) {
    await writeHandle(current.handle, content)
    return current
  }

  downloadAsFile(content, current?.name ?? 'untitled.md')
  return current
}

async function writeHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  const permission = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
  if (permission !== 'granted') {
    const requested = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied'
    if (requested !== 'granted') throw new UserCancelled()
  }
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

export function downloadAsFile(content: string, name: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name.endsWith('.md') ? name : `${name}.md`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Exports the rendered document as a standalone HTML file. */
export function downloadHtml(bodyHtml: string, name: string, title: string): void {
  const doc = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title.replace(/[<>&]/g, '')}</title>
<style>
  body { max-width: 44rem; margin: 4rem auto; padding: 0 1.5rem;
         font: 16px/1.75 -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
         color: #1c1c1e; }
  pre { background: #f6f6f4; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  code { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: .9em; }
  blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid #d8d8d6; color: #6b6b70; }
  table { border-collapse: collapse; } th, td { border: 1px solid #e2e2df; padding: .4em .8em; }
  img { max-width: 100%; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`
  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name.replace(/\.(md|markdown|mdown|txt)$/i, '') + '.html'
  anchor.click()
  URL.revokeObjectURL(url)
}

const DRAFT_KEY = 'taipola:draft'

export interface Draft {
  content: string
  name: string
  savedAt: number
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Draft
    if (typeof parsed?.content !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    /* quota exceeded or private mode — drafts are best-effort */
  }
}
