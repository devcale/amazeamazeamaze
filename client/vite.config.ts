import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo Vite sirve el frontend y reenvía /api y /socket.io al servidor Node.
// En producción el servidor Node sirve client/dist directamente (mismo origen).
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // escucha en 0.0.0.0 para que el celular pueda abrir el mando
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
