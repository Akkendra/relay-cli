import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Builds to dist/dashboard, which `relay dashboard` serves. `npm run dev:dashboard` proxies /api to a running
// dashboard server; changeOrigin makes the proxied Host match the server's loopback allowlist.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('../dist/dashboard', import.meta.url)), emptyOutDir: true, assetsInlineLimit: 0 },
  server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: true } } },
});
