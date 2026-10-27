import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    // Development only: proxy the API to a running `gateseeker-intel ui --port 4310`.
    proxy: { "/api": "http://127.0.0.1:4310" },
  },
});
