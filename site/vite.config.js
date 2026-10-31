import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The landing page builds to dist/site and is served by `relay dashboard` at /.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('../dist/site', import.meta.url)), emptyOutDir: true, assetsInlineLimit: 0 },
});
