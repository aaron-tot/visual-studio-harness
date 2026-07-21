import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
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
  build: {
    // Intermediate only — scripts/build-prod.ts embeds this into the binary.
    // Final runtime data lives at project-root data/prod/ (sibling of source/).
    outDir: "../../data/prod/.build/frontend",
    emptyOutDir: true,
    rollupOptions: {
      // Restrict build to the app entry only. dnd-demo.html is a standalone
      // Playwright component-test harness and must not ship in production.
      input: {
        main: "index.html",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/chat": {
        target: "ws://localhost:3001",
        ws: true,
        filter: (pathname, req) => req.headers.upgrade === "websocket",
        bypass: (req) => {
          // Only proxy WebSocket upgrades — HTTP requests (e.g. /chat-icon.png)
          // must NOT be forwarded to the backend.
          if (req.headers.upgrade !== "websocket") {
            return req.url;
          }
        },
      },
    },
  },
  // ensure /api/fs and /api/workspaces hit backend in dev

});
