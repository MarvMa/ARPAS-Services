import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    root: '.',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor': ['react', 'react-dom'],
                    'leaflet': ['leaflet', 'react-leaflet'],
                    'utils': ['axios']
                }
            }
        }
    },
    server: {
        port: 3000,
        host: true,
        cors: true,
        proxy: {
            // API endpoints proxy
            '/api': {
                target: 'http://localhost',
                changeOrigin: true,
                secure: false,
                rewrite: (path) => path,
                configure: (proxy, options) => {
                    proxy.on('error', (err, req, res) => {
                        console.log('API proxy error:', err);
                    });
                    proxy.on('proxyReq', (proxyReq, req, res) => {
                        console.log('Proxying API request:', req.method, req.url);
                    });
                }
            },
            // WebSocket proxy for prediction endpoint
            '/ws': {
                target: 'ws://localhost',
                ws: true,
                changeOrigin: true,
                secure: false,
                configure: (proxy, options) => {
                    proxy.on('error', (err, req, res) => {
                        console.log('WebSocket proxy error:', err);
                    });
                    proxy.on('open', (proxySocket) => {
                        console.log('WebSocket proxy connection opened');
                    });
                    proxy.on('close', (res, socket, head) => {
                        console.log('WebSocket proxy connection closed');
                    });
                }
            },
            // Health check endpoint
            '/health': {
                target: 'http://localhost/api/storage',
                changeOrigin: true,
                secure: false,
                rewrite: (path) => '/health'
            },
            '/api/docker/stats': {
                target: 'http://localhost',
                changeOrigin: true,
                secure: false,
                rewrite: (path) => path
            }
        }
    },
    preview: {
        port: 3000,
        host: true,
        cors: true,
        proxy: {
            '/api': {
                target: 'http://localhost',
                changeOrigin: true,
                secure: false
            },
            '/ws': {
                target: 'ws://localhost',
                ws: true,
                changeOrigin: true,
                secure: false
            },
            '/health': {
                target: 'http://localhost/api/storage',
                changeOrigin: true,
                secure: false,
                rewrite: (path) => '/health'
            }
        }
    },
    optimizeDeps: {
        include: [
            'leaflet',
            'react-leaflet',
            'axios',
            'react',
            'react-dom'
        ],
        exclude: []
    },
    define: {
        // Define environment variables for better debugging
        __DEV__: JSON.stringify(process.env.NODE_ENV === 'development'),
        __WEBSOCKET_URL__: JSON.stringify(process.env.NODE_ENV === 'development'
            ? 'ws://localhost/ws/predict'
            : 'ws://localhost/ws/predict'),
        __API_BASE_URL__: JSON.stringify(process.env.NODE_ENV === 'development'
            ? 'http://localhost/api/storage'
            : 'http://localhost/api/storage')
    }
})