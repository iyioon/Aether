import { defineConfig } from "@playwright/test";

const apiPort = Number(process.env.AETHER_E2E_API_PORT ?? 3130);
const webPort = Number(process.env.AETHER_E2E_WEB_PORT ?? 4173);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "dot" : "list",
  webServer: [
    {
      command: `AETHER_E2E_API_PORT=${apiPort} npm run e2e:server`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `AETHER_E2E_API_PORT=${apiPort} AETHER_E2E_WEB_PORT=${webPort} npm run dev:web`,
      url: `http://127.0.0.1:${webPort}/`,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chrome",
      use: {
        channel: "chrome",
        viewport: {
          width: 1440,
          height: 980
        }
      }
    }
  ]
});
