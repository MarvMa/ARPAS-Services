import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    root: '.',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    server: {
        port: 3000,
        host: true,
        proxy: {
            '/api': {
                target: 'http://localhost:80',
                changeOrigin: true,
                secure: false,
                rewrite: (path) => path,
            },
            '/ws': {
                target: 'ws://localhost:80',
                ws: true,
                changeOrigin: true,
                secure: false
            }
        }
    },
    preview: {
        port: 3000,
        host: true
    },
    optimizeDeps: {
        include: ['leaflet', 'react-leaflet']
    }
})