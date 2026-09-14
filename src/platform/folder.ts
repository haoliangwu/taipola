/**
 * Folder access, as one interface.
 *
 * The folder a document lives in is a different axis from the document itself
 * (`documents.ts`: how one document is opened, written and exported), so it is a
 * different module: the tree needs to open a directory and read ONE level of it,
 * and never needs to know how a document is saved.
 *
 * Reading a FILE is deliberately not here. A file clicked in the tree is opened
 * through the document seam, which is what it already does with a picked file —
 * carrying the content, the handle and the modification time back as one result.
 * A second reader here would be a second place for those three to disagree.
 *
 * Everything the browser exposes is behind `fileSystemAccessFolders(api)` so the
 * path walking and the entry shape can be tested against a fake API; the seam is
 * the interface above it.
 */
import { childPath } from '../core/fileTree'
import { isAbort } from './abort'

/** A directory the user opened. One at a time, replaced when another is picked. */
export interface FolderRoot {
  readonly name: string
  readonly handle: unknown
}

/** One row of a directory, as the platform reports it — unfiltered and unsorted. */
export interface FolderEntry {
  readonly name: string
  /** Path relative to the folder root, `/`-separated. */
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly handle: unknown
}

export interface Folders {
  /** Whether this platform can open a folder at all. */
  canOpen(): boolean
  /** Shows the directory picker. `null` when the user declines. */
  pick(): Promise<FolderRoot | null>
  /**
   * Lists ONE directory — the root when `path` is `''`. Children are not read:
   * the tree reads a level when the user opens it, and not before. Rejects when
   * the directory cannot be read (permission withdrawn, folder moved).
   */
  list(root: FolderRoot, path: string): Promise<FolderEntry[]>
}

/**
 * The directory half of the File System Access surface we use.
 *
 * Declared here rather than imported: TypeScript's DOM lib ships the directory
 * types behind a flag, and this shape is the adapter's private business.
 */
interface DirectoryHandleLike {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterableIterator<FileHandleLike | DirectoryHandleLike>
  getDirectoryHandle(name: string): Promise<DirectoryHandleLike>
}

interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: { id?: string }) => Promise<DirectoryHandleLike>
}

export function fileSystemAccessFolders(api: DirectoryPickerWindow): Folders {
  return {
    canOpen: () => typeof api.showDirectoryPicker === 'function',

    async pick() {
      const show = api.showDirectoryPicker
      if (typeof show !== 'function') return null
      try {
        // Its own picker id: remembering the last folder must not fight with
        // remembering the last document (`documents.ts` uses `taipola-doc`).
        const handle = await show({ id: 'taipola-folder' })
        return { name: handle.name, handle }
      } catch (error) {
        if (isAbort(error)) return null
        throw error
      }
    },

    async list(root, path) {
      const directory = await directoryAt(root.handle as DirectoryHandleLike, path)
      const entries: FolderEntry[] = []
      for await (const handle of directory.values()) {
        entries.push({
          name: handle.name,
          path: childPath(path, handle.name),
          kind: handle.kind,
          handle,
        })
      }
      return entries
    },
  }
}

/** Walks down from the root: one `getDirectoryHandle` per path segment. */
async function directoryAt(root: DirectoryHandleLike, path: string): Promise<DirectoryHandleLike> {
  let directory = root
  for (const segment of path === '' ? [] : path.split('/')) {
    directory = await directory.getDirectoryHandle(segment)
  }
  return directory
}

/** The browser's folder access, on the API this platform has. */
export const folders: Folders = fileSystemAccessFolders(
  window as unknown as DirectoryPickerWindow,
)
