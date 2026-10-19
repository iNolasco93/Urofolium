import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  const app = {
    name: 'UroFolium',
    description: 'Logbook quirúrgico urológico',
  };
  return {
    plugins: [
      {
        name: 'urofolium-html-meta',
        transformIndexHtml(html) {
          return html
            .replace(/<title>.*<\/title>/, `<title>${app.name}</title>`)
            .replace(
              /<meta name="apple-mobile-web-app-title" content=".*" \/>/,
              `<meta name="apple-mobile-web-app-title" content="${app.name}" />`
            );
        },
      },
      react(),
      VitePWA({
        selfDestroying: true,
        registerType: 'autoUpdate',
        manifest: {
          name: app.name,
          short_name: app.name,
          description: app.description,
          theme_color: '#218d8d',
          background_color: '#fcfcf9',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
          ]
        }
      })
    ],
    optimizeDeps: {
      exclude: ['jeep-sqlite/loader', 'jeep-sqlite'],
    },
  };
});
