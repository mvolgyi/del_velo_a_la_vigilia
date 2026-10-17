/**
 * Capturas de TODAS las escenas tal como las dibuja Foundry (luces, niebla,
 * tiles, tokens, pines, regiones), para revisarlas a ojo antes de una release.
 * Lo que compone ImageMagick no alcanza: no sabe cómo Foundry interpreta los
 * datos (el ancla de un tile, la iluminación, lo que tapa un pin).
 *
 * Requisitos: los de prueba.mjs (un Foundry con el mundo dvv-test en marcha):
 *
 *   cd ~/FoundryVTT/app/resources/app && node main.js --port=30099 --noupnp --world=dvv-test
 *   node tools/e2e/capturas-escenas.mjs [--solo <texto en el nombre>] [--jugador] [--sin-importar]
 *
 * Importa (o actualiza) la crónica, recorre cada escena, la encuadra entera
 * y guarda tools/e2e/capturas/escenas/<nombre>.png. Con --jugador la mira
 * como lo haría un jugador (con niebla y sin lo oculto): entra con el primer
 * usuario que no sea Narrador, que tiene que existir en el mundo.
 */
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const URL = process.env.DVV_FOUNDRY_URL ?? "http://localhost:30099";
const MOD = "del-velo-a-la-vigilia";
const argv = process.argv.slice(2);
const valor = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const solo = valor("--solo");
const jugador = argv.includes("--jugador");
const CAPTURAS = path.resolve(import.meta.dirname, "capturas/escenas");
fs.mkdirSync(CAPTURAS, { recursive: true });

function buscarChrome() {
  const base = path.join(os.homedir(), ".cache/ms-playwright");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort() : [];
  for (const d of dirs.reverse()) for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
    const p = path.join(base, d, rel);
    if (fs.existsSync(p)) return p;
  }
  throw new Error("No encontré Chromium de Playwright; definí DVV_CHROME o corré `npx playwright install chromium`.");
}

const browser = await chromium.launch({
  executablePath: process.env.DVV_CHROME ?? buscarChrome(),
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const errores = [];
page.on("pageerror", err => errores.push(err.message));
page.on("console", msg => { if (msg.type() === "error") errores.push(msg.text().slice(0, 300)); });

await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
await page.waitForSelector("select[name=userid]", { timeout: 60000 });
const opciones = await page.$$eval("select[name=userid] option:not([value=''])", os => os.map(o => ({ id: o.value, nombre: o.textContent.trim() })));
const usuario = jugador ? opciones.find(o => !/gamemaster|narrador|gm/i.test(o.nombre)) : opciones[0];
if (!usuario) throw new Error(`No hay usuario ${jugador ? "jugador" : ""} en el mundo: ${opciones.map(o => o.nombre).join(", ")}`);
await page.selectOption("select[name=userid]", usuario.id);
await page.click("button[name=join]");
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
console.log("· sesión:", await page.evaluate(() => `${game.user.name} (${game.user.isGM ? "Narrador" : "jugador"})`));

if (!argv.includes("--sin-importar")) {
  const esGM = await page.evaluate(() => game.user.isGM);
  if (esGM) {
    await page.evaluate(async MOD => { await game.modules.get(MOD).api.importarCronica({ silencioso: true }); }, MOD);
    console.log("· crónica importada");
  }
}

// Sin pausa (tapa el canvas) y sin UI alrededor del tablero.
await page.evaluate(() => { if (game.paused && game.user.isGM) game.togglePause(false); });
await page.addStyleTag({ content: "#ui-left, #ui-right, #ui-top, #ui-bottom, #navigation, #players, #hotbar, #sidebar, #pause, #notifications, #chat-notifications, #logo { visibility: hidden !important; }" });

const escenas = await page.evaluate(() => game.scenes.map(s => ({ id: s.id, nombre: s.name, w: s.width, h: s.height })).sort((a, b) => a.nombre.localeCompare(b.nombre)));
const lista = escenas.filter(e => !solo || e.nombre.toLowerCase().includes(solo.toLowerCase()));
console.log(`· ${lista.length} escena(s)`);

for (const e of lista) {
  process.stdout.write(`  ${e.nombre.padEnd(52)} … `);
  try {
    await page.evaluate(async id => {
      const s = game.scenes.get(id);
      await s.view();
      await new Promise(r => setTimeout(r, 300));
      // Encuadre: la escena entera dentro de la ventana.
      const { width: vw, height: vh } = canvas.app.renderer.screen;
      const escala = Math.min(vw / s.width, vh / s.height) * 0.98;
      await canvas.animatePan({ x: s.width / 2, y: s.height / 2, scale: escala, duration: 0 });
    }, e.id);
    await page.waitForFunction(id => canvas.ready && canvas.scene?.id === id && !canvas.loading, e.id, { timeout: 120000 });
    // Texturas y luces: un par de frames de margen.
    await page.waitForTimeout(1500);
    const nombre = e.nombre.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
    await page.screenshot({ path: path.join(CAPTURAS, `${nombre}${jugador ? ".jugador" : ""}.png`) });
    console.log("✓");
  } catch (err) {
    console.log(`✗ ${err.message.split("\n")[0]}`);
  }
}

if (errores.length) {
  console.log(`\n${errores.length} error(es) de consola:`);
  for (const m of [...new Set(errores)].slice(0, 15)) console.log("  ·", m);
}
await browser.close();
