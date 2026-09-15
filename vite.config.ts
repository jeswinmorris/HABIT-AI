import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// NOTE: this file must live at the project root. It used to sit in src/vite.config.mts,
// where Vite never picked it up — so `base: './'` was lost and the packaged Electron app
// (loadFile -> dist/index.html) requested /assets/* from the filesystem root and showed a
// blank window.
export default defineConfig({
  plugins: [react()],
  base: './',
  assetsInclude: ['**/*.onnx', '**/*.wasm', '**/*.data'],
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    // vosk-browser ships a UMD bundle while its package.json claims an ESM "module", so it
    // MUST be pre-bundled — excluding it makes `npm run dev` die with
    // "does not provide an export named 'createModel'" and the whole app never mounts.
    // vosk-browser MUST be pre-bundled (UMD bundle under an ESM "module" field); piper is left
    // alone on purpose — it is real ESM and pulling onnxruntime into the optimizer makes the
    // very first page load block for a long time.
    include: ['vosk-browser'],
  },
  worker: {
    format: 'es'
  }
})
