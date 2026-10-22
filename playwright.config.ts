import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a real server on embedded Postgres (PGlite) with a freshly seeded demo workspace.
 * E2E_MODE=start (CI) serves an existing `next build`; the default `dev` mode needs no build.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }], ["github"]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: process.env.CI ? "on" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "sh scripts/e2e-server.sh",
    url: `${baseURL}/api/ready`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      E2E_PORT: String(port),
      E2E_MODE: process.env.E2E_MODE ?? "dev",
      APP_URL: baseURL,
      ALLOW_PRIVATE_WEBHOOK_TARGETS: "true",
      LOG_LEVEL: "warn",
    },
  },
});
