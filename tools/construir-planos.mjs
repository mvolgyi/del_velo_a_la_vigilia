#!/usr/bin/env node
/**
 * Rasteriza los planos vectoriales a un ESQUEMA (`<id>.esquema.webp`).
 *
 * El mapa final NO sale de acá: lo produce pintar-planos.mjs, que usa este
 * mismo esquema como fuente de geometría y lo repinta con el modelo. Este
 * script escribe `.esquema.webp` justamente para no pisar `<id>.webp`: si
 * escribiera el nombre final, cada build revertiría el mapa pintado al
 * vectorial y el trabajo de pintura desaparecería en silencio.
 *
 * Si todavía no hay mapa pintado, construir-contenido usa el esquema como
 * fondo provisional de la escena (y lo avisa).
 *
 * Los muros y las regiones NO se generan acá: los deriva construir-contenido
 * del mismo archivo, al armar las escenas. Así el mapa y la geometría que
 * bloquea el paso no pueden desincronizarse.
 *
 * Uso: node tools/construir-planos.mjs [--solo somnia-planta-nueva]
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderSvg, derivarMuros, mueblesMoviles, GRID_PX } from "./planos.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ENTRADA = path.join(RAIZ, "content/planos");
const SALIDA = path.join(RAIZ, "assets/mapas");

export function cargarPlanos() {
  if (!fs.existsSync(ENTRADA)) return [];
  return fs.readdirSync(ENTRADA)
    .filter(f => f.endsWith(".json"))
    .sort()
    .flatMap(f => JSON.parse(fs.readFileSync(path.join(ENTRADA, f), "utf8")).planos ?? []);
}

if (import.meta.filename === process.argv[1]) {
  const argv = process.argv.slice(2);
  const solo = (() => { const i = argv.indexOf("--solo"); return i >= 0 ? argv[i + 1] : null; })();
  const planos = cargarPlanos().filter(p => !solo || p.id === solo);
  if (!planos.length) {
    console.error(solo ? `No encontré el plano "${solo}".` : "No hay planos en content/planos/.");
    process.exit(1);
  }

  fs.mkdirSync(SALIDA, { recursive: true });

  for (const plano of planos) {
    const svg = renderSvg(plano);
    const tmp = path.join(SALIDA, `${plano.id}.svg`);
    const destino = path.join(SALIDA, `${plano.id}.esquema.webp`);
    fs.writeFileSync(tmp, svg);
    try {
      execFileSync("magick", ["-background", "none", tmp, "-quality", "92", destino], { stdio: "pipe" });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    const muros = derivarMuros(plano);
    const cuenta = t => muros.filter(m => m._tipo === t).length;
    const kb = Math.round(fs.statSync(destino).size / 1024);
    const moviles = mueblesMoviles(plano).length;
    console.log(`  ${plano.id.padEnd(22)} ${String(kb).padStart(5)} KB  ` +
      `${cuenta("muro")} muros · ${cuenta("puerta") + cuenta("puerta-vidrio")} puertas · ` +
      `${cuenta("vidrio")} vidrios · ${moviles} móvil(es) sin pintar · grid ${GRID_PX}px`);
  }
  console.log(`✓ ${planos.length} plano(s) → ${path.relative(RAIZ, SALIDA)}`);
}
