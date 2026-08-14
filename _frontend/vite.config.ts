import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  build: {
    minify: false,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../_shared"),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MB
      },
      manifest: {
        name: "Visual Studio Harness",
        short_name: "VSHarness",
        description: "AI Coding Agent Harness",
        theme_color: "#18181b",
        display: "standalone",
        icons: [
          {
            src: "/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: {
    port: 3100,
    watch: {
      // Poll filesystem instead of relying on inotify (pre-commit hook stash/restore
      // can confuse native file watchers, causing HMR to miss changes).
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      "/api": "http://localhost:3101",
      "/chat": {
        target: "ws://localhost:3101",
        ws: true,
        bypass: (req) => {
          if (req.headers?.upgrade !== "websocket") {
            return req.url;
          }
        },
      },
    },
  },
});
