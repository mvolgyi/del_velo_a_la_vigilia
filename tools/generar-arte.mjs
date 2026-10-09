#!/usr/bin/env node
/**
 * Generador de arte de Del Velo a la Vigilia (exteriores, retratos).
 *
 * Los prompts viven versionados en tools/arte.config.json para que el estilo
 * de la campaña sea reproducible: regenerar un mapa dentro de seis meses tiene
 * que dar algo que combine con los de hoy.
 *
 * Uso:
 *   node tools/generar-arte.mjs                 # genera lo que falte
 *   node tools/generar-arte.mjs --solo <id>,<id>
 *   node tools/generar-arte.mjs --forzar        # regenera aunque exista
 *   node tools/generar-arte.mjs --listar
 *
 * Requiere GOOGE_AI_STUDIO_API_KEY en .env (que está en .gitignore).
 * Env: DVV_SUFIJO agrega un sufijo al nombre de archivo (pruebas A/B).
 *
 * Los INTERIORES no salen de acá: se construyen desde un plano
 * (construir-planos.mjs → pintar-planos.mjs), porque el modelo no garantiza
 * muros ni medidas. Este script es para exteriores difusos y retratos.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, "tools/arte.config.json"), "utf8"));
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const CALIDAD_WEBP = 85;

/* --- argumentos ---------------------------------------------------------- */

const argv = process.argv.slice(2);
const tiene = f => argv.includes(f);
const valor = f => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : null;
};

const soloIds = valor("--solo")?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
const forzar = tiene("--forzar");

/* --- clave --------------------------------------------------------------- */

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

/* --- utilidades ---------------------------------------------------------- */

const SUFIJO = process.env.DVV_SUFIJO ?? "";
const rutaDe = a => {
  const estilo = CONFIG.estilos[a.estilo];
  return path.join(RAIZ, a.carpeta ?? estilo.carpeta, `${a.id}${SUFIJO}.webp`);
};

function promptDe(a) {
  const e = CONFIG.estilos[a.estilo];
  return e.prefijo + a.prompt + e.sufijo;
}

async function generar(a, clave) {
  const e = CONFIG.estilos[a.estilo];
  const cuerpo = {
    contents: [{ parts: [{ text: promptDe(a) }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: a.aspecto ?? e.aspecto,
        imageSize: a.tamano ?? e.tamano
      }
    }
  };

  const modelo = a.modelo ?? CONFIG.modelo;
  const res = await fetch(`${ENDPOINT}/${modelo}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": clave, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo)
  });

  const datos = await res.json();
  if (datos.error) throw new Error(`${datos.error.status}: ${datos.error.message}`);

  const cand = datos.candidates?.[0];
  if (!cand) throw new Error("la API no devolvió ningún candidato");

  const parte = cand.content?.parts?.find(p => p.inlineData);
  if (!parte) {
    const texto = cand.content?.parts?.find(p => p.text)?.text ?? "";
    throw new Error(`sin imagen (finishReason: ${cand.finishReason}) ${texto.slice(0, 160)}`);
  }
  return Buffer.from(parte.inlineData.data, "base64");
}

/**
 * Foundry prefiere WebP: un battlemap baja de ~4 MB a menos de 1 MB.
 *
 * `recortar` elimina el margen uniforme que el modelo agrega a veces alrededor
 * del mapa. Pelear eso desde el prompt es una ruleta —  al forzar «sin borde»
 * reaparece el texto que ya habíamos sacado— así que se resuelve acá, que es
 * determinista.
 */
function aWebp(crudo, destino, { recortar = false } = {}) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, crudo);
  try {
    const args = [tmp];
    if (recortar) args.push("-fuzz", "8%", "-trim", "+repage");
    args.push("-quality", String(CALIDAD_WEBP), destino);
    execFileSync("magick", args, { stdio: "pipe" });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/* --- main ---------------------------------------------------------------- */

if (tiene("--listar")) {
  for (const a of CONFIG.assets) {
    const p = rutaDe(a);
    const estado = fs.existsSync(p) ? "✓" : "·";
    console.log(`  ${estado} ${a.id.padEnd(20)} ${a.estilo.padEnd(10)} ${a.nota ?? ""}`);
  }
  process.exit(0);
}

const clave = leerClave();
if (!clave) {
  console.error("No encontré GOOGE_AI_STUDIO_API_KEY en el entorno ni en .env.");
  process.exit(1);
}

let cola = CONFIG.assets;
if (soloIds) {
  cola = cola.filter(a => soloIds.includes(a.id));
  const faltantes = soloIds.filter(id => !CONFIG.assets.some(a => a.id === id));
  if (faltantes.length) {
    console.error(`Ids desconocidos: ${faltantes.join(", ")}`);
    process.exit(1);
  }
}
if (!forzar) cola = cola.filter(a => !fs.existsSync(rutaDe(a)));

if (!cola.length) {
  console.log("Nada que generar. Usá --forzar para regenerar, o --listar para ver el estado.");
  process.exit(0);
}

console.log(`Generando ${cola.length} imagen(es) con ${CONFIG.modelo}\n`);

let ok = 0;
const fallos = [];

for (const [i, a] of cola.entries()) {
  const destino = rutaDe(a);
  const etiqueta = `[${i + 1}/${cola.length}] ${a.id}`;
  process.stdout.write(`${etiqueta.padEnd(28)} … `);
  try {
    const crudo = await generar(a, clave);
    aWebp(crudo, destino, { recortar: a.estilo === "battlemap" });
    const kb = Math.round(fs.statSync(destino).size / 1024);
    console.log(`✓ ${String(kb).padStart(5)} KB  ${path.relative(RAIZ, destino)}`);
    ok++;
  } catch (err) {
    console.log(`✗ ${err.message}`);
    fallos.push({ id: a.id, error: err.message });
  }
}

console.log(`\n${ok} generada(s), ${fallos.length} fallida(s).`);
if (fallos.length) {
  for (const f of fallos) console.error(`  ${f.id}: ${f.error}`);
  console.error(`\nReintentá con: node tools/generar-arte.mjs --solo ${fallos.map(f => f.id).join(",")}`);
  process.exit(1);
}
