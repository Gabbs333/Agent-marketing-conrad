import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

/** Chemin absolu d'un fichier relatif à la racine du projet. */
export function assetPath(rel: string): string {
  return join(process.cwd(), rel);
}

/** Enregistre un buffer sous `relPath` (relatif à la racine) et renvoie ce chemin. */
export async function saveBuffer(buf: Buffer, relPath: string): Promise<string> {
  const abs = assetPath(relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return relPath;
}

export async function saveText(text: string, relPath: string): Promise<string> {
  return saveBuffer(Buffer.from(text, "utf8"), relPath);
}

/** Convertit un chemin local `assets/...` en URL publique `/assets/...`. */
export function publicUrl(relPath: string): string {
  return "/" + relPath.replace(/\\/g, "/");
}

/** Normalise une URL publique ou un chemin local vers un chemin exploitable. */
export function resolveMediaPath(urlOrPath: string): string {
  if (/^https?:\/\//.test(urlOrPath)) return urlOrPath;
  if (urlOrPath.startsWith("/assets/")) return assetPath(urlOrPath.slice(1));
  return urlOrPath;
}

export function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "media"
  );
}

/** Blob pour upload multipart à partir d'un fichier local. */
export async function fileBlob(filePath: string): Promise<Blob> {
  const buf = await readFile(filePath);
  return new Blob([buf]);
}

// ──────────────────────────────────────────────────────────────
// Encodeur PNG minimal (sans dépendance) pour le mode démo.
// Permet de générer de vraies images utilisables par ffmpeg.
// ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export type Pixel = [number, number, number];

export function createPng(width: number, height: number, pixel: (x: number, y: number) => Pixel): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur de bits
  ihdr[9] = 2; // type de couleur : RGB

  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filtre "None"
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
