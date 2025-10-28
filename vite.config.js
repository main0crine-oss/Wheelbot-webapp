import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base:'/Wheelbot-webapp/', plugins:[react()], server:{port:5173}, build:{outDir:'dist'} })
