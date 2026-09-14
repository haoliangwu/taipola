/**
 * Shared stubs for shell tests: keeps the REAL folder memory out of a test.
 *
 * The folder memory's own tests (platform/savedFolder.test.ts) exercise the
 * real IndexedDB with per-test databases. Shell tests only ever fake the
 * verdict (`probe` → none/restorable/offered), and they do it identically in
 * App.test.tsx and mobileShell.test.tsx — the repeated four-line spy block they
 * used to carry lived here once.
 */
import { vi } from 'vitest'
import { savedFolder, type SavedFolderStatus } from '../platform/savedFolder'

/**
 * Replaces every method of the folder memory with a fake, so a pick never
 * writes and a mount never reads a record left by another test.
 */
export function stubSavedFolder(status: SavedFolderStatus = { status: 'none' }, authorize = true): void {
  vi.spyOn(savedFolder, 'probe').mockResolvedValue(status)
  vi.spyOn(savedFolder, 'save').mockResolvedValue()
  vi.spyOn(savedFolder, 'rememberFile').mockResolvedValue()
  vi.spyOn(savedFolder, 'clear').mockResolvedValue()
  vi.spyOn(savedFolder, 'authorize').mockResolvedValue(authorize)
}
