"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./config");
const scheduler_1 = require("./scheduler");
async function main() {
    const app = await (0, app_1.buildApp)();
    // Planificateur interne (posts planifiés, nurturing, performances)
    const stopScheduler = (0, scheduler_1.startScheduler)();
    app.addHook("onClose", async () => stopScheduler());
    await app.listen({ port: config_1.config.port, host: "0.0.0.0" });
    console.log(`\n🚀 Agent marketing hôtel démarré : http://localhost:${config_1.config.port} (mode démo : ${config_1.config.demoMode})` +
        `\n   Dashboard : http://localhost:${config_1.config.port}/admin` +
        `\n   Landing page d'une campagne : http://localhost:${config_1.config.port}/landing/:campaignId\n`);
}
main().catch((err) => {
    console.error("Démarrage impossible :", err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map