import crypto from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Polyfill crypto.getRandomValues for older Node.js runtimes (Node 18.x < 18.17 / Node 16)
if (typeof (crypto as any).getRandomValues !== "function") {
  const getRandomValues = function (typedArray: any) {
    if ((crypto as any).webcrypto && typeof (crypto as any).webcrypto.getRandomValues === "function") {
      return (crypto as any).webcrypto.getRandomValues(typedArray);
    }
    return crypto.randomFillSync(typedArray);
  };

  try {
    Object.defineProperty(crypto, "getRandomValues", {
      value: getRandomValues,
      writable: true,
      configurable: true,
      enumerable: true
    });
  } catch {
    (crypto as any).getRandomValues = getRandomValues;
  }
}

if (typeof (globalThis as any).crypto === "undefined") {
  try {
    (globalThis as any).crypto = (crypto as any).webcrypto || crypto;
  } catch {}
}

if (typeof (globalThis as any).crypto?.getRandomValues !== "function") {
  try {
    (globalThis as any).crypto.getRandomValues = function (typedArray: any) {
      if ((crypto as any).webcrypto && typeof (crypto as any).webcrypto.getRandomValues === "function") {
        return (crypto as any).webcrypto.getRandomValues(typedArray);
      }
      return crypto.randomFillSync(typedArray);
    };
  } catch {}
}

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
