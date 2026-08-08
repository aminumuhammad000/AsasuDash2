import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rawTarget = process.env.API_PROXY_TARGET ?? process.env.API_PORT ?? "4300";
const targetUrl = rawTarget.startsWith("http://") || rawTarget.startsWith("https://")
  ? rawTarget
  : `http://localhost:${rawTarget}`;

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
        target: targetUrl,
        changeOrigin: true
      },
      "/socket.io": {
        target: targetUrl,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
