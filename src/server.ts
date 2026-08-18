import { buildApp } from "./app";
import { config } from "./config";
import { startScheduler } from "./scheduler";
import { execSync } from "node:child_process";

async function main() {
  console.log("🛠️  Exécution des migrations Prisma...");
  try {
    execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });
  } catch (err) {
    console.error("❌ Échec des migrations :", err);
    process.exit(1);
  }

  const app = await buildApp();

  // Planificateur interne
  const stopScheduler = startScheduler();
  app.addHook("onClose", async () => stopScheduler());

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(
    `\n🚀 Agent marketing hôtel démarré : http://0.0.0.0:${config.port}` +
      `\n   Dashboard : http://0.0.0.0:${config.port}/admin\n`,
  );
}

main().catch((err) => {
  console.error("Démarrage impossible :", err);
  process.exit(1);
});
