#!/usr/bin/env node
/**
 * Tiles de muebles móviles a partir del arte crudo generado sobre fondo chroma.
 *
 *   assets/tiles-crudo/<id>.webp  (objeto sobre verde #00FF00, de generar-arte --estilo tile)
 *     → assets/tiles/<id>.webp    (fondo transparente, recortado al contenido)
 *
 * El arte se genera con el eje largo horizontal y, en asientos, el respaldo
 * arriba; construir-contenido lo rota según `hacia` de cada mueble del plano.
 * El lado largo se limita a --tamano px (un sofá de 8 pies ocupa 240 px en la
 * escena: 512 deja margen para el zoom sin pesar).
 *
 * Uso: node tools/tiles.mjs [--solo <id>] [--tamano 512]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ENTRADA = path.join(RAIZ, "assets/tiles-crudo");
const SALIDA = path.join(RAIZ, "assets/tiles");
const argv = process.argv.slice(2);
const valor = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const solo = valor("--solo");
const TAM = Number(valor("--tamano") ?? 512);

const archivos = fs.existsSync(ENTRADA)
  ? fs.readdirSync(ENTRADA).filter(f => f.endsWith(".webp") && (!solo || f === `${solo}.webp`))
  : [];
if (!archivos.length) {
  console.error(solo ? `No encontré ${solo}.webp en assets/tiles-crudo.` : "No hay tiles crudos en assets/tiles-crudo.");
  process.exit(1);
}

fs.mkdirSync(SALIDA, { recursive: true });
for (const f of archivos) {
  const destino = path.join(SALIDA, f);
  execFileSync("magick", [
    path.join(ENTRADA, f),
    // Mismo keying que los tokens: tolerancia amplia (el verde del modelo no es
    // perfecto), Open quita motas sueltas, Erode come el halo verde del borde.
    "-fuzz", "30%", "-transparent", "#00FF00",
    "-channel", "A", "-morphology", "Open", "Disk:2.5", "-morphology", "Erode", "Diamond:1", "+channel",
    // Restos de verde en bordes semitransparentes: desaturarlos.
    "-channel", "G", "-fx", "min(g, max(r, b) * 1.08)", "+channel",
    "-trim", "+repage",
    "-resize", `${TAM}x${TAM}>`,
    "-define", "webp:lossless=false", "-define", "webp:alpha-quality=100", "-quality", "90",
    destino
  ], { stdio: "pipe" });
  const kb = Math.round(fs.statSync(destino).size / 1024);
  const dims = execFileSync("magick", ["identify", "-format", "%wx%h", destino]).toString();
  console.log(`✓ ${f.replace(/\.webp$/, "").padEnd(26)} ${dims.padEnd(8)} ${kb} KB`);
}
