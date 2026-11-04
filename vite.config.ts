/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Capacitor a Electron načítají dist/index.html – v native režimu se aplikace z dist/app/ zkopíruje tam (s opravenými cestami). */
const nativeEntry = (): Plugin => ({
  name: 'native-entry',
  apply: 'build',
  closeBundle() {
    const html = readFileSync(resolve('dist/app/index.html'), 'utf8');
    writeFileSync(resolve('dist/index.html'), html.replaceAll('"../', '"./'));
  },
});

export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: { input: mode === 'native' ? { app: resolve('app/index.html') } : { main: resolve('index.html'), app: resolve('app/index.html') } },
  },
  plugins: [
    react(),
    mode === 'native' ? nativeEntry() : null,
    VitePWA({
      // Android (Capacitor) a Windows (Electron) mají soubory v balíčku – service worker by jen držel staré verze.
      // Online náhled (mode demo) service worker nepodporuje.
      disable: mode === 'native' || mode === 'demo',
      registerType: 'autoUpdate',
      injectRegister: false,
      scope: '/app/',
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Volejbal Statistika',
        short_name: 'Statistika',
        description: 'Záznam volejbalové statistiky zápasu po hráčích.',
        lang: 'cs',
        start_url: '/app/',
        scope: '/app/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f172a',
        theme_color: '#1d4ed8',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Proxy na cvf.cz nikdy necachovat – soupiska musí být vždy aktuální.
        navigateFallback: '/app/index.html',
        navigateFallbackAllowlist: [/^\/app\//],
        navigateFallbackDenylist: [/^\/cvf\//],
      },
    }),
  ],
  server: {
    // Ve vývoji obchází CORS: /cvf/... -> https://www.cvf.cz/...
    proxy: {
      '/cvf': {
        target: 'https://www.cvf.cz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cvf/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
}));
