import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: { input: { minigame: 'index.html', stall: 'stall.html' } },
    // Jolt's WebAssembly comes embedded in one ~3.6 MB chunk, loaded only when the stall switches to Jolt
    chunkSizeWarningLimit: 3700,
  },
});
