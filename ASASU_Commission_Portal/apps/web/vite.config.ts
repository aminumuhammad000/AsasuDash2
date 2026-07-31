import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.API_PROXY_TARGET ?? process.env.API_PORT ?? process.env.PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "zustand"],
          charts: ["recharts"],
          realtime: ["socket.io-client"],
          icons: ["lucide-react"]
        }
      }
    }
  },
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${apiTarget}`,
        changeOrigin: true
      },
      "/socket.io": {
        target: `http://localhost:${apiTarget}`,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
