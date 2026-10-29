// Phone registration page → dist/hosting (published to Firebase Hosting as it is).
// Its assets go under /register/assets/, so they never clash with the booth's /assets/ on the reception server.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, process.env.SPACELINE_OUT || 'dist');

export default defineConfig({
  root: path.join(here, 'hosting'),
  publicDir: false,
  define: { __SPACELINE_ENV__: JSON.stringify(process.env.SPACELINE_ENV || 'product') },
  build: {
    outDir: path.join(out, 'hosting'),
    emptyOutDir: true,
    assetsDir: 'register/assets',
    chunkSizeWarningLimit: 1500, // the Firebase SDK (loaded only in the Firebase environment) is large
    rollupOptions: { input: { register: path.join(here, 'hosting/register/index.html') } },
  },
});
