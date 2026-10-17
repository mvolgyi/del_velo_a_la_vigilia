/* Guía del Narrador — seguimiento de la partida.
   Todo vive en localStorage ("dvv-guia"); se exporta e importa como JSON. */
(() => {
  const CLAVE = "dvv-guia";
  const LIMITES = { desesperacion: 5, peligro: 5 };
  let estado = { hecho: {}, contadores: {}, notas: {}, tab: null };
  try { estado = { ...estado, ...JSON.parse(localStorage.getItem(CLAVE) || "{}") }; } catch { /* sin almacenamiento: la página funciona igual */ }
  const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* privado */ } };

  /* ---- casillas «Hecho» ---- */
  const casillas = [...document.querySelectorAll("input[data-hecho]")];
  const pintarCasilla = c => {
    c.checked = !!estado.hecho[c.dataset.hecho];
    c.closest(".banda")?.classList.toggle("lista", c.checked);
  };
  for (const c of casillas) {
    pintarCasilla(c);
    c.addEventListener("change", () => { estado.hecho[c.dataset.hecho] = c.checked; if (!c.checked) delete estado.hecho[c.dataset.hecho]; pintarCasilla(c); guardar(); progreso(); });
  }
  function progreso() {
    const total = casillas.length, hechas = casillas.filter(c => c.checked).length;
    const cron = casillas.filter(c => c.closest("#cronica"));
    const cronHechas = cron.filter(c => c.checked).length;
    for (const p of document.querySelectorAll("[data-progreso]")) {
      if (p.dataset.progreso === "cronica") p.textContent = `${cronHechas} de ${cron.length} escenas`;
      else p.textContent = `${hechas} de ${total} escenas y salas marcadas (${total ? Math.round(hechas / total * 100) : 0} %)`;
    }
  }
  progreso();

  /* ---- contadores (Desesperación, Peligro, balizas) ---- */
  for (const c of document.querySelectorAll("[data-contador]")) {
    const id = c.dataset.contador, num = c.querySelector("b");
    const max = LIMITES[id] ?? 9;
    const pintar = () => { num.textContent = estado.contadores[id] ?? 0; };
    c.querySelector("[data-mas]").addEventListener("click", () => { estado.contadores[id] = Math.min(max, (estado.contadores[id] ?? 0) + 1); pintar(); guardar(); });
    c.querySelector("[data-menos]").addEventListener("click", () => { estado.contadores[id] = Math.max(0, (estado.contadores[id] ?? 0) - 1); pintar(); guardar(); });
    pintar();
  }

  /* ---- notas ---- */
  for (const t of document.querySelectorAll("textarea[data-notas]")) {
    t.value = estado.notas[t.dataset.notas] ?? "";
    t.addEventListener("input", () => { estado.notas[t.dataset.notas] = t.value; guardar(); });
  }

  /* ---- pestañas de la crónica ---- */
  const tabs = [...document.querySelectorAll(".tab")], paneles = [...document.querySelectorAll(".panel")];
  const activar = id => {
    for (const t of tabs) t.classList.toggle("activa", t.dataset.tab === id);
    for (const p of paneles) p.classList.toggle("activa", p.dataset.panel === id);
    estado.tab = id; guardar();
    if (location.hash.slice(1) !== id && paneles.some(p => p.dataset.panel === id)) history.replaceState(null, "", `#${id}`);
  };
  for (const t of tabs) t.addEventListener("click", () => activar(t.dataset.tab));
  if (estado.tab && tabs.some(t => t.dataset.tab === estado.tab)) activar(estado.tab);
  // Un enlace a una escena dentro de un acto no activo abre su pestaña.
  const abrirDestino = () => {
    const el = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    const panel = el?.closest(".panel");
    if (panel && !panel.classList.contains("activa")) { activar(panel.dataset.panel); el.scrollIntoView(); }
    const regla = el?.closest("details.regla");
    if (regla && !regla.open) { regla.open = true; el.scrollIntoView(); }
  };
  window.addEventListener("hashchange", abrirDestino);
  abrirDestino();

  /* ---- la mesa ---- */
  const mesa = document.getElementById("mesa");
  const abrir = () => { mesa.hidden = false; mesa.querySelector("button").focus(); };
  const cerrar = () => { mesa.hidden = true; };
  for (const b of document.querySelectorAll("[data-abrir-mesa]")) b.addEventListener("click", abrir);
  for (const b of document.querySelectorAll("[data-cerrar-mesa]")) b.addEventListener("click", cerrar);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !mesa.hidden) cerrar(); });

  document.querySelector("[data-exportar]")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ ...estado, exportado: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `del-velo-a-la-vigilia-partida-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
  });
  document.querySelector("[data-importar]")?.addEventListener("change", async e => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!confirm("Importar reemplaza el seguimiento guardado en este navegador. ¿Seguir?")) { e.target.value = ""; return; }
    try {
      const d = JSON.parse(await f.text());
      if (!d || typeof d !== "object") throw new Error();
      estado = { hecho: d.hecho ?? {}, contadores: d.contadores ?? {}, notas: d.notas ?? {}, tab: d.tab ?? null };
      guardar(); location.reload();
    } catch { alert("Ese archivo no es una partida exportada desde esta guía. Exportá una desde La mesa y volvé a intentarlo."); }
  });
  document.querySelector("[data-reiniciar]")?.addEventListener("click", () => {
    if (!confirm("¿Borrar el seguimiento (escenas hechas, contadores y notas)?")) return;
    estado = { hecho: {}, contadores: {}, notas: {}, tab: null }; guardar(); location.reload();
  });

  /* ---- barra fija: aparece al dejar atrás la portada ---- */
  const barra = document.querySelector("[data-barra]"), arriba = document.querySelector("[data-arriba]"), portada = document.getElementById("inicio");
  if (barra && portada && "IntersectionObserver" in window) {
    new IntersectionObserver(([en]) => { barra.classList.toggle("visible", !en.isIntersecting); if (arriba) arriba.hidden = en.isIntersecting; }, { threshold: 0.05 }).observe(portada);
  }
  arriba?.addEventListener("click", () => window.scrollTo({ top: 0 }));

  /* ---- buscador: ir a una sala, un PNJ, un lugar ---- */
  const lista = document.getElementById("destinos"), buscar = document.getElementById("buscar");
  const destinos = [];
  for (const el of document.querySelectorAll("main [id]")) {
    const t = el.querySelector(":scope > .banda-cab h3, :scope > .banda-cab h4, :scope > h3, :scope > h2, :scope > .pnj-cuerpo .capitular b, :scope > .escena-mapa figcaption");
    const nombre = (t?.textContent ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
    if (nombre && nombre.length < 90) destinos.push({ id: el.id, nombre });
  }
  if (lista) lista.innerHTML = destinos.map(d => `<option value="${d.nombre.replace(/"/g, "&quot;")}"></option>`).join("");
  const irA = texto => {
    const q = texto.trim().toLowerCase(); if (!q) return;
    const d = destinos.find(x => x.nombre.toLowerCase() === q) ?? destinos.find(x => x.nombre.toLowerCase().includes(q));
    if (!d) return;
    location.hash = d.id; abrirDestino();
    document.getElementById(d.id)?.scrollIntoView({ block: "start" });
  };
  buscar?.form?.addEventListener("submit", e => { e.preventDefault(); irA(buscar.value); });
  buscar?.addEventListener("change", () => irA(buscar.value));

  /* ---- carrusel de manzanas ---- */
  for (const c of document.querySelectorAll("[data-carrusel]")) {
    const pista = c.querySelector(".carrusel-pista"), diapos = [...pista.children], pos = c.querySelector(".carrusel-pos"), minis = [...c.querySelectorAll("[data-ir]")];
    let actual = 0;
    const pintar = () => { pos.textContent = `${actual + 1} / ${diapos.length}`; minis.forEach((m, i) => m.setAttribute("aria-selected", i === actual ? "true" : "false")); };
    const ir = (i, suave = true) => { actual = (i + diapos.length) % diapos.length; pista.scrollTo({ left: diapos[actual].offsetLeft, behavior: suave ? "smooth" : "instant" }); pintar(); };
    c.querySelector("[data-anterior]").addEventListener("click", () => ir(actual - 1));
    c.querySelector("[data-siguiente]").addEventListener("click", () => ir(actual + 1));
    minis.forEach((m, i) => m.addEventListener("click", () => ir(i)));
    pista.addEventListener("keydown", e => { if (e.key === "ArrowRight") { e.preventDefault(); ir(actual + 1); } if (e.key === "ArrowLeft") { e.preventDefault(); ir(actual - 1); } });
    // Si el usuario desliza con el dedo o la rueda, el contador sigue.
    let t; pista.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(() => { const i = Math.round(pista.scrollLeft / pista.clientWidth); if (i !== actual && i >= 0 && i < diapos.length) { actual = i; pintar(); } }, 80); }, { passive: true });
    pintar();
  }

  /* ---- visor de mapas ---- */
  const visor = document.querySelector("[data-visor]");
  if (visor) {
    const img = visor.querySelector("img"), titulo = visor.querySelector("[data-visor-titulo]"), cuerpo = visor.querySelector(".visor-cuerpo");
    for (const b of document.querySelectorAll("[data-ampliar]")) b.addEventListener("click", () => {
      const src = b.querySelector("img");
      img.src = src.currentSrc || src.src; img.alt = src.alt; titulo.textContent = b.dataset.ampliar;
      cuerpo.classList.add("encajar"); visor.showModal();
    });
    // Un toque alterna entre «encajar» y tamaño real (para leer los pines).
    cuerpo.addEventListener("click", e => { if (e.target === img) cuerpo.classList.toggle("encajar"); });
    visor.querySelector("[data-visor-cerrar]").addEventListener("click", () => visor.close());
    visor.addEventListener("click", e => { if (e.target === visor) visor.close(); });
  }

  /* ---- entradas por sección (una vez, en orden de lectura) ---- */
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    const partes = document.querySelectorAll("main h2, main h3, .cuerpo > p, .banda, .credo, .banda-foto, .st-a, .st-b, .st-c, .st-texto > div");
    partes.forEach(el => el.classList.add("entra"));
    const io = new IntersectionObserver(entradas => {
      for (const en of entradas) {
        if (!en.isIntersecting) continue;
        const hermanos = [...en.target.parentElement.children].filter(h => h.classList.contains("entra") && !h.classList.contains("visible"));
        const i = Math.max(0, hermanos.indexOf(en.target));
        en.target.style.transitionDelay = `${Math.min(i, 6) * 70}ms`;
        en.target.classList.add("visible");
        io.unobserve(en.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    partes.forEach(el => io.observe(el));
  }
})();
