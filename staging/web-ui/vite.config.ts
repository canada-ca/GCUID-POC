import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

// Read build version from the shared version.json at the staging root
const versionFile = JSON.parse(readFileSync(path.resolve(__dirname, '../version.json'), 'utf-8'));
const BUILD_VERSION = `${versionFile.major}.${versionFile.minor}.${versionFile.build}`;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  // VITE_BASE_PATH is set by deploy_gcuid_app.py to the CloudFront-mounted path
  // (e.g. /client/tbs-sct/gcuid/) so asset references in the built index.html
  // use the correct absolute URL.  In local dev the variable is unset and Vite
  // uses '/' so the dev server works normally.
  base: process.env.VITE_BASE_PATH ?? '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
      host: '127.0.0.1',  // bind on IPv4 loopback so `localhost:5181` resolves
                         // (Node 17+ defaults `localhost` to IPv6-only)
      port: 5181,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:5182',
          changeOrigin: true,
        },
      },
    },
});
