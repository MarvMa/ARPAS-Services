/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string
    readonly DEV: boolean
    readonly PROD: boolean
    readonly MODE: string
    // add more env variables as needed
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}