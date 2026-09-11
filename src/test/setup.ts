// The editor's CSS is a contract (`.blk[data-kind='table'] .vl-table` must be a
// grid, list blocks must reset the counter). Loading it makes computed-style
// assertions in tests real instead of vacuous.
import '../styles.css'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  localStorage.clear()
})