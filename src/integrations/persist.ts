import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Persistance des tokens dans le fichier .env (mis à jour localement,
 * jamais commité — voir .gitignore). L'agent doit être redémarré
 * après modification pour recharger la configuration.
 */
export async function setEnvValue(
  key: string,
  value: string,
  filePath: string = join(process.cwd(), ".env"),
): Promise<void> {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    content = ""; // fichier absent : on le crée
  }

  const needsQuotes = /\s/.test(value) || value.includes("#") || value.includes('"');
  const line = `${key}=${needsQuotes ? `"${value}"` : value}`;

  const lines = content.length ? content.split("\n") : [];
  const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);

  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  await writeFile(filePath, out, "utf8");
}
