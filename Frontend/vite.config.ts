import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ".", "");
  const appBasePath = (env.VITE_APP_BASE_PATH || "").trim().replace(/^\/*|\/*$/g, "");
  const publicBasePath = appBasePath ? `/${appBasePath}` : "";

  return {
    base: command === "serve" ? "/" : `${publicBasePath}/static/app/`,
    plugins: [react()],
    build: {
      outDir: "../Backend/app/static/app",
      emptyOutDir: true,
    },
    server: {
      port: 5000,
      proxy: {
        "/api": "http://127.0.0.1:8031",
        "/exports": "http://127.0.0.1:8031",
      },
    },
  };
});
