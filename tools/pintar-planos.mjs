#!/usr/bin/env node
/**
 * Pinta un plano vectorial con calidad de mapa publicado, sin perder la
 * geometría.
 *
 * El renderer vectorial produce la ESTRUCTURA (habitaciones, vanos, escala
 * exacta) pero un procedural no pinta. El modelo pinta muy bien pero no
 * garantiza medidas. Se encadenan y se corrige al final:
 *
 *   1. Renderizar el esquema desde el plano.
 *   2. Repintarlo con el modelo, exigiendo que no mueva nada.
 *   3. Detectar el muro exterior en el resultado y reescalar para que caiga
 *      EXACTO sobre las coordenadas del plano.
 *
 * El paso 3 es lo que lo hace utilizable: sin corregir, el modelo deja ~1% de
 * anisotropía, suficiente para que los muros de Foundry no coincidan con los
 * pintados.
 *
 * Consistencia del set: el primer mapa que se pinta (`referencia` en
 * arte.config.json) fija el look; los demás reciben un recorte suyo como
 * segunda imagen, sólo como referencia de RENDER.
 *
 * Uso: node tools/pintar-planos.mjs [--solo somnia-planta-nueva] [--forzar] [--referencia <id>]
 * Env: DVV_SUFIJO  sufijo para el archivo de salida (pruebas A/B)
 *
 * Sin --forzar no repinta un mapa que ya existe: cada repintado es una tirada.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderSvg, normalizar, esMovil, PX_POR_PIE } from "./planos.mjs";
import { cargarPlanos } from "./construir-planos.mjs";

const RAIZ = path.resolve(import.meta.dirname, "..");
const SUFIJO = process.env.DVV_SUFIJO ?? "";
const SALIDA = path.join(RAIZ, "assets/mapas");
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, "tools/arte.config.json"), "utf8"));
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const LIMITE_ANISOTROPIA = 3;     // % de deriva tolerable tras corregir
const CALIDAD_MINIMA = 0.35;      // superposición mínima de perfiles de muro (1 = idéntico)
const INTENTOS = 4;               // el repintado es una tirada: a veces reencuadra

const argv = process.argv.slice(2);
const solo = (() => { const i = argv.indexOf("--solo"); return i >= 0 ? argv[i + 1] : null; })();
const forzar = argv.includes("--forzar");
const refCli = (() => { const i = argv.indexOf("--referencia"); return i >= 0 ? argv[i + 1] : null; })();

function leerClave() {
  if (process.env.GOOGE_AI_STUDIO_API_KEY) return process.env.GOOGE_AI_STUDIO_API_KEY;
  const env = path.join(RAIZ, ".env");
  if (!fs.existsSync(env)) return null;
  for (const l of fs.readFileSync(env, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?GOOGE_AI_STUDIO_API_KEY\s*=\s*(.*)$/.exec(l);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const MATERIALES = {
  linoleo: "worn grey-blue hospital vinyl floor tiles with scuffs and wheel marks",
  baldosa: "pale porcelain floor tiles with grey grout",
  azulejo: "small white bathroom tiles with grimy grout",
  terrazo: "old speckled terrazzo floor tiles, cracked and dull",
  moqueta: "dark grey office carpet tiles laid in alternating directions",
  tecnico: "raised data-centre floor panels, some perforated for ventilation",
  hormigon: "stained polished concrete slab with expansion joints and oil stains",
  parquet: "worn, dull wooden parquet strips, scratched along the walking paths",
  piedra: "old cut stone flagstones with mortar joints",
  iglesia: "a chequerboard of worn light and dark marble church floor tiles",
  "piedra-humeda": "damp medieval flagstones, dark with moisture, white salt bloom in the joints",
  tierra: "packed earth",
  grava: "loose pale gravel"
};

const OBJETOS = {
  "camilla-medica": "a modern hospital bed with side rails, white sheet and pillow (empty, nobody in it)",
  camilla: "a hospital trolley bed (empty)",
  rack: "a black server rack cabinet",
  escritorio: "an office desk with a switched-off monitor and keyboard",
  cama: "a bed with rumpled sheets (empty)",
  heladera: "an old refrigerator",
  estante: "metal or wooden shelving with boxes and supplies",
  casillero: "a row of steel lockers",
  corcho: "a cork board on the wall with pinned photos and red thread (no readable text)",
  mostrador: "a reception counter with a dark, switched-off monitor",
  mesada: "a kitchen counter",
  lector: "a small wall-mounted card reader beside the door frame (unlit)",
  relicario: "an ornate medieval stone-and-brass reliquary casket",
  nicho: "a dark burial niche cut into the wall",
  altar: "a bare stone altar",
  columna: "a round stone column",
  banco: "a long wooden bench",
  pila: "a stone basin",
  escalera: "a flight of stairs going down",
  trampilla: "the outline of a closed hatch in the floor",
  inodoro: "a toilet", lavabo: "a washbasin", ducha: "a shower tray",
  contenedor: "a metal container",
  maquina: "heavy building machinery (boiler / electrical board)"
};

/** El prompt describe la planta habitación por habitación, no «una clínica». */
function prompt(plano, conReferencia) {
  const pl = normalizar(plano);
  // Las habitaciones van por POSICIÓN, no por nombre: con el nombre en el
  // prompt el modelo tiende a rotular las salas, y el texto está prohibido.
  const marco = lienzo(plano);
  const dx = (marco.W - plano.ancho * PX_POR_PIE) / 2, dy = (marco.H - plano.alto * PX_POR_PIE) / 2;
  const pct = (v, d, total) => Math.round(((v * PX_POR_PIE + d) / total) * 100);
  const cuartos = pl.habitaciones
    .map(h => `- the room centred ${pct(h.x + h.w / 2, dx, marco.W)}% across and ${pct(h.y + h.h / 2, dy, marco.H)}% down ` +
      `(${h.w} × ${h.h} ft): ${MATERIALES[h.piso ?? "linoleo"] ?? h.piso}`)
    .join("\n");
  // Un mueble puede traer su propia descripción (el rack prohibido no es un
  // rack cualquiera). Los móviles no están en el esquema y no se nombran.
  const vistos = new Map();
  for (const m of (pl.muebles ?? []).filter(m => !esMovil(m))) {
    const t = m.desc ?? OBJETOS[m.tipo] ?? m.tipo;
    if (!vistos.has(t)) vistos.set(t, t);
  }
  const objetos = [...vistos.values()].map(t => `- ${t}`).join("\n") || "- (none)";
  const hayVidrio = (pl.vanos ?? []).some(v => v.tipo === "vidrio");
  const e = CONFIG.estilos.battlemap;

  const cabecera = conReferencia
    ? `You are given TWO images.

IMAGE 1 is a surveyor's floor plan. IMAGE 2 is a finished battlemap from the same product line, provided ONLY as a rendering reference.

Your task: repaint IMAGE 1 as a finished battlemap, keeping IMAGE 1's architecture exactly, and matching IMAGE 2's rendering exactly.

MATCH IMAGE 2 IN: line weight and colour of the ink outlines; overall desaturation and coolness; tonal contrast between floors and objects; how furniture is drawn as solid objects with visible thickness; how much grime is acceptable. DO NOT copy IMAGE 2's content, rooms, layout or props. Only its rendering.`
    : `You are given ONE image: a surveyor's floor plan. Repaint it as a finished battlemap, keeping its architecture exactly.`;

  return `${cabecera}

ABSOLUTELY PRESERVE, to the pixel: the position, thickness and length of every wall; the position and width of every doorway gap; the outline of every room; the position and footprint of every piece of furniture; the image dimensions and the framing. Treat the input as a surveyor's drawing you are rendering, not as inspiration. Do not add or remove rooms. Do not add walls, partitions, low walls, railings or counters that are not in the plan, and do not subdivide any room. Do not close or move any opening. Do not shift, crop, zoom or re-frame anything.

FLOOR MATERIALS BY ROOM (follow the tile pattern drawn in the plan; never write room names or any label on the map):
${cuartos}

WHAT THE SHAPES IN THE PLAN REPRESENT — render each one as the real object, in its exact position and footprint:
${objetos}
${hayVidrio ? "\nThe thin pale-blue strips with small metal posts are fixed floor-to-ceiling GLASS WALLS: render them as thick transparent glass panes in slim steel frames, seen from above. They are walls, not doors.\n" : ""}
OUTSIDE THE BUILDING: continue to all four edges with ${plano.exterior ?? "wet asphalt"}. Never leave paper, white space or any margin outside the walls. The painting must bleed to every edge of the image.

ADD NOTHING THAT IS NOT IN THE PLAN. Movable furniture is placed later as separate tiles, so do not invent chairs, stools, office chairs, sofas, trolleys, carts, buckets, boxes on the floor, plants, bins or loose equipment. Furniture footprints stay exactly as drawn (a straight counter stays straight).

THE MAP MUST BE COMPLETELY EMPTY OF INHABITANTS. No people, no figures, no patients in the beds, no silhouettes, no corpses, no animals. Only architecture, fixed furniture and debris.

DOORWAY GAPS MUST REMAIN EMPTY OPENINGS. Never draw a door leaf, panel, shutter or slab in them: the virtual tabletop draws the door itself.

NO LIGHT SOURCES: do not paint glowing screens, lit lamps, emergency-light spots, light pools or halos.

NO TEXT OR PSEUDO-TEXT: screens, displays, keypads, labels, papers and photos carry no letters, digits, symbols or scribbles that look like writing — screens are plain dark glass.

${e.sufijo.replace(/^\n+/, "")}`;
}

/** Recorte central de un mapa ya terminado, como referencia de render. */
function referenciaEstilo(plano) {
  const id = refCli ?? plano.referencia ?? CONFIG.referencia;
  if (!id || id === plano.id) return null;
  const ref = path.join(SALIDA, `${id}.webp`);
  if (!fs.existsSync(ref)) return null;
  const recorte = path.join(SALIDA, ".ref.jpg");
  execFileSync("magick", [ref, "-gravity", "center", "-crop", "1100x850+0+0", "+repage",
    "-quality", "92", recorte], { stdio: "pipe" });
  const b64 = fs.readFileSync(recorte).toString("base64");
  fs.rmSync(recorte, { force: true });
  return b64;
}

/** Proporciones que acepta el modelo. */
const ASPECTOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/**
 * Lienzo que se le manda al modelo: el plano centrado y rellenado con el color
 * del exterior hasta la proporción soportada más cercana. Si se le manda una
 * proporción que no soporta, la estira a la suya y eso es anisotropía pura.
 */
export function lienzo(plano) {
  const W = plano.ancho * PX_POR_PIE, H = plano.alto * PX_POR_PIE;
  const [nombre, r] = ASPECTOS.map(a => { const [x, y] = a.split(":").map(Number); return [a, x / y]; })
    .sort((a, b) => Math.abs(Math.log(a[1] / (W / H))) - Math.abs(Math.log(b[1] / (W / H))))[0];
  return r >= W / H
    ? { aspecto: nombre, W: Math.round(H * r), H }
    : { aspecto: nombre, W, H: Math.round(W / r) };
}

async function repintar(plano, svgPath, clave) {
  const refB64 = referenciaEstilo(plano);
  const jpg = `${svgPath}.jpg`;
  const marco = lienzo(plano);
  const fondo = execFileSync("magick", [svgPath, "-format", "%[pixel:p{3,3}]", "info:"], { encoding: "utf8" }).trim();
  execFileSync("magick", [svgPath, "-gravity", "center", "-background", fondo,
    "-extent", `${marco.W}x${marco.H}`, "-quality", "94", jpg], { stdio: "pipe" });
  const b64 = fs.readFileSync(jpg).toString("base64");
  fs.rmSync(jpg, { force: true });

  const partes = [
    { text: prompt(plano, Boolean(refB64)) },
    { inline_data: { mime_type: "image/jpeg", data: b64 } }
  ];
  if (refB64) partes.push({ inline_data: { mime_type: "image/jpeg", data: refB64 } });

  const res = await fetch(`${ENDPOINT}/${CONFIG.modelo}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": clave, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: partes }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: marco.aspecto, imageSize: plano.tamano ?? "2K" } }
    })
  });
  const datos = await res.json();
  if (datos.error) {
    const err = new Error(`${datos.error.status}: ${datos.error.message}`);
    err.fatal = ["RESOURCE_EXHAUSTED", "PERMISSION_DENIED", "UNAUTHENTICATED", "INVALID_ARGUMENT", "NOT_FOUND"]
      .includes(datos.error.status);
    throw err;
  }
  const parte = datos.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!parte) throw new Error(`sin imagen (${datos.candidates?.[0]?.finishReason})`);
  return { buffer: Buffer.from(parte.inlineData.data, "base64"), conReferencia: Boolean(refB64) };
}

/**
 * Registra el repintado contra el esquema y lo reescala para que cada muro
 * caiga EXACTO donde dice el plano. Sin esto los muros de Foundry quedan
 * corridos respecto del dibujo (el modelo deja ~1% de deriva anisotrópica y
 * a veces corre el encuadre unos píxeles).
 *
 * Método: perfiles de proyección. Los muros son líneas largas y rectas, así
 * que la suma por columna de los bordes verticales tiene picos donde hay muros
 * verticales (y lo mismo por fila para los horizontales). Se busca la escala y
 * el desplazamiento de cada eje que mejor superponen el perfil del repintado
 * sobre el del esquema. Es independiente del color del exterior (asfalto
 * oscuro, roca negra, empedrado claro), que es lo que rompía la detección por
 * umbral de la caja del muro exterior.
 */
function grises(ruta, ancho) {
  const args = [ruta, "-colorspace", "gray"];
  if (ancho) args.push("-resize", `${ancho}x`);
  args.push("-blur", "0x1.5", "-format", "%w %h", "info:");
  const [w, h] = execFileSync("magick", args, { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  const raw = execFileSync("magick", [...args.slice(0, -3), "-depth", "8", "gray:-"], { maxBuffer: 1 << 28 });
  return { w, h, px: raw };
}

/** Perfil de bordes por columna (eje "x") o por fila (eje "y"), con paso alto. */
function perfil({ w, h, px }, eje) {
  const n = eje === "x" ? w : h;
  const p = new Float64Array(n);
  if (eje === "x") {
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) p[x] += Math.abs(px[y * w + x + 1] - px[y * w + x - 1]);
  } else {
    for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) p[y] += Math.abs(px[(y + 1) * w + x] - px[(y - 1) * w + x]);
  }
  // Paso alto: restar la media local para que pese el pico, no el fondo.
  const r = Math.max(4, Math.round(n / 60)), out = new Float64Array(n);
  let acc = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + p[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r), b = Math.min(n, i + r + 1);
    out[i] = Math.max(0, p[i] - (pre[b] - pre[a]) / (b - a));
    acc += out[i];
  }
  for (let i = 0; i < n; i++) out[i] /= acc || 1;
  return out;
}

/** Correlación de P (esquema, coordenadas del plano) con Q muestreado en a·x+b. */
function puntaje(P, Q, a, b, paso = 1) {
  let s = 0;
  for (let x = 0; x < P.length; x += paso) {
    if (!P[x]) continue;
    const u = a * x + b, i = Math.floor(u);
    if (i < 0 || i >= Q.length - 1) continue;
    const f = u - i;
    s += P[x] * (Q[i] * (1 - f) + Q[i + 1] * f);
  }
  return s;
}

/** Mejor (a, b) para un eje: búsqueda gruesa y después fina. */
function ajustarEje(P, Q, a0, b0) {
  let mejor = { a: a0, b: b0, s: -1 };
  const rangoB = Q.length * 0.06;
  for (let a = a0 * 0.95; a <= a0 * 1.05; a += a0 * 0.002) {
    for (let b = b0 - rangoB; b <= b0 + rangoB; b += 1.5) {
      const s = puntaje(P, Q, a, b, 2);
      if (s > mejor.s) mejor = { a, b, s };
    }
  }
  const g = { ...mejor };
  for (let a = g.a - a0 * 0.003; a <= g.a + a0 * 0.003; a += a0 * 0.0002) {
    for (let b = g.b - 3; b <= g.b + 3; b += 0.25) {
      const s = puntaje(P, Q, a, b, 1);
      if (s > mejor.s) mejor = { a, b, s };
    }
  }
  return mejor;
}

export function corregir(crudoPath, plano, destino, marco = lienzo(plano), esquemaPath) {
  const W = plano.ancho * PX_POR_PIE, H = plano.alto * PX_POR_PIE;
  const ref = grises(esquemaPath);
  const crudo = grises(crudoPath);
  // Escala nominal (px del repintado por px del plano) y posición del plano
  // centrado dentro del lienzo rellenado que se le mandó al modelo.
  const a0 = (crudo.w / marco.W + crudo.h / marco.H) / 2;
  const x = ajustarEje(perfil(ref, "x"), perfil(crudo, "x"), a0, a0 * (marco.W - W) / 2);
  const y = ajustarEje(perfil(ref, "y"), perfil(crudo, "y"), a0, a0 * (marco.H - H) / 2);

  const anisotropia = Math.abs(x.a / y.a - 1) * 100;
  if (anisotropia > LIMITE_ANISOTROPIA) {
    throw new Error(`anisotropía ${anisotropia.toFixed(1)}% (máx ${LIMITE_ANISOTROPIA}%)`);
  }
  // Si la mejor superposición es pobre, el modelo reinterpretó la planta:
  // reescalar igual produciría un mapa desalineado EN SILENCIO. Se compara
  // contra la autocorrelación perfecta del esquema consigo mismo.
  const calidad = Math.min(
    x.s / puntaje(perfil(ref, "x"), perfil(ref, "x"), 1, 0),
    y.s / puntaje(perfil(ref, "y"), perfil(ref, "y"), 1, 0));
  if (calidad < CALIDAD_MINIMA) throw new Error(`la planta no coincide (calidad ${calidad.toFixed(2)})`);

  // Transformación afín por eje: plano (X, Y) → repintado (a·X + b, c·Y + d).
  // -distort Affine con el punto de control de cada esquina la invierte exacta.
  const esquinas = [[0, 0], [W, 0], [0, H], [W, H]]
    .map(([X, Y]) => `${(x.a * X + x.b).toFixed(2)},${(y.a * Y + y.b).toFixed(2)} ${X},${Y}`).join(" ");
  execFileSync("magick", [crudoPath, "-virtual-pixel", "edge",
    "-define", `distort:viewport=${W}x${H}+0+0`, "-distort", "Affine", esquinas, "+repage",
    "-quality", "88", destino], { stdio: "pipe" });

  return { anisotropia, calidad, escala: [x.a, y.a], desplazamiento: [x.b, y.b] };
}

/* -------------------------------------------- */

if (import.meta.filename === process.argv[1]) await main();

async function main() {
const clave = leerClave();
if (!clave) { console.error("Falta GOOGE_AI_STUDIO_API_KEY en .env"); process.exit(1); }

// La referencia de estilo va primero: los demás se pintan contra ella.
const ref = CONFIG.referencia;
let planos = cargarPlanos().filter(p => !solo || p.id === solo)
  .sort((a, b) => (b.id === ref) - (a.id === ref));
if (!planos.length) { console.error("No hay planos que pintar."); process.exit(1); }

fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0;

for (const plano of planos) {
  process.stdout.write(`  ${plano.id.padEnd(22)} … `);
  const destino = path.join(SALIDA, `${plano.id}${SUFIJO}.webp`);
  if (fs.existsSync(destino) && !forzar) { console.log("ya existe (usá --forzar)"); continue; }
  const svg = path.join(SALIDA, `${plano.id}.esquema.svg`);
  const crudo = path.join(SALIDA, `${plano.id}.crudo.png`);
  const esquema = path.join(SALIDA, `${plano.id}.esquema.png`);
  try {
    fs.writeFileSync(svg, renderSvg(plano));
    execFileSync("magick", [svg, esquema], { stdio: "pipe" });
    let ultimo = null, listo = false;
    for (let intento = 1; intento <= INTENTOS && !listo; intento++) {
      try {
        const { buffer, conReferencia } = await repintar(plano, svg, clave);
        fs.writeFileSync(crudo, buffer);
        const { anisotropia, calidad } = corregir(crudo, plano, destino, lienzo(plano), esquema);
        const kb = Math.round(fs.statSync(destino).size / 1024);
        console.log(`✓ ${String(kb).padStart(5)} KB  anisotropía ${anisotropia.toFixed(2)}% ` +
          `· calidad ${calidad.toFixed(2)}${conReferencia ? " · con referencia" : ""}` +
          (intento > 1 ? `  (intento ${intento})` : ""));
        listo = true;
      } catch (err) {
        ultimo = err;
        if (err.fatal) break;
        if (intento < INTENTOS) process.stdout.write(`↻ (${err.message}) `);
      }
    }
    if (!listo) throw ultimo;
  } catch (err) {
    console.log(`✗ ${err.message}`);
    fallos++;
    if (err.fatal) { console.error("Error de la API sin reintento posible; corto acá."); break; }
  } finally {
    fs.rmSync(svg, { force: true });
    fs.rmSync(esquema, { force: true });
    if (!process.env.DVV_CONSERVAR_CRUDO) fs.rmSync(crudo, { force: true });
  }
}

process.exit(fallos ? 1 : 0);
}
