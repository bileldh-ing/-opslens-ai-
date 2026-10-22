/**
 * Scripted product tour used to record the demo video (manual workflow: .github/workflows/demo-video.yml).
 * Not part of the E2E suite: it only runs through playwright.demo.config.ts.
 *
 * It drives a real browser through every feature at a human pace, draws a visible cursor with a click
 * ripple, scrolls smoothly, and writes scene timestamps (epoch ms) to demo-output/scenes.json so the
 * recording can be cut into chapters. Every scene is best-effort: a failing step is logged, never fatal,
 * so one flaky selector cannot ruin a 10-minute recording.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { test, type Locator, type Page } from "@playwright/test";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const ORG = "acme";
const REPO = process.env.DEMO_REPO_URL ?? "https://github.com/bileldh-ing/-opslens-ai-";
const OUT = "demo-output";

type Scene = { id: string; title: string; start: number; end?: number; errors: string[] };
const scenes: Scene[] = [];
let current: Scene | null = null;

function begin(id: string, title: string) {
  if (current) current.end = Date.now();
  current = { id, title, start: Date.now(), errors: [] };
  scenes.push(current);
  flush();
}
function flush() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/scenes.json`, JSON.stringify({ scenes }, null, 2));
}
async function step(page: Page, what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const msg = `${what}: ${(e as Error).message.split("\n")[0]}`;
    console.warn(`[tour] ${msg}`);
    current?.errors.push(msg);
    flush();
  }
}

const wait = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Visible cursor + click ripple. Uses element.style only, so strict CSPs (GitHub, our own) don't block it. */
const CURSOR_SCRIPT = `(() => {
  if (window.__demoCursor) return; window.__demoCursor = true;
  const mk = () => {
    if (!document.body || document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    Object.assign(c.style, { position:'fixed', left:'0px', top:'0px', width:'26px', height:'26px', zIndex:'2147483647',
      pointerEvents:'none', transform:'translate(-3px,-2px)', transition:'left 70ms linear, top 70ms linear' });
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15.5 L12.5 22.5 L15.5 21 L12 14 L19 14 Z" fill="#ffffff" stroke="#111827" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const s = window.__demoPos || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    c.style.left = s.x + 'px'; c.style.top = s.y + 'px';
    document.body.appendChild(c);
  };
  document.addEventListener('mousemove', (e) => {
    window.__demoPos = { x: e.clientX, y: e.clientY };
    mk(); const c = document.getElementById('__demo_cursor');
    if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }
  }, true);
  document.addEventListener('mousedown', (e) => {
    mk();
    const r = document.createElement('div');
    Object.assign(r.style, { position:'fixed', left:(e.clientX-22)+'px', top:(e.clientY-22)+'px', width:'44px', height:'44px',
      borderRadius:'50%', border:'3px solid rgba(139,92,246,0.95)', background:'rgba(139,92,246,0.25)', zIndex:'2147483646',
      pointerEvents:'none', transform:'scale(0.3)', opacity:'1', transition:'transform 450ms ease-out, opacity 500ms ease-out' });
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.6)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 650);
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mk); else mk();
})();`;

let mouse = { x: 960, y: 540 };
async function moveTo(page: Page, x: number, y: number, steps = 28) {
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
}
async function hover(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded({ timeout: 8000 });
  const box = await loc.boundingBox({ timeout: 8000 });
  if (!box) throw new Error("no bounding box");
  await moveTo(page, box.x + box.width / 2, box.y + box.height / 2);
}
async function click(page: Page, loc: Locator, pause = 350) {
  await hover(page, loc);
  await wait(page, pause);
  await loc.click({ timeout: 10000 });
}
async function type(page: Page, loc: Locator, text: string, delay = 45) {
  await click(page, loc, 200);
  await loc.fill("");
  await loc.pressSequentially(text, { delay });
}
/** Eased smooth scroll of the window (or the main scroll container) to an element or offset. */
async function scrollTo(page: Page, target: Locator | number, ms = 1400) {
  let top: number;
  if (typeof target === "number") top = target;
  else {
    const box = await target.boundingBox({ timeout: 8000 });
    const y = await page.evaluate(() => window.scrollY);
    top = box ? Math.max(0, y + box.y - 110) : y;
  }
  await page.evaluate(
    ([to, dur]) =>
      new Promise<void>((resolve) => {
        const from = window.scrollY;
        const t0 = performance.now();
        const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / dur);
          window.scrollTo(0, from + (to - from) * ease(p));
          if (p < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      }),
    [top, ms] as const,
  );
  await wait(page, 300);
}
async function scrollBottom(page: Page, ms = 2200) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await scrollTo(page, h, ms);
}
async function goto(page: Page, path: string) {
  await page.goto(path.startsWith("http") ? path : BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.mouse.move(mouse.x, mouse.y); // re-show the cursor on the new document
}
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });

/** Dark terminal card rendered in the browser, typed out line by line, for curl and log output. */
async function terminal(page: Page, title: string, blocks: { cmd: string; out: string }[], hold = 2500) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
  <body style="margin:0;height:100vh;background:radial-gradient(ellipse at top,#1e1b4b,#0b1020 70%);display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono','DejaVu Sans Mono',monospace">
  <div style="width:78%;max-height:84vh;background:#0d1117;border:1px solid #30363d;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden">
   <div style="height:38px;background:#161b22;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid #30363d">
    <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span><span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span><span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>
    <span style="margin-left:14px;color:#8b949e;font-size:14px">${esc(title)}</span></div>
   <pre id="t" style="margin:0;padding:22px 26px;color:#c9d1d9;font-size:17px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:calc(84vh - 40px);overflow:hidden"></pre></div></body></html>`;
  await page.setContent(html);
  for (const b of blocks) {
    await page.evaluate(() => {
      const t = document.getElementById("t")!;
      const p = document.createElement("span");
      p.style.color = "#7ee787";
      p.textContent = "$ ";
      t.appendChild(p);
      const c = document.createElement("span");
      c.id = "cur";
      c.style.color = "#e6edf3";
      t.appendChild(c);
    });
    for (let i = 0; i < b.cmd.length; i += 3) {
      await page.evaluate((s) => { document.getElementById("cur")!.textContent = s; }, b.cmd.slice(0, i + 3));
      await wait(page, 28);
    }
    await wait(page, 500);
    await page.evaluate((out) => {
      const t = document.getElementById("t")!;
      document.getElementById("cur")!.removeAttribute("id");
      const o = document.createElement("span");
      o.style.color = "#a5d6ff";
      o.textContent = "\n" + out + "\n\n";
      t.appendChild(o);
      t.scrollTop = t.scrollHeight;
    }, b.out);
    await wait(page, 1600);
  }
  await wait(page, hold);
}

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 20000 }).trim();
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? (e as Error).message).trim();
  }
}
const pretty = (s: string, max = 1400) => {
  try {
    const j = JSON.stringify(JSON.parse(s), null, 2);
    return j.length > max ? j.slice(0, max) + "\n  …" : j;
  } catch {
    return s.slice(0, max);
  }
};

test.use({ acceptDownloads: true });
test.setTimeout(30 * 60_000);

test("OpsLens AI product tour", async ({ page, context }) => {
  await context.addInitScript(CURSOR_SCRIPT);
  context.on("page", (p) => p.close().catch(() => {})); // keep everything in one visible tab

  // Sync marker: a full green frame the editor detects to align scenes.json with the recording.
  await page.setContent('<body style="margin:0;background:#00ff00;height:100vh"></body>');
  await wait(page, 300);
  scenes.push({ id: "sync", title: "sync", start: Date.now(), errors: [] });
  await wait(page, 1200);
  await page.setContent('<body style="margin:0;background:#0b1020;height:100vh"></body>');
  await wait(page, 800);

  // 01 Landing + auth
  begin("landing", "Landing page");
  await step(page, "landing", async () => {
    await goto(page, "/");
    await moveTo(page, 700, 420);
    await wait(page, 2500);
    await hover(page, page.getByText("evidence", { exact: true }).first());
    await wait(page, 1500);
    await hover(page, page.getByText("Investigation report").first());
    await wait(page, 2000);
    await scrollBottom(page);
    await wait(page, 2500);
    await scrollTo(page, 0);
    await wait(page, 800);
  });
  begin("signup", "Sign up page");
  await step(page, "signup", async () => {
    await click(page, page.getByRole("link", { name: "Get started" }));
    await page.waitForURL(/signup/);
    await wait(page, 2800);
  });
  begin("login", "Sign in");
  await step(page, "login", async () => {
    await goto(page, "/login");
    await wait(page, 800);
    await type(page, page.getByLabel("Email"), "demo@opslens.dev");
    await type(page, page.getByLabel("Password"), "wrong-password", 40);
    await click(page, page.getByRole("button", { name: "Sign in" }));
    await page.getByText("Invalid email or password.").waitFor({ timeout: 10000 });
    await wait(page, 1800);
    await type(page, page.getByLabel("Password"), "opslens-demo-123", 40);
    await click(page, page.getByRole("button", { name: "Sign in" }));
    await page.waitForURL(new RegExp(`/${ORG}$`), { timeout: 20000 });
  });

  // 02 Dashboard
  begin("overview", "Overview dashboard");
  await step(page, "overview", async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await wait(page, 2000);
    await hover(page, page.getByText("Active incidents").first());
    await wait(page, 1500);
    await hover(page, page.getByLabel("Errors per hour").first()).catch(() => {});
    await wait(page, 2200);
    await scrollTo(page, page.getByText("Recent incidents").first());
    await wait(page, 2500);
    await scrollTo(page, 0);
  });

  // 03 Data sources
  begin("sources", "Data sources & ingestion");
  await step(page, "sources", async () => {
    await click(page, nav(page, "Data sources"));
    await page.waitForURL(/sources/);
    await wait(page, 2000);
    const lines = Array.from({ length: 12 }, (_, i) =>
      JSON.stringify({ timestamp: new Date(Date.now() - (12 - i) * 60_000).toISOString(), level: "error", service: "checkout-worker", message: "QueueConsumerCrash: poison message on orders.v2" }),
    ).join("\n");
    await hover(page, page.getByLabel("File").first());
    await page.getByLabel("File").first().setInputFiles({ name: "checkout-worker.log.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from(lines) });
    await wait(page, 900);
    await click(page, page.getByRole("button", { name: "Upload" }).first());
    await page.getByText(/Ingested \d+ events/).first().waitFor({ timeout: 20000 });
    await wait(page, 2500);
    await scrollTo(page, page.getByText("Services", { exact: true }).first());
    await wait(page, 2500);
    await hover(page, page.getByText("Recent deployments").first());
    await wait(page, 2000);
    await scrollTo(page, page.getByText("Knowledge base").first());
    await wait(page, 2800);
    await scrollTo(page, 0);
  });

  // 04 Incidents
  begin("incidents", "Incidents list");
  let incidentUrl = "";
  await step(page, "incidents", async () => {
    await click(page, nav(page, "Incidents"));
    await page.waitForURL(/incidents$/);
    await wait(page, 2500);
    const row = page
      .locator("tbody tr")
      .filter({ has: page.locator("td:nth-child(2)", { hasText: /^payment-service$/ }) })
      .filter({ hasNotText: "resolved" })
      .first();
    await hover(page, row);
    await wait(page, 1500);
    await click(page, row.locator("a").first());
    await page.getByText("Suspected deployment").waitFor({ timeout: 15000 });
    incidentUrl = page.url();
  });
  begin("incident_detail", "Incident detail & deploy correlation");
  await step(page, "incident detail", async () => {
    await wait(page, 2000);
    await hover(page, page.getByText("Suspected deployment"));
    await wait(page, 2500);
    await hover(page, page.getByText("Error groups"));
    await wait(page, 2000);
    await hover(page, page.getByText("Timeline"));
    await wait(page, 1500);
  });
  begin("incident_status", "Status workflow");
  await step(page, "status", async () => {
    for (const label of ["Acknowledge", "Mark mitigated", "Resolve", "Reopen"]) {
      const b = page.getByRole("button", { name: label, exact: true });
      if (!(await b.count())) continue;
      await click(page, b.first());
      await page.waitForLoadState("networkidle").catch(() => {});
      await wait(page, 1700);
    }
  });

  // 05 Exports
  begin("exports", "Exports (JSON / CSV)");
  await step(page, "exports", async () => {
    await hover(page, page.getByRole("link", { name: "Export JSON" }));
    await wait(page, 800);
    const dl = page.waitForEvent("download", { timeout: 15000 });
    await click(page, page.getByRole("link", { name: "CSV" }));
    const d = await dl;
    await wait(page, 1500);
    const csvPath = await d.path().catch(() => null);
    const csv = csvPath && existsSync(csvPath) ? readFileSync(csvPath, "utf8").split("\n").slice(0, 7).join("\n") : "(downloaded)";
    const api = incidentUrl.replace(`/${ORG}/incidents/`, `/api/orgs/${ORG}/incidents/`) + "/export?format=json";
    const json = await (await page.request.get(api)).text();
    const short = incidentUrl.split("/").pop()!.slice(0, 8) + "…";
    await terminal(page, "Incident export", [
      { cmd: `curl -b session.txt ${BASE}/api/orgs/${ORG}/incidents/${short}/export?format=json | jq`, out: pretty(json, 1100) },
      { cmd: `head -n 6 ${d.suggestedFilename()}`, out: csv.slice(0, 700) },
    ]);
    await goto(page, incidentUrl);
  });

  // 06 AI investigation
  begin("investigate", "AI investigation with citations");
  await step(page, "investigate", async () => {
    await click(page, page.getByRole("link", { name: "Investigate with AI" }));
    await page.waitForURL(/investigate/);
    await wait(page, 2200);
    await hover(page, page.getByLabel("Question"));
    await wait(page, 1500);
    await click(page, page.getByRole("button", { name: "Investigate" }));
    await wait(page, 600);
    await page.getByRole("heading", { name: "Investigation report" }).waitFor({ timeout: 90000 });
    await wait(page, 1800);
    await scrollTo(page, page.getByRole("heading", { name: "Investigation report" }));
    await wait(page, 3000);
    await scrollTo(page, (await page.evaluate(() => window.scrollY)) + 360, 1600);
    await wait(page, 3000);
    await scrollTo(page, (await page.evaluate(() => window.scrollY)) + 360, 1600);
    await wait(page, 2500);
    const unc = page.getByText("Uncertainty", { exact: true });
    if (await unc.count()) {
      await scrollTo(page, unc.first());
      await wait(page, 3000);
    }
    await scrollBottom(page, 1800);
    await wait(page, 2500);
  });

  // 07 Remediations
  begin("remediations", "Approval-gated remediation");
  await step(page, "remediations", async () => {
    await click(page, nav(page, "Remediations"));
    await page.waitForURL(/remediations/);
    await wait(page, 2500);
    const note = page.getByPlaceholder("Review note (optional)").first();
    if (await note.count()) {
      await hover(page, page.locator("pre").first());
      await wait(page, 2000);
      await type(page, note, "Approved: roll back to v2.13.0 during the 14:00 window");
      await wait(page, 600);
      await click(page, page.getByRole("button", { name: "Approve" }).first());
      await page.waitForLoadState("networkidle").catch(() => {});
      await wait(page, 2500);
    } else await wait(page, 3000);
    await scrollTo(page, 0);
  });

  // 08 Settings: members, plan, projects
  begin("settings_team", "Settings: members, roles, plan, projects");
  await step(page, "settings team", async () => {
    await click(page, nav(page, "Settings"));
    await page.waitForURL(/settings/);
    await wait(page, 2200);
    await type(page, page.getByLabel("Email"), "maya@acme.dev");
    await page.getByLabel("Role").selectOption("admin");
    await hover(page, page.getByLabel("Role"));
    await wait(page, 600);
    await click(page, page.getByRole("button", { name: "Invite", exact: true }));
    await page.getByLabel("Copy invite link").waitFor({ timeout: 10000 });
    await wait(page, 2200);
    await hover(page, page.getByText("Plan", { exact: true }).first());
    await wait(page, 2500);
    await scrollTo(page, page.getByText("Projects", { exact: true }).first());
    await type(page, page.getByLabel("Project name"), "Staging");
    await click(page, page.getByRole("button", { name: "Create project" }));
    await wait(page, 2500);
  });
  let apiKey = "";
  begin("settings_keys", "Ingest API keys");
  await step(page, "api keys", async () => {
    await scrollTo(page, page.locator("#api-keys"));
    await wait(page, 1200);
    await type(page, page.getByLabel("Key name"), "otel-collector-prod");
    await click(page, page.getByRole("button", { name: "Create key" }));
    const k = page.getByTestId("new-api-key");
    await k.waitFor({ timeout: 10000 });
    apiKey = (await k.textContent())!.trim();
    await hover(page, k);
    await wait(page, 2800);
  });
  begin("settings_webhooks", "Webhooks with live delivery");
  await step(page, "webhooks", async () => {
    await scrollTo(page, page.locator("#webhooks"));
    await wait(page, 1000);
    await type(page, page.getByLabel("Webhook name"), "#incidents receiver");
    await type(page, page.getByLabel("Webhook URL"), "http://localhost:4000/hook", 35);
    await click(page, page.getByRole("button", { name: "Add webhook" }));
    await page.getByTestId("webhook-secret").waitFor({ timeout: 10000 });
    await wait(page, 2000);
    const row = page.getByTestId("webhook-list").locator("li", { hasText: "#incidents receiver" });
    await click(page, row.getByRole("button", { name: "Test" }));
    await row.getByRole("status").waitFor({ timeout: 15000 });
    await wait(page, 2200);
    await page.reload();
    await page.mouse.move(mouse.x, mouse.y);
    await scrollTo(page, page.getByTestId("delivery-log"));
    await wait(page, 3000);
  });
  begin("webhook_receiver", "Webhook receiver terminal");
  await step(page, "receiver", async () => {
    const log = existsSync("webhook.log") ? readFileSync("webhook.log", "utf8") : "";
    const tail = log.split("\n").filter(Boolean).slice(-28).join("\n");
    await terminal(page, "npm run webhook:receiver  (localhost:4000)", [{ cmd: "npm run webhook:receiver", out: tail || "Webhook receiver on http://localhost:4000/hook" }], 3500);
  });

  // 09 Ingest API via curl
  begin("ingest_api", "Ingest API with curl");
  await step(page, "ingest api", async () => {
    const shown = apiKey ? apiKey.slice(0, 14) + "…" : "olk_…";
    const body = [
      JSON.stringify({ level: "error", service: "search-api", message: "UpstreamTimeout: elasticsearch query exceeded 3000ms" }),
      JSON.stringify({ level: "error", service: "search-api", message: "UpstreamTimeout: elasticsearch query exceeded 3000ms" }),
      JSON.stringify({ level: "warn", service: "search-api", message: "circuit breaker half-open" }),
    ].join("\n");
    const ok = sh("curl", ["-s", "-X", "POST", `${BASE}/api/v1/logs`, "-H", `authorization: Bearer ${apiKey}`, "-H", "content-type: application/x-ndjson", "--data-binary", body]);
    const bad = sh("curl", ["-s", "-w", "\\nHTTP %{http_code}", "-X", "POST", `${BASE}/api/v1/logs`, "-H", "authorization: Bearer olk_invalid_key", "--data", '{"message":"x"}']);
    await terminal(page, "Ingest API", [
      { cmd: `curl -X POST ${BASE}/api/v1/logs \\\n    -H "Authorization: Bearer ${shown}" \\\n    -H "Content-Type: application/x-ndjson" \\\n    --data-binary @search-api.jsonl`, out: pretty(ok) },
      { cmd: `curl -X POST ${BASE}/api/v1/logs -H "Authorization: Bearer olk_invalid_key" -d '{"message":"x"}'`, out: bad },
    ], 3000);
  });

  // 10 Quality / evals
  begin("quality", "Quality & evals");
  await step(page, "quality", async () => {
    await goto(page, `/${ORG}/quality`);
    await wait(page, 2200);
    await hover(page, page.getByLabel("Pass rate per run, oldest to newest").first()).catch(() => {});
    await wait(page, 1500);
    await click(page, page.getByRole("button", { name: "Run evals now" }));
    await page.getByRole("status").filter({ hasText: /cases passed/ }).first().waitFor({ timeout: 90000 });
    await wait(page, 2500);
    await page.reload();
    await page.mouse.move(mouse.x, mouse.y);
    await scrollTo(page, page.getByTestId("eval-results"));
    await wait(page, 3000);
    await scrollTo(page, 0);
  });

  // 11 Audit log
  begin("audit", "Audit log");
  await step(page, "audit", async () => {
    await click(page, nav(page, "Audit log"));
    await page.waitForURL(/audit/);
    await wait(page, 2500);
    await hover(page, page.getByText("auth.login").first());
    await wait(page, 1500);
    await scrollTo(page, (await page.evaluate(() => window.scrollY)) + 500, 2000);
    await wait(page, 2500);
    await scrollTo(page, 0);
  });

  // 12 PWA + offline
  begin("pwa", "PWA manifest & offline mode");
  await step(page, "pwa", async () => {
    const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).text();
    await terminal(page, "PWA manifest", [{ cmd: `curl ${BASE}/manifest.webmanifest | jq`, out: pretty(manifest, 1000) }], 1500);
    await goto(page, `/${ORG}`);
    await wait(page, 2500); // let the service worker install + precache
    await context.setOffline(true);
    await page.goto(`${BASE}/${ORG}/incidents`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.mouse.move(mouse.x, mouse.y);
    await wait(page, 3500);
    await context.setOffline(false);
    if (!(await page.getByRole("heading", { name: "You are offline" }).count())) {
      await goto(page, "/offline");
      await wait(page, 3000);
    }
    await hover(page, page.getByRole("link", { name: "Retry" }));
    await wait(page, 1500);
  });

  // 13 Health / ready
  begin("health", "Health & readiness probes");
  await step(page, "health", async () => {
    const h = await (await page.request.get(`${BASE}/api/health`)).text();
    const r = await (await page.request.get(`${BASE}/api/ready`)).text();
    const head = sh("curl", ["-sI", `${BASE}/login`]).split("\n").filter((l) => /^(HTTP|x-frame|content-security|x-content-type|x-request-id|strict-transport|referrer)/i.test(l)).map((l) => (l.length > 140 ? l.slice(0, 140) + "…" : l)).join("\n");
    await terminal(page, "Probes & security headers", [
      { cmd: `curl ${BASE}/api/health`, out: pretty(h) },
      { cmd: `curl ${BASE}/api/ready`, out: pretty(r, 700) },
      { cmd: `curl -I ${BASE}/login`, out: head },
    ], 3000);
  });

  // 14 CI/CD on GitHub (public pages, no login)
  begin("github_readme", "GitHub repository & README");
  await step(page, "github readme", async () => {
    await goto(page, REPO);
    await wait(page, 2500);
    const readme = page.locator("article.markdown-body").first();
    if (await readme.count()) await scrollTo(page, readme);
    await wait(page, 2500);
    await scrollTo(page, (await page.evaluate(() => window.scrollY)) + 700, 2200);
    await wait(page, 2500);
    await scrollTo(page, (await page.evaluate(() => window.scrollY)) + 700, 2200);
    await wait(page, 2000);
  });
  begin("github_actions", "GitHub Actions pipeline");
  await step(page, "github actions", async () => {
    await goto(page, `${REPO}/actions`);
    await wait(page, 3500);
    await scrollTo(page, 250, 1500);
    await wait(page, 2000);
    const ci = page.locator('a[href*="/actions/runs/"]').filter({ hasText: /./ }).first();
    if (process.env.DEMO_CI_RUN_URL) await goto(page, process.env.DEMO_CI_RUN_URL);
    else await click(page, ci);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.mouse.move(mouse.x, mouse.y);
    await wait(page, 4500);
    await scrollTo(page, 400, 1800);
    await wait(page, 3000);
  });
  begin("github_docker", "Docker image on GHCR");
  await step(page, "github packages", async () => {
    await goto(page, process.env.DEMO_PACKAGE_URL ?? `${REPO}/pkgs/container/opslens-ai`);
    await wait(page, 4000);
    await scrollTo(page, 350, 1800);
    await wait(page, 2500);
  });
  begin("end", "End");
  await wait(page, 1000);
  if (current) current.end = Date.now();
  flush();
});
