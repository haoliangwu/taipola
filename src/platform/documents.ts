/**
 * File access, as one interface.
 *
 * Two adapters sit behind it, and that is what makes the seam real rather than
 * hypothetical:
 *
 * - the **write-back adapter**, on the File System Access API, can save into the
 *   file the user already opened (or ask for a new destination);
 * - the **download adapter**, for browsers without it (Firefox, Safari), can
 *   read a file but can only ever hand one back as a download.
 *
 * Which one is in play is the adapter's business, not the caller's. The shell
 * used to learn it from `supportsFileSystemAccess()` and branch three times —
 * open, save, status-bar sentence — and had to catch a `UserCancelled`
 * exception to tell "the user declined" apart from a real failure. Neither
 * survives this interface: declining is a returned result, and the capability
 * question is asked exactly once, as `supportsWriteBack()`, to pick one sentence
 * of status-bar text.
 *
 * The save policy itself (write back when we hold a file; pick a destination on
 * "save as" or for a new document; download otherwise) is shared and lives here,
 * so the two adapters only supply the primitives that actually differ.
 */
import { localStorageDraft, type DraftStore } from './draft'
import { renderStandaloneHtml } from './html'

const DEFAULT_NAME = 'untitled.md'
const MARKDOWN_MIME = 'text/markdown;charset=utf-8'
const HTML_MIME = 'text/html;charset=utf-8'

const MD_TYPES: FilePickerAcceptType[] = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.txt'] } },
]

/**
 * The identity of an open document.
 *
 * The shell holds this, hands it back to `save`/`exportHtml`, and reads `name`
 * for display. Nothing else about it is part of the interface.
 */
export interface OpenDocument {
  /** Display name: title bar, status bar, export filename. */
  readonly name: string
  /**
   * The adapter's own handle — a `FileSystemFileHandle` on the write-back side,
   * `null` on the download side.
   *
   * Deliberately not part of the interface: "do we hold a writable handle?" is
   * the adapter's question, and asking it from the shell is precisely how the
   * shell ended up branching on the platform.
   */
  readonly handle: unknown
}

export type OpenResult =
  | { status: 'opened'; document: OpenDocument; content: string }
  /** The user dismissed the picker. */
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown }

export type SaveResult =
  /** Written back to the file we hold. */
  | { status: 'saved'; document: OpenDocument }
  /** Handed to the browser as a download, because this platform cannot write back. */
  | { status: 'downloaded'; name: string }
  /** The user declined — dismissed the picker, or refused the write permission. */
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown }

export interface Documents {
  open(): Promise<OpenResult>
  /**
   * Saves `text` as `doc`'s file, or as a new one when there is no `doc` or
   * `forcePicker` asks for "save as".
   *
   * `name` is the shell's display name, and it is the same rule `exportHtml`
   * states below: a document can have a name without having a handle. Without it
   * the welcome document was shown as `welcome.md` while the save picker offered
   * `untitled.md`, because the only name this layer could see was the absent one.
   */
  save(
    doc: OpenDocument | null,
    text: string,
    options?: { forcePicker?: boolean; name?: string },
  ): Promise<SaveResult>
  /**
   * Downloads the rendered document as a standalone HTML file named after
   * `name` — the document's DISPLAY name, which the shell owns.
   *
   * The name is a plain string rather than the document handle on purpose. The
   * handle only exists once a file has been picked or saved, while the shell
   * always has a display name (it shows one in the title bar, and a draft
   * restored on load has a name but no handle). Asking for the handle here made
   * a restored draft export as `untitled.html`.
   */
  exportHtml(source: string, name: string): void
  /** Downloads the markdown source as a `.md` file named after `name`. */
  exportMarkdown(text: string, name: string): void
  /** Whether a save can reach the same file again — for the status-bar sentence. */
  supportsWriteBack(): boolean
  draft: DraftStore
}

/* -------------------------------------------------------------------------- */
/* the adapter seam                                                           */
/* -------------------------------------------------------------------------- */

/** What a picker handed back: a readable file and the handle that identifies it. */
interface PickedFile {
  name: string
  content: string
  handle: unknown
}

/** A destination the user chose: a name and the handle to write through. */
interface PickedTarget {
  name: string
  handle: unknown
}

interface AdapterBase {
  /** Shows the open picker. `null` when the user declines. */
  pickOpen(): Promise<PickedFile | null>
  /** Hands `text` to the browser as a download. */
  download(text: string, filename: string, mime: string): void
}

/** The File System Access adapter: a picked file stays writable. */
export interface WriteBackAdapter extends AdapterBase {
  writeBack: true
  /** Shows the save picker. `null` when the user declines. */
  pickSave(suggestedName: string): Promise<PickedTarget | null>
  /** Writes through a handle. `false` when the user refuses the permission. */
  write(handle: unknown, text: string): Promise<boolean>
}

/** The fallback adapter: <input type=file> for reading, downloads for writing. */
export interface DownloadAdapter extends AdapterBase {
  writeBack: false
}

/**
 * The seam the two adapters implement. Modelled as a union rather than one
 * interface with optional methods so that the save policy's `writeBack` check
 * narrows the type: the download adapter has no `pickSave`/`write` to call by
 * accident.
 */
export type StorageAdapter = WriteBackAdapter | DownloadAdapter

/* -------------------------------------------------------------------------- */
/* the shared policy                                                          */
/* -------------------------------------------------------------------------- */

export function createDocuments(adapter: StorageAdapter): Documents {
  return {
    async open() {
      try {
        const picked = await adapter.pickOpen()
        if (!picked) return { status: 'cancelled' }
        return {
          status: 'opened',
          document: { name: picked.name, handle: picked.handle },
          content: picked.content,
        }
      } catch (error) {
        return { status: 'failed', error }
      }
    },

    async save(doc, text, options = {}) {
      const forcePicker = options.forcePicker ?? false
      const name = doc?.name ?? options.name ?? DEFAULT_NAME

      try {
        if (!adapter.writeBack) {
          adapter.download(text, markdownFileName(name), MARKDOWN_MIME)
          return { status: 'downloaded', name }
        }

        if (forcePicker || !doc) {
          const target = await adapter.pickSave(name)
          if (!target) return { status: 'cancelled' }
          if (!(await adapter.write(target.handle, text))) return { status: 'cancelled' }
          return { status: 'saved', document: { name: target.name, handle: target.handle } }
        }

        if (!(await adapter.write(doc.handle, text))) return { status: 'cancelled' }
        return { status: 'saved', document: doc }
      } catch (error) {
        return { status: 'failed', error }
      }
    },

    exportHtml(source, name) {
      adapter.download(renderStandaloneHtml(source, baseName(name)), htmlFileName(name), HTML_MIME)
    },

    exportMarkdown(text, name) {
      adapter.download(text, markdownFileName(name), MARKDOWN_MIME)
    },

    supportsWriteBack: () => adapter.writeBack,

    draft: localStorageDraft,
  }
}

/**
 * The document's name without a markdown extension: `report.md` → `report`.
 *
 * Only the extensions this editor opens are stripped, so a name that merely
 * contains a dot keeps it (`notes.v2` → `notes.v2.html`). Used for both the
 * exported file's name and its `<title>`.
 */
function baseName(name: string): string {
  return name.replace(/\.(md|markdown|mdown|txt)$/i, '')
}

/** `report.txt` → `report.html`; a name with no markdown extension just gets `.html`. */
function htmlFileName(name: string): string {
  return `${baseName(name)}.html`
}

/** `report.txt` → `report.md`; a name that already ends in `.md` is kept. */
function markdownFileName(name: string): string {
  return name.endsWith('.md') ? name : `${name}.md`
}

/* -------------------------------------------------------------------------- */
/* the browser adapters                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The File System Access surface we use.
 *
 * Declared here rather than imported: TypeScript's DOM lib does not ship
 * `showOpenFilePicker`, and this shape is the adapter's private business — it is
 * not part of the interface above.
 */
interface FileSystemFileHandle {
  readonly name: string
  getFile(): Promise<File>
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface FileSystemWritableFileStream extends WritableStream {
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

interface FilePickerWindow {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
}

/**
 * A dismissed picker is reported as an `AbortError`. Which failures mean "the
 * user declined" is the adapter's knowledge, so it is translated here rather
 * than leaking up as an exception the caller has to recognise.
 */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function fileSystemAccessAdapter(
  showOpen: NonNullable<FilePickerWindow['showOpenFilePicker']>,
  showSave: NonNullable<FilePickerWindow['showSaveFilePicker']>,
): WriteBackAdapter {
  return {
    writeBack: true,

    async pickOpen() {
      try {
        const [handle] = await showOpen({ types: MD_TYPES, id: 'taipola-doc' })
        const file = await handle.getFile()
        return { name: handle.name, content: await file.text(), handle }
      } catch (error) {
        if (isAbort(error)) return null
        throw error
      }
    },

    async pickSave(suggestedName) {
      try {
        const handle = await showSave({ suggestedName, types: MD_TYPES, id: 'taipola-doc' })
        return { name: handle.name, handle }
      } catch (error) {
        if (isAbort(error)) return null
        throw error
      }
    },

    async write(handle, text) {
      const target = handle as FileSystemFileHandle
      const permission = (await target.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
      if (permission !== 'granted') {
        const requested = (await target.requestPermission?.({ mode: 'readwrite' })) ?? 'denied'
        if (requested !== 'granted') return false
      }
      const writable = await target.createWritable()
      await writable.write(text)
      await writable.close()
      return true
    },

    download: downloadFile,
  }
}

function downloadAdapter(): DownloadAdapter {
  return {
    writeBack: false,

    pickOpen() {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.md,.markdown,.mdown,.txt,text/markdown,text/plain'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (!file) return resolve(null)
          resolve({ name: file.name, content: await file.text(), handle: null })
        }
        input.oncancel = () => resolve(null)
        input.click()
      })
    },

    download: downloadFile,
  }
}

function downloadFile(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function browserAdapter(): StorageAdapter {
  const api = window as unknown as FilePickerWindow
  if (typeof api.showOpenFilePicker === 'function' && typeof api.showSaveFilePicker === 'function') {
    return fileSystemAccessAdapter(api.showOpenFilePicker, api.showSaveFilePicker)
  }
  return downloadAdapter()
}

/** The browser's file access, on whichever adapter this platform has. */
export const documents: Documents = createDocuments(browserAdapter())
