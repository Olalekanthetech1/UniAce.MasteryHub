import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const port = process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 3000;
  const hmrPort = process.env.VITE_HMR_PORT 
    ? parseInt(process.env.VITE_HMR_PORT, 10) 
    : (port + 21679); // Dynamically offsets from VITE_PORT (e.g. 3000 -> 24679)

  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        disable: mode !== 'production',
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        devOptions: {
          enabled: false
        },
        manifest: {
          name: 'UniAce',
          short_name: 'UniAce',
          description: 'UniAce Learning Platform',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            },
            {
              src: 'icon.svg',
              sizes: '192x192',
              type: 'image/svg+xml'
            },
            {
              src: 'icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml'
            }
          ]
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallbackDenylist: [/^\/api/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /\.(?:woff|woff2|ttf|eot|svg|png|jpg|jpeg|gif)$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'assets-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                }
              }
            }
          ]
        }
      })
    ],
    define: {
      // API keys should not be exposed to the client
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      },
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'zustand', 'use-sync-external-store'],
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'zustand',
        'zustand/middleware',
        'use-sync-external-store',
        '@tanstack/react-query',
        'react-router-dom',
        'lucide-react',
        'react-hot-toast'
      ],
    },
    server: {
      port,
      hmr: {
        port: hmrPort,
        clientPort: process.env.VITE_HMR_CLIENT_PORT ? parseInt(process.env.VITE_HMR_CLIENT_PORT, 10) : undefined
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 6000,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
              if (id.includes('mathjs')) return 'vendor-mathjs';
              if (id.includes('xlsx')) return 'vendor-xlsx';
              if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdfgen';
              if (id.includes('katex')) return 'vendor-katex';
              if (id.includes('recharts') || id.includes('d3') || id.includes('mermaid')) return 'vendor-charts';
              if (id.includes('highlight.js')) return 'vendor-highlight';
              if (id.includes('firebase')) return 'vendor-firebase';
              if (id.includes('lucide-react')) return 'vendor-lucide';
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'vendor-react';
            }
          }
        }
      }
    },
    base: '/',
  };
});
