import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.AETHER_WEB_HOST ?? "127.0.0.1";
const apiHost = process.env.AETHER_API_PROXY_HOST ?? "127.0.0.1";
const apiPort = Number(process.env.AETHER_E2E_API_PORT ?? 3030);
const webPort = Number(process.env.AETHER_E2E_WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    port: webPort,
    strictPort: Boolean(process.env.AETHER_E2E_WEB_PORT),
    proxy: {
      "/api": `http://${apiHost}:${apiPort}`
    }
  }
});
