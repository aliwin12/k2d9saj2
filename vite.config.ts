import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'copy-root-call-mp3-assets',
        closeBundle() {
          for (const file of ['call.mp3', 'incomingcall.mp3']) {
            const rootSrc = path.resolve(__dirname, file);
            const distDest = path.resolve(__dirname, 'dist', file);
            if (fs.existsSync(rootSrc) && fs.existsSync(path.resolve(__dirname, 'dist'))) {
              fs.copyFileSync(rootSrc, distDest);
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
