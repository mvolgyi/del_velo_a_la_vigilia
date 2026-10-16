#!/usr/bin/env node
/**
 * content/ → packs-src/ (+ customEdges en module.json y lang/caminos-*.json)
 *
 * Toda la prosa y los datos del módulo viven en content/ como fuente única:
 *
 *   content/caminos.json   los tres caminos (poderes, reservas, mejoras)
 *   content/estados.json   estados (ítems condition) con sus modificadores
 *   content/arsenal.json   armas, equipo y sets por Credo
 *   content/pnjs.json      PNJs (actores spc)
 *   content/pjs.json       plantillas de cazador (actores hunter)
 *   content/reglas/*.md    journals de reglas
 *   content/cronica/*.md   journals de la crónica
 *   content/planos/*.json  planos de las escenas (mapa + muros + puertas + regiones + luces)
 *   content/escenas.json   escenas sueltas sin plano (opcional; mapas en assets/mapas)
 *
 * De ahí salen los documentos de compendio, con ids estables para que
 * reconstruir no rompa los @UUID ni duplique nada al reimportar.
 *
 * Marcadores propios sobre Markdown (crónica y reglas):
 *   @tirada{attributes.composure+attributes.resolve|2|Compostura + Resolución}  → botón de tirada
 *   ⚑{fe|+1|motivo}                                                             → botón que mueve una baliza
 *   @npc{marcos} / @npc{marcos|el vampiro}                                      → @UUID al actor del compendio
 *   @item{molotov|Molotov}                                                      → @UUID al ítem del Arsenal
 *   :::leer ... :::                                                             → recuadro de leer en voz alta
 *
 * Uso: node tools/construir-contenido.mjs [--verbose]
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { marked } from "marked";
import {
  RAIZ, MODULO, STATS, idEstable, slug, enlace, uuid,
  limpiarGenerados, escribirDoc, Carpetas, leerJson, archivosMd, separarFrontmatter
} from "./util.mjs";
import { cargarPlanos } from "./construir-planos.mjs";
import { derivarMuros, derivarRegiones, mueblesMoviles, GRID_PX, PX_POR_PIE } from "./planos.mjs";
import { lucesDePlano } from "./iluminacion.mjs";

const verbose = process.argv.includes("--verbose");
const avisos = [];
const log = (...a) => verbose && console.log(...a);

marked.use({ gfm: true });
const md2html = md => marked.parse(md, { async: false });

const existe = rel => fs.existsSync(path.join(RAIZ, rel));
const PACKS = ["reservas", "mejoras", "estados", "rasgos", "arsenal", "reglas", "cronica", "personajes", "escenas", "macros", "playlists", "aventura"];
for (const p of PACKS) limpiarGenerados(path.join(RAIZ, "packs-src", p));

const ICONO_ITEM = "systems/wod5e/assets/icons/items/item-default.svg";
const flags = (origen, extra = {}) => ({ [MODULO]: { origen, ...extra } });

/* ========================================================================== */
/*  Los tres caminos                                                          */
/* ========================================================================== */

const CAMINOS = leerJson("content/caminos.json").caminos;
const edgeId = (camino, poder) => `dvv-${camino.prefijo}-${poder.id}`;
const poderesDe = camino => [camino.pasiva, ...camino.poderes].filter(Boolean);

/** Todos los ids de Facultad de un camino, para expandir selectores `dvv-<prefijo>`. */
const edgesDeCamino = Object.fromEntries(
  CAMINOS.map(c => [`dvv-${c.prefijo}`, poderesDe(c).map(p => `edges.${edgeId(c, p)}`)])
);

const ETIQUETA_CAMINO = { imbuido: "Imbuido", iluminado: "Iluminado", modificado: "Modificado", gen2: "Gen II" };

/** Ids estables de cada documento generado, para enlazar desde los journals. */
const ID = {
  reserva: (eid, i) => idEstable(`reserva:${eid}:${i}`),
  mejora: (eid, mid) => idEstable(`mejora:${eid}:${mid}`),
  estado: id => idEstable(`estado:${id}`),
  rasgo: id => idEstable(`rasgo:${id}`),
  arma: id => idEstable(`arma:${id}`),
  equipo: id => idEstable(`equipo:${id}`),
  actor: id => idEstable(`actor:${id}`),
  journal: id => idEstable(`journal:${id}`),
  pagina: (jid, i) => idEstable(`pagina:${jid}:${i}`),
  escena: id => idEstable(`escena:${id}`),
  macro: id => idEstable(`macro:${id}`)
};

function descripcionPoder(camino, poder) {
  const partes = [];
  if (poder.nombreOriginal || poder.emula) {
    partes.push(`<p><em>${poder.nombreOriginal || ""}${poder.emula ? ` · emula ${poder.emula}` : ""}</em></p>`);
  }
  partes.push(poder.intro || "");
  partes.push(`<p><strong>Sistema.</strong></p>${poder.sistema || ""}`);
  if (poder.precioPropio) partes.push(`<p><strong>El precio propio.</strong></p>${poder.precioPropio}`);
  if (poder.marca) partes.push(`<p><strong>La marca:</strong> ${poder.marca}</p>`);
  if (camino.activacion && !poder.gratis) {
    partes.push(`<p><em>Activación — ${camino.activacion.nombre}: incluí los dados de Desesperación de la Célula en la tirada.</em></p>`);
  }
  if (camino.id === "gen2") {
    partes.push("<p><em>Activación — exigir la carne: incluí los dados de Desesperación. Ocupa 2 Modificaciones contra el límite de Resistencia.</em></p>");
  }
  return partes.join("\n");
}

function construirCaminos() {
  const carpReservas = new Carpetas("reservas", "Item");
  const carpMejoras = new Carpetas("mejoras", "Item");
  const customEdges = [];
  const langEs = {};
  const langEn = {};
  let nReservas = 0, nMejoras = 0;

  for (const camino of CAMINOS) {
    const etiqueta = ETIQUETA_CAMINO[camino.id] ?? camino.nombre;
    for (const poder of poderesDe(camino)) {
      const eid = edgeId(camino, poder);
      customEdges.push({ id: eid, label: `DVV.Edges.${eid}` });
      langEs[eid] = `[${etiqueta}] ${poder.nombre}`;
      langEn[eid] = `[${etiqueta}] ${poder.nombre}${poder.nombreOriginal && !poder.nombreOriginal.startsWith("≈") ? ` (${poder.nombreOriginal})` : ""}`;

      // Reservas: una por tirada del poder.
      poder.reservas.forEach((reserva, i) => {
        const dif = reserva.dificultad > 0 ? ` (dif. ${reserva.dificultad})` : "";
        const dicepool = Object.fromEntries(reserva.dados.map((p, j) => [`d${j + 1}`, { path: p }]));
        const nota = reserva.nota ? `<p><em>${reserva.nota}.</em></p>` : "";
        escribirDoc("reservas", {
          _id: ID.reserva(eid, i),
          _key: `!items!${ID.reserva(eid, i)}`,
          name: `${poder.nombre} — ${reserva.nombre}${dif}`,
          type: "edgepool",
          img: ICONO_ITEM,
          folder: carpReservas.id(camino.nombre),
          sort: (camino.poderes.indexOf(poder) + 1) * 100 + i,
          system: {
            description: descripcionPoder(camino, poder) + nota,
            macroid: "",
            bonuses: [],
            dataItemId: "",
            source: { book: "Del Velo a la Vigilia", page: camino.nombre },
            edge: eid,
            dicepool
          },
          effects: [],
          ownership: { default: 0 },
          flags: flags("reserva", { poder: eid, camino: camino.id, dificultad: reserva.dificultad ?? 0, indice: i }),
          _stats: STATS
        });
        nReservas++;
      });

      // Mejoras: una por Beneficio.
      for (const mejora of poder.mejoras ?? []) {
        const sufijo = mejora.gasto && camino.gasto?.nombre ? ` (${camino.gasto.nombre})` : "";
        const mid = ID.mejora(eid, mejora.id);
        escribirDoc("mejoras", {
          _id: mid,
          _key: `!items!${mid}`,
          name: `${mejora.nombre}${sufijo}`,
          type: "perk",
          img: ICONO_ITEM,
          folder: carpMejoras.id(camino.nombre),
          sort: 0,
          system: {
            description: `<p><em>Mejora de ${poder.nombre}.</em></p>${mejora.texto}${mejora.gasto ? `<p><em>${camino.gasto?.nombre ?? "Gasto"}: además de incluir los dados de Desesperación, bajá la Desesperación de la Célula en 1.</em></p>` : ""}`,
            macroid: "",
            bonuses: [],
            dataItemId: "",
            source: { book: "Del Velo a la Vigilia", page: camino.nombre },
            edge: eid,
            selected: false
          },
          effects: [],
          ownership: { default: 0 },
          flags: flags("mejora", { poder: eid, camino: camino.id, mejora: mejora.id, gasto: !!mejora.gasto }),
          _stats: STATS
        });
        nMejoras++;
      }
    }

    // Defecto obligatorio del camino.
    if (camino.defecto) {
      const rid = ID.rasgo(camino.id);
      escribirDoc("rasgos", {
        _id: rid,
        _key: `!items!${rid}`,
        name: `${camino.defecto.nombre} (${camino.nombre})`,
        type: "feature",
        img: ICONO_ITEM,
        folder: null,
        sort: 0,
        system: {
          description: camino.defecto.texto,
          macroid: "",
          bonuses: [],
          dataItemId: "",
          source: { book: "Del Velo a la Vigilia", page: camino.nombre },
          uses: { current: 0, max: 0, enabled: false },
          points: 1,
          featuretype: "flaw"
        },
        effects: [],
        ownership: { default: 0 },
        flags: flags("rasgo", { camino: camino.id }),
        _stats: STATS
      });
    }
  }

  carpReservas.escribir();
  carpMejoras.escribir();

  // customEdges en module.json y etiquetas en lang/.
  const manifestPath = path.join(RAIZ, "module.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.flags ??= {};
  manifest.flags.wod5e ??= {};
  manifest.flags.wod5e.customEdges = customEdges;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(RAIZ, "lang/caminos-es.json"), JSON.stringify({ DVV: { Edges: langEs } }, null, 2) + "\n");
  fs.writeFileSync(path.join(RAIZ, "lang/caminos-en.json"), JSON.stringify({ DVV: { Edges: langEn } }, null, 2) + "\n");

  console.log(`caminos: ${customEdges.length} facultades, ${nReservas} reservas, ${nMejoras} mejoras`);
}

/* ========================================================================== */
/*  Estados                                                                   */
/* ========================================================================== */

function construirEstados() {
  if (!existe("content/estados.json")) return;
  const { estados } = leerJson("content/estados.json");
  const carpetas = new Carpetas("estados", "Item");
  const nombreCamino = Object.fromEntries(CAMINOS.map(c => [c.id, c.nombre]));

  for (const e of estados) {
    const bonuses = (e.bonuses ?? []).map(b => ({
      ...b,
      paths: b.paths.flatMap(p => edgesDeCamino[p] ?? [p])
    }));
    const id = ID.estado(e.id);
    escribirDoc("estados", {
      _id: id,
      _key: `!items!${id}`,
      name: e.nombre,
      type: "condition",
      img: e.icono ?? ICONO_ITEM,
      folder: carpetas.id(nombreCamino[e.camino] ?? "Otros"),
      sort: 0,
      system: {
        description: e.descripcion,
        macroid: "",
        bonuses,
        dataItemId: "",
        source: { book: "Del Velo a la Vigilia", page: nombreCamino[e.camino] ?? "" },
        suppressed: false,
        effects: {}
      },
      effects: [],
      ownership: { default: 0 },
      flags: flags("estado", { estado: e.id, camino: e.camino }),
      _stats: STATS
    });
  }
  carpetas.escribir();
  console.log(`estados: ${estados.length}`);
}

/* ========================================================================== */
/*  El Arsenal de la Vigilia                                                  */
/* ========================================================================== */

const ARSENAL = existe("content/arsenal.json") ? leerJson("content/arsenal.json") : null;
const NOMBRE_DADO = {
  "attributes.strength": "Fuerza", "attributes.dexterity": "Destreza", "attributes.stamina": "Resistencia",
  "attributes.charisma": "Carisma", "attributes.manipulation": "Manipulación", "attributes.composure": "Compostura",
  "attributes.intelligence": "Inteligencia", "attributes.wits": "Astucia", "attributes.resolve": "Resolución",
  "skills.athletics": "Atletismo", "skills.brawl": "Pelea", "skills.craft": "Artesanía", "skills.drive": "Conducir",
  "skills.firearms": "Armas de fuego", "skills.larceny": "Latrocinio", "skills.melee": "Cuerpo a cuerpo",
  "skills.stealth": "Sigilo", "skills.survival": "Supervivencia", "skills.animalken": "Trato con animales",
  "skills.etiquette": "Etiqueta", "skills.insight": "Empatía", "skills.intimidation": "Intimidación",
  "skills.leadership": "Liderazgo", "skills.performance": "Interpretación", "skills.persuasion": "Persuasión",
  "skills.streetwise": "Callejeo", "skills.subterfuge": "Subterfugio", "skills.academics": "Académicas",
  "skills.awareness": "Consciencia", "skills.finance": "Finanzas", "skills.investigation": "Investigación",
  "skills.medicine": "Medicina", "skills.occult": "Ocultismo", "skills.politics": "Política",
  "skills.science": "Ciencias", "skills.technology": "Tecnología"
};
const nombrarDados = dados => dados.map(d => NOMBRE_DADO[d] ?? d).join(" + ");

function descripcionArma(a) {
  const filas = [
    ["Reserva", nombrarDados(a.dados) + (a.dadosAlternativos?.length ? ` (o ${nombrarDados(a.dadosAlternativos)})` : "")],
    ["Daño", `+${a.dano}${a.agravado ? " agravado" : ""}`],
    ["Dif. / regla", a.dificultad || "—"],
    ["Ocultamiento", a.ocultamiento || "—"],
    ["Recursos", a.recursos || "—"]
  ];
  const tabla = `<table class="dvv-ficha"><tbody>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>`;
  return `${tabla}${a.notas ? `<p>${a.notas}</p>` : ""}<p><em>Las armas comunes infligen daño superficial a vampiros y criaturas resistentes (y lo dividen a la mitad). Para agravado hace falta fuego, sol o equipamiento especial.</em></p>`;
}

function construirArsenal() {
  if (!ARSENAL) return;
  const carpetas = new Carpetas("arsenal", "Item");
  const CATEGORIA = { cuerpo: "Cuerpo a cuerpo e improvisadas", fuego: "Armas de fuego", especial: "Arsenal del cazador" };

  for (const a of ARSENAL.armas) {
    const id = ID.arma(a.id);
    escribirDoc("arsenal", {
      _id: id,
      _key: `!items!${id}`,
      name: a.nombre,
      type: "weapon",
      img: a.tipo === "ranged" ? "icons/weapons/guns/gun-pistol-brass.webp" : "icons/weapons/swords/sword-guard-steel-green.webp",
      folder: carpetas.id(CATEGORIA[a.categoria] ?? "Armas"),
      sort: 0,
      system: {
        description: descripcionArma(a),
        macroid: "",
        bonuses: [],
        dataItemId: "",
        source: { book: "Del Velo a la Vigilia", page: "El Arsenal de la Vigilia" },
        weaponType: a.tipo,
        weaponvalue: a.dano,
        uses: { current: 0, max: 0, enabled: false },
        quantity: 1,
        dicepool: Object.fromEntries(a.dados.map((p, j) => [`d${j + 1}`, { path: p }]))
      },
      effects: [],
      ownership: { default: 0 },
      flags: flags("arma", { arma: a.id, categoria: a.categoria, agravado: !!a.agravado }),
      _stats: STATS
    });
  }

  for (const e of ARSENAL.equipo) {
    const id = ID.equipo(e.id);
    const filas = [["Uso", e.uso], ["Daño", e.dano], ["Regla", e.regla], ["Recursos", e.recursos]].filter(([, v]) => v);
    escribirDoc("arsenal", {
      _id: id,
      _key: `!items!${id}`,
      name: e.nombre,
      type: "gear",
      img: "icons/containers/bags/pack-leather-black-brown.webp",
      folder: carpetas.id("Equipo y munición especial"),
      sort: 0,
      system: {
        description: `<table class="dvv-ficha"><tbody>${filas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>${e.descripcion ? `<p>${e.descripcion}</p>` : ""}`,
        macroid: "",
        bonuses: [],
        dataItemId: "",
        source: { book: "Del Velo a la Vigilia", page: "El Arsenal de la Vigilia" },
        uses: { current: 0, max: 0, enabled: false },
        quantity: 1,
        dicepool: {}
      },
      effects: [],
      ownership: { default: 0 },
      flags: flags("equipo", { equipo: e.id }),
      _stats: STATS
    });
  }
  carpetas.escribir();
  console.log(`arsenal: ${ARSENAL.armas.length} armas, ${ARSENAL.equipo.length} equipo, ${ARSENAL.sets.length} sets`);
}

/** UUID de un ítem del Arsenal por su id de contenido (arma o equipo). */
function uuidArsenal(id) {
  if (!ARSENAL) return null;
  if (ARSENAL.armas.some(a => a.id === id)) return uuid("arsenal", "Item", ID.arma(id));
  if (ARSENAL.equipo.some(e => e.id === id)) return uuid("arsenal", "Item", ID.equipo(id));
  return null;
}

/* ========================================================================== */
/*  Markdown → journals                                                       */
/* ========================================================================== */

const PNJS = existe("content/pnjs.json") ? leerJson("content/pnjs.json").pnjs : [];
const nombrePnj = Object.fromEntries(PNJS.map(p => [p.id, p.nombre]));

function expandirMarcadores(md, archivo) {
  // :::leer ... :::
  md = md.replace(/^:::leer\s*\n([\s\S]*?)\n:::\s*$/gm, (_, inner) =>
    `\n<section class="dvv-leer">${md2html(inner.trim())}</section>\n`);

  // @tirada{paths|dif|texto}
  md = md.replace(/@tirada\{([^}|]+)\|([^}|]*)\|([^}]+)\}/g, (_, paths, dif, texto) => {
    const valuePaths = paths.split("+").map(s => s.trim()).filter(Boolean).join(" ");
    const d = Number(dif) || 0;
    const t = texto.trim().replace(/"/g, "&quot;");
    return `<a class="dvv-tirada" data-dvv-tirada="${valuePaths}" data-dificultad="${d}" data-label="${t}"><i class="fa-solid fa-dice-d10"></i> ${texto.trim()}</a>`;
  });

  // ⚑{fe|+1|motivo}
  md = md.replace(/⚑\{(fe|metodo|carne)\|([+-]?\d+)\|([^}]+)\}/g, (_, baliza, delta, motivo) => {
    const d = Number(delta);
    const signo = d > 0 ? `+${d}` : `${d}`;
    const nombre = { fe: "Fe", metodo: "Método", carne: "Carne" }[baliza];
    const m = motivo.trim().replace(/"/g, "&quot;");
    return `<button type="button" class="dvv-baliza ${baliza}" data-dvv-baliza="${baliza}" data-delta="${d}" data-motivo="${m}"><span class="dvv-baliza-delta">${signo} ${nombre}</span><span class="dvv-baliza-motivo">${motivo.trim()}</span></button>`;
  });

  // @npc{id|texto}
  md = md.replace(/@npc\{([^}|]+)(?:\|([^}]+))?\}/g, (_, id, etiqueta) => {
    id = id.trim();
    if (!nombrePnj[id]) {
      avisos.push(`${archivo}: @npc{${id}} no existe en content/pnjs.json`);
      return etiqueta?.trim() ?? id;
    }
    // Al actor del MUNDO: la Aventura lo importa conservando el id, así el
    // enlace queda vivo en la mesa (token, salud) y no toca el compendio.
    return `@UUID[Actor.${ID.actor(id)}]{${etiqueta?.trim() || nombrePnj[id]}}`;
  });

  // @vehiculo{id|texto}
  md = md.replace(/@vehiculo\{([^}|]+)(?:\|([^}]+))?\}/g, (_, id, etiqueta) => {
    id = id.trim();
    const v = (existe("content/vehiculos.json") ? leerJson("content/vehiculos.json").vehiculos : []).find(x => x.id === id);
    if (!v) { avisos.push(`${archivo}: @vehiculo{${id}} no existe`); return etiqueta?.trim() ?? id; }
    return `@UUID[Actor.${ID.actor(`vehiculo:${id}`)}]{${etiqueta?.trim() || v.nombre}}`;
  });

  // @item{id|texto}
  md = md.replace(/@item\{([^}|]+)(?:\|([^}]+))?\}/g, (_, id, etiqueta) => {
    id = id.trim();
    const u = uuidArsenal(id);
    if (!u) {
      avisos.push(`${archivo}: @item{${id}} no existe en content/arsenal.json`);
      return etiqueta?.trim() ?? id;
    }
    return `@UUID[${u}]{${etiqueta?.trim() || id}}`;
  });

  return md;
}

/** Una página por encabezado de nivel 2; lo anterior al primero es la introducción. */
function paginarMarkdown(cuerpo, nombreJournal) {
  const lineas = cuerpo.split("\n");
  const paginas = [];
  let actual = { nombre: null, lineas: [] };
  let enCodigo = false;
  for (const linea of lineas) {
    if (/^```/.test(linea)) enCodigo = !enCodigo;
    const h2 = !enCodigo && /^## (.+)$/.exec(linea);
    if (h2) {
      paginas.push(actual);
      actual = { nombre: h2[1].trim(), lineas: [] };
      continue;
    }
    actual.lineas.push(linea);
  }
  paginas.push(actual);

  return paginas
    .map(p => {
      let md = p.lineas.join("\n");
      // La introducción arranca con el H1 del documento: lo sacamos, el journal ya tiene nombre.
      md = md.replace(/^# .+\n?/m, "").trim();
      return { nombre: p.nombre ?? "Introducción", md };
    })
    .filter(p => p.md.length > 0 || p.nombre !== "Introducción");
}

/** Enlaces a reservas y mejoras debajo del encabezado de cada poder en los journals de reglas. */
const CAMINO_POR_JOURNAL = {
  "la-marca-de-los-heraldos": "imbuido",
  "la-ciencia-del-umbral": "iluminado",
  "la-carne-templada": "modificado",
  "injertos-de-segunda-generacion": "gen2"
};

function enlazarPoderes(html, caminoId) {
  const camino = CAMINOS.find(c => c.id === caminoId);
  if (!camino) return html;
  return html.replace(/<h([2-4])>([^<]+)<\/h\1>/g, (m, nivel, texto) => {
    const poder = poderesDe(camino).find(p => texto.trim().toLowerCase().includes(p.nombre.toLowerCase()));
    if (!poder) return m;
    const eid = edgeId(camino, poder);
    const reservas = poder.reservas.map((r, i) => enlace("reservas", "Item", ID.reserva(eid, i), r.nombre));
    const mejoras = (poder.mejoras ?? []).map(mj => enlace("mejoras", "Item", ID.mejora(eid, mj.id), mj.nombre));
    const partes = [];
    if (reservas.length) partes.push(`<strong>Reserva:</strong> ${reservas.join(" · ")}`);
    if (mejoras.length) partes.push(`<strong>Mejoras:</strong> ${mejoras.join(" · ")}`);
    return `${m}\n<p class="dvv-enlaces">${partes.join("<br>")}</p>`;
  });
}

function construirJournals(pack, carpetaRaiz) {
  const dir = path.join(RAIZ, "content", pack);
  const archivos = archivosMd(dir);
  if (!archivos.length) return;
  const carpetas = new Carpetas(pack, "JournalEntry");
  let n = 0;

  for (const archivo of archivos) {
    const rel = path.relative(RAIZ, archivo);
    const { meta, cuerpo } = separarFrontmatter(fs.readFileSync(archivo, "utf8"));
    const id = meta.id ?? slug(path.basename(archivo, ".md"));
    const nombre = meta.nombre ?? id;
    const jid = ID.journal(id);
    const caminoId = CAMINO_POR_JOURNAL[id];

    const paginas = paginarMarkdown(expandirMarcadores(cuerpo, rel), nombre).map((p, i) => {
      let html = md2html(p.md);
      if (caminoId) html = enlazarPoderes(html, caminoId);
      const pid = ID.pagina(jid, i);
      return {
        _id: pid,
        _key: `!journal.pages!${jid}.${pid}`,
        name: p.nombre,
        type: "text",
        title: { show: i > 0, level: 1 },
        text: { format: 1, content: html },
        sort: i * 100000,
        ownership: { default: -1 },
        flags: {}
      };
    });

    escribirDoc(pack, {
      _id: jid,
      _key: `!journal!${jid}`,
      name: nombre,
      folder: carpetas.id(meta.carpeta ?? carpetaRaiz),
      sort: Number(meta.orden ?? 0),
      ownership: { default: meta.jugadores === "si" ? 2 : 0 },
      flags: flags("journal", { archivo: rel }),
      pages: paginas,
      _stats: STATS
    });
    n++;
  }
  carpetas.escribir();
  console.log(`${pack}: ${n} journals`);
}

/* ========================================================================== */
/*  Personajes                                                                */
/* ========================================================================== */

const CAMPOS_CREDO = {
  underground: ["Clandestinos", "Sigilo y subterfugio en servicio de la Caza."],
  entrepreneurial: ["Emprendedores", "Construir, inventar, aumentar o reparar durante la Caza."],
  faithful: ["Fieles", "Cualquier conflicto directo (físico, social o mental) con lo sobrenatural durante la Caza."],
  inquisitive: ["Inquisitivos", "Obtener información durante la Caza: documentación, allanamiento de morada e interrogatorio."],
  martial: ["Marciales", "Conflicto físico durante la Caza (no necesita ser con la presa ni con lo sobrenatural)."]
};

function itemEmbebido(aid, iid, doc) {
  return { ...doc, _id: iid, _key: `!actors.items!${aid}.${iid}` };
}

function construirPersonajes() {
  const carpetas = new Carpetas("personajes", "Actor");
  let n = 0;

  for (const p of PNJS) {
    const aid = ID.actor(p.id);
    const hostil = ["vampire", "ghoul"].includes(p.spcType) || /maton|quimera/.test(p.id);
    // Retrato y token si el arte existe; si no, el icono por defecto.
    const retrato = existe(`assets/retratos/${p.id}.webp`) ? `modules/${MODULO}/assets/retratos/${p.id}.webp` : "icons/svg/mystery-man.svg";
    const token = existe(`assets/tokens/${p.id}.webp`) ? `modules/${MODULO}/assets/tokens/${p.id}.webp` : retrato;
    escribirDoc("personajes", {
      _id: aid,
      _key: `!actors!${aid}`,
      name: p.nombre,
      type: "spc",
      img: retrato,
      folder: carpetas.id("PNJs"),
      sort: 0,
      prototypeToken: {
        name: p.nombre,
        actorLink: false,
        disposition: hostil ? -1 : 0,
        lockRotation: true,
        texture: { src: token }
      },
      system: {
        spcType: p.spcType,
        headers: { concept: p.concepto ?? "" },
        standarddicepools: {
          physical: { value: p.estandar?.physical ?? 1 },
          social: { value: p.estandar?.social ?? 1 },
          mental: { value: p.estandar?.mental ?? 1 }
        },
        // `active: true`: la hoja de PNJ de wod5e solo muestra las reservas excepcionales marcadas como activas.
        exceptionaldicepools: Object.fromEntries(Object.entries(p.excepcionales ?? {}).map(([k, v]) => [k, { value: v, active: true }])),
        health: { max: p.salud ?? 5, value: p.salud ?? 5, aggravated: 0, superficial: 0 },
        willpower: { max: p.voluntad ?? 5, value: p.voluntad ?? 5, aggravated: 0, superficial: 0 },
        power: { value: p.poder ?? 0 },
        generaldifficulty: { normal: p.dificultadGeneral?.normal ?? 0, strongest: p.dificultadGeneral?.fuerte ?? 0 },
        description: p.descripcion ?? "",
        biography: [p.poderes ? `<h3>Poderes</h3>${p.poderes}` : "", p.debilidades ? `<h3>Debilidades</h3>${p.debilidades}` : ""].join(""),
        privatenotes: p.notas ?? "",
        settings: { enableDisciplines: p.spcType === "vampire" || p.spcType === "ghoul" }
      },
      items: [],
      effects: [],
      ownership: { default: 0 },
      flags: flags("pnj", { pnj: p.id }),
      _stats: STATS
    });
    n++;
  }

  const PJS = existe("content/pjs.json") ? leerJson("content/pjs.json").pjs : [];
  const armasPorId = Object.fromEntries((ARSENAL?.armas ?? []).map(a => [a.id, a]));
  const equipoPorId = Object.fromEntries((ARSENAL?.equipo ?? []).map(e => [e.id, e]));

  for (const pj of PJS) {
    const aid = ID.actor(`pj:${pj.id}`);
    const items = [];
    const [credoNombre, campos] = CAMPOS_CREDO[pj.credo] ?? [pj.credoNombre ?? pj.credo, ""];

    items.push(itemEmbebido(aid, idEstable(`pj:${pj.id}:credo`), {
      name: credoNombre, type: "creed", img: ICONO_ITEM, sort: 0, effects: [], ownership: { default: 0 }, flags: {},
      system: { description: "", macroid: "", bonuses: [], dataItemId: "", source: { book: "", page: "" }, edges: "", drives: "", desperationFields: campos }
    }));
    if (pj.determinacion) {
      const [nombreDet, ...resto] = pj.determinacion.split(/[:.—]\s*/);
      items.push(itemEmbebido(aid, idEstable(`pj:${pj.id}:drive`), {
        name: nombreDet.trim(), type: "drive", img: ICONO_ITEM, sort: 0, effects: [], ownership: { default: 0 }, flags: {},
        system: { description: "", macroid: "", bonuses: [], dataItemId: "", source: { book: "", page: "" }, redemption: `<p>${resto.join(". ").trim()}</p>` }
      }));
    }

    // Set de armas del Credo, copiado como ítems embebidos.
    const set = ARSENAL?.sets.find(s => s.id === pj.setArsenal);
    for (const [i, itemId] of (set?.items ?? []).entries()) {
      const a = armasPorId[itemId];
      const e = equipoPorId[itemId];
      const iid = idEstable(`pj:${pj.id}:item:${itemId}:${i}`);
      if (a) {
        items.push(itemEmbebido(aid, iid, {
          name: a.nombre, type: "weapon", img: a.tipo === "ranged" ? "icons/weapons/guns/gun-pistol-brass.webp" : "icons/weapons/swords/sword-guard-steel-green.webp",
          sort: 0, effects: [], ownership: { default: 0 }, flags: flags("arma", { arma: a.id }),
          system: {
            description: descripcionArma(a), macroid: "", bonuses: [], dataItemId: "",
            source: { book: "Del Velo a la Vigilia", page: "El Arsenal de la Vigilia" },
            weaponType: a.tipo, weaponvalue: a.dano, uses: { current: 0, max: 0, enabled: false }, quantity: 1,
            dicepool: Object.fromEntries(a.dados.map((p, j) => [`d${j + 1}`, { path: p }]))
          }
        }));
      } else if (e) {
        items.push(itemEmbebido(aid, iid, {
          name: e.nombre, type: "gear", img: "icons/containers/bags/pack-leather-black-brown.webp",
          sort: 0, effects: [], ownership: { default: 0 }, flags: flags("equipo", { equipo: e.id }),
          system: {
            description: `<p>${e.regla ?? ""}</p>`, macroid: "", bonuses: [], dataItemId: "",
            source: { book: "Del Velo a la Vigilia", page: "El Arsenal de la Vigilia" },
            uses: { current: 0, max: 0, enabled: false }, quantity: 1, dicepool: {}
          }
        }));
      }
    }

    const resistencia = pj.atributos?.stamina ?? 1;
    escribirDoc("personajes", {
      _id: aid,
      _key: `!actors!${aid}`,
      name: pj.nombre,
      type: "hunter",
      img: "icons/svg/mystery-man.svg",
      folder: carpetas.id("Plantillas de cazador"),
      sort: 0,
      prototypeToken: { name: pj.nombre, actorLink: true, disposition: 1, lockRotation: true, sight: { enabled: true, range: 0 }, texture: { src: "icons/svg/mystery-man.svg" } },
      system: {
        headers: {
          concept: pj.concepto ?? "",
          chronicle: "Del Velo a la Vigilia",
          ambition: pj.ambicion ?? "",
          desire: pj.deseo ?? "",
          touchstones: pj.piedraDeToque ? `<p>${pj.piedraDeToque}</p>` : "",
          creedfields: campos
        },
        attributes: Object.fromEntries(Object.entries(pj.atributos ?? {}).map(([k, v]) => [k, { value: v }])),
        skills: Object.fromEntries(Object.entries(pj.habilidades ?? {}).map(([k, v]) => [k, { value: v }])),
        health: { max: pj.salud ?? resistencia + 3, value: pj.salud ?? resistencia + 3, aggravated: 0, superficial: 0 },
        willpower: { max: pj.voluntad ?? 5, value: pj.voluntad ?? 5, aggravated: 0, superficial: 0 },
        bio: { history: pj.historia ?? "" },
        notes: [
          pj.especialidades?.length ? `<p><strong>Especialidades:</strong> ${pj.especialidades.join(", ")}</p>` : "",
          pj.ventajas?.length ? `<p><strong>Ventajas y Defectos sugeridos:</strong></p><ul>${pj.ventajas.map(v => `<li>${v}</li>`).join("")}</ul>` : "",
          set ? `<p><strong>Set del Arsenal:</strong> ${set.nombre}${set.equipoLibre?.length ? ` — sin ficha: ${set.equipoLibre.join(", ")}` : ""}</p>` : "",
          pj.caminoProbable ? `<p><strong>Camino probable según la crónica:</strong> ${pj.caminoProbable}</p>` : ""
        ].join("")
      },
      items,
      effects: [],
      ownership: { default: 0 },
      flags: flags("pj", { pj: pj.id, caminoProbable: pj.caminoProbable ?? "" }),
      _stats: STATS
    });
    n++;
  }

  // Vehículos: actores spc con el flag `vehiculo`, token cenital de 2×4 m.
  const VEHICULOS = existe("content/vehiculos.json") ? leerJson("content/vehiculos.json").vehiculos : [];
  for (const v of VEHICULOS) {
    const aid = ID.actor(`vehiculo:${v.id}`);
    const textura = existe(`assets/tokens/vehiculos/${v.id}.webp`) ? `modules/${MODULO}/assets/tokens/vehiculos/${v.id}.webp` : "icons/svg/anchor.svg";
    escribirDoc("personajes", {
      _id: aid, _key: `!actors!${aid}`, name: v.nombre, type: "spc", img: textura,
      folder: carpetas.id("Vehículos"), sort: 0,
      prototypeToken: { name: v.nombre, actorLink: false, disposition: 0, width: 2, height: 4, texture: { src: textura, fit: "contain" }, displayName: 30, lockRotation: false },
      system: {
        spcType: "mortal", headers: { concept: `Vehículo · ${v.plazas} plazas` },
        standarddicepools: { physical: { value: 0 }, social: { value: 0 }, mental: { value: 0 } },
        exceptionaldicepools: {},
        health: { max: v.estructura ?? 6, value: v.estructura ?? 6, aggravated: 0, superficial: 0 },
        willpower: { max: 0, value: 0, aggravated: 0, superficial: 0 },
        power: { value: 0 }, generaldifficulty: { normal: 0, strongest: 0 },
        description: `${md2html(expandirMarcadores(v.descripcion ?? "", "content/vehiculos.json"))}<table class="dvv-ficha"><tbody><tr><th>Plazas</th><td>${v.plazas}</td></tr><tr><th>Estructura</th><td>${v.estructura}</td></tr><tr><th>Maniobra</th><td>${v.maniobra >= 0 ? "+" : ""}${v.maniobra ?? 0}</td></tr><tr><th>Blindaje</th><td>${v.blindaje ?? 0}</td></tr><tr><th>Velocidad</th><td>${v.velocidad ?? "normal"}</td></tr></tbody></table>`,
        privatenotes: md2html(expandirMarcadores(v.notas ?? "", "content/vehiculos.json")), settings: { enableDisciplines: false }
      },
      items: [], effects: [], ownership: { default: 0 },
      flags: { [MODULO]: { origen: "vehiculo", vehiculo: { id: v.id, tipo: v.tipo, plazas: v.plazas, estructura: v.estructura, maniobra: v.maniobra ?? 0, blindaje: v.blindaje ?? 0, velocidad: v.velocidad ?? "normal", ancho: 2, largo: 4 } } },
      _stats: STATS
    });
    n++;
  }
  carpetas.escribir();
  console.log(`personajes: ${n} actores (${VEHICULOS.length} vehículos)`);
}

/* ========================================================================== */
/*  Escenas                                                                   */
/* ========================================================================== */

function dimensiones(rutaAbs) {
  try {
    const salida = execFileSync("magick", ["identify", "-format", "%w %h", rutaAbs], { encoding: "utf8" });
    const [w, h] = salida.trim().split(/\s+/).map(Number);
    return { w, h };
  } catch {
    const salida = execFileSync("python3", ["-c", `from PIL import Image; im=Image.open(${JSON.stringify(rutaAbs)}); print(im.size[0], im.size[1])`], { encoding: "utf8" });
    const [w, h] = salida.trim().split(/\s+/).map(Number);
    return { w, h };
  }
}

/** _key de los documentos embebidos: fvtt-cli los guarda como entradas propias. */
function conClaves(escena) {
  const sid = escena._id;
  for (const col of ["walls", "lights", "levels", "tokens", "notes", "sounds", "tiles", "drawings", "regions"]) {
    for (const d of escena[col] ?? []) {
      d._key = `!scenes.${col}!${sid}.${d._id}`;
      if (col === "regions") {
        for (const b of d.behaviors ?? []) b._key = `!scenes.regions.behaviors!${sid}.${d._id}.${b._id}`;
      }
    }
  }
  return escena;
}

const GRID_M_PX = 100;
const PIES_POR_METRO = 3.2808;

/** Ambiente (playlist + pista) de una escena según content/musica.json; se lee acá porque las escenas se construyen antes que las listas. */
function ambienteDe(escenaId) {
  if (!existe("content/musica.json")) return {};
  for (const lista of leerJson("content/musica.json").listas) {
    const pista = lista.pistas.find(p => p.escena === escenaId);
    if (pista && existe(`assets/music/${pista.archivo ?? `${pista.id}.mp3`}`)) {
      return { playlist: idEstable(`playlist:${lista.id}`), playlistSound: idEstable(`pista:${lista.id}:${pista.id}`) };
    }
  }
  return {};
}

/** Escena base, compartida por las dos fuentes (planos y escenas.json). */
function docEscena({ id, nombre, carpeta, orden, w, h, grid, gridAlpha, oscuridad, luzGlobal, fondo, walls, lights, regions, nota, notes = [], tokens = [], tiles = [], extra = {}, sinGrid = false, visionToken = true }) {
  const sid = ID.escena(id);
  const ambiente = ambienteDe(id);
  return conClaves({
    playlist: ambiente.playlist ?? null,
    playlistSound: ambiente.playlistSound ?? null,
    _id: sid,
    _key: `!scenes!${sid}`,
    name: nombre,
    folder: carpeta,
    navigation: true,
    navOrder: orden ?? 0,
    width: w,
    height: h,
    // Sin relleno: Foundry desplaza el rectángulo de la escena por el padding
    // y las coordenadas de muros, puertas y luces (que vienen del plano, en
    // píxeles del mapa) quedarían corridas media pantalla.
    padding: 0,
    // Casillas de 1 metro (100 px a 30 px/pie, 2 % de error): en interiores
    // modernos una casilla de 5 pies hace que un token tape media habitación.
    grid: { type: sinGrid ? 0 : 1, size: GRID_M_PX, style: "solidLines", thickness: 1, color: "#000000", alpha: gridAlpha, distance: 1, units: "m" },
    tokenVision: visionToken,
    fog: { exploration: visionToken },
    environment: { darknessLevel: oscuridad, globalLight: { enabled: Boolean(luzGlobal) } },
    // En v14 el fondo vive en un Level embebido, no en la escena.
    levels: [{
      _id: idEstable(`nivel:${id}`),
      name: "Suelo",
      elevation: { bottom: 0, top: 20 },
      background: { src: `modules/${MODULO}/${fondo}`, color: "#000000" },
      sort: 0
    }],
    walls, regions,
    // Los radios de las luces vienen en pies (presets del plano); la escena mide en metros.
    lights: (lights ?? []).map(l => ({ ...l, config: { ...l.config, dim: +(l.config.dim / PIES_POR_METRO).toFixed(2), bright: +(l.config.bright / PIES_POR_METRO).toFixed(2) } })),
    tokens, notes, sounds: [], tiles, drawings: [],
    flags: flags("escena", { escena: id, nota: nota ?? "", ...extra }),
    _stats: STATS
  });
}


/* ========================================================================== */
/*  Salas: notas de habitación, pines en el mapa y tokens colocados           */
/* ========================================================================== */

/**
 * content/salas/<escena>.md → un journal por escena (una página por sala),
 * un pin (Note) por sala en el mapa que abre esa página, y los tokens de PNJ
 * que la sala declara. El formato del archivo está documentado en README.md.
 */
const DISPOSICION = { vampire: -1, ghoul: -1 };
const HOSTILES = /maton|quimera|ghoul/;

function cargarSalas() {
  const dir = path.join(RAIZ, "content/salas");
  const salasPorEscena = {};
  for (const archivo of archivosMd(dir)) {
    const rel = path.relative(RAIZ, archivo);
    const { meta, cuerpo } = separarFrontmatter(fs.readFileSync(archivo, "utf8"));
    const escena = meta.escena ?? slug(path.basename(archivo, ".md"));
    const prefijo = meta.prefijo ?? "A";
    const jid = ID.journal(`salas:${escena}`);
    const salas = [];
    // Secciones: "# A1. Nombre {sala: Nombre del plano}" + línea opcional "tokens: …"
    const partes = cuerpo.split(/^(?=# )/m).filter(p => p.trim());
    for (const parte of partes) {
      const m = /^# (.+?)\s*\{sala:\s*([^}]+)\}\s*\n([\s\S]*)$/.exec(parte);
      if (!m) { avisos.push(`${rel}: sección sin {sala: …}: ${parte.split("\n")[0]}`); continue; }
      let [, titulo, sala, resto] = m;
      sala = sala.trim();
      const tokens = [];
      resto = resto.replace(/^tokens:\s*(.+)$/m, (_, lista) => {
        for (const t of lista.split(",").map(x => x.trim()).filter(Boolean)) {
          const mm = /^([a-z0-9-]+)(?:\s*x(\d+))?(?:\s*\((oculto)\))?$/i.exec(t);
          if (!mm) { avisos.push(`${rel}: token ilegible «${t}»`); continue; }
          if (!nombrePnj[mm[1]]) { avisos.push(`${rel}: token de PNJ desconocido «${mm[1]}»`); continue; }
          tokens.push({ pnj: mm[1], n: Number(mm[2] ?? 1), oculto: !!mm[3] });
        }
        return "";
      });
      const codigo = titulo.split(".")[0].trim();
      salas.push({ codigo, titulo: titulo.trim(), sala, md: resto.trim(), tokens, pageId: ID.pagina(jid, salas.length + 1) });
    }
    salasPorEscena[escena] = { rel, jid, prefijo, nombre: meta.nombre ?? escena, intro: meta.intro ?? "", salas };
  }
  return salasPorEscena;
}
const SECTORES = existe("content/sectores.json") ? leerJson("content/sectores.json") : { sectores: [], pxPorMetro: 50 };
const geoSector = id => existe(`content/sectores/geo/${id}.json`) ? leerJson(`content/sectores/geo/${id}.json`) : null;
const PRESETS_SECTOR = { farola: { dim: 12, bright: 4, color: "#ffb46b", alpha: 0.45, animation: { type: null, speed: 5, intensity: 5, reverse: false } },
                         neon: { dim: 6, bright: 2, color: "#7fd1ff", alpha: 0.4, animation: { type: "pulse", speed: 1, intensity: 1, reverse: false } } };
ID.sector = id => idEstable(`escena:sector:${id}`);
ID.regionSector = (sector, region) => idEstable(`region:sector:${sector}:${region}`);
ID.regionCiudad = sector => idEstable(`region:malaga:${sector}`);
const JID_SECTORES = idEstable("journal:sectores");

const SALAS = cargarSalas();

/** Pines y tokens de una escena a partir de sus salas y del plano (habitaciones en pies). */
function pinesYTokensDe(plano) {
  const def = SALAS[plano.id];
  if (!def) return { notes: [], tokens: [] };
  const notes = [], tokens = [];
  const px = pies => Math.round(pies * PX_POR_PIE);
  for (const s of def.salas) {
    const hab = plano.habitaciones.find(h => h.nombre === s.sala);
    if (!hab) { avisos.push(`${def.rel}: la sala «${s.sala}» no existe en el plano ${plano.id}`); continue; }
    const cx = px(hab.x + hab.w / 2), cy = px(hab.y + hab.h / 2);
    notes.push({
      _id: idEstable(`nota:${plano.id}:${s.codigo}`),
      entryId: def.jid, pageId: s.pageId,
      x: cx, y: cy, elevation: 0, sort: 0, locked: false,
      texture: { src: "icons/svg/book.svg", anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
      iconSize: 44, text: s.codigo, fontFamily: "Signika", fontSize: 28, textAnchor: 1, textColor: "#ffffff",
      global: false, flags: flags("pin", { escena: plano.id, sala: s.sala })
    });
    // Tokens: los durmientes van sobre las camillas/camas de la sala y la
    // priora sobre el relicario; el resto en fila alrededor del centro.
    const dentro = m => m.x >= hab.x && m.y >= hab.y && m.x + (m.w ?? 0) <= hab.x + hab.w + 0.01 && m.y + (m.h ?? 0) <= hab.y + hab.h + 0.01;
    const centroMueble = m => ({ x: px(m.x + (m.w ?? 1) / 2) - 50, y: px(m.y + (m.h ?? 1) / 2) - 50 });
    const camas = (plano.muebles ?? []).filter(m => /^(camilla|camilla-medica|cama|catre)$/.test(m.tipo) && dentro(m)).sort((a, b) => a.y - b.y || a.x - b.x).map(centroMueble);
    const relicario = (plano.muebles ?? []).find(m => m.tipo === "relicario" && dentro(m));
    const lista = s.tokens.flatMap(t => Array.from({ length: t.n }, (_, i) => ({ ...t, i })));
    let k = 0;
    lista.forEach(t => {
      const pnj = PNJS.find(p => p.id === t.pnj);
      let x, y;
      if (t.pnj === "durmiente" && camas.length) ({ x, y } = camas.shift());
      else if (t.pnj === "sor-anunciacion" && relicario) ({ x, y } = centroMueble(relicario));
      else {
        const col = k % 4, fila = Math.floor(k / 4);
        x = Math.round((cx - 50 + (col - 1.5) * GRID_M_PX) / 50) * 50;
        y = Math.round((cy + 60 + fila * GRID_M_PX) / 50) * 50;
        k++;
      }
      const hostil = DISPOSICION[pnj.spcType] ?? (HOSTILES.test(pnj.id) ? -1 : 0);
      const textura = existe(`assets/tokens/${pnj.id}.webp`) ? `modules/${MODULO}/assets/tokens/${pnj.id}.webp`
        : existe(`assets/retratos/${pnj.id}.webp`) ? `modules/${MODULO}/assets/retratos/${pnj.id}.webp` : "icons/svg/mystery-man.svg";
      tokens.push({
        _id: idEstable(`token:${plano.id}:${s.codigo}:${t.pnj}:${t.i}`),
        name: t.n > 1 ? `${pnj.nombre} ${t.i + 1}` : pnj.nombre,
        displayName: 30, actorId: ID.actor(pnj.id), actorLink: false,
        texture: { src: textura, anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
        // En v14 el token pertenece a un nivel de la escena; sin esto no se dibuja.
        x, y, width: 1, height: 1, elevation: 0, level: idEstable(`nivel:${plano.id}`), rotation: 0, alpha: 1, lockRotation: true, locked: false, sort: 0,
        hidden: t.oculto, disposition: hostil,
        flags: flags("token", { escena: plano.id, sala: s.sala, pnj: pnj.id })
      });
    });
  }
  return { notes, tokens };
}

function construirSalas() {
  const carpetas = new Carpetas("cronica", "JournalEntry");
  let n = 0;
  for (const [escena, def] of Object.entries(SALAS)) {
    const paginas = [];
    const intro = `${def.intro ? `<p>${def.intro}</p>` : ""}<p>Cada pin numerado del mapa abre la página de su sala. Los tokens de PNJ ya están colocados; los ocultos se revelan desde la capa de tokens.</p><ul>${def.salas.map(s => `<li>@UUID[JournalEntry.${def.jid}.JournalEntryPage.${s.pageId}]{${s.titulo}}</li>`).join("")}</ul>`;
    const pid0 = ID.pagina(def.jid, 0);
    paginas.push({ _id: pid0, _key: `!journal.pages!${def.jid}.${pid0}`, name: "Salas", type: "text", title: { show: false, level: 1 }, text: { format: 1, content: intro }, sort: 0, ownership: { default: -1 }, flags: {} });
    def.salas.forEach((s, i) => {
      const html = md2html(expandirMarcadores(s.md, def.rel));
      const tokensTxt = s.tokens.length ? `<p class="dvv-tokens"><strong>Tokens en la sala:</strong> ${s.tokens.map(t => `@UUID[Actor.${ID.actor(t.pnj)}]{${nombrePnj[t.pnj]}}${t.n > 1 ? ` ×${t.n}` : ""}${t.oculto ? " (oculto)" : ""}`).join(" · ")}</p>` : "";
      paginas.push({
        _id: s.pageId, _key: `!journal.pages!${def.jid}.${s.pageId}`, name: s.titulo, type: "text",
        title: { show: true, level: 1 }, text: { format: 1, content: html + tokensTxt },
        sort: (i + 1) * 100000, ownership: { default: -1 }, flags: flags("sala", { escena, sala: s.sala, codigo: s.codigo })
      });
    });
    escribirDoc("cronica", {
      _id: def.jid, _key: `!journal!${def.jid}`, name: `Salas · ${def.nombre}`,
      folder: carpetas.id("Salas", "Crónica"), sort: 500 + n, ownership: { default: 0 },
      flags: flags("journal", { archivo: def.rel, escena }), pages: paginas, _stats: STATS
    });
    n++;
  }
  carpetas.escribir();
  console.log(`salas: ${n} journals (${Object.values(SALAS).reduce((a, d) => a + d.salas.length, 0)} salas)`);
}

/**
 * Escenas desde content/planos/*.json (camino principal).
 *
 * Muros, puertas, vidrios, regiones de transición y luces salen del MISMO
 * archivo que el mapa (tools/planos.mjs, tools/iluminacion.mjs), así que lo
 * que se ve y lo que bloquea el paso no pueden desincronizarse. Si todavía no
 * hay mapa pintado, se usa el esquema como fondo provisional.
 */
/**
 * Muebles móviles del plano → tiles de la escena. El arte (assets/tiles) se
 * genera con el eje largo horizontal y, en asientos, el respaldo arriba y el
 * frente hacia abajo (sur); `hacia` rota el tile para que el frente mire a ese
 * lado. En Foundry, x/y/width/height son del rectángulo SIN rotar y el giro es
 * sobre su centro: a 90°/270° se intercambian ancho y alto para que el tile
 * caiga sobre la huella del plano. OJO: en v14 x/y es el punto de anclaje de
 * la textura (anchorX/Y = 0,5), o sea el CENTRO del tile, no la esquina.
 * Quedan desbloqueados: son para moverlos.
 */
const ROTACION_HACIA = { s: 0, o: 90, n: 180, e: 270 };
function tilesDe(plano) {
  const px = pies => Math.round(pies * PX_POR_PIE);
  const tiles = [], sinTile = [];
  mueblesMoviles(plano).forEach((m, i) => {
    if (!m.tile) { sinTile.push(m); return; }
    if (!existe(`assets/tiles/${m.tile}.webp`)) {
      avisos.push(`plano ${plano.id}: falta assets/tiles/${m.tile}.webp (${m.tipo}); corré npm run tiles`);
      sinTile.push(m);
      return;
    }
    const horizontal = m.w >= m.h;
    const rotacion = m.hacia ? ROTACION_HACIA[m.hacia] : (horizontal ? 0 : 90);
    if (rotacion === undefined) avisos.push(`plano ${plano.id}: hacia «${m.hacia}» inválido en ${m.tipo}`);
    const girado = rotacion === 90 || rotacion === 270;
    const ancho = px(girado ? m.h : m.w), alto = px(girado ? m.w : m.h);
    const cx = px(m.x + m.w / 2), cy = px(m.y + m.h / 2);
    tiles.push({
      _id: idEstable(`tile:${plano.id}:${i}`),
      name: m.desc ?? m.tile.replace(/^tile-/, "").replace(/-/g, " "),
      texture: { src: `modules/${MODULO}/assets/tiles/${m.tile}.webp`, anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
      x: cx, y: cy, width: ancho, height: alto,
      elevation: 0, levels: [idEstable(`nivel:${plano.id}`)], sort: i, rotation: rotacion ?? 0,
      alpha: 1, hidden: false, locked: false,
      restrictions: { light: false, weather: false },
      occlusion: { modes: [], alpha: 0 },
      video: { loop: true, autoplay: true, volume: 0 },
      flags: flags("tile", { escena: plano.id, tipo: m.tipo })
    });
  });
  return { tiles, sinTile };
}

function escenasDePlanos(carpetas) {
  const planos = cargarPlanos();
  const ids = new Set(planos.map(p => p.id));
  const esSector = id => SECTORES.sectores.some(s => s.id === id);
  const uuidDeRegion = (idPlano, idRegion) => esSector(idPlano)
    ? `Scene.${ID.sector(idPlano)}.Region.${ID.regionSector(idPlano, idRegion)}`
    : `Scene.${ID.escena(idPlano)}.Region.${idEstable(`region:${idPlano}:${idRegion}`)}`;
  const resumen = [];

  for (const plano of planos) {
    const pintado = `assets/mapas/${plano.id}.webp`;
    const esquema = `assets/mapas/${plano.id}.esquema.webp`;
    let fondo = pintado;
    if (!existe(pintado)) {
      if (!existe(esquema)) {
        avisos.push(`plano ${plano.id}: no hay mapa ni esquema; corré npm run planos`);
        continue;
      }
      fondo = esquema;
      avisos.push(`plano ${plano.id}: sin mapa pintado, uso el esquema como fondo provisional (npm run pintar)`);
    }
    const W = plano.ancho * PX_POR_PIE, H = plano.alto * PX_POR_PIE;
    const { w, h } = dimensiones(path.join(RAIZ, fondo));
    if (w !== W || h !== H) avisos.push(`plano ${plano.id}: el fondo mide ${w}×${h} y el plano ${W}×${H}; se usa el del plano`);

    const walls = derivarMuros(plano).map(({ _tipo, ...m }, i) => ({ _id: idEstable(`muro:${plano.id}:${i}`), ...m }));
    const regions = derivarRegiones({
      ...plano,
      regiones: (plano.regiones ?? []).filter(rg => {
        const [destino, region] = rg.destino.split(":");
        const ok = esSector(destino)
          ? !!(geoSector(destino)?.regiones ?? []).some(r => r.id === region)
          : ids.has(destino) && planos.find(p => p.id === destino).regiones?.some(r => r.id === region);
        if (!ok) avisos.push(`plano ${plano.id}: la región ${rg.id} apunta a ${rg.destino}, que no existe`);
        return ok;
      })
    }, idEstable, uuidDeRegion);
    // Las regiones de llegada (`llegada: true`) reciben tokens pero no los mandan a ningún lado.
    for (const rg of regions) {
      const def = (plano.regiones ?? []).find(r => idEstable(`region:${plano.id}:${r.id}`) === rg._id);
      if (def?.llegada) rg.behaviors = [];
    }
    const lights = lucesDePlano(plano, idEstable);
    const { tiles, sinTile: moviles } = tilesDe(plano);
    const nota = [plano.nota ?? "",
      tiles.length ? `Los muebles móviles (${tiles.length}) son tiles desbloqueados: se pueden mover, tirar o usar de barricada.` : "",
      moviles.length ? `Muebles móviles NO pintados y sin tile (colocarlos a mano): ${Object.entries(
        moviles.reduce((acc, m) => ({ ...acc, [m.tipo]: (acc[m.tipo] ?? 0) + 1 }), {})
      ).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(", ")}.` : ""
    ].filter(Boolean).join(" ");

    const { notes, tokens } = pinesYTokensDe(plano);
    escribirDoc("escenas", docEscena({
      id: plano.id, nombre: plano.nombre, carpeta: carpetas.id(plano.carpeta ?? "Somnia Biotech"), orden: plano.orden ?? 10,
      w: W, h: H, grid: GRID_PX, gridAlpha: 0, oscuridad: plano.oscuridad ?? 0.5, luzGlobal: plano.luzGlobal,
      fondo, walls, lights, regions, nota, notes, tokens, tiles,
      extra: { origen: "escena", plano: plano.id, provisional: fondo === esquema }
    }));
    const puertas = walls.filter(m => m.door).length;
    resumen.push(`  ${plano.id.padEnd(22)} ${W}×${H}  ${walls.length - puertas} muros · ${puertas} puertas · ` +
      `${lights.length} luces · ${regions.length} regiones · ${notes.length} pines · ${tokens.length} tokens · ${tiles.length} tiles${fondo === esquema ? " · ESQUEMA" : ""}`);
  }
  if (verbose) for (const r of resumen) console.log(r);
  return resumen.length;
}

/** Camino viejo: content/escenas.json + content/muros/<id>.json, para mapas sin plano. */
function escenasDeJson(carpetas) {
  if (!existe("content/escenas.json")) return 0;
  const { escenas } = leerJson("content/escenas.json");
  let n = 0;
  for (const def of escenas) {
    const rel = `assets/mapas/${def.mapa}.webp`;
    if (!existe(rel)) {
      avisos.push(`escenas.json: el mapa ${rel} no existe`);
      continue;
    }
    const { w, h } = dimensiones(path.join(RAIZ, rel));
    const murosRel = `content/muros/${def.id}.json`;
    const walls = existe(murosRel) ? leerJson(murosRel).map((m, i) => ({ ...m, _id: idEstable(`muro:${def.id}:${i}`) })) : [];
    const lights = (def.luces ?? []).map((l, i) => ({
      _id: idEstable(`luz:${def.id}:${i}`),
      x: l.x, y: l.y, rotation: 0, elevation: 0, walls: true, vision: false, hidden: false,
      config: {
        dim: l.dim ?? 20, bright: l.bright ?? 5, angle: 360, color: l.color ?? null, alpha: l.alpha ?? 0.5,
        animation: { type: l.animacion ?? null, speed: 5, intensity: 5, reverse: false },
        coloration: 1, attenuation: 0.5, luminosity: 0.5, saturation: 0, contrast: 0, shadows: 0,
        darkness: { min: 0, max: 1 }, negative: false, priority: 0
      },
      flags: {}
    }));
    // Pines declarados en fracciones del mapa (x, y en 0..1) hacia journals del módulo.
    const notes = (def.pines ?? []).map(pin => {
      const jid = ID.journal(pin.journal);
      return {
        _id: idEstable(`nota:${def.id}:${pin.id}`), entryId: jid, pageId: null,
        x: Math.round(pin.x * w), y: Math.round(pin.y * h), elevation: 0, sort: 0, locked: false,
        texture: { src: pin.icono ?? "icons/svg/book.svg", anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
        iconSize: 56, text: pin.texto ?? "", fontFamily: "Signika", fontSize: 30, textAnchor: 1, textColor: "#ffffff", global: false, flags: flags("pin", { escena: def.id, pin: pin.id })
      };
    });
    escribirDoc("escenas", docEscena({
      id: def.id, nombre: def.nombre, carpeta: carpetas.id(def.carpeta ?? "Somnia Biotech"), orden: def.orden,
      w, h, grid: def.grid ?? GRID_PX, gridAlpha: def.gridAlpha ?? 0.1, oscuridad: def.oscuridad ?? 0.6,
      luzGlobal: def.luzGlobal, fondo: rel, walls, lights, regions: [], nota: def.nota, notes,
      sinGrid: !!def.sinGrid, visionToken: def.visionToken ?? true, extra: def.landing ? { landing: true } : {}
    }));
    n++;
  }
  return n;
}

function construirEscenas() {
  const carpetas = new Carpetas("escenas", "Scene");
  const n = escenasDePlanos(carpetas) + escenasDeJson(carpetas);
  carpetas.escribir();
  console.log(`escenas: ${n}`);
}

/* ========================================================================== */
/*  Macros                                                                    */
/* ========================================================================== */

function construirMacros() {
  const api = `game.modules.get("${MODULO}").api`;
  const macros = [
    { id: "importar", nombre: "Somnia Biotech — Importar la crónica al mundo", icono: "icons/svg/down.svg", comando: `${api}.importarCronica();` },
    { id: "panel", nombre: "Somnia Biotech — Panel del Narrador", icono: "icons/svg/book.svg", comando: `${api}.abrirPanel();` },
    { id: "otorgar", nombre: "Las Tres Puertas — Otorgar camino", icono: "icons/svg/door-exit.svg", comando: `${api}.otorgarCamino();` },
    { id: "comprar", nombre: "Comprar poder (Borde / Artefacto / Modificación)", icono: "icons/svg/upgrade.svg", comando: `${api}.comprarPoder();` },
    { id: "mejora", nombre: "Comprar mejora", icono: "icons/svg/aura.svg", comando: `${api}.comprarMejora();` },
    { id: "quemar", nombre: "Quemar la Chispa / Sobrecarga / Desgarro", icono: "icons/svg/fire.svg", comando: `${api}.quemar();` },
    { id: "peligro", nombre: "Registrar +1 Peligro", icono: "icons/svg/hazard.svg", comando: `${api}.registrarPeligro();` },
    { id: "balizas", nombre: "Balizas Fe / Método / Carne", icono: "icons/svg/light.svg", comando: `${api}.ajustarBalizas();` },
    { id: "equipar", nombre: "Equipar set del Credo", icono: "icons/svg/item-bag.svg", comando: `${api}.equiparSet();` }
  ];
  for (const m of macros) {
    const id = ID.macro(m.id);
    escribirDoc("macros", {
      _id: id,
      _key: `!macros!${id}`,
      name: m.nombre,
      type: "script",
      scope: "global",
      img: m.icono,
      command: m.comando,
      folder: null,
      sort: 0,
      ownership: { default: 0 },
      flags: flags("macro", { macro: m.id }),
      _stats: STATS
    });
  }
  console.log(`macros: ${macros.length}`);
}

/* ========================================================================== */

construirCaminos();
construirEstados();
construirArsenal();
construirJournals("reglas", "Reglas");
construirJournals("cronica", "Crónica");
construirPersonajes();
construirEscenas();
construirMacros();

const cerrar = () => {
  for (const a of avisos) console.warn(`aviso: ${a}`);
  console.log(avisos.length ? `✓ contenido construido con ${avisos.length} aviso(s)` : "✓ contenido construido");
};



/* ========================================================================== */
/*  Málaga: escena de ciudad con puntos de interés                            */
/* ========================================================================== */

/**
 * content/malaga/pois.json + geo.json + *.md → una escena "Málaga" (mapa de
 * ciudad renderizado desde OpenStreetMap, sin grid táctico), un journal con
 * una página por punto de interés y un pin por punto en el mapa.
 */
function construirMalaga() {
  if (!existe("content/malaga/pois.json") || !existe("content/malaga/geo.json")) return;
  if (!existe("assets/mapas/malaga.webp")) { avisos.push("malaga: falta assets/mapas/malaga.webp (node tools/malaga-mapa.mjs)"); return; }
  const { pois, escena: defEscena } = leerJson("content/malaga/pois.json");
  const geo = leerJson("content/malaga/geo.json");
  const { w, h } = dimensiones(path.join(RAIZ, "assets/mapas/malaga.webp"));
  if (w !== geo.ancho || h !== geo.alto) avisos.push(`malaga: el mapa mide ${w}×${h} y geo.json dice ${geo.ancho}×${geo.alto}`);
  const b = geo.bbox;
  const aPx = (lat, lon) => ({
    x: Math.round((lon - b.oeste) / (b.este - b.oeste) * w),
    y: Math.round((b.norte - lat) / (b.norte - b.sur) * h)
  });

  // Journal: presentación + una página por POI, en el orden del md (orden) o del json.
  const jid = ID.journal("malaga");
  const paginasMd = archivosMd(path.join(RAIZ, "content/malaga")).map(f => {
    const { meta, cuerpo } = separarFrontmatter(fs.readFileSync(f, "utf8"));
    return { id: meta.id ?? slug(path.basename(f, ".md")), nombre: meta.nombre ?? meta.id, orden: Number(meta.orden ?? 100), cuerpo, rel: path.relative(RAIZ, f) };
  }).sort((a, c) => a.orden - c.orden);
  const pageIdDe = id => ID.pagina(jid, id);
  const pages = paginasMd.map((p, i) => {
    const poi = pois.find(x => x.id === p.id);
    const cab = poi ? `<p class="dvv-ficha-poi"><strong>${poi.tipo}</strong>${poi.direccion ? ` · ${poi.direccion}` : ""}${poi.ficticio ? " · <em>lugar ficticio de la crónica</em>" : ""}</p>` : "";
    return {
      _id: pageIdDe(p.id), _key: `!journal.pages!${jid}.${pageIdDe(p.id)}`,
      name: p.nombre, type: "text", title: { show: i > 0, level: 1 },
      text: { format: 1, content: cab + md2html(expandirMarcadores(p.cuerpo.replace(/^# .+\n?/m, ""), p.rel)) },
      sort: i * 100000, ownership: { default: -1 }, flags: poi ? flags("poi", { poi: poi.id, tipo: poi.tipo }) : {}
    };
  });
  for (const poi of pois) if (!paginasMd.some(p => p.id === poi.id)) avisos.push(`malaga: el POI ${poi.id} no tiene content/malaga/${poi.id}.md`);
  const carpetas = new Carpetas("cronica", "JournalEntry");
  escribirDoc("cronica", {
    _id: jid, _key: `!journal!${jid}`, name: "Málaga — Puntos de interés",
    folder: carpetas.id("Crónica"), sort: 900, ownership: { default: 0 },
    flags: flags("journal", { archivo: "content/malaga" }), pages, _stats: STATS
  });
  carpetas.escribir();

  // Escena: sin grid táctico; 1 unidad = 100 m.
  const sid = ID.escena("malaga");
  const notes = pois.map(poi => {
    const { x, y } = aPx(poi.lat, poi.lon);
    if (x < 0 || y < 0 || x > w || y > h) avisos.push(`malaga: ${poi.id} cae fuera del mapa (${x},${y})`);
    return {
      _id: idEstable(`nota:malaga:${poi.id}`), entryId: jid, pageId: pageIdDe(poi.id),
      x, y, elevation: 0, sort: 0, locked: false,
      texture: { src: poi.icono ?? "icons/svg/house.svg", anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: poi.ficticio ? "#ff8a80" : "#ffffff", alphaThreshold: 0.75 },
      iconSize: 48, text: poi.nombre, fontFamily: "Signika", fontSize: 26, textAnchor: 1, textColor: "#ffffff",
      global: false, flags: flags("pin", { poi: poi.id, tipo: poi.tipo })
    };
  });
  const escenasCarp = new Carpetas("escenas", "Scene");
  const tam = Math.round(100 / (geo.metrosPorPixel ?? 2));
  escribirDoc("escenas", conClaves({
    _id: sid, _key: `!scenes!${sid}`, name: defEscena?.nombre ?? "Málaga",
    folder: escenasCarp.id("Somnia Biotech"), navigation: true, navOrder: 0,
    width: w, height: h, padding: 0,
    grid: { type: 0, size: tam, style: "solidLines", thickness: 1, color: "#000000", alpha: 0, distance: 100, units: "m" },
    tokenVision: false, fog: { exploration: false },
    environment: { darknessLevel: 0.15, globalLight: { enabled: true } },
    levels: [{ _id: idEstable("nivel:malaga"), name: "Ciudad", elevation: { bottom: 0, top: 20 }, background: { src: `modules/${MODULO}/assets/mapas/malaga.webp`, color: "#0b0d10" }, sort: 0 }],
    walls: [], lights: [], regions: regionesCiudad(aPx), tokens: [], notes, sounds: [], tiles: [], drawings: [],
    flags: flags("escena", { escena: "malaga", nota: `Mapa de ciudad (OpenStreetMap, ${geo.atribucion ?? "© OpenStreetMap contributors"}). Los pines abren el journal de Málaga.` }),
    _stats: STATS
  }));
  escenasCarp.escribir();
  console.log(`malaga: escena ${w}×${h}, ${pois.length} puntos de interés, ${pages.length} páginas`);
}


/* ========================================================================== */
/*  Sectores: manzanas caminables de Málaga                                   */
/* ========================================================================== */

/**
 * content/sectores.json + content/sectores/geo/<id>.json (tools/sectores.mjs)
 * + content/sectores/<id>.md → una escena por sector (1 m = 50 px) con muros,
 * farolas y regiones de transición ciudad ↔ sector ↔ interior, un journal
 * "Sectores" con una página por sector, pines a los lugares, y los tokens
 * declarados en la línea `tokens:` del Markdown.
 *
 * Las regiones de llegada en la escena Málaga las devuelve regionesCiudad(),
 * que construirMalaga() consume.
 */

function cargarSectoresMd() {
  const out = {};
  for (const archivo of archivosMd(path.join(RAIZ, "content/sectores"))) {
    const rel = path.relative(RAIZ, archivo);
    const { meta, cuerpo } = separarFrontmatter(fs.readFileSync(archivo, "utf8"));
    const id = meta.sector ?? slug(path.basename(archivo, ".md"));
    const tokens = [];
    const md = cuerpo.replace(/^# La calle\s*$/m, "").replace(/^tokens:\s*(.+)$/m, (_, lista) => {
      for (const t of lista.split(",").map(x => x.trim()).filter(Boolean)) {
        const mm = /^([a-z0-9-]+)(?:\s*x(\d+))?(?:\s*@([a-z0-9-]+))?(?:\s*\((oculto)\))?$/i.exec(t);
        if (!mm || !nombrePnj[mm[1]]) { avisos.push(`${rel}: token ilegible o PNJ desconocido «${t}»`); continue; }
        tokens.push({ pnj: mm[1], n: Number(mm[2] ?? 1), poi: mm[3] ?? null, oculto: !!mm[4] });
      }
      return "";
    });
    out[id] = { rel, nombre: meta.nombre, intro: meta.intro ?? "", md: md.trim(), tokens, pageId: ID.pagina(JID_SECTORES, id) };
  }
  return out;
}

/** Regiones de llegada/entrada de cada sector dentro de la escena Málaga, en px del mapa general. */
function regionesCiudad(aPx) {
  const regiones = [];
  for (const sec of SECTORES.sectores) {
    const geo = geoSector(sec.id);
    if (!geo) continue;
    const a = aPx(geo.bbox.norte, geo.bbox.oeste), b = aPx(geo.bbox.sur, geo.bbox.este);
    const w = Math.max(b.x - a.x, 64), h = Math.max(b.y - a.y, 64);
    const x = Math.round((a.x + b.x) / 2 - w / 2), y = Math.round((a.y + b.y) / 2 - h / 2);
    const llegada = (geo.regiones ?? []).find(r => r.id === "llegada");
    const rid = ID.regionCiudad(sec.id);
    regiones.push({
      _id: rid, name: sec.nombre, color: "#5c1f1f",
      shapes: [{ type: "rectangle", x, y, width: w, height: h, rotation: 0, hole: false }],
      elevation: { bottom: null, top: null }, visibility: 0, locked: false, flags: flags("region", { sector: sec.id }),
      behaviors: llegada ? [{
        _id: idEstable(`regionB:malaga:${sec.id}`), name: `Entrar a ${sec.nombre}`, type: "teleportToken", disabled: false, flags: {},
        system: { destinations: [`Scene.${ID.sector(sec.id)}.Region.${ID.regionSector(sec.id, "llegada")}`], placement: "center", snap: true, choice: false }
      }] : []
    });
  }
  return regiones;
}

function construirSectores() {
  if (!SECTORES.sectores.length) return;
  const md = cargarSectoresMd();
  const carpetas = new Carpetas("escenas", "Scene");
  const px = SECTORES.pxPorMetro ?? 50;
  const paginas = [];
  let n = 0;

  for (const sec of SECTORES.sectores) {
    const geo = geoSector(sec.id);
    if (!geo) { avisos.push(`sector ${sec.id}: falta content/sectores/geo/${sec.id}.json (node tools/sectores.mjs)`); continue; }
    const pintado = `assets/mapas/sectores/${sec.id}.webp`, esquema = `assets/mapas/sectores/${sec.id}.esquema.webp`;
    const fondo = existe(pintado) ? pintado : existe(esquema) ? esquema : null;
    if (!fondo) { avisos.push(`sector ${sec.id}: sin mapa ni esquema`); continue; }
    if (fondo === esquema) avisos.push(`sector ${sec.id}: sin mapa pintado, uso el esquema (npm run pintar:sectores)`);
    const W = geo.ancho ?? sec.ancho * px, H = geo.alto ?? sec.alto * px;
    const sid = ID.sector(sec.id);
    const doc = md[sec.id];

    const walls = (geo.muros ?? []).map((m, i) => ({
      _id: idEstable(`muro:sector:${sec.id}:${i}`), c: m.c.map(Math.round),
      door: m.door ?? 0, ds: m.ds ?? 0, move: m.move ?? 20, sight: m.sight ?? 20, light: m.light ?? 20, sound: m.sound ?? 20, dir: 0, flags: {}
    }));
    const lights = (geo.luces ?? []).map((l, i) => {
      const p = PRESETS_SECTOR[l.preset] ?? PRESETS_SECTOR.farola;
      return {
        _id: idEstable(`luz:sector:${sec.id}:${i}`), x: Math.round(l.x), y: Math.round(l.y), rotation: 0, elevation: 0, walls: true, vision: false, hidden: false,
        config: { dim: l.dim ?? p.dim, bright: l.bright ?? p.bright, angle: 360, color: l.color ?? p.color, alpha: l.alpha ?? p.alpha, animation: p.animation,
          coloration: 1, attenuation: 0.6, luminosity: 0.5, saturation: 0, contrast: 0, shadows: 0, darkness: { min: 0, max: 1 }, negative: false, priority: 0 },
        flags: {}
      };
    });
    const regions = (geo.regiones ?? []).map(r => {
      let destino = null;
      if (r.destino?.escena === "malaga") destino = `Scene.${ID.escena("malaga")}.Region.${ID.regionCiudad(sec.id)}`;
      else if (r.destino?.escena && r.destino?.region) destino = `Scene.${ID.escena(r.destino.escena)}.Region.${idEstable(`region:${r.destino.escena}:${r.destino.region}`)}`;
      return {
        _id: ID.regionSector(sec.id, r.id), name: r.nombre ?? r.id, color: destino ? "#8c2f5c" : "#2f7f8c",
        shapes: [{ type: "rectangle", x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h), rotation: 0, hole: false }],
        elevation: { bottom: null, top: null }, visibility: 0, locked: false, flags: flags("region", { sector: sec.id, region: r.id }),
        behaviors: destino && !r.llegada ? [{ _id: idEstable(`regionB:sector:${sec.id}:${r.id}`), name: r.nombre ?? r.id, type: "teleportToken", disabled: false, flags: {}, system: { destinations: [destino], placement: "center", snap: true, choice: false } }] : []
      };
    });

    // Pines: la página del sector en el centro y un pin por POI en su puerta (o en el centro del POI).
    const notes = [];
    const puntoPoi = poiId => {
      const e = (geo.puntos ?? []).find(p => p.poi === poiId);
      return e ? { x: e.x, y: e.y } : { x: W / 2, y: H / 2 };
    };
    if (doc) notes.push({ _id: idEstable(`nota:sector:${sec.id}`), entryId: JID_SECTORES, pageId: doc.pageId, x: Math.round(W / 2), y: 120, elevation: 0, sort: 0, locked: false,
      texture: { src: "icons/svg/book.svg", anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
      iconSize: 48, text: sec.nombre, fontFamily: "Signika", fontSize: 28, textAnchor: 1, textColor: "#ffffff", global: false, flags: flags("pin", { sector: sec.id }) });
    for (const poiId of sec.pois ?? []) {
      const poi = (existe("content/malaga/pois.json") ? leerJson("content/malaga/pois.json").pois : []).find(p => p.id === poiId);
      if (!poi) continue;
      const { x, y } = puntoPoi(poiId);
      notes.push({ _id: idEstable(`nota:sector:${sec.id}:${poiId}`), entryId: ID.journal("malaga"), pageId: ID.pagina(ID.journal("malaga"), poiId), x: Math.round(x), y: Math.round(y), elevation: 0, sort: 0, locked: false,
        texture: { src: poi.icono ?? "icons/svg/house.svg", anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
        iconSize: 48, text: poi.nombre, fontFamily: "Signika", fontSize: 28, textAnchor: 1, textColor: "#ffffff", global: false, flags: flags("pin", { sector: sec.id, poi: poiId }) });
    }

    // Tokens.
    const tokens = [];
    let k = 0;
    for (const t of doc?.tokens ?? []) {
      const pnj = PNJS.find(p => p.id === t.pnj);
      const base = t.poi ? puntoPoi(t.poi) : { x: W / 2, y: H / 2 };
      for (let i = 0; i < t.n; i++, k++) {
        const x = Math.round((base.x + (k % 3 - 1) * 120) / px) * px, y = Math.round((base.y + 150 + Math.floor(k / 3) * 100) / px) * px;
        const textura = existe(`assets/tokens/${pnj.id}.webp`) ? `modules/${MODULO}/assets/tokens/${pnj.id}.webp` : "icons/svg/mystery-man.svg";
        tokens.push({ _id: idEstable(`token:sector:${sec.id}:${t.pnj}:${i}`), name: t.n > 1 ? `${pnj.nombre} ${i + 1}` : pnj.nombre, displayName: 30, actorId: ID.actor(pnj.id), actorLink: false,
          texture: { src: textura, anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
          x, y, width: 1, height: 1, elevation: 0, level: idEstable(`nivel:sector:${sec.id}`), rotation: 0, alpha: 1, lockRotation: true, locked: false, sort: 0,
          hidden: t.oculto, disposition: (DISPOSICION[pnj.spcType] ?? (HOSTILES.test(pnj.id) ? -1 : 0)), flags: flags("token", { sector: sec.id, pnj: pnj.id }) });
      }
    }

    // Vehículos aparcados en este sector.
    const VEHS = existe("content/vehiculos.json") ? leerJson("content/vehiculos.json").vehiculos.filter(v => v.sector === sec.id) : [];
    const llegada = (geo.regiones ?? []).find(r => r.id === "llegada");
    VEHS.forEach((v, i) => {
      // En un aparcamiento calculado sobre la calzada (tools/sectores.mjs): el
      // coche entero libre de edificios y alineado con la calle. Sin hueco, al
      // lado de la llegada como antes. El token es 2 × 4 m y x/y es su esquina.
      const hueco = (geo.aparcamientos ?? [])[i];
      const base = llegada ? { x: llegada.x + llegada.w / 2, y: llegada.y + llegada.h / 2 } : { x: W / 2, y: H / 2 };
      const cx = hueco ? hueco.x : base.x + 300 + i * 200, cy = hueco ? hueco.y : base.y - 100;
      const rotacion = hueco?.rotacion ?? 0;
      const x = Math.round(cx - px), y = Math.round(cy - 2 * px);
      const textura = existe(`assets/tokens/vehiculos/${v.id}.webp`) ? `modules/${MODULO}/assets/tokens/vehiculos/${v.id}.webp` : "icons/svg/anchor.svg";
      tokens.push({ _id: idEstable(`token:sector:${sec.id}:vehiculo:${v.id}`), name: v.nombre, displayName: 30, actorId: ID.actor(`vehiculo:${v.id}`), actorLink: false,
        texture: { src: textura, anchorX: 0.5, anchorY: 0.5, fit: "contain", scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
        x: Math.min(x, W - 2 * px), y: Math.min(y, H - 4 * px), width: 2, height: 4, elevation: 0, level: idEstable(`nivel:sector:${sec.id}`), rotation: rotacion, alpha: 1, lockRotation: false, locked: false, sort: 0,
        hidden: !!v.oculto, disposition: 0, flags: { [MODULO]: { origen: "token", sector: sec.id, vehiculo: v.id, nombreBase: v.nombre, pasajeros: [] } } });
    });

    // Cada manzana tiene su ambiente (`"escena": "sector:<id>"` en musica.json); si no, la noche de Málaga.
    const propio = ambienteDe(`sector:${sec.id}`);
    const ambiente = propio.playlist ? propio : ambienteDe("malaga");
    escribirDoc("escenas", conClaves({
      _id: sid, _key: `!scenes!${sid}`, name: `Málaga · ${sec.nombre}`, folder: carpetas.id("Málaga · sectores"),
      navigation: false, navOrder: 200 + (sec.orden ?? 0), width: W, height: H, padding: 0,
      playlist: ambiente.playlist ?? null, playlistSound: ambiente.playlistSound ?? null,
      grid: { type: 1, size: px, style: "solidLines", thickness: 1, color: "#000000", alpha: 0, distance: 1, units: "m" },
      tokenVision: true, fog: { exploration: true },
      environment: { darknessLevel: sec.oscuridad ?? 0.8, globalLight: { enabled: false } },
      levels: [{ _id: idEstable(`nivel:sector:${sec.id}`), name: "Calle", elevation: { bottom: 0, top: 20 }, background: { src: `modules/${MODULO}/${fondo}`, color: "#0b0d10" }, sort: 0 }],
      walls, lights, regions, tokens, notes, sounds: [], tiles: [], drawings: [],
      flags: flags("escena", { escena: `sector:${sec.id}`, sector: sec.id, nota: `${sec.nota ?? ""} Datos de OpenStreetMap (© OpenStreetMap contributors, ODbL).`, provisional: fondo === esquema }),
      _stats: STATS
    }));

    if (doc) {
      const html = md2html(expandirMarcadores(doc.md, doc.rel));
      const cab = `<p class="dvv-ficha-poi"><strong>Sector</strong> · ${(sec.pois ?? []).map(p => enlace("cronica", "JournalEntry", ID.journal("malaga"), p)).join(" · ")}</p>`;
      paginas.push({ _id: doc.pageId, _key: `!journal.pages!${JID_SECTORES}.${doc.pageId}`, name: sec.nombre, type: "text", title: { show: true, level: 1 },
        text: { format: 1, content: (doc.intro ? `<p><em>${doc.intro}</em></p>` : "") + html }, sort: (sec.orden ?? 0) * 1000, ownership: { default: -1 }, flags: flags("sector", { sector: sec.id }) });
    } else avisos.push(`sector ${sec.id}: sin content/sectores/${sec.id}.md`);
    n++;
  }
  carpetas.escribir();

  if (paginas.length) {
    const pid0 = ID.pagina(JID_SECTORES, 0);
    const intro = `<p>Manzanas de Málaga a escala de calle (1 m por casilla). Desde el mapa de la ciudad, un token que entra en la zona de un sector aparece en su calle; pisar el borde del sector lo devuelve a la ciudad, y la puerta de cada lugar lleva a su interior.</p><ul>${SECTORES.sectores.filter(s => md[s.id] && geoSector(s.id)).map(s => `<li>@UUID[Scene.${ID.sector(s.id)}]{${s.nombre}} — @UUID[JournalEntry.${JID_SECTORES}.JournalEntryPage.${md[s.id].pageId}]{página}</li>`).join("")}</ul>`;
    const carpJ = new Carpetas("cronica", "JournalEntry");
    escribirDoc("cronica", {
      _id: JID_SECTORES, _key: `!journal!${JID_SECTORES}`, name: "Málaga — Sectores a pie",
      folder: carpJ.id("Crónica"), sort: 910, ownership: { default: 0 }, flags: flags("journal", { archivo: "content/sectores" }),
      pages: [{ _id: pid0, _key: `!journal.pages!${JID_SECTORES}.${pid0}`, name: "Sectores", type: "text", title: { show: false, level: 1 }, text: { format: 1, content: intro }, sort: 0, ownership: { default: -1 }, flags: {} }, ...paginas],
      _stats: STATS
    });
    carpJ.escribir();
  }
  console.log(`sectores: ${n} escenas, ${paginas.length} páginas`);
}

/* ========================================================================== */
/*  Música y ambientes                                                        */
/* ========================================================================== */

const MUSICA = existe("content/musica.json") ? leerJson("content/musica.json") : { listas: [] };
const MODOS_LISTA = { sequential: 0, shuffle: 1, simultaneous: 2, soundboard: -1 };
ID.lista = id => idEstable(`playlist:${id}`);
ID.pista = (lista, id) => idEstable(`pista:${lista}:${id}`);

/** { escenaId: { playlist, playlistSound } } para enlazar el ambiente de cada escena. */
const AMBIENTE_POR_ESCENA = {};
for (const lista of MUSICA.listas) {
  for (const pista of lista.pistas) {
    if (pista.escena) AMBIENTE_POR_ESCENA[pista.escena] = { playlist: ID.lista(lista.id), playlistSound: ID.pista(lista.id, pista.id) };
  }
}

function construirPlaylists() {
  let n = 0;
  for (const lista of MUSICA.listas) {
    const pid = ID.lista(lista.id);
    const sounds = [];
    for (const [i, pista] of lista.pistas.entries()) {
      const archivo = pista.archivo ?? `${pista.id}.mp3`;
      if (!existe(`assets/music/${archivo}`)) {
        avisos.push(`musica.json: falta assets/music/${archivo} (${pista.id}); corré npm run musica`);
        continue;
      }
      const sid = ID.pista(lista.id, pista.id);
      sounds.push({
        _id: sid,
        _key: `!playlists.sounds!${pid}.${sid}`,
        name: pista.nombre,
        description: pista.escena ? `Ambiente de la escena ${pista.escena}` : "",
        path: `modules/${MODULO}/assets/music/${archivo}`,
        channel: "",
        playing: false,
        pausedTime: null,
        repeat: pista.repetir ?? true,
        volume: pista.volumen ?? 0.4,
        fade: pista.fundido ?? 2000,
        sort: i * 1000,
        flags: flags("pista", { pista: pista.id, escena: pista.escena ?? "" })
      });
    }
    escribirDoc("playlists", {
      _id: pid,
      _key: `!playlists!${pid}`,
      name: lista.nombre,
      description: lista.descripcion ?? "",
      sounds,
      channel: "music",
      mode: MODOS_LISTA[lista.modo ?? "soundboard"] ?? -1,
      playing: false,
      fade: 2000,
      folder: null,
      sorting: "m",
      seed: 0,
      sort: 0,
      ownership: { default: 0 },
      flags: flags("playlist", { lista: lista.id }),
      _stats: STATS
    });
    n++;
  }
  console.log(`playlists: ${n} (${Object.keys(AMBIENTE_POR_ESCENA).length} escenas con ambiente)`);
}

/* ========================================================================== */
/*  Aventura: todo al mundo en un click                                       */
/* ========================================================================== */

/**
 * Un documento Adventure que embebe escenas, actores, journals y macros ya
 * generados, con sus carpetas, para que el Narrador importe la crónica entera
 * desde el compendio (o desde el quickstart de Foundry 14) sin arrastrar nada.
 * Los ítems (reservas, mejoras, estados, arsenal) quedan en sus compendios:
 * se usan desde ahí.
 */
function construirAventura() {
  const AVENTURA_ID = idEstable("aventura:somnia-biotech");
  const leerPack = pack => {
    const dir = path.join(RAIZ, "packs-src", pack);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  };
  const sinKey = doc => {
    const { _key, ...resto } = doc;
    for (const campo of ["pages", "items", "effects"]) {
      if (Array.isArray(resto[campo])) resto[campo] = resto[campo].map(({ _key, ...h }) => h);
    }
    return resto;
  };
  const esCarpeta = d => d._key?.startsWith("!folders!");

  const raices = {};
  const raiz = tipo => {
    raices[tipo] ??= {
      _id: idEstable(`aventura:raiz:${tipo}`), name: "Del Velo a la Vigilia", type: tipo, folder: null,
      sorting: "m", sort: 0, color: null, flags: flags("carpeta"), _stats: STATS
    };
    return raices[tipo];
  };

  const folders = [];
  const colgar = (docs, tipo) => {
    const carpetas = docs.filter(esCarpeta).map(sinKey);
    const resto = docs.filter(d => !esCarpeta(d)).map(sinKey);
    const r = raiz(tipo);
    for (const c of carpetas) folders.push({ ...c, folder: c.folder ?? r._id });
    for (const d of resto) d.folder ??= r._id;
    return resto;
  };

  const actors = colgar(leerPack("personajes"), "Actor");
  const journal = [...colgar(leerPack("cronica"), "JournalEntry"), ...colgar(leerPack("reglas"), "JournalEntry")];
  const scenes = colgar(leerPack("escenas"), "Scene");
  const macros = colgar(leerPack("macros"), "Macro");
  const playlists = colgar(leerPack("playlists"), "Playlist");
  folders.unshift(...Object.values(raices));

  const portada = existe("assets/mapas/somnia-planta-nueva.webp") ? `modules/${MODULO}/assets/mapas/somnia-planta-nueva.webp` : "icons/svg/book.svg";
  escribirDoc("aventura", {
    _id: AVENTURA_ID,
    _key: `!adventures!${AVENTURA_ID}`,
    name: "Somnia Biotech — Del Velo a la Vigilia",
    img: portada,
    caption: "<p>La crónica completa, lista para dirigir.</p>",
    description: `<p>Importa al mundo <strong>${scenes.length} escenas</strong>, <strong>${actors.length} actores</strong> (PNJs y plantillas de cazador), <strong>${journal.length} journals</strong> (crónica y reglas caseras), <strong>${macros.length} macros</strong> y ${playlists.length} lista(s) de música y ambientes, con sus carpetas.</p><p>Los poderes de los tres caminos, los estados y el Arsenal quedan en sus compendios: se usan desde ahí (o desde el panel del Narrador).</p><p>Reimportar actualiza los documentos existentes sin duplicarlos.</p>`,
    actors, journal, scenes, macros, playlists, folders,
    items: [], tables: [], cards: [], combats: [],
    folder: null, sort: 0,
    flags: flags("aventura", { aventura: "somnia-biotech" }),
    _stats: STATS
  });

  // El quickstart del manifest apunta a este id.
  const manifestPath = path.join(RAIZ, "module.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.quickstart?.adventures) {
    for (const a of Object.values(manifest.quickstart.adventures)) {
      a.uuid = `Compendium.${MODULO}.aventura.Adventure.${AVENTURA_ID}`;
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(`aventura: ${scenes.length} escenas, ${actors.length} actores, ${journal.length} journals, ${macros.length} macros, ${folders.length} carpetas`);
}

construirSalas();
construirSectores();
construirMalaga();
construirPlaylists();
construirAventura();
cerrar();
