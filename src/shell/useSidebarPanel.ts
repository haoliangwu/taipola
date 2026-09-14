import { useEffect, useState } from 'react'

/** Which half of the sidebar is on screen. */
export type SidebarPanel = 'files' | 'outline'

const STORAGE_KEY = 'taipola:sidebar-panel'

function storedPanel(): SidebarPanel {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'files') return 'files'
  } catch {
    /* private mode — fall through to the default */
  }
  return 'outline'
}

/**
 * The sidebar's two panels: the folder tree and the document outline.
 *
 * The choice is a preference about how someone works, not a property of the
 * document, so it is remembered the way the theme is. A fresh session still
 * starts on the outline: no folder is open yet, and an empty tree is a worse
 * first impression than a table of contents.
 */
export function useSidebarPanel() {
  const [panel, setPanel] = useState<SidebarPanel>(storedPanel)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, panel)
    } catch {
      /* preference is best-effort */
    }
  }, [panel])

  return { panel, setPanel }
}
