import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// MediaPipe loads its WebAssembly from a folder URL rather than through an import, so the folder is served in dev
// and copied into the build, next to the pages: the booth needs no network.
const MEDIAPIPE_WASM = path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
function mediapipeWasm(): Plugin {
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const file = path.join(MEDIAPIPE_WASM, path.basename((req.url ?? '').split('?')[0]));
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      const to = path.join(options.dir ?? 'dist', 'mediapipe/wasm');
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(MEDIAPIPE_WASM)) fs.copyFileSync(path.join(MEDIAPIPE_WASM, f), path.join(to, f));
    },
  };
}

export default defineConfig({
  plugins: [mediapipeWasm()],
  build: {
    rollupOptions: { input: { minigame: 'index.html', stall: 'stall.html' } },
    // Jolt's WebAssembly comes embedded in one ~3.6 MB chunk, loaded only when the stall switches to Jolt
    chunkSizeWarningLimit: 3700,
  },
});
