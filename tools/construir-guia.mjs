#!/usr/bin/env node
/**
 * content/ → guia/index.html: la Guía del Narrador, una página local.
 *
 * Toda la crónica (actos, interludio, epílogo), los cuatro cazadores, los
 * PNJs con sus diálogos, las escenas sala por sala, Málaga con sus manzanas
 * y lugares, la pantalla y las reglas caseras, en un solo HTML que se abre
 * desde el disco (file://) sin internet: las fuentes van en guia/fonts y las
 * imágenes salen de ../assets. El seguimiento de la partida (escenas hechas,
 * Desesperación, Peligro, balizas, notas) lo guarda guia.js en el navegador.
 *
 * Estilo: el de los libros de Cazador 5ª (ver .taste-skill/notas.md).
 *
 * El HTML es AUTOCONTENIDO: CSS, JS, fuentes e imágenes van embebidos (las
 * imágenes reducidas y en base64). Un navegador Flatpak abre el archivo por
 * el portal de documentos y no ve la carpeta de al lado; con todo adentro,
 * la guía se abre con doble clic en cualquier máquina.
 *
 * Uso: node tools/construir-guia.mjs [--enlazado]   (--enlazado: sin embeber, para depurar)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { marked } from "marked";
import { RAIZ, leerJson, archivosMd, separarFrontmatter, slug } from "./util.mjs";

marked.use({ gfm: true });
const md2html = md => marked.parse(md, { async: false });
const SALIDA = path.join(RAIZ, "guia/index.html");
const A = "../assets";
const ENLAZADO = process.argv.includes("--enlazado");
const CACHE = path.join(RAIZ, "cache/guia");
/** Ancho máximo al embeber, por carpeta: los mapas no necesitan 4000 px para leerse en la guía. */
const ANCHO = { "mapas/sectores": 1400, mapas: 1600, retratos: 480, portadas: 640, "tokens/vehiculos": 120, credos: 1400 };
const existe = rel => fs.existsSync(path.join(RAIZ, rel));
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const leerMd = f => separarFrontmatter(fs.readFileSync(f, "utf8"));
const porOrden = (a, b) => (Number(a.meta.orden ?? 0) - Number(b.meta.orden ?? 0));

/* ---------------------------------------------------------------- datos */
const PNJS = leerJson("content/pnjs.json").pnjs;
const PJS = leerJson("content/pjs.json").pjs;
const VEHS = existe("content/vehiculos.json") ? leerJson("content/vehiculos.json").vehiculos : [];
const POIS = existe("content/malaga/pois.json") ? leerJson("content/malaga/pois.json").pois : [];
const SECTORES = existe("content/sectores.json") ? leerJson("content/sectores.json").sectores : [];
const PLANOS = fs.readdirSync(path.join(RAIZ, "content/planos")).filter(f => f.endsWith(".json")).sort()
  .flatMap(f => leerJson(`content/planos/${f}`).planos ?? []);
const nombrePnj = Object.fromEntries(PNJS.map(p => [p.id, p.nombre]));
const nombreVeh = Object.fromEntries(VEHS.map(v => [v.id, v.nombre]));

/* ------------------------------------------------------------ marcadores */
const ETIQ = { fe: "Fe", metodo: "Método", carne: "Carne" };
function expandir(md) {
  md = md.replace(/^:::leer\s*\n([\s\S]*?)\n:::\s*$/gm, (_, inner) => `\n<blockquote class="leer">${md2html(inner.trim())}</blockquote>\n`);
  md = md.replace(/@tirada\{([^}|]+)\|([^}|]*)\|([^}]+)\}/g, (_, _p, dif, texto) =>
    `<span class="tirada" title="Tirada">${esc(texto.trim())}${Number(dif) ? "" : ""}</span>`);
  md = md.replace(/⚑\{(fe|metodo|carne)\|([+-]?\d+)\|([^}]+)\}/g, (_, b, d, motivo) => {
    const n = Number(d);
    return `<span class="baliza ${b}" title="${esc(motivo.trim())}">${n > 0 ? "+" : ""}${n} ${ETIQ[b]}</span>`;
  });
  md = md.replace(/@npc\{([^}|]+)(?:\|([^}]+))?\}/g, (_, id, et) => {
    id = id.trim();
    return nombrePnj[id] ? `<a class="pnj-ref" href="#pnj-${id}">${esc(et?.trim() || nombrePnj[id])}</a>` : esc(et?.trim() ?? id);
  });
  md = md.replace(/@vehiculo\{([^}|]+)(?:\|([^}]+))?\}/g, (_, id, et) => {
    id = id.trim();
    return nombreVeh[id] ? `<a class="pnj-ref" href="#veh-${id}">${esc(et?.trim() || nombreVeh[id])}</a>` : esc(et?.trim() ?? id);
  });
  return md;
}
/** Párrafos con etiqueta de arranque («Qué hay.», «Para el Narrador.») → nota al margen. */
function conNotas(html) {
  return html.replace(/<p><strong>([^<]{2,40}?)\.?<\/strong>\s*/g, (_, l) => `<p class="nota" data-label="${esc(l.replace(/\.$/, ""))}">`);
}
const render = md => conNotas(md2html(expandir(sinEmoji(md))));
/** Quita el primer título h1 del markdown (ya lo pone la sección). */
const sinH1 = md => md.replace(/^\s*# [^\n]*\n/, "");
/** Emojis fuera: la guía usa palabras. */
const sinEmoji = md => md.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?\s?/gu, "");
/** Línea `tokens: a, b x2 @poi (oculto)` → chips. */
function tokensHtml(linea) {
  if (!linea) return "";
  const partes = linea.split(",").map(s => s.trim()).filter(Boolean).map(t => {
    const m = /^([a-z0-9-]+)(?:\s+x(\d+))?(?:\s+@([a-z0-9-]+))?(?:\s*\((oculto)\))?/.exec(t);
    if (!m) return esc(t);
    const [, id, n, , oculto] = m;
    const nombre = nombrePnj[id] ?? id;
    return `<a class="chip${oculto ? " oculto" : ""}" href="#pnj-${id}">${esc(nombre)}${n ? ` ×${n}` : ""}${oculto ? " · oculto" : ""}</a>`;
  });
  return `<p class="tokens"><span>En la sala</span>${partes.join("")}</p>`;
}

/* --------------------------------------------------------------- piezas */
const dots = n => "●".repeat(Math.max(0, Math.min(5, n))) + "○".repeat(Math.max(0, 5 - Math.min(5, n)));
const ATR = { strength: "Fuerza", dexterity: "Destreza", stamina: "Resistencia", charisma: "Carisma", manipulation: "Manipulación", composure: "Compostura", intelligence: "Inteligencia", wits: "Astucia", resolve: "Resolución" };
const HAB = { athletics: "Atletismo", brawl: "Pelea", craft: "Artesanía", drive: "Conducir", firearms: "Armas de fuego", larceny: "Latrocinio", melee: "Cuerpo a cuerpo", stealth: "Sigilo", survival: "Supervivencia", animalken: "Trato con animales", etiquette: "Etiqueta", insight: "Perspicacia", intimidation: "Intimidación", leadership: "Liderazgo", performance: "Interpretación", persuasion: "Persuasión", streetwise: "Callejeo", subterfuge: "Subterfugio", academics: "Academicismo", awareness: "Alerta", finance: "Finanzas", investigation: "Investigación", medicine: "Medicina", occult: "Ocultismo", politics: "Política", science: "Ciencia", technology: "Tecnología" };
const TIPO = { vampire: "Vampiro", ghoul: "Ghoul", mortal: "Mortal" };

function hecho(id, etiqueta = "Hecho") {
  return `<label class="hecho"><input type="checkbox" data-hecho="${esc(id)}"><span>${esc(etiqueta)}</span></label>`;
}

/* ---------------------------------------------------------- 1. cabecera */
const vision = leerMd(path.join(RAIZ, "content/cronica/00-vision-general.md"));
const premisa = /## Premisa\s*\n([\s\S]*?)\n## /.exec(vision.cuerpo)?.[1].trim() ?? "";
const estructura = /## Estructura\s*\n([\s\S]*?)\n## /.exec(vision.cuerpo)?.[1].trim() ?? "";
const balizasTxt = /## Las tres balizas\s*\n([\s\S]*?)(\n## |$)/.exec(vision.cuerpo)?.[1].trim() ?? "";

const cabecera = `
<header class="tablero" id="inicio">
  <div class="fila">
    <a class="t-logo" href="#inicio" aria-label="Inicio"><span>WoD</span></a>
    <nav class="t-nav" aria-label="Secciones">
      <a href="#cronica">Crónica</a><a href="#cazadores">Credos</a><a href="#dramatis">Dramatis</a><a href="#escenas">Escenas</a><a href="#malaga">Málaga</a><a href="#reglas">Reglas</a>
    </nav>
    <button class="t-accion" type="button" data-abrir-mesa>La mesa</button>
  </div>
  <div class="cuadro">
    <h1 class="t-nombre"><span class="grande">Del Velo</span><span class="chico">a la Vigilia</span></h1>
    <figure class="t-foto t-shutter"><img src="${A}/mapas/landing.webp" width="2634" height="1359" alt="La pared de corcho de Elías: fotos, recortes y hilo rojo" fetchpriority="high"></figure>
    <figure class="t-foto t-foto-2"><img src="${A}/mapas/malaga.webp" width="4016" height="2783" alt="El mapa de Málaga de noche" loading="lazy"></figure>
    <div class="t-par">
      <p class="t-oscuro">Málaga. Una clínica de ensayos del sueño alimenta a una vampira antigua con la sangre de sus pacientes, y cuatro empleados lo ven la noche de un apagón.</p>
      <p class="t-acento">Guía del Narrador de la crónica Somnia Biotech para Cazador: La Venganza, 5ª edición. Se abre desde el disco y guarda la partida en este navegador.</p>
    </div>
  </div>
</header>`;

/* ------------------------------------------------------ 2. statement */
const intro = `
<section class="statement" id="vision">
  <div class="st-board">
    <div class="st-a"><p class="lema">Comida<br>que camina</p></div>
    <div class="st-b"><span>4</span></div>
    <figure class="st-c"><img src="${A}/portadas/portada.webp" width="1024" height="1536" alt="Portada de Del Velo a la Vigilia" loading="lazy"></figure>
  </div>
  <div class="st-texto"><div>${render(premisa)}</div></div>
</section>
<section class="pagina" id="estructura">
  <h2>Cómo se cuenta</h2>
  <div class="cuerpo">${render(estructura)}<h3>Las tres balizas</h3>${render(balizasTxt)}
  <h3>Cómo usar esta guía</h3>
  <p>Leela entera una vez antes de la primera sesión; después, en la mesa, trabajá con la pestaña del acto que toca y con las salas de la escena abierta en Foundry. Cada escena y cada sala tienen una casilla «Hecho»; el botón <strong>La mesa</strong> abre el tablero con la Desesperación, el Peligro y las balizas de cada cazador. Todo queda guardado en este navegador y se puede exportar a un archivo.</p></div>
</section>`;

/* ----------------------------------------------------- 3. credos y cazadores */
/** Los cinco Credos de Cazador 5ª, como los presenta World of Darkness: una banda por Credo. */
const CREDOS = [
  { id: "martial", nombre: "Marciales", titulo: "Marcial", frase: "Aplastar la amenaza con armas, táctica y fuerza bruta.",
    texto: "El cazador Marcial entiende la Caza como una guerra: hay que entrenar, armarse y golpear antes de que el monstruo golpee. Su fuerte es el conflicto físico, y su dilema es qué queda de él cuando todo se resuelve a tiros.",
    desesperacion: "Cualquier conflicto físico con lo sobrenatural: armas, táctica, fuerza bruta." },
  { id: "underground", nombre: "Clandestinos", titulo: "Clandestino", frase: "Astucia, subterfugio y conocer a la gente indicada.",
    texto: "El cazador Clandestino sabe que a la presa no se llega de frente sino por la puerta de servicio: contactos, mentiras, cerraduras, sigilo. Su fuerte es moverse sin ser visto, y su dilema es a quién termina pareciéndose para lograrlo.",
    desesperacion: "Sigilo y subterfugio en servicio directo de la Caza." },
  { id: "inquisitive", nombre: "Inquisitivos", titulo: "Inquisitivo", frase: "Acumular y usar conocimiento contra lo oculto.",
    texto: "El cazador Inquisitivo estudia al monstruo con métodos de hoy y de hace siglos, y convierte lo que aprende en un arma. Su fuerte es conseguir información: investigar, entrar donde no debe, interrogar. Su dilema es cuánto está dispuesto a saber.",
    desesperacion: "Obtener información vital: investigación, allanamientos e interrogatorios." },
  { id: "faithful", nombre: "Fieles", titulo: "Fiel", frase: "Una fe que sostiene en el choque directo con lo sobrenatural.",
    texto: "El cazador Fiel cree en poderes más altos y mira el mundo con esa certeza. Su fe lo sostiene en el conflicto directo con lo sobrenatural, sea físico, social o mental. Su dilema es qué pasa la noche en que nadie responde.",
    desesperacion: "Cualquier conflicto directo (físico, social o mental) frente a lo sobrenatural." },
  { id: "entrepreneurial", nombre: "Emprendedores", titulo: "Emprendedor", frase: "Innovar, construir y reparar en plena Caza.",
    texto: "El cazador Emprendedor va a la Caza con soluciones nuevas y enfoques experimentales: construye, inventa, mejora y repara sobre la marcha, y lo que no sabe hacer lo compra o lo negocia. Su dilema es que todo cuesta, y alguien paga.",
    desesperacion: "Construir, inventar, aumentar o reparar dispositivos durante la Caza." }
];
const SETS_CREDO = Object.fromEntries((existe("content/arsenal.json") ? leerJson("content/arsenal.json").sets ?? [] : []).map(x => [x.credo, x]));
const SETS = Object.fromEntries(Object.values(SETS_CREDO).map(x => [x.id, x.nombre]));
const CAMINO = { fe: "La Marca de los Heraldos (Fe)", metodo: "La Ciencia del Umbral (Método)", carne: "La Carne Templada (Carne)", mortal: "Cazador mortal, con el Arsenal" };
const cazadores = `
<section class="credos" id="cazadores">
  <div class="credos-cab">
    <h2>Los Credos y los cuatro cazadores</h2>
    <p class="standfirst">El Credo es cómo un cazador encara a su presa: su método, sus herramientas y su manera de mirar el mundo. En esta crónica, cuatro empleados de Somnia Biotech encarnan cuatro de los cinco Credos. Son arquetipos sugeridos: el nombre, la ficha y la historia los construye cada jugador. Lo que importa es el puesto que tenían en la clínica, porque de ahí sale lo que cada uno sabe, a quién conoce y por qué Somnia puede apretarlo.</p>
  </div>
  ${CREDOS.map((c, i) => {
    const pj = PJS.find(p => p.credo === c.id);
    const set = SETS_CREDO[c.id];
    const img = existe(`assets/credos/${c.id}.webp`) ? `${A}/credos/${c.id}.webp` : null;
    return `
  <article class="credo${i % 2 ? " invertido" : ""}" id="credo-${c.id}">
    <figure class="credo-foto">${img ? `<img src="${img}" width="1600" height="900" alt="" loading="lazy">` : ""}<figcaption>${esc(c.titulo)}</figcaption></figure>
    <div class="credo-texto">
      <h3>${esc(c.nombre)}</h3>
      <p class="credo-frase">${esc(c.frase)}</p>
      <p>${esc(c.texto)}</p>
      <dl class="credo-datos">
        <dt>Dados de Desesperación</dt><dd>${esc(c.desesperacion)}</dd>
        ${set ? `<dt>Set del Arsenal</dt><dd><a href="#regla-el-arsenal-de-la-vigilia">${esc(set.nombre)}</a>${set.lema ? ` · <em>${esc(set.lema)}</em>` : ""}</dd>` : ""}
      </dl>
      ${pj ? `<div class="credo-pj" id="pj-${pj.id}"><span class="credo-pj-etiqueta">En esta crónica</span><h4>${esc(pj.nombre)}</h4><p>${esc(pj.concepto)}.</p><p class="chica">Camino probable: ${esc(CAMINO[pj.caminoProbable] ?? pj.caminoProbable ?? "—")}.</p></div>` : `<div class="credo-pj vacio"><span class="credo-pj-etiqueta">En esta crónica</span><p>Sin arquetipo propio. Si un jugador lo elige, el ${set ? esc(set.nombre) : "set"} está en el Arsenal y Somnia tiene una cuenta pendiente con cualquiera que mueva dinero.</p></div>`}
    </div>
  </article>`; }).join("")}
  <p class="credos-pie">En el compendio de personajes del módulo hay una plantilla por arquetipo con cifras sugeridas, por si una mesa quiere empezar a jugar en diez minutos.</p>
</section>`;

/* ----------------------------------------------------- 4. dramatis */
const dramatis = leerMd(path.join(RAIZ, "content/cronica/07-dramatis-personae.md"));
/** Diálogos por PNJ: bloques `## Nombre (...)` cuya `Ficha: @npc{id}` apunta al PNJ. */
const dialogos = {};
for (const bloque of dramatis.cuerpo.split(/^## /m).slice(1)) {
  const id = /@npc\{([a-z0-9-]+)\}/.exec(bloque)?.[1];
  if (!id) continue;
  const cuerpo = bloque.replace(/^[^\n]*\n/, "").replace(/^Ficha:[^\n]*\n/m, "").replace(/^### /gm, "#### ");
  dialogos[id] = render(cuerpo);
}
const pnjCard = p => {
  const retrato = existe(`assets/retratos/${p.id}.webp`) ? `${A}/retratos/${p.id}.webp` : null;
  const desc = p.descripcion ?? "";
  const primero = /<p>([\s\S]*?)<\/p>/.exec(desc)?.[1] ?? "";
  const resto = desc.replace(/<p>[\s\S]*?<\/p>/, "");
  return `
  <article class="pnj" id="pnj-${p.id}">
    <div class="pnj-lado">
      <dl><dt>Es</dt><dd>${TIPO[p.spcType] ?? esc(p.spcType)}</dd><dt>Salud / Voluntad</dt><dd>${p.salud ?? "–"} / ${p.voluntad ?? "–"}</dd><dt>Dificultad</dt><dd>${p.dificultadGeneral?.normal ?? 0} · ${p.dificultadGeneral?.fuerte ?? 0} contra lo suyo</dd></dl>
    </div>
    <div class="pnj-cuerpo">
      <p class="capitular">${retrato ? `<img src="${retrato}" width="768" height="1024" alt="${esc(p.nombre)}" loading="lazy">` : `<span class="sin-retrato" aria-hidden="true"></span>`}<b>${esc(p.nombre)}.</b> ${esc(p.concepto)}. <span class="suave">${primero}</span></p>
      ${resto ? `<div class="suave">${resto}</div>` : ""}
      ${p.poderes ? `<h4>Poderes</h4>${p.poderes}` : ""}
      ${p.debilidades ? `<h4>Debilidades</h4>${p.debilidades}` : ""}
      ${p.notas ? `<h4>En la crónica</h4>${p.notas}` : ""}
      ${dialogos[p.id] ? `<h4>Qué dice</h4>${dialogos[p.id]}` : ""}
      <div class="reservas"><span>Físico ${p.estandar?.physical ?? "–"}</span><span>Social ${p.estandar?.social ?? "–"}</span><span>Mental ${p.estandar?.mental ?? "–"}</span>${Object.entries(p.excepcionales ?? {}).map(([k, v]) => `<span>${HAB[k] ?? k} ${v}</span>`).join("")}</div>
    </div>
  </article>`;
};
const dramatisHtml = `
<section class="pagina" id="dramatis">
  <h2>Dramatis personae</h2>
  <div class="cuerpo"><p>Quién es cada uno, qué puede, qué le pesa y qué dice cuando habla. Las fichas de wod5e están en el compendio; las cifras de todos salvo Elías son sugeridas.</p></div>
  <nav class="indice" aria-label="Personajes">${PNJS.map(p => `<a href="#pnj-${p.id}">${esc(p.nombre)}</a>`).join("")}</nav>
  ${PNJS.map(pnjCard).join("")}
</section>`;

/* ------------------------------------------------------- 5. crónica */
const ACTOS = ["01-acto-1", "02-interludio", "03-interludio-monologo-de-elias", "04-acto-2", "05-acto-3", "06-epilogo"]
  .map(f => ({ f, ...leerMd(path.join(RAIZ, `content/cronica/${f}.md`)) }));
const pestanas = ACTOS.map((a, i) => {
  const corto = a.meta.nombre.replace(/\s[—-]\s.*$/, "").replace("El monólogo", "Monólogo");
  const largo = a.meta.nombre.replace(/^[^—-]*[—-]\s*/, "");
  return `<button type="button" class="tab${i === 0 ? " activa" : ""}" data-tab="${a.meta.id}"><span>${esc(corto)}</span><small>${esc(largo === a.meta.nombre ? "" : largo)}</small></button>`;
}).join("");
const paneles = ACTOS.map((a, i) => {
  const cuerpo = sinH1(a.cuerpo);
  const partes = cuerpo.split(/^## /m);
  const intro = partes[0].trim();
  const escenas = partes.slice(1).map(bloque => {
    const titulo = bloque.split("\n")[0].trim();
    const id = `${a.meta.id}:${slug(titulo)}`;
    return `<div class="banda" id="escena-${a.meta.id}-${slug(titulo)}"><div class="banda-cab"><h3>${esc(titulo)}</h3>${hecho(id)}</div><div class="banda-cuerpo">${render(bloque.replace(/^[^\n]*\n/, ""))}</div></div>`;
  });
  return `<div class="panel${i === 0 ? " activa" : ""}" data-panel="${a.meta.id}" id="${a.meta.id}">
    <h3 class="panel-titulo">${esc(a.meta.nombre)}</h3>
    ${intro ? `<div class="cuerpo">${render(intro)}</div>` : ""}
    ${escenas.length ? escenas.join("") : `<div class="banda"><div class="banda-cab"><h3>${esc(a.meta.nombre)}</h3>${hecho(a.meta.id)}</div></div>`}
  </div>`;
}).join("");
const cronica = `
<section class="agenda" id="cronica">
  <div class="agenda-cab"><div><h2>La crónica</h2><p class="standfirst">Acto por acto, escena por escena. Marcá cada una cuando pase.</p></div><p class="progreso" data-progreso="cronica" aria-live="polite"></p></div>
  <div class="agenda-grid"><div class="tabs" role="tablist">${pestanas}</div><div class="paneles">${paneles}</div></div>
</section>`;

/* --------------------------------------------------------- 6. salas */
const salasDocs = archivosMd(path.join(RAIZ, "content/salas")).map(f => ({ f, ...leerMd(f) }));
const ordenEscena = Object.fromEntries(PLANOS.map(p => [p.id, p.orden ?? 99]));
salasDocs.sort((a, b) => (ordenEscena[a.meta.escena] ?? 99) - (ordenEscena[b.meta.escena] ?? 99));
const escenasHtml = salasDocs.map(doc => {
  const esc_ = doc.meta.escena;
  const plano = PLANOS.find(p => p.id === esc_);
  const mapa = existe(`assets/mapas/${esc_}.webp`) ? `${A}/mapas/${esc_}.webp` : null;
  const salas = doc.cuerpo.split(/^# /m).slice(1).map(bloque => {
    const lineas = bloque.split("\n");
    const titulo = lineas[0].replace(/\s*\{sala:[^}]*\}\s*$/, "").trim();
    let tokens = "";
    let i = 1;
    if (/^tokens:/.test(lineas[1] ?? "")) { tokens = lineas[1].replace(/^tokens:\s*/, ""); i = 2; }
    const id = `${esc_}:${slug(titulo)}`;
    return `<div class="banda sala" id="sala-${esc_}-${slug(titulo)}"><div class="banda-cab"><h4>${esc(titulo)}</h4>${hecho(id)}</div><div class="banda-cuerpo">${tokensHtml(tokens)}${render(lineas.slice(i).join("\n"))}</div></div>`;
  });
  return `
  <article class="escena" id="escena-${esc_}">
    ${mapa ? `<figure class="escena-mapa"><button type="button" class="ampliar" data-ampliar="${esc(doc.meta.nombre)}"><img src="${mapa}" width="${(plano?.ancho ?? 80) * 30}" height="${(plano?.alto ?? 60) * 30}" alt="Mapa: ${esc(doc.meta.nombre)}" loading="lazy"><span class="lupa">Ampliar</span></button><figcaption><span>${esc(doc.meta.prefijo ?? "")}</span>${esc(doc.meta.nombre)}</figcaption></figure>` : `<h3>${esc(doc.meta.nombre)}</h3>`}
    <div class="cuerpo"><p class="intro-escena">${esc(doc.meta.intro ?? "")}</p>${plano?.nota ? `<p class="nota" data-label="La escena">${esc(plano.nota)}</p>` : ""}</div>
    ${salas.join("")}
  </article>`;
}).join("");
const escenas = `
<section class="pagina ancha" id="escenas">
  <h2>Las escenas, sala por sala</h2>
  <div class="cuerpo"><p>Cada escena de Foundry, con sus salas numeradas como los pines del mapa. «Qué hay» es lo que se ve; «Qué pasa» lo que puede ocurrir; «Para el Narrador», lo que solo vos sabés. Los tokens listados son los que la escena trae colocados. Tocá un mapa para verlo a tamaño completo.</p></div>
  <nav class="indice" aria-label="Escenas">${salasDocs.map(d => `<a href="#escena-${d.meta.escena}"><b>${esc(d.meta.prefijo ?? "")}</b>${esc(d.meta.nombre)}</a>`).join("")}</nav>
  ${escenasHtml}
</section>`;

/* --------------------------------------------------------- 7. Málaga */
const malagaDocs = archivosMd(path.join(RAIZ, "content/malaga")).map(f => ({ f, ...leerMd(f) })).sort(porOrden);
const malagaIntro = malagaDocs.find(d => d.meta.id === "malaga");
const lugares = malagaDocs.filter(d => d.meta.id !== "malaga");
const sectoresDocs = archivosMd(path.join(RAIZ, "content/sectores")).map(f => ({ f, ...leerMd(f) }));
const ordenSector = Object.fromEntries(SECTORES.map(s => [s.id, s.orden ?? 99]));
sectoresDocs.sort((a, b) => (ordenSector[a.meta.sector] ?? 99) - (ordenSector[b.meta.sector] ?? 99));
const conMapa = sectoresDocs.filter(d => existe(`assets/mapas/sectores/${d.meta.sector}.webp`));
const carrusel = `
<div class="carrusel" data-carrusel>
  <div class="carrusel-pista" tabindex="0" aria-label="Mapas de las manzanas; usá las flechas del teclado">
    ${conMapa.map((d, i) => `<figure class="diapo" data-i="${i}"><button type="button" class="ampliar" data-ampliar="${esc(d.meta.nombre)}"><img src="${A}/mapas/sectores/${d.meta.sector}.webp" width="4000" height="3000" alt="${esc(d.meta.nombre)}" loading="lazy"><span class="lupa">Ampliar</span></button><figcaption><a href="#sector-${d.meta.sector}">${esc(d.meta.nombre)}</a><span>${esc(d.meta.intro ?? "")}</span></figcaption></figure>`).join("")}
  </div>
  <div class="carrusel-mandos">
    <button type="button" data-anterior aria-label="Mapa anterior">◀</button>
    <span class="carrusel-pos" aria-live="polite">1 / ${conMapa.length}</span>
    <button type="button" data-siguiente aria-label="Mapa siguiente">▶</button>
  </div>
  <div class="carrusel-miniaturas" role="tablist" aria-label="Elegir mapa">
    ${conMapa.map((d, i) => `<button type="button" role="tab" data-ir="${i}" aria-label="${esc(d.meta.nombre)}"${i === 0 ? ' aria-selected="true"' : ""}><img src="${A}/mapas/sectores/${d.meta.sector}.webp" width="4000" height="3000" alt="" loading="lazy"></button>`).join("")}
  </div>
</div>`;
const sectoresHtml = sectoresDocs.map(d => {
  const lineas = sinH1(d.cuerpo).split("\n");
  let tokens = "", i = 0;
  while (i < lineas.length && !lineas[i].trim()) i++;
  if (/^tokens:/.test(lineas[i] ?? "")) { tokens = lineas[i].replace(/^tokens:\s*/, ""); i++; }
  const veh = VEHS.filter(v => v.sector === d.meta.sector);
  const id = `sector:${d.meta.sector}`;
  return `<div class="banda sala" id="sector-${d.meta.sector}"><div class="banda-cab"><h4>${esc(d.meta.nombre)}</h4>${hecho(id, "Visitada")}</div>
    <div class="banda-cuerpo"><p class="intro-escena">${esc(d.meta.intro ?? "")}</p>${tokensHtml(tokens)}
    ${veh.length ? `<p class="tokens"><span>Vehículos</span>${veh.map(v => `<a class="chip" href="#veh-${v.id}">${esc(v.nombre)}${v.oculto ? " · oculto" : ""}</a>`).join("")}</p>` : ""}
    ${render(lineas.slice(i).join("\n"))}</div></div>`;
}).join("");
const lugaresHtml = lugares.map(d => {
  const poi = POIS.find(p => p.id === d.meta.id);
  return `<div class="banda sala" id="lugar-${d.meta.id}"><div class="banda-cab"><h4>${esc(d.meta.nombre)}</h4>${poi?.direccion ? `<span class="direccion">${esc(poi.direccion)}${poi.ficticio ? " · ficticio" : ""}</span>` : ""}</div><div class="banda-cuerpo">${render(d.cuerpo.replace(/^## /gm, "##### "))}</div></div>`;
}).join("");
const vehiculosHtml = VEHS.length ? `<h3>Vehículos</h3><div class="vehiculos">${VEHS.map(v => `<div class="veh" id="veh-${v.id}">${existe(`assets/tokens/vehiculos/${v.id}.webp`) ? `<img src="${A}/tokens/vehiculos/${v.id}.webp" width="400" height="800" alt="" loading="lazy">` : ""}<div><h4>${esc(v.nombre)}</h4>${v.descripcion ?? ""}<p class="chica">Plazas ${v.plazas} · Estructura ${v.estructura} · Maniobra ${v.maniobra >= 0 ? "+" : ""}${v.maniobra ?? 0} · Blindaje ${v.blindaje ?? 0} · ${esc(v.velocidad ?? "normal")}${v.duenio ? ` · ${esc(v.duenio)}` : ""}</p>${v.notas ? `<div class="chica">${v.notas}</div>` : ""}</div></div>`).join("")}</div>` : "";
const malaga = `
<section class="pagina ancha" id="malaga">
  <h2>Málaga, el tablero de la Vigilia</h2>
  <div class="cuerpo">${malagaIntro ? render(sinH1(malagaIntro.cuerpo).replace(/^## /gm, "### ")) : ""}</div>
  <h3>Las manzanas</h3>
  ${carrusel}
  <h3>Manzana por manzana</h3>
  <nav class="indice" aria-label="Manzanas">${sectoresDocs.map(d => `<a href="#sector-${d.meta.sector}">${esc(d.meta.nombre.replace(/^Málaga · /, ""))}</a>`).join("")}</nav>
  ${sectoresHtml}
  <h3>Lugares</h3>
  <nav class="indice" aria-label="Lugares">${lugares.map(d => `<a href="#lugar-${d.meta.id}">${esc(d.meta.nombre)}</a>`).join("")}</nav>
  ${lugaresHtml}
  ${vehiculosHtml}
</section>`;

/* ------------------------------------------- 8. pantalla y reglas */
const pantalla = leerMd(path.join(RAIZ, "content/cronica/08-pantalla-del-narrador.md"));
const pantallaHtml = `
<section class="pagina" id="pantalla">
  <h2>Pantalla del Narrador</h2>
  <div class="cuerpo">${render(sinH1(pantalla.cuerpo).replace(/^## /gm, "### ").replace(/^### (.*)$/gm, (m, t) => `### ${t}`))}</div>
</section>`;
const reglasDocs = archivosMd(path.join(RAIZ, "content/reglas")).map(f => ({ f, ...leerMd(f) })).sort(porOrden);
const reglasHtml = `
<section class="pagina" id="reglas">
  <h2>Reglas caseras</h2>
  <div class="cuerpo"><p>Los tres caminos, los injertos, el Arsenal y las persecuciones, tal como están en los journals del módulo. Lo que el jugador puede leer está marcado en Foundry; acá está todo.</p></div>
  ${reglasDocs.map(d => `<details class="regla" id="regla-${d.meta.id}"><summary><h3>${esc(d.meta.nombre)}</h3></summary><div class="cuerpo">${render(sinH1(d.cuerpo).replace(/^## /gm, "### ").replace(/^### (.*)$/gm, "### $1"))}</div></details>`).join("")}
</section>`;

/* --------------------------------------------------------- 9. mesa */
const mesa = `
<aside class="mesa" id="mesa" role="dialog" aria-labelledby="mesa-titulo" hidden>
  <div class="mesa-cab"><h2 id="mesa-titulo">La mesa</h2><button type="button" data-cerrar-mesa aria-label="Cerrar">Cerrar</button></div>
  <div class="mesa-cuerpo">
    <div class="contador" data-contador="desesperacion"><span>Desesperación</span><button type="button" data-menos aria-label="Bajar">−</button><b>0</b><button type="button" data-mas aria-label="Subir">+</button></div>
    <div class="contador" data-contador="peligro"><span>Peligro</span><button type="button" data-menos aria-label="Bajar">−</button><b>0</b><button type="button" data-mas aria-label="Subir">+</button></div>
    <h3>Balizas</h3>
    ${PJS.map(pj => `<div class="balizas-pj"><span class="quien">${esc(pj.nombre)}</span>${["fe", "metodo", "carne"].map(b => `<div class="contador chico ${b}" data-contador="baliza:${pj.id}:${b}"><span>${ETIQ[b]}</span><button type="button" data-menos aria-label="Bajar">−</button><b>0</b><button type="button" data-mas aria-label="Subir">+</button></div>`).join("")}</div>`).join("")}
    <h3>Avance</h3>
    <p class="progreso" data-progreso="todo" aria-live="polite"></p>
    <h3>Notas de la sesión</h3>
    <label class="etiqueta-notas" for="notas-sesion">Lo que pasó, lo pendiente, a quién vieron</label><textarea id="notas-sesion" name="notas-sesion" data-notas="sesion" rows="8" autocomplete="off" placeholder="Ej.: la célula se llevó los cuadernos; Marcos vio al Guardia…"></textarea>
    <div class="mesa-acciones"><button type="button" data-exportar>Exportar</button><label class="boton">Importar<input type="file" accept="application/json" data-importar hidden></label><button type="button" data-reiniciar>Reiniciar</button></div>
  </div>
</aside>`;

/* --------------------------------------------------------------- HTML */
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Del Velo a la Vigilia — Guía del Narrador</title>
<meta name="description" content="La crónica Somnia Biotech para Cazador: La Venganza 5ª edición, completa y con seguimiento de la partida.">
<meta name="theme-color" content="#f7f7f7">
<!-- Sin preload de fuentes: con crossorigin falla desde file://, y sin él el navegador las carga dos veces. -->
<link rel="stylesheet" href="guia.css">
</head>
<body>
<a class="saltar" href="#vision">Saltar al contenido</a>
${cabecera}
<nav class="barra" aria-label="Navegación fija" data-barra>
  <a class="barra-logo" href="#inicio" aria-label="Volver a la portada">WoD</a>
  <div class="barra-links"><a href="#cronica">Crónica</a><a href="#cazadores">Credos</a><a href="#dramatis">Dramatis</a><a href="#escenas">Escenas</a><a href="#malaga">Málaga</a><a href="#pantalla">Pantalla</a><a href="#reglas">Reglas</a></div>
  <form class="buscar" role="search" data-buscar><label for="buscar" class="visualmente-oculto">Ir a una sala, un personaje o un lugar</label><input id="buscar" name="buscar" type="search" list="destinos" placeholder="Ir a… (sala, PNJ, lugar)" autocomplete="off" spellcheck="false"><datalist id="destinos"></datalist></form>
  <button class="t-accion" type="button" data-abrir-mesa>La mesa</button>
</nav>
<main id="contenido">
${intro}
${cazadores}
${dramatisHtml}
${cronica}
${escenas}
${malaga}
${pantallaHtml}
${reglasHtml}
</main>
<footer class="pie"><p>Del Velo a la Vigilia es un módulo para Hunter: The Reckoning 5ª edición sobre wod5e. Cazador: La Venganza es de Paradox Interactive y Nosolorol; esta guía usa su estilo, no su texto. Mapas de calle con datos de OpenStreetMap (ODbL). Fuentes Anton, Oswald e IBM Plex Sans (OFL).</p></footer>
${mesa}
<button type="button" class="arriba" data-arriba hidden aria-label="Volver arriba">▲</button>
<dialog class="visor" data-visor><div class="visor-cab"><span data-visor-titulo></span><button type="button" data-visor-cerrar>Cerrar</button></div><div class="visor-cuerpo"><img src="" alt=""></div></dialog>
<script src="guia.js"></script>
</body>
</html>
`;
/** Reduce la imagen (magick, cacheado por hash) y la devuelve como data URI. */
function dataUri(rel) {
  const abs = path.join(RAIZ, rel);
  const carpeta = Object.keys(ANCHO).sort((a, b) => b.length - a.length).find(k => rel.startsWith(`assets/${k}/`));
  const ancho = carpeta ? ANCHO[carpeta] : 1200;
  fs.mkdirSync(CACHE, { recursive: true });
  const clave = crypto.createHash("md5").update(`${rel}:${ancho}:${fs.statSync(abs).mtimeMs}`).digest("hex").slice(0, 12);
  const out = path.join(CACHE, `${path.basename(rel, path.extname(rel))}-${clave}.webp`);
  if (!fs.existsSync(out)) execFileSync("magick", [abs, "-resize", `${ancho}x${ancho}>`, "-quality", "78", "-define", "webp:method=4", out], { stdio: "pipe" });
  return `data:image/webp;base64,${fs.readFileSync(out).toString("base64")}`;
}
function embeber(html) {
  let css = fs.readFileSync(path.join(RAIZ, "guia/guia.css"), "utf8");
  css = css.replace(/url\(fonts\/([^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(RAIZ, "guia/fonts", f)).toString("base64")})`);
  const js = fs.readFileSync(path.join(RAIZ, "guia/guia.js"), "utf8");
  html = html.replace('<link rel="stylesheet" href="guia.css">', `<style>\n${css}\n</style>`);
  html = html.replace('<script src="guia.js"></script>', `<script>\n${js.replace(/<\/script/g, "<\\/script")}\n</script>`);
  const vistas = new Map();
  html = html.replace(/src="\.\.\/(assets\/[^"]+)"/g, (_, rel) => {
    if (!vistas.has(rel)) vistas.set(rel, dataUri(rel));
    return `src="${vistas.get(rel)}"`;
  });
  return html;
}
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, ENLAZADO ? html : embeber(html));
const kb = Math.round(fs.statSync(SALIDA).size / 1024);
console.log(`✓ guia/index.html (${kb} KB${ENLAZADO ? ", enlazado" : ", autocontenido"}): ${PJS.length} cazadores, ${PNJS.length} PNJs, ${ACTOS.length} partes, ${salasDocs.length} escenas, ${sectoresDocs.length} manzanas, ${lugares.length} lugares, ${reglasDocs.length} reglas`);
