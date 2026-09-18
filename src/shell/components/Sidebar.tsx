import type { Heading } from '../../core/markdown'
import type { FolderEntry } from '../../platform/folder'
import type { FileTreeState } from '../useFileTree'
import type { SidebarPanel } from '../useSidebarPanel'
import { FileTree, type TreeEditing } from './FileTree'
import { Outline } from './Outline'

interface SidebarProps {
  panel: SidebarPanel
  onPanelChange(panel: SidebarPanel): void
  /** Whether this platform can open a folder at all. */
  canOpenFolder: boolean
  tree: FileTreeState
  /** Path of the document on screen, relative to the folder root, or null. */
  activePath: string | null
  hasDraft(entry: FolderEntry): boolean
  onOpenEntry(entry: FolderEntry): void
  onOpenFolder(): void
  /** Starts a new document at the folder's root (the tree's top edit row). */
  onNewFile(): void
  /** The tree's inline edit currently on screen (held by the shell, like the
      tree menu itself — the component only draws the input). */
  editing: TreeEditing | null
  onRowMenu(entry: FolderEntry, x: number, y: number): void
  onEditSubmit(name: string): void
  onEditCancel(): void
  onTreeError(message: string): void
  headings: Heading[]
  activeLine: number
  onJump(line: number): void
}

/**
 * The sidebar: two panels answering two different questions.
 *
 * 「文件」 answers "what else is there to write" (the folder the user opened), and
 * 「大纲」 answers "what is in this one" (the document on screen). They are stacked
 * as segments rather than as one scrolling column because they are not sections
 * of the same list — sharing a scrollbar would leave both permanently half
 * visible.
 */
export function Sidebar({
  panel,
  onPanelChange,
  canOpenFolder,
  tree,
  activePath,
  hasDraft,
  onOpenEntry,
  onOpenFolder,
  onNewFile,
  editing,
  onRowMenu,
  onEditSubmit,
  onEditCancel,
  onTreeError,
  headings,
  activeLine,
  onJump,
}: SidebarProps) {
  return (
    <aside className="outline" aria-label="侧栏">
      <div className="sidebar-tabs" role="tablist" aria-label="侧栏面板">
        <PanelTab label="文件" active={panel === 'files'} onClick={() => onPanelChange('files')} />
        <PanelTab
          label="大纲"
          active={panel === 'outline'}
          onClick={() => onPanelChange('outline')}
        />
      </div>

      {panel === 'files' ? (
        <>
          <div className="outline-header sidebar-root">
            <span className="sidebar-root-name" title={tree.root?.name}>
              {tree.root?.name ?? '没有打开文件夹'}
            </span>
            <span className="sidebar-actions">
              {tree.root !== null && (
                <button type="button" className="sidebar-action" onClick={onNewFile}>
                  新建
                </button>
              )}
              {tree.root !== null && (
                <button type="button" className="sidebar-action" onClick={tree.refresh}>
                  刷新
                </button>
              )}
              {/* No button at all where the platform cannot open one: a control
                  that can only fail is worse than no control. */}
              {canOpenFolder && tree.resumePrompt && (
                <button type="button" className="sidebar-action" onClick={() => void tree.resume()}>
                  恢复上次的文件夹
                </button>
              )}
              {canOpenFolder && (
                <button type="button" className="sidebar-action" onClick={onOpenFolder}>
                  {tree.root === null ? '打开文件夹' : '换一个'}
                </button>
              )}
            </span>
          </div>
          {tree.root === null ? (
            <div className="outline-empty">
              {canOpenFolder
                ? '打开一个文件夹，就能在这里切换文档。'
                : '这个浏览器不能打开文件夹，只能一次打开一个文件。'}
            </div>
          ) : (
            <FileTree
              tree={tree}
              activePath={activePath}
              hasDraft={hasDraft}
              onOpen={onOpenEntry}
              editing={editing}
              onRowMenu={onRowMenu}
              onEditSubmit={onEditSubmit}
              onEditCancel={onEditCancel}
              onError={onTreeError}
            />
          )}
        </>
      ) : (
        <Outline headings={headings} activeLine={activeLine} onJump={onJump} />
      )}
    </aside>
  )
}

function PanelTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`sidebar-tab${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
