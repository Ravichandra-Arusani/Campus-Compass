import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const geojsonNoCachePlugin = () => ({
  name: 'geojson-no-cache',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url && req.url.endsWith('.geojson')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
      next();
    });
  }
});

export default defineConfig({
  plugins: [react(), geojsonNoCachePlugin()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
