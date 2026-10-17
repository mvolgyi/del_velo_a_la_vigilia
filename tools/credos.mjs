#!/usr/bin/env node
/**
 * Bandas de Credo para la guía, con el tratamiento de la web de World of
 * Darkness: foto en dos tintas (negro → naranja) muy contrastada, con un
 * barrido horizontal de líneas que la «rompe» como una señal de video.
 *
 *   assets/credos-crudo/credo-<id>.webp  (foto nocturna, de generar-arte --estilo credo)
 *     → assets/credos/<id>.webp          (1600 × 900, duotono naranja, líneas)
 *
 * El nombre del Credo NO va en la imagen: lo pone la guía encima en CSS, así
 * queda nítido y traducible.
 *
 * Uso: node tools/credos.mjs [--solo <id>]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ENTRADA = path.join(RAIZ, "assets/credos-crudo");
const SALIDA = path.join(RAIZ, "assets/credos");
const argv = process.argv.slice(2);
const solo = (() => { const i = argv.indexOf("--solo"); return i >= 0 ? argv[i + 1] : null; })();
const W = 1600, H = 900;

const archivos = fs.existsSync(ENTRADA) ? fs.readdirSync(ENTRADA).filter(f => f.endsWith(".webp") && (!solo || f === `credo-${solo}.webp`)) : [];
if (!archivos.length) { console.error("No hay fotos en assets/credos-crudo (node tools/generar-arte.mjs --estilo credo)."); process.exit(1); }
fs.mkdirSync(SALIDA, { recursive: true });

for (const f of archivos) {
  const id = f.replace(/^credo-/, "").replace(/\.webp$/, "");
  const destino = path.join(SALIDA, `${id}.webp`);
  execFileSync("magick", [
    path.join(ENTRADA, f),
    "-resize", `${W}x${H}^`, "-gravity", "center", "-extent", `${W}x${H}`,
    // 1. blanco y negro duro, abierto en las luces
    "-colorspace", "Gray", "-normalize", "-sigmoidal-contrast", "9x35%", "-gamma", "1.6", "-set", "colorspace", "sRGB",
    // 2. tres tintas por tabla: negro → el naranja del libro → casi blanco
    "(", "-size", "1x120", "gradient:#070707-#f58220", "-size", "1x136", "gradient:#f58220-#fff4e8", "-append", ")", "-clut",
    // 3. barrido horizontal de líneas finas (una de cada dos filas, algo más oscura)
    "(", "-size", `${W}x${H}`, "pattern:horizontal2", "-negate", "-fill", "#ffffff", "-colorize", "55", ")",
    "-compose", "Multiply", "-composite",
    // 4. un arrastre horizontal leve, como una señal interferida
    "(", "+clone", "-motion-blur", "0x22+0", ")",
    "-compose", "Blend", "-define", "compose:args=30", "-composite",
    "-define", "webp:method=5", "-quality", "82",
    destino
  ], { stdio: "pipe" });
  const kb = Math.round(fs.statSync(destino).size / 1024);
  console.log(`✓ ${id.padEnd(16)} ${kb} KB`);
}
