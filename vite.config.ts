import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The app is published as a *project* page, at https://haoliangwu.github.io/taipola/,
 * so production assets must be requested from `/taipola/`. With the default base a
 * browser looks them up at the domain root, gets a 404, and the page comes up blank.
 *
 * `vite preview` serves that same build output, so it has to take the base too —
 * otherwise `pnpm preview` is the one place the production artifact is wrong. `vite`
 * itself keeps the root, so `pnpm dev` stays on http://localhost:5178/ (AGENTS.md).
 */
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/taipola/' : '/',
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
}))
