import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "/static/app/",
  plugins: [react()],
  build: {
    outDir: "../Backend/app/static/app",
    emptyOutDir: true,
  },
  server: {
    port: 5000,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/exports": "http://127.0.0.1:8000",
    },
  },
}));
