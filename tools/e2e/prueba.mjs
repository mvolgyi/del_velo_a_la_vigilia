/**
 * Prueba end-to-end del módulo contra un Foundry local.
 *
 * Requisitos: wod5e instalado, un mundo con id `dvv-test`, el módulo enlazado
 * en Data/modules, y el servidor corriendo con el mundo abierto:
 *
 *   cd ~/FoundryVTT/app/resources/app && node main.js --port=30099 --noupnp --world=dvv-test
 *
 * Después: npm run e2e   (usa playwright-core y el Chromium de ~/.cache/ms-playwright)
 *
 * Qué prueba: que el módulo cargue sin errores, las 37 Facultades estén
 * registradas, los compendios tengan documentos, otorgar/comprar caminos,
 * quemar la Chispa, balizas, registro de Peligro, equipar set, el recordatorio
 * tras un 1 en Desesperación, el panel, la hoja y los journals.
 */
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const URL = process.env.DVV_FOUNDRY_URL ?? "http://localhost:30099";

/** El Chromium que Playwright deja en ~/.cache/ms-playwright, el más nuevo. */
function buscarChrome() {
  const base = path.join(os.homedir(), ".cache/ms-playwright");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort() : [];
  for (const d of dirs.reverse()) {
    for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error("No encontré Chromium de Playwright; definí DVV_CHROME o corré `npx playwright install chromium`.");
}
const MOD = "del-velo-a-la-vigilia";
const CAPTURAS = path.resolve(import.meta.dirname, "capturas");
fs.mkdirSync(CAPTURAS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.DVV_CHROME ?? buscarChrome(),
  headless: true,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"]
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errores = [];
page.on("console", msg => {
  const t = msg.text();
  if (msg.type() === "error" || /DVV-PASO|del-velo-a-la-vigilia \|/i.test(t)) console.log(`[${msg.type()}] ${t.slice(0, 400)}`);
  if (msg.type() === "error") { const l = msg.location(); errores.push(`${t} @ ${l.url?.split("/").slice(-2).join("/")}:${l.lineNumber}`); }
});
page.on("pageerror", err => { console.log(`[pageerror] ${err.message}\n${(err.stack ?? "").split("\n").slice(1, 5).join("\n")}`); errores.push(err.message); });

async function entrar() {
  await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
  // Si el mundo no está lanzado, lo lanzamos desde /setup... pero arrancamos con --world, así que /join existe.
  await page.waitForSelector("select[name=userid]", { timeout: 60000 });
  const valor = await page.$eval("select[name=userid] option:not([value=''])", o => o.value);
  await page.selectOption("select[name=userid]", valor);
  await page.click("button[name=join]");
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
  console.log("· sesión iniciada como", await page.evaluate(() => game.user.name));
}

await entrar();
await page.evaluate(() => { const o = console.error; console.error = (...a) => o(...a, "\nSTACK:", new Error().stack.split("\n").slice(1, 6).join(" | ")); });

// Activar el módulo si hace falta.
const activo = await page.evaluate(id => game.modules.get(id)?.active ?? null, MOD);
console.log("· módulo activo:", activo);
if (activo === false) {
  await page.evaluate(async id => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    cfg[id] = true;
    await game.settings.set("core", "moduleConfiguration", cfg);
  }, MOD);
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
  console.log("· módulo activado y mundo recargado:", await page.evaluate(id => game.modules.get(id)?.active, MOD));
}
if (process.argv.includes("--solo-login")) { await browser.close(); process.exit(0); }

await page.waitForFunction(id => !!game.modules.get(id)?.api && game.modules.get(id).api.Caminos.lista.length > 0, MOD, { timeout: 30000 });
const r = await page.evaluate(async MOD => {
  const out = {};
  const api = game.modules.get(MOD).api;
  out.api = Object.keys(api ?? {});
  out.edgesCustom = Object.keys(WOD5E.Edges.getList({})).filter(k => k.startsWith("dvv-")).length;
  out.labelHendir = WOD5E.Edges.getList({})["dvv-imb-hendir"]?.displayName;
  out.packs = Object.fromEntries(await Promise.all(game.packs.filter(p => p.metadata.packageName === MOD).map(async p => [p.metadata.name, (await p.getIndex()).size])));

  // Célula + cazador de prueba.
  let celula = game.actors.getName("Célula de prueba");
  if (!celula) celula = await Actor.create({ name: "Célula de prueba", type: "group", system: { groupType: "cell", desperation: { value: 3 } } });
  else await celula.update({ "system.desperation.value": 3, "system.members": [] });
  for (const viejo of game.actors.filter(a => a.name === "Cazador de prueba")) await viejo.delete();
  const cazador = await Actor.create({ name: "Cazador de prueba", type: "hunter", system: { attributes: { stamina: { value: 3 }, strength: { value: 3 }, resolve: { value: 2 }, composure: { value: 2 } }, skills: { melee: { value: 2 }, occult: { value: 1 } } } });
  await celula.update({ "system.members": [cazador.uuid] });
  await cazador.update({ "system.group": celula.id });
  out.desperacionCazador = cazador.system.desperation?.value;

  console.log("DVV-PASO otorgar");
  // Las Tres Puertas.
  await api.otorgarCamino(cazador, { caminoId: "imbuido", ramaId: "celo" });
  out.caminos = cazador.getFlag(MOD, "caminos");
  out.segundaVistaVisible = cazador.system.edges["dvv-imb-segunda-vista"]?.visible;
  out.segundaVistaDesc = (cazador.system.edges["dvv-imb-segunda-vista"]?.description ?? "").slice(0, 80);
  out.itemsTrasOtorgar = cazador.items.map(i => `${i.type}:${i.name}`);

  console.log("DVV-PASO comprar");
  await api.comprarPoder(cazador, { edgeId: "dvv-imb-hendir", mejoras: ["filo-paciente"] });
  out.hendirVisible = cazador.system.edges["dvv-imb-hendir"]?.visible;
  out.hendirPerks = cazador.system.edges["dvv-imb-hendir"]?.perks?.map(p => p.name);
  out.hendirPools = cazador.system.edges["dvv-imb-hendir"]?.pools?.map(p => p.name);

  console.log("DVV-PASO modificado");
  await api.otorgarCamino(cazador, { caminoId: "modificado", ramaId: "refuerzo" });
  await api.comprarPoder(cazador, { edgeId: "dvv-gen2-malla-subdermica", mejoras: [], forzar: true });
  out.slots = `${api.Caminos.slotsUsados(cazador)}/${api.Caminos.limiteCarne(cazador)}`;

  console.log("DVV-PASO quemar");
  // Quemar y balizas.
  out.quemar = await api.quemar(cazador, { gasto: "Quemar la Chispa", motivo: "Filo Paciente (prueba)" });
  out.desperacionCelula = celula.system.desperation.value;
  await api.Balizas.ajustar(cazador, "fe", 2, "prueba");
  await api.Balizas.ajustar(cazador, "carne", 1, "prueba");
  out.balizas = api.Balizas.de(cazador);
  out.dominante = api.Balizas.dominante(cazador);
  await api.registrarPeligro(cazador, "Usó Hendir frente a Marcos (prueba)");
  out.registro = api.Desesperacion.registro.length;

  console.log("DVV-PASO arsenal");
  // Arsenal.
  await api.equiparSet(cazador, "profesional");
  out.armas = cazador.items.filter(i => i.type === "weapon").map(i => i.name);

  console.log("DVV-PASO tirada");
  // Tirada con dados de Desesperación hasta que salga un 1 (máx. 15 intentos).
  const antes = game.messages.size;
  for (let i = 0; i < 15; i++) {
    await WOD5E.api.Roll({ actor: cazador, data: cazador.system, basicDice: 4, advancedDice: 3, title: "Hendir — Fuerza + Cuerpo a cuerpo", quickRoll: true, difficulty: 2 });
    await new Promise(r => setTimeout(r, 300));
    if (game.messages.contents.slice(antes).some(m => m.content.includes("data-dvv-accion"))) break;
  }
  const recordatorio = game.messages.contents.slice(antes).find(m => m.content.includes("data-dvv-accion"));
  out.recordatorio = recordatorio ? recordatorio.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300) : null;

  console.log("DVV-PASO panel");
  // Panel y hojas.
  api.abrirPanel();
  await new Promise(r => setTimeout(r, 800));
  out.panelAbierto = !!document.querySelector("#dvv-panel-cronica");
  cazador.sheet.render(true);
  await new Promise(r => setTimeout(r, 1500));
  out.hojaAbierta = !!cazador.sheet.rendered;
  const journal = await game.packs.get(`${MOD}.reglas`).getDocuments().then(d => d.find(j => j.name.includes("Marca")));
  out.journalPaginas = journal?.pages.size;
  out.journalEnlaces = journal?.pages.contents.map(p => (p.text.content.match(/@UUID\[/g) ?? []).length);
  const cronica = await game.packs.get(`${MOD}.cronica`).getDocuments().then(d => d.find(j => j.name.includes("Acto 1")));
  out.acto1Botones = { tiradas: (cronica?.pages.contents.map(p => p.text.content).join("").match(/data-dvv-tirada/g) ?? []).length, balizas: (cronica?.pages.contents.map(p => p.text.content).join("").match(/data-dvv-baliza/g) ?? []).length };
  const pnj = await game.packs.get(`${MOD}.personajes`).getDocuments().then(d => d.find(a => a.name === "Marcos"));
  out.marcos = { tipo: pnj?.type, spcType: pnj?.system.spcType, gamesystem: pnj?.system.gamesystem, fisico: pnj?.system.standarddicepools?.physical?.value, salud: pnj?.system.health?.max };
  const pj = await game.packs.get(`${MOD}.personajes`).getDocuments().then(d => d.find(a => a.name === "El Guardia"));
  out.guardia = { tipo: pj?.type, fuerza: pj?.system.attributes?.strength?.value, items: pj?.items.map(i => `${i.type}:${i.name}`) };
  return out;
}, MOD);
console.log(JSON.stringify(r, null, 2));

await page.screenshot({ path: path.join(CAPTURAS, "panel.png") });
// Pestaña de Facultades de la hoja del cazador.
await page.evaluate(() => {
  const tab = document.querySelector(".wod5e.hunter [data-tab='edges'], .wod5e [data-action='tab'][data-tab='edges'], .wod5e a[data-tab='edges']");
  tab?.click();
});
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(CAPTURAS, "hoja.png") });

console.log(`\n${errores.length} error(es) de consola`);
for (const e of errores.slice(0, 15)) console.log("  -", e.slice(0, 300));
await browser.close();
