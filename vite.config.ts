import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: { input: { minigame: 'index.html', stall: 'stall.html' } },
  },
});
