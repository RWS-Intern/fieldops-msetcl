import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType:  'autoUpdate',
      // Use our hand-crafted public/manifest.json
      manifest:      false,
      // Generated from public/rite-water-logo.png by `npm run generate:icons`.
      // The previous 'favicon.ico' entry named a file that has never existed
      // in public/ — the favicon is now icons/favicon-32.png, already covered
      // by this glob.
      includeAssets: ['icons/*.png'],
      workbox: {
        // Allow large chunks (mapbox-gl alone is ~2.5 MB unminified)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        // Pre-cache all built assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Firestore REST calls — network-first with fallback
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler:    'NetworkFirst',
            options: {
              cacheName:            'firestore-cache',
              networkTimeoutSeconds: 10,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Firebase Auth token exchange
            urlPattern: /^https:\/\/securetoken\.googleapis\.com\/.*/i,
            handler:    'NetworkFirst',
            options: {
              cacheName:            'firebase-auth-cache',
              networkTimeoutSeconds: 10,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Mapbox tile & style requests — cache-first (tiles don't change)
            urlPattern: /^https:\/\/.*\.mapbox\.com\/.*/i,
            handler:    'CacheFirst',
            options: {
              cacheName: 'mapbox-cache',
              expiration: {
                maxEntries:    200,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(gstatic|googleapis)\.com\/.*/i,
            handler:    'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries:    30,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('mapbox-gl'))      return 'mapbox';
          if (id.includes('node_modules/firebase')) return 'firebase';
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router-dom') ||
            id.includes('node_modules/zustand')
          ) return 'vendor';
        },
      },
    },
  },
})
