"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./config");
const scheduler_1 = require("./scheduler");
const node_child_process_1 = require("node:child_process");
async function main() {
    console.log("🛠️  Exécution des migrations Prisma...");
    try {
        (0, node_child_process_1.execSync)("npx prisma db push --accept-data-loss", { stdio: "inherit" });
    }
    catch (err) {
        console.error("❌ Échec des migrations :", err);
        process.exit(1);
    }
    const app = await (0, app_1.buildApp)();
    // Planificateur interne
    const stopScheduler = (0, scheduler_1.startScheduler)();
    app.addHook("onClose", async () => stopScheduler());
    await app.listen({ port: config_1.config.port, host: "0.0.0.0" });
    console.log(`\n🚀 Agent marketing hôtel démarré : http://0.0.0.0:${config_1.config.port}` +
        `\n   Dashboard : http://0.0.0.0:${config_1.config.port}/admin\n`);
}
main().catch((err) => {
    console.error("Démarrage impossible :", err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map