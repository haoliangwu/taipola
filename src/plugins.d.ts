// Type shims for markdown-it plugins that ship without declarations, and for
// the Vite client types used by the app.

declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it'
  const plugin: MarkdownIt.PluginSimple
  export default plugin
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'
  const plugin: MarkdownIt.PluginWithOptions<{
    enabled?: boolean
    label?: boolean
    labelAfter?: boolean
  }>
  export default plugin
}
