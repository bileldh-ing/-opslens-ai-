import { defineConfig } from "@playwright/test";

/**
 * Records the scripted product tour (e2e/demo.tour.ts) in a headed Chromium on an X display,
 * which .github/workflows/demo-video.yml captures with ffmpeg. Expects `npm run demo` on :3000 already.
 * Never picked up by the normal E2E run (playwright.config.ts only matches *.spec.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "demo.tour.ts",
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  reporter: [["list"]],
  outputDir: "demo-output/test-results",
  use: {
    headless: false,
    viewport: null,
    colorScheme: "dark",
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    launchOptions: {
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        // --window-size is in DIPs: 1440x810 page + ~87 DIP of browser UI. The workflow captures the
        // whole X screen and the editor crops the page area (located via the green sync frame).
        "--window-position=0,0",
        "--window-size=1440,900",
        `--force-device-scale-factor=${process.env.DEMO_SCALE ?? "1.3333"}`,
        "--hide-scrollbars",
        "--disable-infobars",
        "--no-first-run",
        "--disable-features=Translate,DownloadBubble,DownloadBubbleV2",
      ],
    },
  },
});
