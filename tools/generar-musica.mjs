#!/usr/bin/env node
/**
 * Música y ambientes con Lyria 3 (Gemini API).
 *
 * Lee content/musica.json y genera cada pista que tenga `prompt` y todavía no
 * exista en assets/music/<id>.mp3. Las pistas con `archivo` son propias y no
 * se tocan.
 *
 * Uso:
 *   node tools/generar-musica.mjs                # genera lo que falte
 *   node tools/generar-musica.mjs --solo cripta,heraldos
 *   node tools/generar-musica.mjs --forzar       # regenera aunque exista
 *   node tools/generar-musica.mjs --listar
 *
 * Requiere GOOGE_AI_STUDIO_API_KEY en .env. Modelos: lyria-3-pro-preview
 * (~2 min) o lyria-3-clip-preview (~30 s); se elige por pista o por defecto.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const SALIDA = path.join(RAIZ, "assets/music");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, "content/musica.json"), "utf8"));

const argv = process.argv.slice(2);
const tiene = f => argv.includes(f);
const valor = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const soloIds = valor("--solo")?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
const forzar = tiene("--forzar");

function leerClave() {
  if (process.env.GOOGE_AI_STUDIO_API_KEY) return process.env.GOOGE_AI_STUDIO_API_KEY;
  const env = path.join(RAIZ, ".env");
  if (!fs.existsSync(env)) return null;
  for (const linea of fs.readFileSync(env, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?GOOGE_AI_STUDIO_API_KEY\s*=\s*(.*)$/.exec(linea);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const pistas = CONFIG.listas.flatMap(l => l.pistas);
const rutaDe = p => path.join(SALIDA, p.archivo ?? `${p.id}.mp3`);

function duracion(ruta) {
  try {
    const s = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ruta], { encoding: "utf8" });
    return Math.round(Number(s.trim()));
  } catch { return null; }
}

if (tiene("--listar")) {
  for (const p of pistas) {
    const r = rutaDe(p);
    const ok = fs.existsSync(r);
    console.log(`  ${ok ? "✓" : "·"} ${p.id.padEnd(22)} ${p.archivo ? "propia" : (p.modelo ?? CONFIG.modelo)}${ok ? `  ${duracion(r)} s` : ""}`);
  }
  process.exit(0);
}

async function generar(p, clave) {
  const modelo = p.modelo ?? CONFIG.modelo;
  const res = await fetch(`${ENDPOINT}/${modelo}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": clave, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: p.prompt }] }],
      generationConfig: { responseModalities: ["AUDIO"] }
    })
  });
  const datos = await res.json();
  if (datos.error) throw new Error(`${datos.error.status}: ${datos.error.message}`);
  const cand = datos.candidates?.[0];
  const parte = cand?.content?.parts?.find(x => x.inlineData);
  if (!parte) throw new Error(`sin audio (finishReason: ${cand?.finishReason})`);
  if (!/mpeg|mp3/.test(parte.inlineData.mimeType)) throw new Error(`formato inesperado: ${parte.inlineData.mimeType}`);
  return Buffer.from(parte.inlineData.data, "base64");
}

const clave = leerClave();
if (!clave) { console.error("No encontré GOOGE_AI_STUDIO_API_KEY en el entorno ni en .env."); process.exit(1); }

let cola = pistas.filter(p => p.prompt);
if (soloIds) cola = cola.filter(p => soloIds.includes(p.id));
if (!forzar) cola = cola.filter(p => !fs.existsSync(rutaDe(p)));
if (!cola.length) { console.log("Nada que generar. Usá --forzar o --listar."); process.exit(0); }

fs.mkdirSync(SALIDA, { recursive: true });
console.log(`Generando ${cola.length} pista(s)\n`);
const fallos = [];
for (const [i, p] of cola.entries()) {
  process.stdout.write(`[${i + 1}/${cola.length}] ${p.id.padEnd(22)} … `);
  try {
    const mp3 = await generar(p, clave);
    fs.writeFileSync(rutaDe(p), mp3);
    console.log(`✓ ${Math.round(mp3.length / 1024)} KB  ${duracion(rutaDe(p)) ?? "?"} s`);
  } catch (err) {
    console.log(`✗ ${err.message}`);
    fallos.push(p.id);
  }
}
if (fallos.length) {
  console.error(`\nFallaron: ${fallos.join(", ")}. Reintentá con --solo ${fallos.join(",")}`);
  process.exit(1);
}
