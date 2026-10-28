import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    // Development only: proxy the API to the local server (`node dist/web/local-server.js`).
    proxy: { "/api": "http://127.0.0.1:4320" },
  },
});
