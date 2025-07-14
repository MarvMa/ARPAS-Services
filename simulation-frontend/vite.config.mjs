// Rename to vite.config.mjs
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({mode}) => {
    return {
        plugins: [react()],
        build: {
            outDir: 'dist',
        },
        server: {
            __API_BASE__: JSON.stringify(process.env.VITE_API_BASE || '"/api"')
        }
    }
})