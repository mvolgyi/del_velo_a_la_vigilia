#!/usr/bin/env node
/**
 * Tokens cenitales a partir del arte crudo generado sobre fondo chroma.
 *
 *   assets/tokens-crudo/<id>.webp  (figura sobre verde #00FF00, de generar-arte)
 *     → assets/tokens/<id>.webp    (fondo transparente, recorte circular, anillo)
 *
 * El fondo se elimina por clave de color; después se recorta al contenido, se
 * centra en un lienzo cuadrado y se aplica máscara circular con un anillo
 * fino, el formato que Foundry espera para un token de 1 casilla.
 *
 * Uso: node tools/tokens.mjs [--solo <id>] [--tamano 512]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ENTRADA = path.join(RAIZ, "assets/tokens-crudo");
const SALIDA = path.join(RAIZ, "assets/tokens");
const argv = process.argv.slice(2);
const valor = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const solo = valor("--solo");
const TAM = Number(valor("--tamano") ?? 512);
const ANILLO = "#2b2b2b";

fs.mkdirSync(SALIDA, { recursive: true });
const archivos = fs.readdirSync(ENTRADA).filter(f => f.endsWith(".webp") && (!solo || f === `${solo}.webp`));
for (const f of archivos) {
  const id = f.replace(/\.webp$/, "");
  const entrada = path.join(ENTRADA, f);
  const destino = path.join(SALIDA, `${id}.webp`);
  const interior = TAM - 24; // margen para el anillo
  const magick = [
    entrada,
    // 1. fondo chroma → transparente (tolerancia amplia: el modelo no da un verde perfecto)
    "-fuzz", "30%", "-transparent", "#00FF00",
    // 2. limpiar: motas sueltas del fondo (Open) y halo verde en los bordes (Erode)
    "-channel", "A", "-morphology", "Open", "Disk:2.5", "-morphology", "Erode", "Diamond:1", "+channel",
    "-trim", "+repage",
    // 3. ajustar al círculo interior y centrar en lienzo cuadrado
    "-resize", `${interior}x${interior}`,
    "-background", "none", "-gravity", "center", "-extent", `${TAM}x${TAM}`,
    // 4. máscara circular: DstIn conserva la transparencia del fondo keyeado
    //    y además recorta lo que queda fuera del círculo
    "(", "-size", `${TAM}x${TAM}`, "xc:none", "-fill", "white",
      "-draw", `circle ${TAM / 2},${TAM / 2} ${TAM / 2},10`, ")",
    "-compose", "DstIn", "-composite",
    // 5. anillo
    "-fill", "none", "-stroke", ANILLO, "-strokewidth", "8",
    "-draw", `circle ${TAM / 2},${TAM / 2} ${TAM / 2},10`,
    "-define", "webp:lossless=false", "-quality", "90",
    destino
  ];
  execFileSync("magick", magick, { stdio: "pipe" });
  const kb = Math.round(fs.statSync(destino).size / 1024);
  console.log(`✓ ${id.padEnd(18)} ${kb} KB`);
}
