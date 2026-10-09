import { DVV } from "./constantes.mjs";

/**
 * Los tres caminos: la capa de datos.
 *
 * La fuente única es content/caminos.json, la misma que usa el build para
 * generar las Facultades, reservas y mejoras. Acá se carga una vez y se
 * consulta: qué poder es cada Facultad `dvv-*`, qué camino otorgó la
 * cronista a cada actor, cuántos slots de carne usa un Modificado.
 */
export class Caminos {
  static #datos = null;

  static async cargar() {
    if (!this.#datos) {
      this.#datos = await foundry.utils.fetchJsonWithTimeout(DVV.ruta("content/caminos.json"));
    }
    return this.#datos;
  }

  /** @returns {Array} */
  static get lista() {
    return this.#datos?.caminos ?? [];
  }

  static camino(id) {
    return this.lista.find(c => c.id === id) ?? null;
  }

  static edgeId(camino, poder) {
    return `${DVV.PREFIJO_EDGE}${camino.prefijo}-${poder.id}`;
  }

  /** Pasiva primero, después los poderes comprables. */
  static poderes(camino) {
    return [camino.pasiva, ...camino.poderes].filter(Boolean);
  }

  /** @returns {{camino, poder}|null} */
  static porEdge(edgeId) {
    for (const camino of this.lista) {
      for (const poder of this.poderes(camino)) {
        if (this.edgeId(camino, poder) === edgeId) return { camino, poder };
      }
    }
    return null;
  }

  static etiquetaCamino(camino) {
    return game.i18n.localize(`DVV.caminos.${camino.id}`);
  }

  /* -------------------------------------------- */
  /*  Estado en el actor                          */
  /* -------------------------------------------- */

  /** { imbuido: { fecha, rama }, ... } */
  static deActor(actor) {
    return foundry.utils.deepClone(actor.getFlag(DVV.ID, DVV.FLAGS.CAMINOS) ?? {});
  }

  static tiene(actor, caminoId) {
    return caminoId in this.deActor(actor);
  }

  /** Facultades de este módulo visibles en la hoja. */
  static visibles(actor) {
    const edges = actor.system?.edges ?? {};
    return Object.entries(edges)
      .filter(([id, e]) => id.startsWith(DVV.PREFIJO_EDGE) && e?.visible)
      .map(([id]) => ({ id, ...this.porEdge(id) }))
      .filter(e => e.poder);
  }

  static tienePoder(actor, edgeId) {
    return !!actor.system?.edges?.[edgeId]?.visible;
  }

  /** Modificaciones que cuentan contra el límite de Resistencia (la pasiva no cuenta; Gen II cuenta doble). */
  static slotsUsados(actor) {
    return this.visibles(actor)
      .filter(e => ["modificado", "gen2"].includes(e.camino.id) && !e.poder.gratis)
      .reduce((n, e) => n + (e.poder.slots ?? 1), 0);
  }

  static limiteCarne(actor) {
    return actor.system?.attributes?.stamina?.value ?? 1;
  }

  /** Mejoras (ítems perk) que el actor ya tiene de un poder. */
  static mejorasDe(actor, edgeId) {
    return actor.items.filter(i => i.type === "perk" && i.system.edge === edgeId);
  }

  /* -------------------------------------------- */
  /*  Coste                                       */
  /* -------------------------------------------- */

  /**
   * @returns {{puntos:number, px:number, fueraDeRama:boolean}}
   */
  static coste(actor, camino, poder) {
    const otorgado = this.deActor(actor)[camino.id];
    const fueraDeRama = !!(poder.rama && otorgado?.rama && otorgado.rama !== poder.rama);
    const extraP = fueraDeRama ? (camino.coste.fueraDeRamaPuntos ?? 0) : 0;
    const extraX = fueraDeRama ? (camino.coste.fueraDeRamaPx ?? 0) : 0;
    return { puntos: camino.coste.puntos + extraP, px: camino.coste.px + extraX, fueraDeRama };
  }

  /* -------------------------------------------- */
  /*  Texto                                       */
  /* -------------------------------------------- */

  /** Descripción que va a la hoja del cazador cuando se otorga la Facultad. */
  static descripcion(camino, poder) {
    const partes = [];
    if (poder.nombreOriginal || poder.emula) {
      partes.push(`<p><em>${poder.nombreOriginal ?? ""}${poder.emula ? ` · emula ${poder.emula}` : ""}</em></p>`);
    }
    partes.push(poder.intro ?? "");
    partes.push(`<p><strong>Sistema.</strong></p>${poder.sistema ?? ""}`);
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
}
