#!/usr/bin/env node
/**
 * Motor de SECTORES — manzanas caminables de Málaga desde OpenStreetMap.
 *
 * Cada sector de content/sectores.json es un rectángulo de `ancho × alto`
 * metros (80 × 60) alrededor de `centro`, a 1 m = 50 px (4000 × 3000 px). De
 * los datos crudos de Overpass (cache/osm/*.json) salen, con la MISMA
 * geometría:
 *
 *   1. El ESQUEMA vectorial nocturno (SVG → assets/mapas/sectores/<id>.esquema.webp):
 *      asfalto húmedo, aceras de baldosa, azoteas vistas desde arriba con
 *      tinta en el contorno y sombra abajo-derecha, verde, arena, mar, muelles.
 *      Sin texto, sin grid, sin luz pintada, sin coches ni gente. Lo repinta
 *      tools/pintar-sectores.mjs (assets/mapas/sectores/<id>.webp).
 *   2. Los MUROS (contorno de cada edificio; las medianeras compartidas por dos
 *      edificios se descartan), las PUERTAS de las `entradas`, las FAROLAS y
 *      las REGIONES de transición → content/sectores/geo/<id>.json.
 *   3. Las regiones gemelas en los interiores (content/planos/<archivo>.json).
 *
 * Proyección: la del mapa general (content/malaga/geo.json, equirectangular,
 * latMedia 36.715). Un punto se pasa a metros del mapa general con
 *     xm = (lon − oeste) / (este − oeste) · ancho · metrosPorPixel
 *     ym = (norte − lat) / (norte − sur) · alto  · metrosPorPixel
 * y el sector es la ventana [xm0 − ancho/2, xm0 + ancho/2] × [ym0 − alto/2, …]
 * alrededor de su centro. Así un sector cae EXACTO sobre su lugar en malaga.webp.
 *
 * -------------------------------------------------------------------------
 * FORMATO DE content/sectores/geo/<id>.json (todo en PÍXELES del sector,
 * origen arriba-izquierda, 50 px por metro):
 *
 *   {
 *     id, nombre, ancho: 4000, alto: 3000, pxPorMetro: 50,
 *     centro: { lat, lon },
 *     bbox: { oeste, este, sur, norte },                 // lat/lon del rectángulo
 *     enMalaga: { region: "malaga:<id>", x, y, w, h },  // el bbox en px de malaga.webp
 *     muros:   [{ c: [x1,y1,x2,y2], door: 0|1, ds: 0, move, sight, light, sound, doorSound? }],
 *     puertas: [{ entrada: n, poi, nombre, c: [x1,y1,x2,y2], destino, sala }],
 *     luces:   [{ x, y, preset: "farola"|"neon", nombre }],
 *     regiones:[{ id, nombre, x, y, w, h, destino: { escena, region, uuid } | null }],
 *     aparcamientos: [{ x, y, rotacion }],             // centro del coche y giro del token
 *     puntos:  [{ poi, x, y, edificio: <osm id>|null, aproximado: bool }],
 *     edificios, avisos: [...]
 *   }
 *
 *   `move/sight/light/sound` son los valores de Foundry (20 = normal, 0 = nada).
 *   Las luces van en px; los radios los pone el preset (tools/iluminacion.mjs
 *   en pies; construir-contenido los usa en metros: farola dim 12 m, bright 4 m).
 *
 * IDS DE REGIONES (convención idEstable de tools/util.mjs, la misma que usa
 * construir-contenido):
 *
 *   Escena del sector     Scene.<idEstable("escena:sector:<id>")>
 *   Región del sector     Region.<idEstable("region:sector:<id>:<region>")>
 *   Escena Málaga         Scene.<idEstable("escena:malaga")>
 *   Región de la ciudad   Region.<idEstable("region:malaga:<id>")>      (id "malaga:<id>")
 *   Escena de un plano    Scene.<idEstable("escena:<plano>")>
 *   Región de un plano    Region.<idEstable("region:<plano>:<region>")>
 *
 *   Regiones de cada sector (`id` dentro del sector):
 *     borde-n, borde-s, borde-o, borde-e   franjas de 3 m en los bordes →
 *                                          teleportToken a malaga:<id>
 *     llegada                              3 × 3 m en el eje de la calle principal;
 *                                          sin comportamiento (destino null): ahí
 *                                          aparece el token que viene de la ciudad
 *     entrada-<n>                          2 × 2 m delante de la puerta n (1, 2, …) →
 *                                          teleportToken a <plano>:desde-<id>[-<n>]
 *
 *   Regiones que este script agrega a cada plano interior destino, dentro de
 *   la `sala` de la entrada (en pies, formato de plano):
 *     desde-<id>       (desde-<id>-<n> si n ≥ 2)  llegada desde el sector; lleva
 *                      `llegada: true` y destino "<id>:entrada-<n>" para que el
 *                      build no la descarte (Foundry no rebota un token
 *                      teletransportado: la llegada no dispara la región)
 *     salida-<id>      (salida-<id>-<n> si n ≥ 2)  sobre la puerta exterior (o
 *                      la escalera) de la sala → "<id>:entrada-<n>"
 *   `ubicaciones` (opcional en content/sectores.json): { "<poi>": { lat, lon } }
 *   ubica un lugar ficticio en un edificio real del sector sin tocar el pin
 *   del mapa general (content/malaga/pois.json).
 *
 *   OJO: el destino "<id>:entrada-<n>" de un plano apunta a la escena del
 *   SECTOR (Scene.<idEstable("escena:sector:<id>")>.Region.<idEstable("region:sector:<id>:entrada-<n>")>),
 *   no a un plano.
 *
 * Uso: node tools/sectores.mjs [--solo <id>] [--sin-imagen] [--svg]
 *   --sin-imagen  solo geometría (geo JSON y regiones de planos)
 *   --svg         conserva el SVG intermedio junto al webp
 *
 * Datos: © OpenStreetMap contributors (ODbL).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { idEstable, RAIZ } from "./util.mjs";

const OSM = path.join(RAIZ, "cache/osm");
const SALIDA_IMG = path.join(RAIZ, "assets/mapas/sectores");
const SALIDA_GEO = path.join(RAIZ, "content/sectores/geo");
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, "content/sectores.json"), "utf8"));
const GEO = JSON.parse(fs.readFileSync(path.join(RAIZ, "content/malaga/geo.json"), "utf8"));
const PXM = CONFIG.pxPorMetro ?? 50;
const MARGEN = 40;   // metros de datos alrededor del sector (sombras, farolas, puertas)

/* -------------------------------------------- */
/*  Proyección (la del mapa general)            */
/* -------------------------------------------- */

const G = GEO.bbox;
const M_LON = GEO.ancho * GEO.metrosPorPixel / (G.este - G.oeste);   // metros por grado de longitud
const M_LAT = GEO.alto * GEO.metrosPorPixel / (G.norte - G.sur);     // metros por grado de latitud
const generalPx = (lat, lon) => ({
  x: (lon - G.oeste) / (G.este - G.oeste) * GEO.ancho,
  y: (G.norte - lat) / (G.norte - G.sur) * GEO.alto
});

function proyeccion(sec) {
  const { lat, lon } = sec.centro;
  const W = sec.ancho * PXM, H = sec.alto * PXM;
  const aPx = (la, lo) => [((lo - lon) * M_LON + sec.ancho / 2) * PXM, ((lat - la) * M_LAT + sec.alto / 2) * PXM];
  const bbox = {
    oeste: lon - sec.ancho / 2 / M_LON, este: lon + sec.ancho / 2 / M_LON,
    sur: lat - sec.alto / 2 / M_LAT, norte: lat + sec.alto / 2 / M_LAT
  };
  const m = MARGEN;
  const ext = {
    oeste: lon - (sec.ancho / 2 + m) / M_LON, este: lon + (sec.ancho / 2 + m) / M_LON,
    sur: lat - (sec.alto / 2 + m) / M_LAT, norte: lat + (sec.alto / 2 + m) / M_LAT
  };
  return { W, H, aPx, bbox, ext };
}

/* -------------------------------------------- */
/*  OSM                                         */
/* -------------------------------------------- */

const capas = {};
function capa(nombre) {
  if (!capas[nombre]) {
    const f = path.join(OSM, `${nombre}.json`);
    capas[nombre] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).elements : [];
  }
  return capas[nombre];
}

const toca = (el, b) => {
  const bb = el.bounds;
  if (!bb) return true;
  return !(bb.maxlat < b.sur || bb.minlat > b.norte || bb.maxlon < b.oeste || bb.minlon > b.este);
};

/** Une los ways de una multipolígono en anillos cerrados (como malaga-mapa.py). */
function coser(trozos) {
  trozos = trozos.filter(t => t.length > 1).map(t => [...t]);
  const igual = (a, b) => a[0] === b[0] && a[1] === b[1];
  const cerrados = [];
  while (trozos.length) {
    let a = trozos.pop();
    let cambio = true;
    while (!igual(a[0], a[a.length - 1]) && cambio) {
      cambio = false;
      for (let i = 0; i < trozos.length; i++) {
        const t = trozos[i];
        if (igual(t[0], a[a.length - 1])) a = a.concat(t.slice(1));
        else if (igual(t[t.length - 1], a[a.length - 1])) a = a.concat([...t].reverse().slice(1));
        else if (igual(t[t.length - 1], a[0])) a = t.concat(a.slice(1));
        else if (igual(t[0], a[0])) a = [...t].reverse().concat(a.slice(1));
        else continue;
        trozos.splice(i, 1);
        cambio = true;
        break;
      }
    }
    cerrados.push(a);
  }
  return cerrados;
}

/** Anillos exteriores e interiores en [lat, lon]. */
function anillos(el) {
  if (el.type === "way") return { ext: [(el.geometry ?? []).filter(Boolean).map(p => [p.lat, p.lon])], inn: [] };
  const ext = [], inn = [];
  for (const m of el.members ?? []) {
    if (m.type !== "way" || !m.geometry) continue;
    const g = m.geometry.filter(Boolean).map(p => [p.lat, p.lon]);
    (m.role === "inner" ? inn : ext).push(g);
  }
  return { ext: coser(ext), inn: coser(inn) };
}

const lineaDe = el => (el.geometry ?? []).filter(Boolean).map(p => [p.lat, p.lon]);

/* -------------------------------------------- */
/*  Geometría plana                             */
/* -------------------------------------------- */

function dentroAnillo([x, y], r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const dentroPoligono = (p, pol) => pol.ext.some(r => dentroAnillo(p, r)) && !pol.inn.some(r => dentroAnillo(p, r));

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), t, q };
}
function distPolilinea(p, l) {
  let mejor = { d: Infinity };
  for (let i = 0; i < l.length - 1; i++) {
    const r = distSeg(p, l[i], l[i + 1]);
    if (r.d < mejor.d) mejor = { ...r, i };
  }
  return mejor;
}
const distPoligono = (p, pol) => Math.min(...[...pol.ext, ...pol.inn].map(r => distPolilinea(p, r).d));

/** Sutherland–Hodgman contra el rectángulo [0,W]×[0,H]. */
function recortar(anillo, W, H) {
  let out = anillo[0] && anillo[0][0] === anillo.at(-1)[0] && anillo[0][1] === anillo.at(-1)[1] ? anillo.slice(0, -1) : anillo;
  const bordes = [
    [p => p[0] >= 0, (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; }],
    [p => p[0] <= W, (a, b) => { const t = (W - a[0]) / (b[0] - a[0]); return [W, a[1] + t * (b[1] - a[1])]; }],
    [p => p[1] >= 0, (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; }],
    [p => p[1] <= H, (a, b) => { const t = (H - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), H]; }]
  ];
  for (const [dentro, corte] of bordes) {
    if (!out.length) break;
    const entrada = out;
    out = [];
    for (let i = 0; i < entrada.length; i++) {
      const a = entrada[(i + entrada.length - 1) % entrada.length], b = entrada[i];
      if (dentro(b)) {
        if (!dentro(a)) out.push(corte(a, b));
        out.push(b);
      } else if (dentro(a)) out.push(corte(a, b));
    }
  }
  return out;
}

/** Recorre una polilínea por longitud de arco. */
function largoPolilinea(l) {
  let s = 0;
  for (let i = 0; i < l.length - 1; i++) s += Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]);
  return s;
}
function puntoEn(l, s) {
  for (let i = 0; i < l.length - 1; i++) {
    const dx = l[i + 1][0] - l[i][0], dy = l[i + 1][1] - l[i][1];
    const seg = Math.hypot(dx, dy);
    if (s <= seg || i === l.length - 2) {
      const t = seg ? Math.min(1, s / seg) : 0;
      return { p: [l[i][0] + t * dx, l[i][1] + t * dy], tan: seg ? [dx / seg, dy / seg] : [1, 0] };
    }
    s -= seg;
  }
  return { p: l[0], tan: [1, 0] };
}

/** Largo de la parte de una polilínea que cae dentro del rectángulo (muestreado). */
function largoDentro(l, W, H) {
  const L = largoPolilinea(l);
  let n = 0;
  for (let s = 0; s <= L; s += PXM / 2) {
    const { p } = puntoEn(l, s);
    if (p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H) n++;
  }
  return n * PXM / 2;
}

/* -------------------------------------------- */
/*  Calles                                      */
/* -------------------------------------------- */

// highway → ancho en metros, prioridad (como malaga-mapa.py) y clase de superficie.
const CALLES = {
  motorway: [24, 9, "asfalto"], motorway_link: [12, 8, "asfalto"],
  trunk: [20, 9, "asfalto"], trunk_link: [11, 8, "asfalto"],
  primary: [17, 7, "asfalto"], primary_link: [10, 7, "asfalto"],
  secondary: [14, 6, "asfalto"], secondary_link: [9, 6, "asfalto"],
  tertiary: [11, 5, "asfalto"], tertiary_link: [8, 5, "asfalto"],
  residential: [7.5, 4, "asfalto"], unclassified: [7.5, 4, "asfalto"], road: [7, 3, "asfalto"],
  living_street: [6, 3, "losa"], pedestrian: [6, 3, "losa"],
  service: [4.5, 2, "asfalto"],
  footway: [2.2, 1, "senda"], path: [2, 1, "senda"], cycleway: [2.2, 1, "carril-bici"],
  steps: [2.2, 1, "senda"], track: [3, 1, "senda"]
};
const CON_ACERA = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "primary_link", "secondary_link",
  "tertiary_link", "residential", "unclassified", "road"]);
const CON_FAROLAS = new Set(["trunk", "primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link",
  "residential", "unclassified", "road", "living_street", "pedestrian"]);
const ACERA = 2;   // m

/* -------------------------------------------- */
/*  Aleatoriedad determinista                   */
/* -------------------------------------------- */

function azar(semilla) {
  let s = 2166136261;
  for (let i = 0; i < semilla.length; i++) s = Math.imul(s ^ semilla.charCodeAt(i), 16777619) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const mezclar = (hex, hacia, k) => {
  const c = n => parseInt(hex.slice(1 + n * 2, 3 + n * 2), 16);
  const d = n => parseInt(hacia.slice(1 + n * 2, 3 + n * 2), 16);
  return "#" + [0, 1, 2].map(n => Math.round(c(n) + (d(n) - c(n)) * k).toString(16).padStart(2, "0")).join("");
};
const variar = (hex, v) => mezclar(hex, v > 0 ? "#ffffff" : "#000000", Math.abs(v));

/* -------------------------------------------- */
/*  Carga del sector                            */
/* -------------------------------------------- */

function cargarSector(sec) {
  const P = proyeccion(sec);
  const { W, H, aPx, ext } = P;
  const anillosPx = el => {
    const { ext: e, inn } = anillos(el);
    return { ext: e.filter(r => r.length > 2).map(r => r.map(([la, lo]) => aPx(la, lo))),
      inn: inn.filter(r => r.length > 2).map(r => r.map(([la, lo]) => aPx(la, lo))) };
  };

  const edificios = capa("edificios").filter(el => toca(el, ext)).map(el => ({ id: el.id, tags: el.tags ?? {}, ...anillosPx(el) }))
    .filter(e => e.ext.length && !["roof", "carport"].includes(e.tags.building) && e.tags.location !== "underground"
      && !(e.tags.layer && Number(e.tags.layer) < 0));

  const calles = [], plazas = [];
  for (const el of capa("calles").filter(el => toca(el, ext))) {
    const t = el.tags ?? {};
    if (!CALLES[t.highway]) continue;
    if (t.tunnel && t.tunnel !== "no") continue;
    if (t.covered === "yes" || (t.layer && Number(t.layer) < 0)) continue;
    if (t.area === "yes") { plazas.push({ id: el.id, tags: t, ...anillosPx(el) }); continue; }
    const [ancho, prio, sup] = CALLES[t.highway];
    const w = t.width && !isNaN(parseFloat(t.width)) ? Math.min(30, Math.max(2, parseFloat(t.width))) : ancho;
    calles.push({ id: el.id, tags: t, tipo: t.highway, ancho: w, prio, sup, l: lineaDe(el).map(([la, lo]) => aPx(la, lo)) });
  }

  const poligonos = (nombre, filtro) => capa(nombre).filter(el => toca(el, ext) && filtro(el.tags ?? {}))
    .map(el => ({ id: el.id, tags: el.tags ?? {}, ...anillosPx(el) })).filter(p => p.ext.length);
  const verde = poligonos("verde", () => true);
  const playa = poligonos("playa", () => true);
  const puertoSuelo = poligonos("puerto", t => ["industrial", "port", "harbour", "railway"].includes(t.landuse));
  const muelles = [], espigones = [];
  for (const el of capa("puerto").filter(el => toca(el, ext))) {
    const t = el.tags ?? {};
    if (!["pier", "breakwater", "groyne", "quay"].includes(t.man_made)) continue;
    const g = el.geometry ?? [];
    const cerrado = el.type === "relation" || (g.length > 2 && g[0].lat === g.at(-1).lat && g[0].lon === g.at(-1).lon && t.area !== "no");
    if (cerrado) muelles.push({ id: el.id, tags: t, ...anillosPx(el) });
    else espigones.push({ tags: t, l: lineaDe(el).map(([la, lo]) => aPx(la, lo)), ancho: t.man_made === "breakwater" ? 10 : 6 });
  }
  const aguaEls = capa("agua");
  const aguas = aguaEls.filter(el => toca(el, ext) && (el.tags?.natural === "water" || el.tags?.waterway === "riverbank"))
    .map(el => ({ id: el.id, tags: el.tags ?? {}, ...anillosPx(el) })).filter(p => p.ext.length);
  // Costa: se buscan los tramos cercanos (hasta 600 m) para decidir qué lado es mar.
  const lejos = { oeste: ext.oeste - 600 / M_LON, este: ext.este + 600 / M_LON, sur: ext.sur - 600 / M_LAT, norte: ext.norte + 600 / M_LAT };
  const costa = aguaEls.filter(el => el.tags?.natural === "coastline" && toca(el, lejos)).map(el => lineaDe(el).map(([la, lo]) => aPx(la, lo)));
  const vias = capa("ferrocarril").filter(el => toca(el, ext) && !["yes", "building_passage"].includes(el.tags?.tunnel) && el.tags?.railway !== "subway")
    .map(el => lineaDe(el).map(([la, lo]) => aPx(la, lo)));
  // Verjas y tapias: solo si OSM las trae (barrier=fence|wall en alguna capa cargada).
  const barreras = [];
  for (const nombre of ["verde", "puerto", "calles", "edificios"]) {
    for (const el of capa(nombre).filter(el => toca(el, ext))) {
      const b = el.tags?.barrier;
      if (b !== "fence" && b !== "wall") continue;
      const { ext: e } = anillosPx(el);
      for (const r of e) barreras.push({ tipo: b, l: r, id: el.id });
    }
  }

  return { P, W, H, edificios, calles, plazas, verde, playa, puertoSuelo, muelles, espigones, aguas, costa, vias, barreras };
}

/* -------------------------------------------- */
/*  Mar: lado derecho de la línea de costa      */
/* -------------------------------------------- */

/**
 * En OSM la costa se dibuja con la tierra a la IZQUIERDA. En píxeles (y hacia
 * abajo) el signo del producto vectorial se invierte: el mar queda donde el
 * producto (b−a)×(p−a) es POSITIVO. Se decide por el tramo más cercano; en un
 * vértice compartido se suman las distancias con signo de los tramos empatados.
 */
function mascaraMar(S, paso) {
  const segs = [];
  for (const l of S.costa) for (let i = 0; i < l.length - 1; i++) segs.push([l[i], l[i + 1]]);
  if (!segs.length) return null;
  const cols = Math.ceil(S.W / paso), filas = Math.ceil(S.H / paso);
  const m = new Uint8Array(cols * filas);
  let alguno = false;
  for (let fy = 0; fy < filas; fy++) {
    for (let fx = 0; fx < cols; fx++) {
      const p = [(fx + 0.5) * paso, (fy + 0.5) * paso];
      let dmin = Infinity, score = 0;
      for (const [a, b] of segs) {
        const { d } = distSeg(p, a, b);
        if (d > dmin + 0.01) continue;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const cr = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L;
        if (d < dmin - 0.01) { dmin = d; score = cr; } else score += cr;
      }
      if (dmin < 600 * PXM && score > 0) { m[fy * cols + fx] = 1; alguno = true; }
    }
  }
  return alguno ? { m, cols, filas, paso } : null;
}

/* -------------------------------------------- */
/*  Muros y puertas                             */
/* -------------------------------------------- */

const MURO = { door: 0, ds: 0, move: 20, sight: 20, light: 20, sound: 20 };
const SONIDO_PALETA = { clinica: "metal", departamento: "woodBasic", convento: "woodHeavy", cripta: "stoneBasic" };

function enBorde([x1, y1, x2, y2], W, H) {
  const e = 1;
  return (Math.abs(x1) < e && Math.abs(x2) < e) || (Math.abs(x1 - W) < e && Math.abs(x2 - W) < e) ||
    (Math.abs(y1) < e && Math.abs(y2) < e) || (Math.abs(y1 - H) < e && Math.abs(y2 - H) < e);
}

/** Segmentos de fachada (recortados al sector) de cada edificio, sin medianeras. */
function segmentosDeEdificios(S) {
  const crudos = [];
  for (const [bi, e] of S.edificios.entries()) {
    for (const r of [...e.ext, ...e.inn]) {
      const c = recortar(r, S.W, S.H);
      if (c.length < 3) continue;
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length];
        const s = [a[0], a[1], b[0], b[1]].map(v => Math.round(v));
        if (Math.hypot(s[2] - s[0], s[3] - s[1]) < 2) continue;
        if (enBorde(s, S.W, S.H)) continue;
        crudos.push({ c: s, edificio: bi });
      }
    }
  }
  // Medianeras: el mismo tramo en dos edificios es interior a la manzana.
  const clave = c => (c[0] < c[2] || (c[0] === c[2] && c[1] <= c[3]) ? c : [c[2], c[3], c[0], c[1]]).join(",");
  const cuenta = new Map();
  for (const s of crudos) cuenta.set(clave(s.c), (cuenta.get(clave(s.c)) ?? 0) + 1);
  const vistos = new Set();
  return crudos.filter(s => {
    const k = clave(s.c);
    if (cuenta.get(k) > 1 || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

const enAlgunEdificio = (S, p) => S.edificios.some(e => dentroPoligono(p, e));

/** Edificio del POI: el que lo contiene, o el más cercano (con aviso). */
function edificioDePoi(S, p) {
  const i = S.edificios.findIndex(e => dentroPoligono(p, e));
  if (i >= 0) return { i, aproximado: false, d: 0 };
  let mejor = { i: -1, d: Infinity };
  for (const [k, e] of S.edificios.entries()) {
    const d = distPoligono(p, e);
    if (d < mejor.d) mejor = { i: k, d };
  }
  return { ...mejor, aproximado: true };
}

/**
 * Abre la puerta de una entrada en la fachada de su edificio: el punto de
 * fachada más cercano a una calle, con 2 m de hueco. Las entradas siguientes
 * del mismo edificio se alejan de las anteriores (el muelle de carga no va al
 * lado de la entrada principal).
 */
function abrirPuerta(S, segs, bi, previas, calles) {
  const hueco = 2 * PXM, medio = hueco / 2;
  const edif = S.edificios[bi];
  const cands = [];
  for (const [si, s] of segs.entries()) {
    if (s.edificio !== bi || s.door) continue;
    const [x1, y1, x2, y2] = s.c;
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L < hueco + 0.4 * PXM) continue;
    const t = [(x2 - x1) / L, (y2 - y1) / L];
    let n = [-t[1], t[0]];
    for (let d = medio + 0.1 * PXM; d <= L - medio - 0.1 * PXM; d += 0.25 * PXM) {
      const p = [x1 + t[0] * d, y1 + t[1] * d];
      let fuera = [p[0] + n[0] * 0.5 * PXM, p[1] + n[1] * 0.5 * PXM];
      if (dentroPoligono(fuera, edif)) { n = [-n[0], -n[1]]; fuera = [p[0] + n[0] * 0.5 * PXM, p[1] + n[1] * 0.5 * PXM]; }
      const delante = [p[0] + n[0] * 1.6 * PXM, p[1] + n[1] * 1.6 * PXM];
      if (enAlgunEdificio(S, fuera) || enAlgunEdificio(S, delante)) continue;
      // Lejos de las franjas de borde (3 m): la región de entrada tiene que caber delante.
      if (delante[0] < 5 * PXM || delante[0] > S.W - 5 * PXM || delante[1] < 5 * PXM || delante[1] > S.H - 5 * PXM) continue;
      let dc = Infinity;
      for (const c of calles) dc = Math.min(dc, distPolilinea(p, c.l).d - c.ancho * PXM / 2);
      const dPrev = previas.length ? Math.min(...previas.map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))) : Infinity;
      cands.push({ si, d, p, n, t, dc: Math.max(0, dc), dPrev });
    }
  }
  if (!cands.length) return null;
  let elegido;
  if (!previas.length) elegido = cands.reduce((a, b) => (b.dc < a.dc ? b : a));
  else {
    const dmin = Math.min(...cands.map(c => c.dc));
    const cerca = cands.filter(c => c.dc <= dmin + 8 * PXM && c.dPrev >= 8 * PXM);
    const pool = cerca.length ? cerca : cands.filter(c => c.dPrev >= 4 * PXM);
    if (!pool.length) return null;
    elegido = cerca.length ? pool.reduce((a, b) => (b.dPrev > a.dPrev ? b : a)) : pool.reduce((a, b) => (b.dc < a.dc ? b : a));
  }
  const s = segs[elegido.si];
  const [x1, y1, x2, y2] = s.c;
  const { t, d } = elegido;
  const a = [x1 + t[0] * (d - medio), y1 + t[1] * (d - medio)].map(Math.round);
  const b = [x1 + t[0] * (d + medio), y1 + t[1] * (d + medio)].map(Math.round);
  // El tramo de fachada se parte en dos y el hueco lleva la puerta.
  segs.splice(elegido.si, 1,
    { c: [x1, y1, a[0], a[1]], edificio: bi },
    { c: [a[0], a[1], b[0], b[1]], edificio: bi, door: true },
    { c: [b[0], b[1], x2, y2], edificio: bi });
  return { c: [a[0], a[1], b[0], b[1]], centro: elegido.p, normal: elegido.n, tangente: t };
}

/* -------------------------------------------- */
/*  Farolas                                     */
/* -------------------------------------------- */

function farolas(S, sec) {
  const espaciado = ["malagueta", "muelle-uno"].includes(sec.id) ? 40 : 25;
  const luces = [];
  const libre = p => p[0] > 0.5 * PXM && p[0] < S.W - 0.5 * PXM && p[1] > 0.5 * PXM && p[1] < S.H - 0.5 * PXM &&
    !enAlgunEdificio(S, p) && !(S.mar && enMar(S.mar, p));
  for (const c of S.calles.filter(c => CON_FAROLAS.has(c.tipo)).sort((a, b) => b.prio - a.prio || a.id - b.id)) {
    const L = largoPolilinea(c.l);
    const r = azar(`farola:${c.id}`);
    const paso = espaciado * PXM;
    const peatonal = c.sup === "losa";
    const off = (peatonal ? c.ancho / 2 - 0.6 : c.ancho / 2 + 0.6) * PXM;
    let lado = r() < 0.5 ? 1 : -1;
    for (let s = (r() * 0.8 + 0.1) * paso; s < L; s += paso, lado = -lado) {
      const { p, tan } = puntoEn(c.l, s);
      const n = [-tan[1], tan[0]];
      let q = null;
      // En las calles estrechas la fachada cae sobre la acera teórica: la
      // farola se arrima a la calzada (va adosada o en el bordillo).
      const offs = peatonal ? [off] : [off, off - 1.0 * PXM, off - 1.8 * PXM];
      busca: for (const o of offs) for (const ld of [lado, -lado]) {
        const cand = [p[0] + n[0] * o * ld, p[1] + n[1] * o * ld];
        if (libre(cand)) { q = cand; break busca; }
      }
      if (!q) continue;
      if (luces.some(l => Math.hypot(l.x - q[0], l.y - q[1]) < 10 * PXM)) continue;
      luces.push({ x: Math.round(q[0]), y: Math.round(q[1]), preset: "farola", nombre: `Farola · ${c.tags.name ?? c.tipo}`, _tan: tan, _haciaCalle: [-(q[0] - p[0]), -(q[1] - p[1])] });
    }
  }
  return luces;
}

const enMar = (mar, p) => {
  const fx = Math.floor(p[0] / mar.paso), fy = Math.floor(p[1] / mar.paso);
  return fx >= 0 && fy >= 0 && fx < mar.cols && fy < mar.filas && mar.m[fy * mar.cols + fx] === 1;
};

/* -------------------------------------------- */
/*  Aparcamientos                               */
/* -------------------------------------------- */

/**
 * Lugares donde un coche puede estar aparcado: sobre la calzada de una calle
 * asfaltada, pegado al cordón y alineado con ella, con TODO el rectángulo del
 * coche (4,6 × 2,2 m) fuera de edificios, del mar y de las franjas de borde.
 * Ordenados por cercanía a la llegada y separados al menos 6 m.
 *
 * `rotacion` es la del token: el arte de vehículo mira al sur con rotación 0
 * (tools/tokens.mjs), así que se gira para que el eje largo siga la calle.
 * x/y son el centro del coche en px.
 */
function aparcamientos(S, llegada, max = 8) {
  const largo = 4.6 * PXM, ancho = 2.2 * PXM, borde = 5 * PXM;
  const libre = q => q[0] > borde && q[0] < S.W - borde && q[1] > borde && q[1] < S.H - borde &&
    !enAlgunEdificio(S, q) && !(S.mar && enMar(S.mar, q));
  const cands = [];
  for (const c of S.calles.filter(c => c.sup === "asfalto" && !c.tipo.startsWith("motorway"))) {
    const L = largoPolilinea(c.l);
    const off = Math.max(1.1, c.ancho / 2 - 1.3) * PXM;
    for (let d = 3 * PXM; d < L - 3 * PXM; d += PXM) {
      const { p, tan } = puntoEn(c.l, d);
      const n = [-tan[1], tan[0]];
      for (const lado of [1, -1]) {
        const q = [p[0] + n[0] * off * lado, p[1] + n[1] * off * lado];
        const puntos = [];
        for (const a of [-0.5, 0, 0.5]) for (const b of [-0.5, 0, 0.5])
          puntos.push([q[0] + tan[0] * largo * a + n[0] * ancho * b, q[1] + tan[1] * largo * a + n[1] * ancho * b]);
        if (!puntos.every(libre)) continue;
        // Nada de cruces: el coche no puede invadir la calzada de otra calle.
        const otras = S.calles.filter(o => o !== c && o.sup !== "senda");
        if (puntos.some(pt => otras.some(o => distPolilinea(pt, o.l).d < (o.ancho / 2 + 1) * PXM))) continue;
        const rot = (Math.atan2(-tan[0], tan[1]) * 180 / Math.PI + 360) % 360;
        cands.push({ x: Math.round(q[0]), y: Math.round(q[1]), rotacion: Math.round(rot),
          _d: llegada ? Math.hypot(q[0] - (llegada.x + llegada.w / 2), q[1] - (llegada.y + llegada.h / 2)) : 0 });
      }
    }
  }
  cands.sort((a, b) => a._d - b._d);
  const elegidos = [];
  for (const c of cands) {
    if (elegidos.some(e => Math.hypot(e.x - c.x, e.y - c.y) < 6 * PXM)) continue;
    // No tapar la llegada: los tokens que vienen de la ciudad aparecen ahí.
    if (llegada && Math.abs(c.x - (llegada.x + llegada.w / 2)) < 4 * PXM && Math.abs(c.y - (llegada.y + llegada.h / 2)) < 4 * PXM) continue;
    elegidos.push(c);
    if (elegidos.length >= max) break;
  }
  return elegidos.map(({ _d, ...c }) => c);
}

/* -------------------------------------------- */
/*  Regiones                                    */
/* -------------------------------------------- */

const UUID = {
  sector: (sec, region) => `Scene.${idEstable(`escena:sector:${sec}`)}.Region.${idEstable(`region:sector:${sec}:${region}`)}`,
  malaga: sec => `Scene.${idEstable("escena:malaga")}.Region.${idEstable(`region:malaga:${sec}`)}`,
  plano: (plano, region) => `Scene.${idEstable(`escena:${plano}`)}.Region.${idEstable(`region:${plano}:${region}`)}`
};
const sufijo = n => (n >= 2 ? `-${n}` : "");

function regionLlegada(S) {
  const tam = 3 * PXM;
  const candidatas = S.calles.filter(c => c.sup !== "senda")
    .map(c => ({ c, dentro: largoDentro(c.l, S.W, S.H) }))
    .filter(x => x.dentro >= 15 * PXM)
    .sort((a, b) => b.c.prio - a.c.prio || b.dentro - a.dentro);
  const centro = [S.W / 2, S.H / 2];
  let p = centro;
  for (const { c } of candidatas) {
    const q = distPolilinea(centro, c.l).q;
    const cl = [Math.min(S.W - 5 * PXM, Math.max(5 * PXM, q[0])), Math.min(S.H - 5 * PXM, Math.max(5 * PXM, q[1]))];
    if (!enAlgunEdificio(S, cl) && !(S.mar && enMar(S.mar, cl))) { p = cl; break; }
  }
  return { id: "llegada", nombre: "Llegada desde la ciudad", x: Math.round(p[0] - tam / 2), y: Math.round(p[1] - tam / 2), w: tam, h: tam, destino: null };
}

function regionesBorde(S, sec) {
  const f = 3 * PXM;
  const destino = { escena: "malaga", region: sec.id, uuid: UUID.malaga(sec.id) };
  return [
    { id: "borde-n", nombre: "Volver a la ciudad (norte)", x: 0, y: 0, w: S.W, h: f },
    { id: "borde-s", nombre: "Volver a la ciudad (sur)", x: 0, y: S.H - f, w: S.W, h: f },
    { id: "borde-o", nombre: "Volver a la ciudad (oeste)", x: 0, y: f, w: f, h: S.H - 2 * f },
    { id: "borde-e", nombre: "Volver a la ciudad (este)", x: S.W - f, y: f, w: f, h: S.H - 2 * f }
  ].map(r => ({ ...r, destino }));
}

/* -------------------------------------------- */
/*  Regiones gemelas en los planos interiores   */
/* -------------------------------------------- */

const DIR_PLANOS = path.join(RAIZ, "content/planos");

function archivosPlanos() {
  return fs.readdirSync(DIR_PLANOS).filter(f => f.endsWith(".json")).sort().map(f => {
    const ruta = path.join(DIR_PLANOS, f);
    const texto = fs.readFileSync(ruta, "utf8");
    return { ruta, texto, datos: JSON.parse(texto) };
  });
}

/**
 * Serializador «compacto» (el de piso-de-elias.json): objetos expandidos, y
 * los arrays de objetos planos con un objeto por línea. Solo se usa si
 * reproduce el archivo original byte a byte.
 */
function compacto(v, ind = "") {
  const sig = ind + "  ";
  const plano = o => o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every(x => x === null || typeof x !== "object");
  const linea = o => `{ ${Object.entries(o).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(", ")} }`;
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    if (v.every(plano)) return `[\n${v.map(o => sig + linea(o)).join(",\n")}\n${ind}]`;
    return `[\n${v.map(x => sig + compacto(x, sig)).join(",\n")}\n${ind}]`;
  }
  if (v && typeof v === "object") {
    const e = Object.entries(v);
    if (!e.length) return "{}";
    return `{\n${e.map(([k, x]) => `${sig}${JSON.stringify(k)}: ${compacto(x, sig)}`).join(",\n")}\n${ind}}`;
  }
  return JSON.stringify(v);
}

function serializar(original, datos) {
  const parsed = JSON.parse(original);
  if (JSON.stringify(parsed, null, 2) + "\n" === original) return JSON.stringify(datos, null, 2) + "\n";
  if (compacto(parsed) + "\n" === original) return compacto(datos) + "\n";
  return JSON.stringify(datos, null, 2) + "\n";
}

/**
 * Dentro de la sala: `salida` sobre la escalera de la sala o sobre su puerta
 * exterior (un vano en el borde de la sala que no da a otra habitación); si
 * no hay, contra el lado de la sala más cercano al borde del plano. `desde`,
 * al lado, hacia adentro. Todo en pies, 5 × 5.
 */
function regionesInteriores(plano, sala) {
  const h = plano.habitaciones.find(x => x.nombre === sala);
  if (!h) return null;
  const T = 5;
  const dentroDeAlguna = (x, y) => plano.habitaciones.some(o => x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h);
  const ajustar = r => ({ ...r, x: Math.min(h.x + h.w - r.w, Math.max(h.x, r.x)), y: Math.min(h.y + h.h - r.h, Math.max(h.y, r.y)) });
  let salida = null, haciaAdentro = null;

  const escalera = (plano.muebles ?? []).find(m => m.tipo === "escalera" && m.x >= h.x && m.y >= h.y && m.x + m.w <= h.x + h.w && m.y + m.h <= h.y + h.h);
  if (escalera) {
    salida = ajustar({ x: escalera.x + escalera.w / 2 - T / 2, y: escalera.y + escalera.h / 2 - T / 2, w: T, h: T });
    const cy = salida.y + T / 2, cx = salida.x + T / 2;
    haciaAdentro = Math.abs(cy - (h.y + h.h / 2)) >= Math.abs(cx - (h.x + h.w / 2))
      ? [0, cy > h.y + h.h / 2 ? -1 : 1] : [cx > h.x + h.w / 2 ? -1 : 1, 0];
  }
  if (!salida) {
    for (const v of plano.vanos ?? []) {
      if (!["puerta", "puerta-vidrio", "abierto"].includes(v.tipo)) continue;
      const mid = v.eje === "h" ? [v.x + v.w / 2, v.y] : [v.x, v.y + v.w / 2];
      let lado = null;
      if (v.eje === "h" && v.x >= h.x - 1e-6 && v.x + v.w <= h.x + h.w + 1e-6) {
        if (Math.abs(v.y - (h.y + h.h)) < 1e-6) lado = "s";
        else if (Math.abs(v.y - h.y) < 1e-6) lado = "n";
      } else if (v.eje === "v" && v.y >= h.y - 1e-6 && v.y + v.w <= h.y + h.h + 1e-6) {
        if (Math.abs(v.x - (h.x + h.w)) < 1e-6) lado = "e";
        else if (Math.abs(v.x - h.x) < 1e-6) lado = "o";
      }
      if (!lado) continue;
      const afuera = { s: [mid[0], mid[1] + 0.5], n: [mid[0], mid[1] - 0.5], e: [mid[0] + 0.5, mid[1]], o: [mid[0] - 0.5, mid[1]] }[lado];
      if (dentroDeAlguna(...afuera)) continue;
      const r = { s: { x: mid[0] - T / 2, y: h.y + h.h - T }, n: { x: mid[0] - T / 2, y: h.y },
        e: { x: h.x + h.w - T, y: mid[1] - T / 2 }, o: { x: h.x, y: mid[1] - T / 2 } }[lado];
      salida = ajustar({ ...r, w: T, h: T });
      haciaAdentro = { s: [0, -1], n: [0, 1], e: [-1, 0], o: [1, 0] }[lado];
      break;
    }
  }
  if (!salida) {
    const d = { o: h.x, n: h.y, e: plano.ancho - (h.x + h.w), s: plano.alto - (h.y + h.h) };
    const lado = Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
    const r = { s: { x: h.x + h.w / 2 - T / 2, y: h.y + h.h - T }, n: { x: h.x + h.w / 2 - T / 2, y: h.y },
      e: { x: h.x + h.w - T, y: h.y + h.h / 2 - T / 2 }, o: { x: h.x, y: h.y + h.h / 2 - T / 2 } }[lado];
    salida = ajustar({ ...r, w: T, h: T });
    haciaAdentro = { s: [0, -1], n: [0, 1], e: [-1, 0], o: [1, 0] }[lado];
  }
  const desde = ajustar({ x: salida.x + haciaAdentro[0] * (T + 1), y: salida.y + haciaAdentro[1] * (T + 1), w: T, h: T });
  const solapa = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  if (solapa(desde, salida)) return { salida, desde: null };
  return { salida, desde };
}

function actualizarPlanos(sector, entradas, avisos) {
  const archivos = archivosPlanos();
  for (const e of entradas) {
    const arch = archivos.find(a => a.datos.planos?.some(p => p.id === e.destino));
    if (!arch) { avisos.push(`entrada-${e.n}: el plano ${e.destino} no existe`); continue; }
    const plano = arch.datos.planos.find(p => p.id === e.destino);
    const r = regionesInteriores(plano, e.sala);
    if (!r) { avisos.push(`entrada-${e.n}: el plano ${e.destino} no tiene la sala «${e.sala}»`); continue; }
    const s = sufijo(e.n);
    const nuevas = [];
    if (r.desde) nuevas.push({ id: `desde-${sector.id}${s}`, nombre: `Llegada desde la calle (${sector.nombre})`, ...r.desde,
      destino: `${sector.id}:entrada-${e.n}`, llegada: true, color: "#2f7f8c" });
    else avisos.push(`entrada-${e.n}: la sala «${e.sala}» es muy chica para separar llegada y salida; la llegada es la misma salida`);
    nuevas.push({ id: `salida-${sector.id}${s}`, nombre: `Salir a la calle (${sector.nombre})`, ...r.salida,
      destino: `${sector.id}:entrada-${e.n}`, color: "#8c2f5c" });
    plano.regiones = [...(plano.regiones ?? []).filter(x => !nuevas.some(n => n.id === x.id)), ...nuevas];
    e.regionInterior = r.desde ? `desde-${sector.id}${s}` : `salida-${sector.id}${s}`;
    e.regionSalida = `salida-${sector.id}${s}`;
    e.paleta = plano.paleta;
  }
  for (const a of archivos) {
    const nuevo = serializar(a.texto, a.datos);
    if (nuevo !== a.texto) fs.writeFileSync(a.ruta, nuevo);
  }
}

/* -------------------------------------------- */
/*  Render del esquema                          */
/* -------------------------------------------- */

const PAL = {
  acera: "#64676a", aceraJunta: "#46494c", bordillo: "#8b8f92",
  asfalto: "#2a2e33", asfaltoDetalle: "#1d2024", asfaltoClaro: "#3a3f45", charco: "#161a1f", reflejo: "#56606a",
  losa: "#76787a", losaJunta: "#4f5254",
  senda: "#6e6f6c", carrilBici: "#3b4a47",
  verde: "#37423d", verdeDetalle: "#2a332f", tierra: "#4a4842",
  arena: "#77756d", arenaDetalle: "#5f5d56",
  mar: "#1a252c", marOrilla: "#2c3c44",
  hormigon: "#55585b", hormigonJunta: "#3d4043",
  azotea: "#5b5f63", pretil: "#7b7f83", tejado: "#625c58",
  tinta: "#101317", sombra: "#05070a",
  arbol: "#2c3833", arbolLuz: "#3f4d45",
  via: "#24262a", traviesa: "#575a5e"
};

const d = l => `M${l.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}`;
const dPol = pol => [...pol.ext, ...pol.inn].map(r => d(r) + "Z").join("");

function patrones(r) {
  const o = [];
  // Baldosa de acera: 40 cm, con valor variable por baldosa (tile de 4 × 4).
  {
    const t = 20, n = 4;
    let s = `<pattern id="baldosa" width="${t * n}" height="${t * n}" patternUnits="userSpaceOnUse">`;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      s += `<rect x="${i * t}" y="${j * t}" width="${t}" height="${t}" fill="${variar(PAL.acera, (r() - 0.5) * 0.12)}" stroke="${PAL.aceraJunta}" stroke-width="1.3"/>`;
    }
    o.push(s + `</pattern>`);
  }
  // Losas de granito de las calles peatonales: 120 × 60 cm a junta trabada.
  {
    const w = 60, h = 30;
    let s = `<pattern id="losa" width="${w * 2}" height="${h * 2}" patternUnits="userSpaceOnUse">`;
    const losa = (x, y) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${variar(PAL.losa, (r() - 0.5) * 0.14)}" stroke="${PAL.losaJunta}" stroke-width="1.6"/>`;
    s += losa(0, 0) + losa(w, 0) + losa(-w / 2, h) + losa(w / 2, h) + losa(w * 1.5, h);
    o.push(s + `</pattern>`);
  }
  // Asfalto: árido fino.
  {
    const t = 160;
    let s = `<pattern id="asfalto" width="${t}" height="${t}" patternUnits="userSpaceOnUse"><rect width="${t}" height="${t}" fill="${PAL.asfalto}"/>`;
    for (let i = 0; i < 140; i++) {
      s += `<circle cx="${(r() * t).toFixed(1)}" cy="${(r() * t).toFixed(1)}" r="${(0.7 + r() * 1.5).toFixed(1)}" fill="${r() < 0.5 ? PAL.asfaltoDetalle : PAL.asfaltoClaro}" opacity="0.8"/>`;
    }
    o.push(s + `</pattern>`);
  }
  // Hormigón del muelle: losas de 5 m con junta.
  o.push(`<pattern id="hormigon" width="250" height="250" patternUnits="userSpaceOnUse"><rect width="250" height="250" fill="${PAL.hormigon}"/>` +
    `<path d="M0,0H250M0,0V250" stroke="${PAL.hormigonJunta}" stroke-width="3"/></pattern>`);
  // Césped y tierra.
  {
    const t = 120;
    let s = `<pattern id="cesped" width="${t}" height="${t}" patternUnits="userSpaceOnUse"><rect width="${t}" height="${t}" fill="${PAL.verde}"/>`;
    for (let i = 0; i < 90; i++) {
      const x = r() * t, y = r() * t;
      s += `<path d="M${x.toFixed(1)},${y.toFixed(1)}l${((r() - 0.5) * 5).toFixed(1)},${(-3 - r() * 5).toFixed(1)}" stroke="${r() < 0.5 ? PAL.verdeDetalle : variar(PAL.verde, 0.12)}" stroke-width="1.3"/>`;
    }
    o.push(s + `</pattern>`);
  }
  {
    const t = 120;
    let s = `<pattern id="arena" width="${t}" height="${t}" patternUnits="userSpaceOnUse"><rect width="${t}" height="${t}" fill="${PAL.arena}"/>`;
    for (let i = 0; i < 160; i++) s += `<circle cx="${(r() * t).toFixed(1)}" cy="${(r() * t).toFixed(1)}" r="${(0.6 + r()).toFixed(1)}" fill="${PAL.arenaDetalle}" opacity="0.7"/>`;
    o.push(s + `</pattern>`);
  }
  o.push(`<filter id="grano" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="11"/><feColorMatrix type="saturate" values="0"/></filter>`);
  o.push(`<filter id="difuso" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="7"/></filter>`);
  o.push(`<filter id="suave" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="3"/></filter>`);
  return o;
}

function arboles(S, r) {
  const out = [];
  const zonas = S.verde.filter(v => {
    const t = v.tags;
    return ["park", "garden"].includes(t.leisure) || ["wood", "scrub"].includes(t.natural) ||
      ["forest", "cemetery", "grass", "recreation_ground", "village_green"].includes(t.landuse) || t.amenity === "grave_yard";
  });
  const pts = [];
  for (const z of zonas) {
    const t = z.tags;
    const bosque = t.natural === "wood" || t.landuse === "forest";
    const cipres = t.landuse === "cemetery" || t.amenity === "grave_yard";
    const cesped = t.landuse === "grass";
    const paso = (bosque ? 4.5 : cipres ? 5 : cesped ? 11 : 7) * PXM;
    const rz = azar(`arboles:${z.id}`);
    for (let y = -2 * PXM; y < S.H + 2 * PXM; y += paso) {
      for (let x = -2 * PXM; x < S.W + 2 * PXM; x += paso) {
        const p = [x + (rz() - 0.5) * paso * 0.8, y + (rz() - 0.5) * paso * 0.8];
        if (rz() < (cesped ? 0.55 : 0.2)) continue;
        if (!dentroPoligono(p, z) || enAlgunEdificio(S, p)) continue;
        if (S.calles.some(c => c.sup !== "senda" && distPolilinea(p, c.l).d < (c.ancho / 2 + 1.5) * PXM)) continue;
        if (S.calles.some(c => c.sup === "senda" && distPolilinea(p, c.l).d < (c.ancho / 2 + 0.8) * PXM)) continue;
        if (pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 2.5 * PXM)) continue;
        pts.push(p);
        const radio = (cipres ? 0.9 + rz() * 0.5 : 2 + rz() * 1.6) * PXM;
        out.push({ p, radio, cipres });
      }
    }
  }
  const sombras = out.map(a => `<circle cx="${(a.p[0] + a.radio * 0.35).toFixed(0)}" cy="${(a.p[1] + a.radio * 0.4).toFixed(0)}" r="${a.radio.toFixed(0)}" fill="${PAL.sombra}" opacity="0.45"/>`);
  const copas = out.map(a => {
    const lob = [];
    const n = a.cipres ? 5 : 9;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + r();
      const rr = a.radio * (0.35 + r() * 0.25);
      lob.push(`<circle cx="${(a.p[0] + Math.cos(ang) * a.radio * 0.55).toFixed(0)}" cy="${(a.p[1] + Math.sin(ang) * a.radio * 0.55).toFixed(0)}" r="${rr.toFixed(0)}" fill="${variar(PAL.arbol, (r() - 0.5) * 0.15)}" stroke="${PAL.tinta}" stroke-width="2.2"/>`);
    }
    lob.push(`<circle cx="${a.p[0].toFixed(0)}" cy="${a.p[1].toFixed(0)}" r="${(a.radio * 0.55).toFixed(0)}" fill="${PAL.arbol}"/>`);
    lob.push(`<circle cx="${(a.p[0] - a.radio * 0.2).toFixed(0)}" cy="${(a.p[1] - a.radio * 0.2).toFixed(0)}" r="${(a.radio * 0.3).toFixed(0)}" fill="${PAL.arbolLuz}" opacity="0.6"/>`);
    return lob.join("");
  });
  return { sombras, copas };
}

/** Detalles de azotea: máquinas de aire, depósitos, casetón de escalera, claraboyas. */
function detallesAzotea(e, r) {
  const out = [], sombras = [];
  const xs = e.ext.flat().map(p => p[0]), ys = e.ext.flat().map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const area = (x1 - x0) * (y1 - y0) / (PXM * PXM);
  const n = Math.min(14, Math.round(area / 45));
  const cabe = (x, y, w, h) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y + h / 2]]
    .every(p => dentroPoligono(p, e) && distPoligono(p, e) > 0.6 * PXM);
  for (let i = 0, intentos = 0; i < n && intentos < n * 12; intentos++) {
    const tipo = r();
    let w, h;
    if (tipo < 0.5) { w = (0.8 + r() * 0.4) * PXM; h = (0.5 + r() * 0.3) * PXM; }          // aire acondicionado
    else if (tipo < 0.7) { w = h = (1 + r() * 0.6) * PXM; }                                   // depósito
    else if (tipo < 0.85) { w = (2.4 + r()) * PXM; h = (2 + r()) * PXM; }                     // casetón de escalera
    else { w = (1.2 + r()) * PXM; h = (0.8 + r() * 0.6) * PXM; }                              // claraboya
    const x = x0 + r() * (x1 - x0 - w), y = y0 + r() * (y1 - y0 - h);
    if (!cabe(x, y, w, h)) continue;
    i++;
    const alto = tipo < 0.5 ? 6 : tipo < 0.7 ? 10 : tipo < 0.85 ? 18 : 3;
    if (tipo >= 0.5 && tipo < 0.7) {
      sombras.push(`<circle cx="${(x + w / 2 + alto).toFixed(0)}" cy="${(y + h / 2 + alto).toFixed(0)}" r="${(w / 2).toFixed(0)}" fill="${PAL.sombra}" opacity="0.4"/>`);
      out.push(`<circle cx="${(x + w / 2).toFixed(0)}" cy="${(y + h / 2).toFixed(0)}" r="${(w / 2).toFixed(0)}" fill="#7d8285" stroke="${PAL.tinta}" stroke-width="2.4"/>` +
        `<circle cx="${(x + w / 2).toFixed(0)}" cy="${(y + h / 2).toFixed(0)}" r="${(w / 5).toFixed(0)}" fill="none" stroke="${PAL.tinta}" stroke-width="1.4" opacity="0.6"/>`);
    } else {
      sombras.push(`<rect x="${(x + alto).toFixed(0)}" y="${(y + alto).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${PAL.sombra}" opacity="0.4"/>`);
      const fill = tipo < 0.5 ? "#878b8d" : tipo < 0.85 ? variar(PAL.azotea, 0.1) : "#4a5866";
      out.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="2" fill="${fill}" stroke="${PAL.tinta}" stroke-width="2.4"/>`);
      if (tipo < 0.5) out.push(`<circle cx="${(x + w * 0.62).toFixed(0)}" cy="${(y + h / 2).toFixed(0)}" r="${(h * 0.32).toFixed(0)}" fill="#5d6264" stroke="${PAL.tinta}" stroke-width="1.2"/>`);
      if (tipo >= 0.85) out.push(`<path d="M${x.toFixed(0)},${y.toFixed(0)}L${(x + w).toFixed(0)},${(y + h).toFixed(0)}M${(x + w).toFixed(0)},${y.toFixed(0)}L${x.toFixed(0)},${(y + h).toFixed(0)}" stroke="${PAL.tinta}" stroke-width="1.2" opacity="0.5"/>`);
    }
  }
  // Manchas de humedad y parches de tela asfáltica.
  for (let i = 0; i < Math.round(area / 30); i++) {
    const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
    if (!dentroPoligono([x, y], e)) continue;
    out.unshift(`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(20 + r() * 60).toFixed(0)}" ry="${(14 + r() * 40).toFixed(0)}" fill="${r() < 0.6 ? "#3e4246" : "#6c7074"}" opacity="0.25"/>`);
  }
  return { out, sombras };
}

function renderSvg(S, sec, geo) {
  const r = azar(`sector:${sec.id}`);
  const { W, H } = S;
  const o = [`<defs>${patrones(r).join("")}`];

  // Máscara del asfalto (para charcos y manchas solo sobre la calzada).
  const asfaltadas = S.calles.filter(c => c.sup === "asfalto").sort((a, b) => a.prio - b.prio);
  o.push(`<mask id="mAsfalto" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="black"/>` +
    asfaltadas.map(c => `<path d="${d(c.l)}" fill="none" stroke="white" stroke-width="${(c.ancho * PXM).toFixed(0)}" stroke-linecap="round" stroke-linejoin="round"/>`).join("") +
    `</mask>`);
  // Clip por edificio para el pretil (la mitad interior del trazo).
  const edifs = S.edificios;
  edifs.forEach((e, i) => o.push(`<clipPath id="e${i}"><path d="${dPol(e)}" fill-rule="evenodd"/></clipPath>`));
  o.push(`</defs>`);

  // 1. Suelo urbano: baldosa de acera por defecto (patios, plazas sin mapear).
  o.push(`<rect width="${W}" height="${H}" fill="url(#baldosa)"/>`);
  for (let i = 0; i < 60; i++) {
    o.push(`<ellipse cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" rx="${(40 + r() * 160).toFixed(0)}" ry="${(30 + r() * 100).toFixed(0)}" fill="${r() < 0.6 ? "#2f3236" : "#8a8d90"}" opacity="${(0.07 + r() * 0.1).toFixed(2)}"/>`);
  }

  // 2. Suelos: puerto, verde, arena.
  for (const p of S.puertoSuelo) o.push(`<path d="${dPol(p)}" fill="url(#hormigon)" fill-rule="evenodd"/>`);
  for (const v of S.verde) {
    const t = v.tags;
    const fill = ["pitch"].includes(t.leisure) ? "#3b4440" : (t.landuse === "cemetery" || t.amenity === "grave_yard") ? PAL.tierra : "url(#cesped)";
    o.push(`<path d="${dPol(v)}" fill="${fill}" fill-rule="evenodd"/>`);
    if (t.leisure === "pitch") o.push(`<path d="${dPol(v)}" fill="none" stroke="#7c8380" stroke-width="5" opacity="0.6"/>`);
  }
  for (const p of S.playa) o.push(`<path d="${dPol(p)}" fill="url(#arena)" fill-rule="evenodd"/>`);

  // 3. Mar (lado derecho de la costa) y agua interior.
  if (S.mar) {
    const { m, cols, filas, paso } = S.mar;
    const filasD = [];
    for (let fy = 0; fy < filas; fy++) {
      let fx = 0;
      while (fx < cols) {
        if (!m[fy * cols + fx]) { fx++; continue; }
        const ini = fx;
        while (fx < cols && m[fy * cols + fx]) fx++;
        filasD.push(`M${ini * paso},${fy * paso}h${(fx - ini) * paso}v${paso}h${-(fx - ini) * paso}Z`);
      }
    }
    const dm = filasD.join("");
    o.push(`<path d="${dm}" fill="${PAL.marOrilla}" filter="url(#suave)"/>`);
    o.push(`<g filter="url(#difuso)"><path d="${dm}" fill="${PAL.mar}" transform="translate(0,0)"/></g>`);
    for (let i = 0; i < 260; i++) {           // oleaje: trazos cortos y claros
      const x = r() * W, y = r() * H;
      if (!enMar(S.mar, [x, y])) continue;
      o.push(`<path d="M${x.toFixed(0)},${y.toFixed(0)}q${(20 + r() * 30).toFixed(0)},${(-6 - r() * 6).toFixed(0)} ${(50 + r() * 60).toFixed(0)},0" stroke="#3d4f59" stroke-width="2.4" fill="none" opacity="0.45"/>`);
    }
  }
  for (const a of S.aguas) {
    o.push(`<path d="${dPol(a)}" fill="#20292e" fill-rule="evenodd" stroke="${PAL.tinta}" stroke-width="3"/>`);
  }

  // 4. Muelles y espigones sobre el agua.
  for (const mq of S.muelles) o.push(`<path d="${dPol(mq)}" fill="url(#hormigon)" fill-rule="evenodd" stroke="${PAL.tinta}" stroke-width="4"/>`);
  for (const e of S.espigones) o.push(`<path d="${d(e.l)}" fill="none" stroke="${PAL.hormigon}" stroke-width="${e.ancho * PXM}" stroke-linecap="square"/>`);

  // 5. Plazas peatonales (highway area).
  for (const p of S.plazas) o.push(`<path d="${dPol(p)}" fill="url(#losa)" fill-rule="evenodd"/>`);

  // 6. Calles: acera (franja de 2 m) → bordillo → calzada; peatonales en losa; sendas.
  const ordenadas = [...S.calles].sort((a, b) => a.prio - b.prio);
  for (const c of ordenadas.filter(c => CON_ACERA.has(c.tipo))) {
    o.push(`<path d="${d(c.l)}" fill="none" stroke="url(#baldosa)" stroke-width="${((c.ancho + 2 * ACERA) * PXM).toFixed(0)}" stroke-linecap="butt" stroke-linejoin="round"/>`);
  }
  for (const c of ordenadas.filter(c => c.sup === "senda" || c.sup === "carril-bici")) {
    o.push(`<path d="${d(c.l)}" fill="none" stroke="${c.sup === "carril-bici" ? PAL.carrilBici : PAL.senda}" stroke-width="${(c.ancho * PXM).toFixed(0)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`);
  }
  for (const c of ordenadas.filter(c => c.sup === "losa")) {
    o.push(`<path d="${d(c.l)}" fill="none" stroke="url(#losa)" stroke-width="${(c.ancho * PXM).toFixed(0)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const c of asfaltadas) {   // bordillo: canto claro y tinta
    o.push(`<path d="${d(c.l)}" fill="none" stroke="${PAL.tinta}" stroke-width="${((c.ancho + 0.36) * PXM).toFixed(0)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    o.push(`<path d="${d(c.l)}" fill="none" stroke="${PAL.bordillo}" stroke-width="${((c.ancho + 0.26) * PXM).toFixed(0)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const c of asfaltadas) {
    o.push(`<path d="${d(c.l)}" fill="none" stroke="url(#asfalto)" stroke-width="${(c.ancho * PXM).toFixed(0)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  // Charcos, parches y manchas de aceite, solo sobre la calzada.
  {
    const g = [];
    for (const c of asfaltadas) {
      const L = largoPolilinea(c.l);
      const rc = azar(`charcos:${c.id}`);
      for (let s = rc() * 6 * PXM; s < L; s += (4 + rc() * 8) * PXM) {
        const { p, tan } = puntoEn(c.l, s);
        const n = [-tan[1], tan[0]];
        const off = (rc() - 0.5) * c.ancho * 0.9 * PXM;
        const x = p[0] + n[0] * off, y = p[1] + n[1] * off;
        if (x < -200 || y < -200 || x > W + 200 || y > H + 200) continue;
        const ang = Math.atan2(tan[1], tan[0]) * 180 / Math.PI;
        const k = rc();
        if (k < 0.45) {        // charco con brillo frío en el borde
          const rx = 40 + rc() * 110, ry = 20 + rc() * 45;
          g.push(`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" transform="rotate(${ang.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="${PAL.charco}" opacity="0.75"/>`);
          g.push(`<ellipse cx="${(x - 4).toFixed(0)}" cy="${(y - 4).toFixed(0)}" rx="${(rx * 0.8).toFixed(0)}" ry="${(ry * 0.6).toFixed(0)}" transform="rotate(${ang.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="none" stroke="${PAL.reflejo}" stroke-width="2" opacity="0.35"/>`);
        } else if (k < 0.75) { // parche de asfalto nuevo
          g.push(`<rect x="${(x - 50).toFixed(0)}" y="${(y - 35).toFixed(0)}" width="${(60 + rc() * 120).toFixed(0)}" height="${(40 + rc() * 60).toFixed(0)}" transform="rotate(${ang.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="#202428" stroke="#15181b" stroke-width="2" opacity="0.6"/>`);
        } else {               // mancha de aceite
          g.push(`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(25 + rc() * 40).toFixed(0)}" ry="${(15 + rc() * 25).toFixed(0)}" fill="#0e1013" opacity="0.4"/>`);
        }
      }
      // Grietas.
      for (let s = rc() * 10 * PXM; s < L; s += (6 + rc() * 10) * PXM) {
        const { p } = puntoEn(c.l, s);
        g.push(`<path d="M${p[0].toFixed(0)},${p[1].toFixed(0)}l${((rc() - 0.5) * 90).toFixed(0)},${((rc() - 0.5) * 90).toFixed(0)}l${((rc() - 0.5) * 60).toFixed(0)},${((rc() - 0.5) * 60).toFixed(0)}" stroke="#121417" stroke-width="2" fill="none" opacity="0.7"/>`);
      }
    }
    o.push(`<g mask="url(#mAsfalto)">${g.join("")}</g>`);
  }
  // Marcas viales: eje discontinuo en las calles de doble sentido grandes, línea de borde.
  for (const c of asfaltadas.filter(c => c.prio >= 5 && c.tags.oneway !== "yes")) {
    o.push(`<path d="${d(c.l)}" fill="none" stroke="#a9adb0" stroke-width="7" stroke-dasharray="150 250" opacity="0.55"/>`);
  }

  // 7. Vías de tren.
  for (const v of S.vias) {
    o.push(`<path d="${d(v)}" fill="none" stroke="${PAL.via}" stroke-width="${3 * PXM}" stroke-linejoin="round"/>`);
    o.push(`<path d="${d(v)}" fill="none" stroke="${PAL.traviesa}" stroke-width="${2.4 * PXM}" stroke-dasharray="10 22" stroke-linejoin="round"/>`);
    o.push(`<path d="${d(v)}" fill="none" stroke="#8c9093" stroke-width="${1.6 * PXM}" stroke-linejoin="round" opacity="0.9"/>`);
    o.push(`<path d="${d(v)}" fill="none" stroke="${PAL.via}" stroke-width="${1.35 * PXM}" stroke-linejoin="round"/>`);
  }

  // 8. Árboles (procedurales en zonas verdes; OSM no trae la capa de árboles).
  const ar = arboles(S, r);
  o.push(...ar.sombras, ...ar.copas);

  // 9. Edificios: sombra proyectada sutil abajo-derecha, azotea, pretil, detalles, tinta.
  o.push(`<g filter="url(#suave)" opacity="0.55">${edifs.map(e => `<path d="${dPol(e)}" transform="translate(16,18)" fill="${PAL.sombra}" fill-rule="evenodd"/>`).join("")}</g>`);
  for (const [i, e] of edifs.entries()) {
    const re = azar(`azotea:${e.id}`);
    const tejado = ["church", "chapel", "house", "cathedral"].includes(e.tags.building) || e.tags["roof:material"] === "roof_tiles" || ["gabled", "hipped"].includes(e.tags["roof:shape"]);
    const base = tejado ? variar(PAL.tejado, (re() - 0.5) * 0.12) : variar(PAL.azotea, (re() - 0.5) * 0.16);
    o.push(`<path d="${dPol(e)}" fill="${base}" fill-rule="evenodd"/>`);
    if (tejado) {
      // Teja: rayado paralelo a la fachada más larga.
      const r0 = e.ext[0];
      let largo = 0, ang = 0;
      for (let k = 0; k < r0.length - 1; k++) {
        const L = Math.hypot(r0[k + 1][0] - r0[k][0], r0[k + 1][1] - r0[k][1]);
        if (L > largo) { largo = L; ang = Math.atan2(r0[k + 1][1] - r0[k][1], r0[k + 1][0] - r0[k][0]) * 180 / Math.PI; }
      }
      o.push(`<g clip-path="url(#e${i})"><g transform="rotate(${ang.toFixed(1)} ${r0[0][0].toFixed(0)} ${r0[0][1].toFixed(0)})">` +
        Array.from({ length: 160 }, (_, k) => `<line x1="${(r0[0][0] - 4000).toFixed(0)}" y1="${(r0[0][1] - 2000 + k * 25).toFixed(0)}" x2="${(r0[0][0] + 4000).toFixed(0)}" y2="${(r0[0][1] - 2000 + k * 25).toFixed(0)}" stroke="#3f3a37" stroke-width="3" opacity="0.55"/>`).join("") +
        `</g></g>`);
    } else {
      const det = detallesAzotea(e, re);
      o.push(`<g clip-path="url(#e${i})">${det.sombras.join("")}${det.out.join("")}</g>`);
      o.push(`<path d="${dPol(e)}" fill="none" stroke="${PAL.pretil}" stroke-width="22" clip-path="url(#e${i})"/>`);
      o.push(`<path d="${dPol(e)}" fill="none" stroke="${PAL.tinta}" stroke-width="1.6" opacity="0.5" transform="translate(0,0)" clip-path="url(#e${i})" stroke-dasharray="0" />`);
    }
    o.push(`<path d="${dPol(e)}" fill="none" stroke="${PAL.tinta}" stroke-width="4" stroke-linejoin="round"/>`);
  }

  // 10. Postes de farola (el objeto físico, apagado; la luz la pone Foundry) y umbrales de las puertas.
  for (const l of geo.luces) {
    const h = l._haciaCalle, L = Math.hypot(h[0], h[1]) || 1;
    const bx = l.x + h[0] / L * 0.9 * PXM, by = l.y + h[1] / L * 0.9 * PXM;
    o.push(`<circle cx="${l.x + 5}" cy="${l.y + 6}" r="9" fill="${PAL.sombra}" opacity="0.5"/>`);
    o.push(`<path d="M${l.x},${l.y}L${bx.toFixed(0)},${by.toFixed(0)}" stroke="${PAL.tinta}" stroke-width="7" stroke-linecap="round"/>`);
    o.push(`<path d="M${l.x},${l.y}L${bx.toFixed(0)},${by.toFixed(0)}" stroke="#4b5055" stroke-width="3.5" stroke-linecap="round"/>`);
    o.push(`<circle cx="${l.x}" cy="${l.y}" r="8" fill="#3a3e42" stroke="${PAL.tinta}" stroke-width="2.4"/>`);
  }
  for (const p of geo._puertas) {
    const [x1, y1, x2, y2] = p.c;
    const n = p.normal;
    const off = 0.3 * PXM;
    o.push(`<path d="M${x1},${y1}L${x2},${y2}L${(x2 + n[0] * off).toFixed(0)},${(y2 + n[1] * off).toFixed(0)}L${(x1 + n[0] * off).toFixed(0)},${(y1 + n[1] * off).toFixed(0)}Z" fill="#8d9193" stroke="${PAL.tinta}" stroke-width="2.4" opacity="0.9"/>`);
    // El hueco en la fachada: un vano oscuro donde el pretil se corta.
    o.push(`<path d="M${x1},${y1}L${x2},${y2}" stroke="#1b1e22" stroke-width="12"/>`);
  }

  // 11. Grano.
  o.push(`<rect width="${W}" height="${H}" filter="url(#grano)" opacity="0.06"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${o.join("")}</svg>`;
}

/* -------------------------------------------- */
/*  Sector completo                             */
/* -------------------------------------------- */

export function construirSector(sec, { imagen = true, svg = false } = {}) {
  const S = cargarSector(sec);
  S.mar = mascaraMar(S, 0.25 * PXM);
  const { P, W, H } = S;
  const avisos = [];
  const pois = JSON.parse(fs.readFileSync(path.join(RAIZ, "content/malaga/pois.json"), "utf8")).pois;

  // Edificios del sector (los que tocan el rectángulo).
  const enSector = S.edificios.filter(e => e.ext.some(r => recortar(r, W, H).length >= 3));

  // POIs → edificio.
  const puntos = [];
  for (const id of sec.pois ?? []) {
    const poi = pois.find(p => p.id === id);
    if (!poi) { avisos.push(`POI ${id}: no está en content/malaga/pois.json`); continue; }
    // `ubicaciones` (opcional, por sector) ubica un lugar FICTICIO en un edificio
    // real de la manzana sin mover el pin del mapa de la ciudad.
    const ub = sec.ubicaciones?.[id] ?? poi;
    const p = P.aPx(ub.lat, ub.lon);
    const fuera = p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H;
    const conPuerta = (sec.entradas ?? []).some(e => e.poi === id);
    if (fuera) {
      avisos.push(`POI ${id}: su coordenada cae fuera del sector (${p.map(Math.round).join(",")} px); pin en el centro${conPuerta ? " y SIN puerta" : ""}`);
      puntos.push({ poi: id, x: Math.round(W / 2), y: Math.round(H / 2), edificio: null, aproximado: true });
      continue;
    }
    const dentro = S.edificios.findIndex(e => dentroPoligono(p, e));
    if (dentro >= 0) { puntos.push({ poi: id, x: Math.round(p[0]), y: Math.round(p[1]), edificio: S.edificios[dentro].id, aproximado: false, _bi: dentro }); continue; }
    if (!conPuerta) {
      // Un lugar abierto (playa, muelle, cementerio): el pin va en su coordenada.
      avisos.push(`POI ${id}: no hay edificio en su coordenada (lugar abierto); pin en la coordenada`);
      puntos.push({ poi: id, x: Math.round(p[0]), y: Math.round(p[1]), edificio: null, aproximado: false });
      continue;
    }
    const b = edificioDePoi(S, p);
    if (b.i < 0) { avisos.push(`POI ${id}: no hay edificios cerca`); puntos.push({ poi: id, x: Math.round(p[0]), y: Math.round(p[1]), edificio: null, aproximado: true }); continue; }
    avisos.push(`POI ${id}: no hay edificio en su coordenada; uso el más cercano (osm ${S.edificios[b.i].id}, a ${(b.d / PXM).toFixed(1)} m)`);
    puntos.push({ poi: id, x: Math.round(p[0]), y: Math.round(p[1]), edificio: S.edificios[b.i].id, aproximado: true, _bi: b.i });
  }

  // Muros y puertas.
  const segs = segmentosDeEdificios(S);
  const entradas = (sec.entradas ?? []).map((e, i) => ({ ...e, n: i + 1 }));
  actualizarPlanos(sec, entradas, avisos);
  const puertas = [];
  const previasPorEdificio = new Map();
  const callesPuerta = S.calles;
  for (const e of entradas) {
    const pt = puntos.find(p => p.poi === e.poi);
    if (!pt || pt._bi === undefined) { avisos.push(`entrada-${e.n}: sin edificio para ${e.poi}`); continue; }
    const previas = previasPorEdificio.get(pt._bi) ?? [];
    const pu = abrirPuerta(S, segs, pt._bi, previas, callesPuerta);
    if (!pu) { avisos.push(`entrada-${e.n}: no encontré fachada libre para la puerta de ${e.poi}`); continue; }
    previas.push(pu.centro);
    previasPorEdificio.set(pt._bi, previas);
    puertas.push({ entrada: e.n, poi: e.poi, nombre: e.nombre, c: pu.c, destino: e.destino, sala: e.sala,
      regionInterior: e.regionInterior, regionSalida: e.regionSalida, doorSound: SONIDO_PALETA[e.paleta] ?? "woodBasic",
      _centro: pu.centro, normal: pu.normal });
    if (puertas.filter(p => p.poi === e.poi).length === 1) { pt.x = Math.round(pu.centro[0]); pt.y = Math.round(pu.centro[1]); pt.puerta = true; }
  }

  const muros = segs.map(s => {
    if (!s.door) return { c: s.c, ...MURO };
    const p = puertas.find(q => q.c.join() === s.c.join());
    return { c: s.c, ...MURO, door: 1, ds: 0, doorSound: p?.doorSound ?? "woodBasic" };
  });
  // Verjas (sight/light libres) y tapias, solo si OSM las trae.
  for (const b of S.barreras) {
    const c = recortar(b.l, W, H);
    for (let i = 0; i < c.length; i++) {
      const a = c[i], bb = c[(i + 1) % c.length];
      const s = [a[0], a[1], bb[0], bb[1]].map(Math.round);
      if (Math.hypot(s[2] - s[0], s[3] - s[1]) < 2 || enBorde(s, W, H)) continue;
      muros.push(b.tipo === "fence" ? { c: s, ...MURO, sight: 0, light: 0, sound: 0 } : { c: s, ...MURO });
    }
  }

  // Farolas.
  const luces = farolas(S, sec);

  // Regiones.
  const regiones = [...regionesBorde(S, sec), regionLlegada(S)];
  for (const p of puertas) {
    const t = 2 * PXM;
    const cx = p._centro[0] + p.normal[0] * 1.3 * PXM, cy = p._centro[1] + p.normal[1] * 1.3 * PXM;
    const x = Math.min(W - 3 * PXM - t, Math.max(3 * PXM, cx - t / 2)), y = Math.min(H - 3 * PXM - t, Math.max(3 * PXM, cy - t / 2));
    regiones.push({ id: `entrada-${p.entrada}`, nombre: `${p.nombre} → ${p.destino}`, x: Math.round(x), y: Math.round(y), w: t, h: t,
      destino: p.regionInterior ? { escena: p.destino, region: p.regionInterior, uuid: UUID.plano(p.destino, p.regionInterior) } : null });
  }
  for (const rg of regiones) rg.uuid = UUID.sector(sec.id, rg.id);
  const huecos = aparcamientos(S, regiones.find(r => r.id === "llegada"));
  if (!huecos.length) avisos.push("sin aparcamientos: los vehículos del sector irán junto a la llegada");

  const a = generalPx(P.bbox.norte, P.bbox.oeste), b = generalPx(P.bbox.sur, P.bbox.este);
  const geo = {
    _comentario: `Generado por tools/sectores.mjs desde OpenStreetMap (© OpenStreetMap contributors, ODbL). No editar a mano.`,
    id: sec.id, nombre: sec.nombre, ancho: W, alto: H, pxPorMetro: PXM,
    centro: sec.centro,
    bbox: Object.fromEntries(Object.entries(P.bbox).map(([k, v]) => [k, +v.toFixed(7)])),
    enMalaga: { region: `malaga:${sec.id}`, uuid: UUID.malaga(sec.id),
      x: +a.x.toFixed(1), y: +a.y.toFixed(1), w: +(b.x - a.x).toFixed(1), h: +(b.y - a.y).toFixed(1) },
    edificios: enSector.length,
    muros,
    puertas: puertas.map(({ _centro, normal, ...p }) => p),
    luces: luces.map(({ _tan, _haciaCalle, ...l }) => l),
    regiones,
    aparcamientos: huecos,
    puntos: puntos.map(({ _bi, ...p }) => p),
    avisos
  };

  fs.mkdirSync(SALIDA_GEO, { recursive: true });
  fs.writeFileSync(path.join(SALIDA_GEO, `${sec.id}.json`), JSON.stringify(geo, null, 1).replace(/\n\s+(?=[\d\-\]])/g, " ").replace(/\[\s+(?=\d|-)/g, "[") + "\n");

  if (imagen) {
    fs.mkdirSync(SALIDA_IMG, { recursive: true });
    const svgTxt = renderSvg(S, sec, { luces, _puertas: puertas });
    const tmp = path.join(SALIDA_IMG, `${sec.id}.esquema.svg`);
    fs.writeFileSync(tmp, svgTxt);
    try {
      execFileSync("magick", ["-background", "none", tmp, "-quality", "92", path.join(SALIDA_IMG, `${sec.id}.esquema.webp`)], { stdio: "pipe" });
    } finally {
      if (!svg) fs.rmSync(tmp, { force: true });
    }
  }
  return { geo, S };
}

export const cargarSectores = () => CONFIG.sectores;

if (import.meta.filename === process.argv[1]) {
  const argv = process.argv.slice(2);
  const solo = (() => { const i = argv.indexOf("--solo"); return i >= 0 ? argv[i + 1] : null; })();
  const sectores = CONFIG.sectores.filter(s => !solo || s.id === solo);
  if (!sectores.length) { console.error(`No encontré el sector "${solo}".`); process.exit(1); }
  for (const sec of sectores) {
    const t0 = Date.now();
    const { geo } = construirSector(sec, { imagen: !argv.includes("--sin-imagen"), svg: argv.includes("--svg") });
    const puertas = geo.muros.filter(m => m.door).length;
    console.log(`  ${sec.id.padEnd(24)} ${String(geo.edificios).padStart(3)} edificios · ${String(geo.muros.length - puertas).padStart(4)} muros · ` +
      `${puertas} puertas · ${String(geo.luces.length).padStart(2)} farolas · ${geo.regiones.length} regiones  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    for (const a of geo.avisos) console.log(`      ! ${a}`);
  }
  console.log(`✓ ${sectores.length} sector(es) → assets/mapas/sectores, content/sectores/geo`);
}
