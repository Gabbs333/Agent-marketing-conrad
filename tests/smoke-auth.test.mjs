/**
 * Test de fumée (sans base de données) : authentification et routes publiques.
 * Nécessite une compilation préalable : npm run build
 * Lancement : npm run test:smoke
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_API_KEY = "test-secret";
process.env.WEBHOOK_VERIFY_TOKEN = "test-verify";
process.env.DEMO_MODE = "true";

let app;

before(async () => {
  const { buildApp } = await import("../dist/app.js");
  app = await buildApp({ logger: false });
});

after(async () => {
  await app?.close();
});

async function req(method, url, headers = {}) {
  const res = await app.inject({ method, url, headers });
  return res.statusCode;
}

test("santé : public", async () => {
  assert.equal(await req("GET", "/api/health"), 200);
});

test("API protégée sans clé → 401", async () => {
  assert.equal(await req("GET", "/api/dashboard"), 401);
  assert.equal(await req("GET", "/api/leads"), 401);
});

test("webhook Meta : vérification par token", async () => {
  assert.equal(
    await req(
      "GET",
      "/api/messaging/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=CHALLENGE_42",
    ),
    200,
  );
  assert.equal(
    await req(
      "GET",
      "/api/messaging/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x",
    ),
    403,
  );
});

test("dashboard web et landing : publics", async () => {
  assert.equal(await req("GET", "/public/admin.html"), 200);
  assert.equal(await req("GET", "/admin"), 302);
  // publique donc jamais 401 : 404 avec DB, 500 « base indisponible » sans DB
  const landing = await req("GET", "/landing/inexistante");
  assert.ok([404, 500].includes(landing), `landing = ${landing}`);
});
