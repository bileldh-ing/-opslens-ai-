/**
 * Tiny local webhook receiver for demos and debugging. Verifies X-OpsLens-Signature.
 *   WEBHOOK_SECRET=whsec_... npm run webhook:receiver      # listens on :4000
 * Then add http://localhost:4000/hook as a webhook in Settings (demo mode allows localhost).
 */
import { createServer } from "node:http";
import { verifySignature } from "../src/server/integrations/webhooks";

const port = Number(process.env.PORT ?? 4000);
const secret = process.env.WEBHOOK_SECRET;

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const ts = Number(req.headers["x-opslens-timestamp"]);
    const sig = String(req.headers["x-opslens-signature"] ?? "");
    const verdict = secret ? (verifySignature(secret, ts, body, sig) ? "✓ signature valid" : "✗ SIGNATURE INVALID") : "(set WEBHOOK_SECRET to verify)";
    console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url} event=${req.headers["x-opslens-event"]} ${verdict}`);
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(body);
    }
    res.writeHead(200, { "content-type": "application/json" }).end('{"received":true}');
  });
}).listen(port, () => console.log(`Webhook receiver on http://localhost:${port}/hook`));
