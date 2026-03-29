import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'redirect-admin',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/admin') {
            _res.writeHead(301, { Location: '/admin/' })
            _res.end()
            return
          }
          next()
        })
      },
    },
  ],
  base: '/admin/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/admin/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
