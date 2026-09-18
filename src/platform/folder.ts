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
 * Resolving a file's HANDLE by path IS here (`fileAt`): that is path walking,
 * the tree's own business, and it is what the "last opened file" memory needs
 * when a reload has only the path to go on.
 *
 * Everything the browser exposes is behind `fileSystemAccessFolders(api)` so the
 * path walking and the entry shape can be tested against a fake API; the seam is
 * the interface above it.
 */
import { childPath, lastSegment, parentOf } from '../core/fileTree'
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
  /**
   * Resolves ONE file inside the folder by its path, re-finding the handle the
   * tree would show for it. `null` when the path no longer resolves — renamed,
   * moved, deleted, or a segment is the wrong kind. Only the HANDLE is found
   * here; reading the content is the document seam's (`documents.openEntry`).
   */
  fileAt(root: FolderRoot, path: string): Promise<FolderEntry | null>
  /**
   * Creates an EMPTY file by name inside a directory. Throws on permission
   * failure. When the name already exists the browser hands back the existing
   * handle silently — callers check the name against the tree before asking.
   */
  createFile(root: FolderRoot, path: string, name: string): Promise<FolderEntry>
  /**
   * Removes the FILE at a path. Deliberately files only: a directory removal is
   * a whole-tree decision this seam does not get to make. Throws on permission
   * failure. There is no undo — the filesystem has no recycle bin here.
   */
  removeFile(root: FolderRoot, path: string): Promise<void>
  /**
   * Renames the FILE at a path, in place. `move()` — the only rename the File
   * System API offers — exists on file handles only, so this is files only too.
   * Throws on permission failure; the browser rejects a move onto an existing
   * name, so callers check first.
   */
  renameFile(root: FolderRoot, path: string, newName: string): Promise<void>
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
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  removeEntry(name: string): Promise<void>
}

interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
  /** The File System API's rename: move within (or across) directories. */
  move(parent: DirectoryHandleLike, newName?: string): Promise<void>
  /** Removes this entry. Files only in this seam — the directory half is the
      caller's shape to decide about, via `removeEntry`. */
  remove(): Promise<void>
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

    async fileAt(root, path) {
      if (path === '') return null
      const segments = path.split('/')
      const name = segments.pop()!
      try {
        // The parent walk is `directoryAt`'s job — one getDirectoryHandle per
        // segment — so this cannot drift from `list`'s segment semantics.
        const directory = await directoryAt(root.handle as DirectoryHandleLike, segments.join('/'))
        const handle = await directory.getFileHandle(name)
        return { name, path, kind: 'file', handle }
      } catch (error) {
        if (isMissingPath(error)) return null
        throw error
      }
    },

    async createFile(root, path, name) {
      const directory = await directoryAt(root.handle as DirectoryHandleLike, path)
      // `create: true` returns the EXISTING file when the name is taken — the
      // browsers' silent behaviour, so callers must have checked the name first.
      const handle = await directory.getFileHandle(name, { create: true })
      return { name, path: childPath(path, name), kind: 'file', handle }
    },

    async removeFile(root, path) {
      const directory = await directoryAt(root.handle as DirectoryHandleLike, parentOf(path))
      const handle = await directory.getFileHandle(lastSegment(path))
      await handle.remove()
    },

    async renameFile(root, path, newName) {
      const directory = await directoryAt(root.handle as DirectoryHandleLike, parentOf(path))
      const handle = await directory.getFileHandle(lastSegment(path))
      // Moving a file onto its own directory with a new name IS the rename: the
      // File System API has no other. The handle stays the same entry afterwards.
      await handle.move(directory, newName)
    },
  }
}

/**
 * The signals that "this path has no file here": a missing name, or a segment
 * whose kind does not match the step (a file walked as a directory, a directory
 * taken as the file). Browsers report them as NotFoundError / TypeMismatchError
 * or a TypeError, depending on the era of the API.
 */
function isMissingPath(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError'))
  )
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
