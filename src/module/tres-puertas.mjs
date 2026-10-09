import { DVV } from "./constantes.mjs";
import { Caminos } from "./caminos.mjs";
import { cazadorActual, documentosDelPack, publicar } from "./actores.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Las Tres Puertas.
 *
 * Otorgar un camino (el Imbuimiento, el Avance, la Operación) y comprar
 * poderes y mejoras. Todo lo que el jugador tendría que hacer a mano en la
 * hoja (agregar la Facultad, pegarle la descripción, arrastrar la reserva
 * desde el compendio, anotar el Defecto) pasa en un diálogo, y queda
 * registrado en el chat con el coste.
 */
export class TresPuertas {
  /* -------------------------------------------- */
  /*  Otorgar un camino                           */
  /* -------------------------------------------- */

  static async otorgar(actor = null, { caminoId = null, ramaId = null } = {}) {
    if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));
    await Caminos.cargar();
    actor ??= await cazadorActual();
    if (!actor) return;

    let camino = caminoId ? Caminos.camino(caminoId) : null;
    if (!camino) {
      const opciones = Caminos.lista
        .filter(c => c.pasiva)
        .map(c => `<option value="${c.id}"${Caminos.tiene(actor, c.id) ? " disabled" : ""}>${c.nombre} — ${c.subtitulo}</option>`)
        .join("");
      const r = await DialogV2.input({
        window: { title: game.i18n.localize("DVV.tresPuertas.titulo") },
        classes: ["dvv-dialogo"],
        content: `<p><strong>${actor.name}</strong></p>
          <div class="form-group"><label>${game.i18n.localize("DVV.tresPuertas.elegirCamino")}</label><select name="camino">${opciones}</select></div>`,
        ok: { label: game.i18n.localize("DVV.confirmar") }
      });
      if (!r) return;
      camino = Caminos.camino(r.camino);
    }
    if (!camino) return;
    if (Caminos.tiene(actor, camino.id)) {
      return ui.notifications.warn(game.i18n.format("DVV.tresPuertas.yaTiene", { actor: actor.name }));
    }

    let rama = ramaId ? camino.ramas.find(x => x.id === ramaId) : null;
    if (!rama && camino.ramas?.length) {
      const opciones = camino.ramas.map(x => `<option value="${x.id}">${x.nombre}</option>`).join("");
      const r = await DialogV2.input({
        window: { title: `${camino.nombre} — ${camino.ramasNombre}` },
        classes: ["dvv-dialogo"],
        content: `${camino.notasRamas ?? ""}<div class="form-group"><label>${camino.ramasNombre}</label><select name="rama">${opciones}</select></div>`,
        ok: { label: game.i18n.localize("DVV.confirmar") }
      });
      if (!r) return;
      rama = camino.ramas.find(x => x.id === r.rama);
    }

    // 1. La pasiva gratis, con su descripción y su reserva.
    const pasiva = camino.pasiva;
    const eid = Caminos.edgeId(camino, pasiva);
    await this.#darFacultad(actor, camino, pasiva);

    // 2. El Defecto de 1 punto.
    const defectos = await documentosDelPack(DVV.PACKS.RASGOS, f => f.camino === camino.id);
    if (defectos.length && !actor.items.some(i => i.name === defectos[0].name)) {
      await actor.createEmbeddedDocuments("Item", defectos.map(d => d.toObject()));
    }

    // 3. Registro en el actor y en el chat.
    const caminos = Caminos.deActor(actor);
    caminos[camino.id] = { fecha: new Date().toISOString(), rama: rama?.id ?? "" };
    await actor.setFlag(DVV.ID, DVV.FLAGS.CAMINOS, caminos);

    await publicar(`
      <p>${game.i18n.format("DVV.tresPuertas.otorgado", {
        actor: actor.name, camino: camino.nombre, rama: rama?.nombre ?? camino.subtitulo,
        pasiva: pasiva.nombre, defecto: defectos[0]?.name ?? camino.defecto?.nombre ?? "—"
      })}</p>
      ${camino.origen?.texto ? `<details><summary>${camino.origen.nombre}</summary>${camino.origen.texto}</details>` : ""}`,
      { actor });
    Hooks.callAll("dvvCaminos", { actor, camino, rama, edgeId: eid });
    return { camino, rama };
  }

  /* -------------------------------------------- */
  /*  Comprar un poder                            */
  /* -------------------------------------------- */

  static async comprar(actor = null, { edgeId = null, mejoras = null, forzar = false } = {}) {
    await Caminos.cargar();
    actor ??= await cazadorActual();
    if (!actor) return;
    if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));

    const otorgados = Caminos.deActor(actor);
    let seleccion = edgeId ? Caminos.porEdge(edgeId) : null;

    if (!seleccion) {
      const caminos = Caminos.lista.filter(c => otorgados[c.id] || (c.id === "gen2" && otorgados.modificado));
      if (!caminos.length) {
        return ui.notifications.warn(game.i18n.format("DVV.tresPuertas.sinCaminos", { actor: actor.name }));
      }
      const grupos = caminos.map(c => {
        const opciones = c.poderes.map(p => {
          const id = Caminos.edgeId(c, p);
          const { puntos, px, fueraDeRama } = Caminos.coste(actor, c, p);
          const ramaNombre = c.ramas.find(x => x.id === p.rama)?.nombre;
          const tiene = Caminos.tienePoder(actor, id);
          return `<option value="${id}"${tiene ? " disabled" : ""}>${p.nombre}${ramaNombre ? ` (${ramaNombre})` : ""} — ${puntos} pts / ${px} PX${fueraDeRama ? " ★" : ""}${tiene ? " ✓" : ""}</option>`;
        }).join("");
        return `<optgroup label="${c.nombre}">${opciones}</optgroup>`;
      }).join("");
      const r = await DialogV2.input({
        window: { title: game.i18n.localize("DVV.tresPuertas.comprarTitulo") },
        classes: ["dvv-dialogo"],
        content: `<p><strong>${actor.name}</strong> · ${this.#textoSlots(actor)}</p>
          <div class="form-group"><label>${game.i18n.localize("DVV.tresPuertas.poder")}</label><select name="poder">${grupos}</select></div>
          <p class="hint">★ = fuera de su ${caminos[0].ramasNombre || "rama"} (cuesta más)</p>`,
        ok: { label: game.i18n.localize("DVV.confirmar") }
      });
      if (!r) return;
      seleccion = Caminos.porEdge(r.poder);
    }
    if (!seleccion) return;
    const { camino, poder } = seleccion;
    const id = Caminos.edgeId(camino, poder);

    if (Caminos.tienePoder(actor, id)) {
      return ui.notifications.warn(game.i18n.format("DVV.tresPuertas.yaTienePoder", { actor: actor.name, poder: poder.nombre }));
    }
    if (camino.id === "gen2" && !otorgados.modificado && !forzar) {
      return ui.notifications.warn(game.i18n.localize("DVV.tresPuertas.requiereModificado"));
    }

    // Límite de carne.
    if (["modificado", "gen2"].includes(camino.id) && !poder.gratis) {
      const usados = Caminos.slotsUsados(actor) + (poder.slots ?? 1);
      const limite = Caminos.limiteCarne(actor);
      if (usados > limite && !forzar) {
        const ok = await DialogV2.confirm({
          window: { title: poder.nombre },
          content: `<p>${game.i18n.format("DVV.tresPuertas.slotsExcedidos", { limite })}</p>`
        });
        if (!ok) return;
      }
    }

    // Mejoras que compra ahora.
    if (mejoras === null && poder.mejoras?.length) {
      const casillas = poder.mejoras.map(m => `
        <div class="form-group"><label><input type="checkbox" name="mejora.${m.id}"> ${m.nombre}${m.gasto ? ` (${camino.gasto?.nombre ?? ""})` : ""}</label></div>`).join("");
      const r = await DialogV2.input({
        window: { title: poder.nombre },
        classes: ["dvv-dialogo"],
        content: `${poder.intro ?? ""}<fieldset><legend>${game.i18n.localize("DVV.tresPuertas.mejorasAhora")}</legend>${casillas}</fieldset>`,
        ok: { label: game.i18n.localize("DVV.confirmar") }
      });
      if (!r) return;
      mejoras = poder.mejoras.filter(m => r[`mejora.${m.id}`]).map(m => m.id);
    }

    await this.#darFacultad(actor, camino, poder, mejoras ?? []);

    const coste = Caminos.coste(actor, camino, poder);
    const ramaNombre = camino.ramas.find(x => x.id === poder.rama)?.nombre;
    await publicar(`<p>${game.i18n.format("DVV.tresPuertas.comprado", {
      actor: actor.name, poder: poder.nombre, camino: camino.nombre, rama: ramaNombre ? `, ${ramaNombre}` : "",
      coste: game.i18n.format("DVV.tresPuertas.costePuntos", coste) + (coste.fueraDeRama ? ` (${game.i18n.format("DVV.tresPuertas.fueraDeRama", { ramasNombre: camino.ramasNombre, puntos: coste.puntos, px: coste.px })})` : "")
    })}</p>${["modificado", "gen2"].includes(camino.id) ? `<p>${this.#textoSlots(actor, poder.gratis ? 0 : poder.slots ?? 1)}</p>` : ""}`, { actor });
    Hooks.callAll("dvvCaminos", { actor, camino, poder, edgeId: id });
  }

  /* -------------------------------------------- */
  /*  Comprar una mejora                          */
  /* -------------------------------------------- */

  static async comprarMejora(actor = null) {
    await Caminos.cargar();
    actor ??= await cazadorActual();
    if (!actor) return;
    if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.soloNarrador"));

    const visibles = Caminos.visibles(actor);
    const opciones = visibles.flatMap(({ id, camino, poder }) => {
      const tiene = new Set(Caminos.mejorasDe(actor, id).map(i => i.getFlag(DVV.ID, "mejora")));
      return (poder.mejoras ?? [])
        .filter(m => !tiene.has(m.id))
        .map(m => `<option value="${id}|${m.id}">${poder.nombre} → ${m.nombre}${m.gasto ? ` (${camino.gasto?.nombre ?? ""})` : ""}</option>`);
    }).join("");
    if (!opciones) return ui.notifications.info(game.i18n.format("DVV.tresPuertas.sinCaminos", { actor: actor.name }));

    const r = await DialogV2.input({
      window: { title: game.i18n.localize("DVV.tresPuertas.mejoraTitulo") },
      classes: ["dvv-dialogo"],
      content: `<p><strong>${actor.name}</strong></p><div class="form-group"><select name="mejora">${opciones}</select></div>`,
      ok: { label: game.i18n.localize("DVV.confirmar") }
    });
    if (!r) return;
    const [edgeId, mejoraId] = r.mejora.split("|");
    const { poder } = Caminos.porEdge(edgeId) ?? {};
    const docs = await documentosDelPack(DVV.PACKS.MEJORAS, f => f.poder === edgeId && f.mejora === mejoraId);
    if (!docs.length) return;
    await actor.createEmbeddedDocuments("Item", docs.map(d => d.toObject()));
    await publicar(game.i18n.format("DVV.tresPuertas.mejoraComprada", { actor: actor.name, mejora: docs[0].name, poder: poder?.nombre ?? "" }), { actor });
  }

  /* -------------------------------------------- */

  /** Hace visible la Facultad, le pega la descripción y crea reserva(s) y mejoras desde los compendios. */
  static async #darFacultad(actor, camino, poder, mejoras = []) {
    const eid = Caminos.edgeId(camino, poder);
    await actor.update({
      [`system.edges.${eid}.visible`]: true,
      [`system.edges.${eid}.description`]: Caminos.descripcion(camino, poder)
    });

    const nuevos = [];
    const reservas = await documentosDelPack(DVV.PACKS.RESERVAS, f => f.poder === eid);
    for (const r of reservas) {
      if (!actor.items.some(i => i.type === "edgepool" && i.name === r.name)) nuevos.push(r.toObject());
    }
    if (mejoras.length) {
      const docs = await documentosDelPack(DVV.PACKS.MEJORAS, f => f.poder === eid && mejoras.includes(f.mejora));
      nuevos.push(...docs.map(d => d.toObject()));
    }
    if (nuevos.length) await actor.createEmbeddedDocuments("Item", nuevos);
  }

  static #textoSlots(actor, extra = 0) {
    return game.i18n.format("DVV.tresPuertas.slots", {
      usados: Caminos.slotsUsados(actor) + extra,
      limite: Caminos.limiteCarne(actor),
      resistencia: Caminos.limiteCarne(actor)
    });
  }

  /**
   * Si alguien arrastra una reserva o mejora `dvv-*` desde el compendio a la
   * hoja, la Facultad aparece sola (wod5e la hace visible al ver un perk)
   * pero sin descripción. Se la ponemos.
   */
  static async onCreateItem(item) {
    const actor = item.parent;
    if (!actor || actor.documentName !== "Actor" || !["perk", "edgepool"].includes(item.type)) return;
    const eid = item.system.edge;
    if (!eid?.startsWith(DVV.PREFIJO_EDGE)) return;
    if (!actor.isOwner || actor.system.edges?.[eid]?.description) return;
    await Caminos.cargar();
    const sel = Caminos.porEdge(eid);
    if (!sel) return;
    await actor.update({
      [`system.edges.${eid}.visible`]: true,
      [`system.edges.${eid}.description`]: Caminos.descripcion(sel.camino, sel.poder)
    });
  }
}
