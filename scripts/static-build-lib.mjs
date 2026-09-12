import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const CLIENT_DIR = path.resolve("dist/client");
export const SITE_ORIGIN = "https://hiloxs.co.ke";
export const EXPECTED_PUBLIC_PAGE_COUNT = 49;
export const EXPECTED_PLATFORM_PRODUCT_COUNT = 44;

export async function listFiles(root = CLIENT_DIR) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort();
}

export async function readHtmlFiles() {
  const files = (await listFiles()).filter((file) => file.endsWith(".html"));
  return Promise.all(files.map(async (file) => ({ file, html: await readFile(file, "utf8") })));
}

export function executableInlineScripts(html) {
  const bodies = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attributes) || body.trim() === "") continue;
    const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
    bodies.push(body);
  }
  return bodies;
}

export function scriptHash(body) {
  return `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
}

export function expectedHtmlPath(pathname) {
  return pathname === "/"
    ? path.join(CLIENT_DIR, "index.html")
    : path.join(CLIENT_DIR, pathname.slice(1), "index.html");
}

export async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
