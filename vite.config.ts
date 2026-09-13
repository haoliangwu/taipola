import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * The app is published as a *project* page, at https://haoliangwu.github.io/taipola/,
 * so production assets must be requested from `/taipola/`. With the default base a
 * browser looks them up at the domain root, gets a 404, and the page comes up blank.
 *
 * `vite preview` serves that same build output, so it has to take the base too —
 * otherwise `pnpm preview` is the one place the production artifact is wrong. `vite`
 * itself keeps the root, so `pnpm dev` stays on http://localhost:5178/ (AGENTS.md).
 *
 * PWA (`.scratch/pwa/issues/01`): manifest + service worker come from
 * `vite-plugin-pwa`, so every generated URL (manifest link, icon srcs, SW scope)
 * inherits the base and stays inside /taipola/. `registerType: 'prompt'` because
 * this is an EDITOR: autoUpdate could reload mid-typing, and a dirty draft is
 * worth more than a silent update. Offline navigation falls back to the
 * precached index.html — the whole app is static, so offline is full-featured.
 */
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/taipola/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'taipola',
        short_name: 'taipola',
        description: '极简但强大的 Markdown 编辑器',
        lang: 'zh-CN',
        display: 'standalone',
        start_url: './',
        scope: './',
        // One colour for both themes: the light background, a known tradeoff
        // (the app has dark mode; colour-scheme is already declared in
        // index.html — see the ticket's comments).
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: './pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: './pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: './pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: './maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    port: 5178,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
}))
