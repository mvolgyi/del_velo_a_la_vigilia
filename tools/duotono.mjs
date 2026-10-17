#!/usr/bin/env node
/**
 * Imágenes de la guía con el tratamiento de la web de World of Darkness:
 * foto en tres tintas (negro → el naranja del libro → casi blanco) muy
 * contrastada, con un barrido horizontal de líneas que la «rompe» como una
 * señal de video. El nombre NO va en la imagen: lo pone la guía encima en
 * CSS, así queda nítido.
 *
 *   assets/credos-crudo/credo-<id>.webp → assets/guia/credos/<id>.webp   (1600 × 900)
 *   assets/retratos/<id>.webp           → assets/guia/pnj/<id>.webp      (900 × 1200)
 *   assets/mapas/<id>.webp              → assets/guia/escenas/<id>.webp  (1600 × 1200, interiores)
 *   assets/mapas/landing.webp, portada  → assets/guia/<id>.webp
 *
 * Uso: node tools/duotono.mjs [--solo <id>]   (solo rehace lo que falta o cambió)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const solo = (() => { const i = argv.indexOf("--solo"); return i >= 0 ? argv[i + 1] : null; })();

const PLANOS = fs.readdirSync(path.join(RAIZ, "content/planos")).filter(f => f.endsWith(".json")).sort()
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(RAIZ, "content/planos", f), "utf8")).planos ?? []).map(p => p.id);

/** Trabajos: [origen, destino, ancho, alto, id]. */
const trabajos = [];
const lista = (dir, re, destDir, W, H, idDe = f => f.replace(/\.webp$/, "")) => {
  const d = path.join(RAIZ, dir);
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d).filter(f => re.test(f))) trabajos.push([path.join(d, f), path.join(RAIZ, destDir, `${idDe(f)}.webp`), W, H, idDe(f)]);
};
lista("assets/credos-crudo", /^credo-.*\.webp$/, "assets/guia/credos", 1600, 900, f => f.replace(/^credo-/, "").replace(/\.webp$/, ""));
lista("assets/retratos", /\.webp$/, "assets/guia/pnj", 900, 1200);
lista("assets/mapas", new RegExp(`^(${PLANOS.join("|")})\\.webp$`), "assets/guia/escenas", 1600, 1200);
lista("assets/mapas", /^(landing|malaga)\.webp$/, "assets/guia", 1600, 900);
lista("assets/portadas", /^portada\.webp$/, "assets/guia", 900, 1200);

let n = 0;
for (const [origen, destino, W, H, id] of trabajos) {
  if (solo && id !== solo) continue;
  if (!solo && fs.existsSync(destino) && fs.statSync(destino).mtimeMs > fs.statSync(origen).mtimeMs) continue;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  execFileSync("magick", [
    origen,
    "-resize", `${W}x${H}^`, "-gravity", H > W ? "north" : "center", "-extent", `${W}x${H}`,
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
  console.log(`✓ ${path.relative(RAIZ, destino).padEnd(40)} ${Math.round(fs.statSync(destino).size / 1024)} KB`);
  n++;
}
console.log(n ? `${n} imagen(es)` : "Nada que tratar.");
