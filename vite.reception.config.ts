// Booth (/), operator page (/operator.html) and the contract test page (/tools/queue-test.html) → dist/reception,
// served only by the reception PC's server. The MediaPipe wasm files are copied next to them so the booth works
// offline; the hand model comes from reception/public/models.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, process.env.SPACELINE_OUT || 'dist');
const outDir = path.join(out, 'reception');

// FilesetResolver.forVisionTasks() loads its wasm from a folder URL, not through an import
function copyMediapipeWasm(): Plugin {
  return {
    name: 'copy-mediapipe-wasm',
    apply: 'build',
    closeBundle() {
      const from = path.join(here, 'node_modules/@mediapipe/tasks-vision/wasm');
      const to = path.join(outDir, 'mediapipe/wasm');
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
    },
  };
}

export default defineConfig({
  root: path.join(here, 'reception'),
  publicDir: path.join(here, 'reception/public'),
  define: { __SPACELINE_ENV__: JSON.stringify(process.env.SPACELINE_ENV || 'product') },
  plugins: [copyMediapipeWasm()],
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500, // three.js + MediaPipe make one big booth bundle; that's expected
    rollupOptions: {
      input: {
        booth: path.join(here, 'reception/index.html'),
        operator: path.join(here, 'reception/operator.html'),
        'queue-test': path.join(here, 'reception/tools/queue-test.html'),
      },
    },
  },
});
