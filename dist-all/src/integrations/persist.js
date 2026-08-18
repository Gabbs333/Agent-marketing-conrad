"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setEnvValue = setEnvValue;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
/**
 * Persistance des tokens dans le fichier .env (mis à jour localement,
 * jamais commité — voir .gitignore). L'agent doit être redémarré
 * après modification pour recharger la configuration.
 */
async function setEnvValue(key, value, filePath = (0, node_path_1.join)(process.cwd(), ".env")) {
    let content = "";
    try {
        content = await (0, promises_1.readFile)(filePath, "utf8");
    }
    catch {
        content = ""; // fichier absent : on le crée
    }
    const needsQuotes = /\s/.test(value) || value.includes("#") || value.includes('"');
    const line = `${key}=${needsQuotes ? `"${value}"` : value}`;
    const lines = content.length ? content.split("\n") : [];
    const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
    if (idx >= 0)
        lines[idx] = line;
    else
        lines.push(line);
    let out = lines.join("\n");
    if (!out.endsWith("\n"))
        out += "\n";
    await (0, promises_1.writeFile)(filePath, out, "utf8");
}
//# sourceMappingURL=persist.js.map