import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ระบบบริหารจัดการประมง',
        short_name: 'Fisher ERP',
        description: 'ระบบบริหารกองเรือ เที่ยวเรือ สัตว์น้ำ และบุคลากร',
        lang: 'th',
        theme_color: '#0b1f3a',
        background_color: '#f5f7fa',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // app shell offline; API is network-only (business data must not be served stale silently)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:3000' } },
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'jsdom' },
});
