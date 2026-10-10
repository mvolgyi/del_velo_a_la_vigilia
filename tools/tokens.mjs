#!/usr/bin/env node
/**
 * Tokens cenitales a partir del arte crudo generado sobre fondo chroma.
 *
 *   assets/tokens-crudo/<id>.webp  (figura sobre verde #00FF00, de generar-arte)
 *     → assets/tokens/<id>.webp    (fondo transparente, recorte circular, anillo)
 *
 *   assets/tokens-crudo/vehiculos/<id>.webp
 *     → assets/tokens/vehiculos/<id>.webp  (fondo transparente, rectángulo 1:2
 *       de 400×800, sin anillo: un coche ocupa 2×4 casillas, no un círculo)
 *
 * El fondo se elimina por clave de color; después se recorta al contenido, se
 * centra en el lienzo y, en el modo PNJ, se aplica máscara circular con un
 * anillo fino, el formato que Foundry espera para un token de 1 casilla.
 *
 * Uso: node tools/tokens.mjs [--solo <id>] [--tamano 512]
 *   --solo busca el id en ambos modos (PNJ y vehículos).
 *   --tamano solo afecta a los tokens circulares.
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

const VEH_ANCHO = 400, VEH_ALTO = 800, VEH_MARGEN = 8;

// 1-2 compartidos: fondo chroma → transparente y limpieza del alfa
const KEY_Y_LIMPIEZA = [
  // tolerancia amplia: el modelo no da un verde perfecto
  "-fuzz", "30%", "-transparent", "#00FF00",
  // motas sueltas del fondo (Open) y halo verde en los bordes (Erode)
  "-channel", "A", "-morphology", "Open", "Disk:2.5", "-morphology", "Erode", "Diamond:1", "+channel",
  "-trim", "+repage"
];

const listar = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => f.endsWith(".webp") && (!solo || f === `${solo}.webp`))
  : [];

function circular(entrada, destino) {
  const interior = TAM - 24; // margen para el anillo
  return [
    entrada,
    ...KEY_Y_LIMPIEZA,
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
}

function rectangular(entrada, destino) {
  return [
    entrada,
    ...KEY_Y_LIMPIEZA,
    // 3. encajar sin deformar dentro de 400×800 y centrar sobre transparente
    "-resize", `${VEH_ANCHO - 2 * VEH_MARGEN}x${VEH_ALTO - 2 * VEH_MARGEN}`,
    "-background", "none", "-gravity", "center", "-extent", `${VEH_ANCHO}x${VEH_ALTO}`,
    "-define", "webp:lossless=false", "-quality", "90",
    destino
  ];
}

const trabajos = [
  ...listar(ENTRADA).map(f => ({ f, dir: ENTRADA, sal: SALIDA, args: circular })),
  ...listar(path.join(ENTRADA, "vehiculos"))
    .map(f => ({ f, dir: path.join(ENTRADA, "vehiculos"), sal: path.join(SALIDA, "vehiculos"), args: rectangular }))
];
if (solo && !trabajos.length) {
  console.error(`No encontré ${solo}.webp en assets/tokens-crudo ni en assets/tokens-crudo/vehiculos.`);
  process.exit(1);
}

for (const { f, dir, sal, args } of trabajos) {
  const id = f.replace(/\.webp$/, "");
  const destino = path.join(sal, `${id}.webp`);
  fs.mkdirSync(sal, { recursive: true });
  execFileSync("magick", args(path.join(dir, f), destino), { stdio: "pipe" });
  const kb = Math.round(fs.statSync(destino).size / 1024);
  const dims = execFileSync("magick", ["identify", "-format", "%wx%h", destino]).toString();
  console.log(`✓ ${id.padEnd(18)} ${dims.padEnd(8)} ${kb} KB`);
}
