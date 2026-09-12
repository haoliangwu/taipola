// The editor's CSS is a contract (`.blk[data-kind='table'] .vl-table` must be a
// grid, list blocks must reset the counter). Loading it makes computed-style
// assertions in tests real instead of vacuous.
import '../styles.css'
import { afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { page } from 'vitest/browser'

/**
 * A desktop viewport by default, because the desktop is the product's primary
 * target.
 *
 * The runner's own default is phone-sized (~414px), which quietly put every test
 * in this project below the shell's 900px breakpoint: the outline, the format
 * toolbar and the desktop command group were all hidden while suites asserted
 * about the editor and the shell. Layout is part of what these tests measure (a
 * soft break shares one visual line because the column is wide; clicks are aimed
 * with real rectangles), so the width is stated here instead of inherited.
 *
 * Tests that ARE about the narrow layout opt in with `page.viewport(...)` and put
 * this width back — see `src/shell/mobileShell.test.tsx`.
 */
beforeAll(async () => {
  await page.viewport(1280, 800)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})