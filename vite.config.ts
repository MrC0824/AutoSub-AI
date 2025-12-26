import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    base: './', 
    // We removed the `define` block to prevent Vite from hardcoding process.env.API_KEY 
    // to an empty string during build. This allows the code to access the 
    // runtime-injected window.process.env.API_KEY correctly.
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    }
  }
})