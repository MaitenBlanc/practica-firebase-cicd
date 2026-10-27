#!/usr/bin/env node
// Calcula los hashes SHA-256 de todos los scripts inline generados por Next.js
// en `out/**/*.html` y actualiza la Content-Security-Policy en `firebase.json`
// para no depender de `'unsafe-inline'` en `script-src`.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function findHtmlFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      findHtmlFiles(full, files);
    } else if (full.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

const htmlFiles = findHtmlFiles("out");
const hashes = new Set();

// Extrae el contenido de etiquetas <script> sin atributo src
const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  for (const match of html.matchAll(scriptRegex)) {
    const content = match[1];
    if (content.length > 0) {
      const sha256 = createHash("sha256").update(content, "utf8").digest("base64");
      hashes.add(`'sha256-${sha256}'`);
    }
  }
}

const hashList = Array.from(hashes).sort().join(" ");
const cspValue = [
  "default-src 'self'",
  `script-src 'self' ${hashList}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://picsum.photos https://fastly.picsum.photos",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const firebaseConfigPath = "firebase.json";
const firebaseConfig = JSON.parse(readFileSync(firebaseConfigPath, "utf8"));

const globalRule = firebaseConfig.hosting?.headers?.find((r) => r.source === "**");
if (!globalRule) {
  throw new Error("No se encontró la regla source: '**' en firebase.json");
}

const cspHeader = globalRule.headers.find(
  (h) => h.key.toLowerCase() === "content-security-policy",
);
if (cspHeader) {
  cspHeader.value = cspValue;
} else {
  globalRule.headers.push({ key: "Content-Security-Policy", value: cspValue });
}

writeFileSync(firebaseConfigPath, JSON.stringify(firebaseConfig, null, 2) + "\n", "utf8");
console.log(`✔ CSP actualizada en firebase.json con ${hashes.size} hashes SHA-256 (sin 'unsafe-inline' en script-src).`);

