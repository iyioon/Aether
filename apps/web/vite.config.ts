import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const host = process.env.AETHER_WEB_HOST ?? "127.0.0.1";
const apiHost = process.env.AETHER_API_PROXY_HOST ?? "127.0.0.1";
const apiPort = Number(process.env.AETHER_E2E_API_PORT ?? 3030);
const webPort = Number(process.env.AETHER_E2E_WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "aether-offline-shell",
      apply: "build",
      generateBundle(_options, bundle) {
        const template = readFileSync(
          new URL("./pwa/service-worker.js", import.meta.url),
          "utf8"
        );
        const urls = [
          "/index.html",
          "/offline.html",
          "/offline-retry.js",
          "/manifest.json",
          "/aether-logo.png",
          "/aether-icon-180.png",
          "/aether-icon-192.png",
          "/login-bg.png",
          ...Object.keys(bundle)
            .filter((name) => /\.(js|css|woff2)$/.test(name))
            .map((name) => `/${name}`)
        ].sort();
        const publicResources = urls
          .filter((url) => !url.startsWith("/assets/") && url !== "/index.html")
          .map((url) =>
            readFileSync(path.join(import.meta.dirname, "public", url.slice(1)))
          );
        const hash = createHash("sha256")
          .update(template)
          .update(readFileSync(new URL("./index.html", import.meta.url)))
          .update(JSON.stringify(urls));
        publicResources.forEach((resource) => hash.update(resource));
        this.emitFile({
          type: "asset",
          fileName: "service-worker.js",
          source: template
            .replace("__BUILD_ID__", hash.digest("hex").slice(0, 16))
            .replace("__PRECACHE_URLS__", JSON.stringify(urls))
        });
      }
    }
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src")
    }
  },
  test: {
    exclude: [...configDefaults.exclude, "**/._*"]
  },
  server: {
    host,
    port: webPort,
    strictPort: Boolean(process.env.AETHER_E2E_WEB_PORT),
    proxy: {
      "/api": `http://${apiHost}:${apiPort}`
    }
  }
});
