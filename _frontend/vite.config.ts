import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  build: {
    minify: false,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
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
      // Watch _shared directory for changes since it's outside the frontend root
      additionalPaths: ["../_shared"],
    },
    proxy: {
      "/api": "http://localhost:3101",
      "/chat": {
        target: "ws://localhost:3101",
        ws: true,
        filter: (pathname, req) => req.headers.upgrade === "websocket",
        bypass: (req) => {
          if (req.headers.upgrade !== "websocket") {
            return req.url;
          }
        },
      },
    },
  },
});
