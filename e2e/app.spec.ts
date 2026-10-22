import { expect, test } from "@playwright/test";
import { DEMO, login } from "./helpers";

test.describe("public surface", () => {
  test("health, readiness, security headers and request id", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.ok()).toBe(true);
    expect(await health.json()).toMatchObject({ status: "ok" });
    const ready = await request.get("/api/ready");
    expect(ready.status()).toBe(200);
    expect((await ready.json()).checks.database.ok).toBe(true);

    const res = await request.get("/login");
    const h = res.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-request-id"]).toMatch(/[0-9a-f-]{36}/);
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("PWA manifest, icons, service worker and offline page", async ({ request, page }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ short_name: "OpsLens", display: "standalone", theme_color: "#0a0d14" });
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
    expect((await request.get("/sw.js")).headers()["content-type"]).toMatch(/javascript/);
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });

  test("unknown pages render the styled 404", async ({ page }) => {
    await login(page);
    await page.goto(`/${DEMO.org}/incidents/00000000-0000-0000-0000-000000000000`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("wrong password is rejected without revealing whether the account exists", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });
});

test.describe("demo workspace", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("dashboard shows the seeded scenario", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Active incidents")).toBeVisible();
    await expect(page.getByText("Recent incidents")).toBeVisible();
    await expect(page.locator(`a[href^="/${DEMO.org}/incidents/"]`).first()).toBeVisible();
  });

  test("incident detail, export and triage investigation", async ({ page }) => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Incidents" }).click();
    await page.locator("table a").first().click();
    await expect(page.getByText("Suspected deployment")).toBeVisible();
    await expect(page.getByText("v2.14.0").first()).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "CSV" }).click();
    const csv = await download;
    expect(csv.suggestedFilename()).toMatch(/^incident-.*\.csv$/);

    const exported = await page.request.get(page.url().replace(/\/(acme)\/incidents\//, "/api/orgs/$1/incidents/") + "/export?format=json");
    expect(exported.ok()).toBe(true);
    expect((await exported.json()).incident.status).toBeTruthy();

    await page.getByRole("link", { name: "Investigate with AI" }).click();
    await expect(page.getByLabel("Question")).not.toHaveValue("");
    await page.getByRole("button", { name: "Investigate" }).click();
    await expect(page.getByRole("heading", { name: "Investigation report" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/v2\.14\.0/).first()).toBeVisible();
  });

  test("data sources: upload a log file", async ({ page }) => {
    await page.goto(`/${DEMO.org}/sources`);
    const lines = Array.from({ length: 6 }, (_, i) =>
      JSON.stringify({ timestamp: new Date(Date.UTC(2026, 9, 3, 8, i)).toISOString(), level: "error", service: "e2e-upload-svc", message: "QueueConsumerCrash: poison message" }),
    ).join("\n");
    await page.getByLabel("File").setInputFiles({ name: "e2e.log.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from(lines) });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText(/Ingested 6 events/)).toBeVisible();
    await expect(page.getByText("e2e-upload-svc").first()).toBeVisible();
  });

  test("settings: create an ingest key, ship logs with it, revoke it", async ({ page, request }) => {
    await page.goto(`/${DEMO.org}/settings`);
    await page.getByLabel("Key name").fill("e2e collector");
    await page.getByRole("button", { name: "Create key" }).click();
    const key = (await page.getByTestId("new-api-key").textContent())!.trim();
    expect(key).toMatch(/^olk_[A-Za-z0-9]{8}_/);

    const res = await request.post("/api/v1/logs", {
      headers: { authorization: `Bearer ${key}`, "content-type": "application/x-ndjson" },
      data: JSON.stringify({ level: "info", service: "e2e-http", message: "hello from playwright" }),
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1 });

    await page.reload();
    const row = page.getByTestId("api-key-list").locator("li", { hasText: "e2e collector" });
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row.getByText("Revoked")).toBeVisible();
    const after = await request.post("/api/v1/logs", { headers: { authorization: `Bearer ${key}` }, data: '{"message":"x"}' });
    expect(after.status()).toBe(401);
  });

  test("settings: add a webhook and send a test delivery", async ({ page }) => {
    await page.goto(`/${DEMO.org}/settings`);
    await page.getByLabel("Webhook name").fill("e2e hook");
    // Our own health endpoint only accepts GET, so the POST is recorded as a failed delivery: the log is what we check.
    await page.getByLabel("Webhook URL").fill(`${new URL(page.url()).origin}/api/health`);
    await page.getByRole("button", { name: "Add webhook" }).click();
    await expect(page.getByTestId("webhook-secret")).toContainText("whsec_");
    const row = page.getByTestId("webhook-list").locator("li", { hasText: "e2e hook" });
    await row.getByRole("button", { name: "Test" }).click();
    await expect(row.getByRole("status")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("delivery-log")).toContainText("webhook.test");
  });

  test("quality page lists eval results", async ({ page }) => {
    await page.goto(`/${DEMO.org}/quality`);
    await expect(page.getByRole("heading", { name: /Quality/ })).toBeVisible();
    await page.getByRole("button", { name: "Run evals now" }).click();
    await expect(page.getByRole("status")).toContainText(/cases passed/, { timeout: 60_000 });
    await page.reload();
    await expect(page.getByTestId("eval-results").locator("li")).toHaveCount(3);
  });

  test("audit log records sensitive actions", async ({ page }) => {
    await page.goto(`/${DEMO.org}/audit`);
    await expect(page.getByText("auth.login").first()).toBeVisible();
  });
});
