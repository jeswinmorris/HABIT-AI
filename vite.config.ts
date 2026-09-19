import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

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
    outDir: 'dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    // vosk-browser MUST be pre-bundled (UMD bundle published under an ESM "module" field).
    // onnxruntime-web / piper must NOT be: they resolve their .wasm at runtime relative to the
    // bundle, and rolling them into the optimizer breaks that lookup. They stay dynamic imports.
    include: ['vosk-browser'],
    exclude: ['onnxruntime-web', '@mintplex-labs/piper-tts-web']
  },
  worker: {
    format: 'es'
  }
})