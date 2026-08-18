import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { prisma } from "../db";
import { publicUrl, saveBuffer, slugify } from "../lib/files";
import { detectCategory } from "./mediaSelector";

/**
 * Collecteur de médias : va chercher les vraies images (et vidéos)
 * sur le site de l'hôtel ou n'importe quelle URL, les télécharge dans
 * la médiathèque locale et les indexe dans MediaAsset (champ `source`
 * = URL d'origine). Le pipeline les réutilise ensuite pour créer les
 * contenus (posts, vidéos) au lieu de tout générer par IA.
 */

const BLOCKLIST =
  /logo|icon|avatar|favicon|pixel|spacer|blank|transparent|arrow|close|menu|search|social|share|loader|preload|cookie|\.gif$|\.svg$/i;
const IMG_EXT = /\.(jpe?g|png|webp)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov)(\?|#|$)/i;
const MIN_BYTES = 2 * 1024; // 2 Ko

export interface CollectResult {
  collected: number;
  skipped: number;
  assets: { id: string; type: string; url: string; localPath: string }[];
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HotelMarketingAgent/1.0)" },
  });
  if (!res.ok) throw new Error(`Impossible de charger ${url} (HTTP ${res.status})`);
  return res.text();
}

/** Extrait toutes les URLs d'images/vidéos d'une page HTML. */
function extractMediaUrls(html: string, base: URL): string[] {
  const ogImages = [
    ...html.matchAll(/<meta[^>]+property=["']og:image(?::video)?["'][^>]+content=["']([^"']+)["']/gi),
  ].map((m) => m[1]);
  const imgSrc = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const imgSrcSet = [...html.matchAll(/<img[^>]+srcset=["']([^"']+)["']/gi)]
    .flatMap((m) => m[1].split(","))
    .map((p) => p.trim().split(/\s+/)[0]);
  const videoSrc = [...html.matchAll(/<video[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const videoPoster = [...html.matchAll(/<video[^>]+poster=["']([^"']+)["']/gi)].map((m) => m[1]);

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of [...ogImages, ...imgSrc, ...imgSrcSet, ...videoSrc, ...videoPoster]) {
    if (!raw || raw.startsWith("data:")) continue;
    try {
      const u = new URL(raw, base).href;
      if (BLOCKLIST.test(u)) continue;
      if (!IMG_EXT.test(u) && !VIDEO_EXT.test(u)) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      urls.push(u);
    } catch {
      /* URL invalide : ignorée */
    }
  }
  return urls;
}

function extFromContentType(contentType: string): string | null {
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("video/mp4")) return ".mp4";
  if (contentType.includes("video/webm")) return ".webm";
  if (contentType.includes("video/quicktime")) return ".mov";
  return null;
}

/** Télécharge un média unique et l'indexe dans la médiathèque (dédupliqué par URL source). */
export async function fetchMediaFromUrl(input: {
  url: string;
  category?: string;
  caption?: string;
  tags?: string;
}): Promise<any> {
  const existing = await prisma.mediaAsset.findFirst({ where: { source: input.url } });
  if (existing) return existing;

  const res = await fetch(input.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HotelMarketingAgent/1.0)" },
  });
  if (!res.ok) throw new Error(`Téléchargement échoué (HTTP ${res.status})`);
  const contentType = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_BYTES) throw new Error("Média trop petit (moins de 2 Ko)");

  const isVideo = contentType.startsWith("video/");
  const type = isVideo ? "video" : "image";
  if (!isVideo && !contentType.startsWith("image/")) {
    throw new Error(`Type non supporté : ${contentType || "inconnu"}`);
  }

  const hash = createHash("sha1").update(buf).digest("hex").slice(0, 10);
  const ext =
    extFromContentType(contentType) ??
    (VIDEO_EXT.test(input.url) ? ".mp4" : extname(new URL(input.url).pathname) || ".jpg");
  const dir = isVideo ? "assets/videos" : "assets/images";
  const baseName = slugify(basename(new URL(input.url).pathname).split(".")[0]);
  const relPath = await saveBuffer(buf, `${dir}/${baseName}-${hash}${ext}`);

  // Catégorisation automatique à partir de l'URL et du nom du fichier
  const autoCategory = input.category ?? detectCategory(`${input.url} ${baseName}`);

  return prisma.mediaAsset.create({
    data: {
      type,
      url: publicUrl(relPath),
      localPath: relPath,
      source: input.url,
      category: autoCategory,
      caption: input.caption ?? null,
      tags: input.tags ?? `source:${input.url}`,
    },
  });
}

/** Parcourt une page web et collecte tous ses médias dans la médiathèque. */
export async function collectMediaFromSite(input: {
  url: string;
  max?: number;
}): Promise<CollectResult> {
  const max = input.max ?? 20;
  const html = await fetchHtml(input.url);
  const urls = extractMediaUrls(html, new URL(input.url));

  let collected = 0;
  let skipped = 0;
  const assets: { id: string; type: string; url: string; localPath: string }[] = [];

  for (const u of urls) {
    if (collected >= max) break;
    try {
      const existing = await prisma.mediaAsset.findFirst({ where: { source: u } });
      if (existing) {
        skipped++;
        continue;
      }
      const asset = await fetchMediaFromUrl({ url: u });
      collected++;
      assets.push({
        id: asset.id,
        type: asset.type,
        url: asset.url,
        localPath: asset.localPath ?? asset.url,
      });
    } catch (err) {
      skipped++;
      console.error(`[media] ${u} ignoré :`, (err as Error).message.slice(0, 120));
    }
  }
  return { collected, skipped, assets };
}
