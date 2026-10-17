import { DVV } from "./constantes.mjs";
import { publicar } from "./actores.mjs";

/**
 * Vehículos: subir, bajar y viajar.
 *
 * Foundry no tiene «montar un token». Acá un vehículo es un actor con el flag
 * `vehiculo` ({ plazas, estructura, … }). Sus pasajeros viven en un flag del
 * TOKEN del vehículo: al subir, el token del pasajero se borra de la escena y
 * queda anotado dentro; al bajar, se vuelve a crear al lado del coche. Como
 * el teletransporte de regiones copia el token con sus flags, los pasajeros
 * viajan con el coche entre la ciudad, los sectores y los interiores.
 *
 * Tamaño por escena: en el mapa general (2 m/px) el coche se achica a un
 * marcador; en calles e interiores (1 m por casilla) mide 2×4 casillas.
 */
export class Vehiculos {
  static FLAG_PASAJEROS = "pasajeros";

  static datos(doc) {
    const actor = doc?.actor ?? doc;
    return actor?.getFlag?.(DVV.ID, "vehiculo") ?? null;
  }

  static esVehiculo(tokenDoc) {
    return !!this.datos(tokenDoc);
  }

  static pasajeros(tokenDoc) {
    return foundry.utils.deepClone(tokenDoc.getFlag(DVV.ID, this.FLAG_PASAJEROS) ?? []);
  }

  static plazas(tokenDoc) {
    return this.datos(tokenDoc)?.plazas ?? 4;
  }

  /* -------------------------------------------- */

  /** Tokens controlados por el usuario que no sean vehículos y estén a ≤ `radio` m del coche. */
  static candidatos(vehiculo, radio = 4) {
    const escena = vehiculo.parent;
    const centro = vehiculo.object?.center ?? { x: vehiculo.x + vehiculo.width * escena.grid.size / 2, y: vehiculo.y + vehiculo.height * escena.grid.size / 2 };
    const metrosPorPx = (escena.grid.distance || 1) / (escena.grid.size || 100);
    const controlados = canvas.tokens.controlled.map(t => t.document).filter(t => t.id !== vehiculo.id && !this.esVehiculo(t));
    const lista = controlados.length ? controlados : escena.tokens.filter(t => t.id !== vehiculo.id && !this.esVehiculo(t) && t.isOwner);
    return lista.filter(t => {
      const c = t.object?.center ?? { x: t.x + escena.grid.size / 2, y: t.y + escena.grid.size / 2 };
      const d = Math.hypot(c.x - centro.x, c.y - centro.y) * metrosPorPx;
      return controlados.length ? true : d <= radio;
    });
  }

  static async subir(vehiculo, tokens = null) {
    if (!vehiculo?.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.vehiculos.sinPermiso"));
    tokens ??= this.candidatos(vehiculo);
    if (!tokens.length) return ui.notifications.info(game.i18n.localize("DVV.vehiculos.nadieCerca"));
    const pasajeros = this.pasajeros(vehiculo);
    const plazas = this.plazas(vehiculo);
    const libres = plazas - pasajeros.length;
    if (libres <= 0) return ui.notifications.warn(game.i18n.format("DVV.vehiculos.lleno", { vehiculo: vehiculo.name, plazas }));
    const suben = tokens.slice(0, libres);
    for (const t of suben) {
      pasajeros.push({ actorId: t.actorId, nombre: t.name, img: t.texture.src, tokenData: t.toObject() });
    }
    await vehiculo.parent.deleteEmbeddedDocuments("Token", suben.map(t => t.id));
    await vehiculo.update({ [`flags.${DVV.ID}.${this.FLAG_PASAJEROS}`]: pasajeros, name: this.nombreCon(vehiculo, pasajeros.length) });
    await publicar(game.i18n.format("DVV.vehiculos.subieron", { quienes: suben.map(t => t.name).join(", "), vehiculo: this.nombreBase(vehiculo), n: pasajeros.length, plazas }));
    if (tokens.length > libres) ui.notifications.warn(game.i18n.format("DVV.vehiculos.quedaronAfuera", { n: tokens.length - libres }));
    Hooks.callAll("dvvVehiculo", { vehiculo, pasajeros });
  }

  static async bajar(vehiculo, actorIds = null) {
    if (!vehiculo?.isOwner) return ui.notifications.warn(game.i18n.localize("DVV.vehiculos.sinPermiso"));
    const pasajeros = this.pasajeros(vehiculo);
    if (!pasajeros.length) return ui.notifications.info(game.i18n.localize("DVV.vehiculos.vacio"));
    const bajan = actorIds ? pasajeros.filter(p => actorIds.includes(p.actorId)) : pasajeros;
    const quedan = pasajeros.filter(p => !bajan.includes(p));
    const escena = vehiculo.parent;
    const g = escena.grid.size;
    const nuevos = [];
    bajan.forEach((p, i) => {
      // Alrededor del coche: primero los laterales, después adelante y atrás.
      const posiciones = [[-1, 0], [vehiculo.width, 0], [-1, 1], [vehiculo.width, 1], [0, -1], [0, vehiculo.height], [-1, 2], [vehiculo.width, 2]];
      const [dx, dy] = posiciones[i % posiciones.length];
      const base = p.tokenData ?? { actorId: p.actorId, name: p.nombre, texture: { src: p.img } };
      const { _id, x, y, level, ...resto } = base;
      nuevos.push({ ...resto, actorId: p.actorId, name: p.nombre, x: vehiculo.x + dx * g, y: vehiculo.y + dy * g, level: vehiculo.level, hidden: vehiculo.hidden,
        width: 1, height: 1 });
    });
    await escena.createEmbeddedDocuments("Token", nuevos);
    await vehiculo.update({ [`flags.${DVV.ID}.${this.FLAG_PASAJEROS}`]: quedan, name: this.nombreCon(vehiculo, quedan.length) });
    await publicar(game.i18n.format("DVV.vehiculos.bajaron", { quienes: bajan.map(p => p.nombre).join(", "), vehiculo: this.nombreBase(vehiculo) }));
    Hooks.callAll("dvvVehiculo", { vehiculo, pasajeros: quedan });
  }

  static nombreBase(vehiculo) {
    return vehiculo.getFlag(DVV.ID, "nombreBase") ?? vehiculo.name.replace(/\s·\s\d+\/\d+$/, "");
  }

  static nombreCon(vehiculo, n) {
    const base = this.nombreBase(vehiculo);
    return n > 0 ? `${base} · ${n}/${this.plazas(vehiculo)}` : base;
  }

  /* -------------------------------------------- */
  /*  Diálogos y HUD                              */
  /* -------------------------------------------- */

  static async dialogoBajar(vehiculo) {
    const pasajeros = this.pasajeros(vehiculo);
    if (!pasajeros.length) return ui.notifications.info(game.i18n.localize("DVV.vehiculos.vacio"));
    const casillas = pasajeros.map(p => `<div class="form-group"><label><input type="checkbox" name="p.${p.actorId}" checked> ${p.nombre}</label></div>`).join("");
    const r = await foundry.applications.api.DialogV2.input({
      window: { title: `${game.i18n.localize("DVV.vehiculos.bajar")} — ${this.nombreBase(vehiculo)}` },
      classes: ["dvv-dialogo"],
      content: casillas,
      ok: { label: game.i18n.localize("DVV.vehiculos.bajar") }
    });
    if (!r) return;
    const ids = pasajeros.filter(p => r[`p.${p.actorId}`]).map(p => p.actorId);
    if (ids.length) await this.bajar(vehiculo, ids);
  }

  /** Botones Subir / Bajar en el HUD del token del vehículo. */
  static onRenderTokenHUD(hud, html) {
    const doc = hud.document;
    if (!doc || !this.esVehiculo(doc) || !doc.isOwner) return;
    const col = html.querySelector(".col.right") ?? html;
    const n = this.pasajeros(doc).length, plazas = this.plazas(doc);
    const subir = document.createElement("button");
    subir.type = "button"; subir.className = "control-icon dvv-hud";
    subir.dataset.tooltip = game.i18n.format("DVV.vehiculos.subirTooltip", { n, plazas });
    subir.innerHTML = `<i class="fa-solid fa-person-walking-arrow-right"></i>`;
    subir.addEventListener("click", ev => { ev.preventDefault(); this.subir(doc); });
    const bajar = document.createElement("button");
    bajar.type = "button"; bajar.className = "control-icon dvv-hud";
    bajar.dataset.tooltip = game.i18n.format("DVV.vehiculos.bajarTooltip", { n });
    bajar.innerHTML = `<i class="fa-solid fa-person-walking-arrow-loop-left"></i><span class="dvv-hud-n">${n}</span>`;
    bajar.addEventListener("click", ev => { ev.preventDefault(); this.dialogoBajar(doc); });
    col.append(subir, bajar);
  }

  /* -------------------------------------------- */
  /*  Tamaño según la escena                      */
  /* -------------------------------------------- */

  /** Hook preCreateToken: un vehículo mide 2×4 en calles e interiores y es un marcador en el mapa general. */
  static onPreCreateToken(doc, data) {
    const actor = game.actors.get(data.actorId);
    // La visión de los cazadores la pone vision.mjs.
    const datos = actor?.getFlag(DVV.ID, "vehiculo");
    if (!datos) return;
    const escena = doc.parent;
    const esCiudad = escena?.getFlag(DVV.ID, "escena") === "malaga";
    const tam = esCiudad ? { width: 0.5, height: 1 } : { width: datos.ancho ?? 2, height: datos.largo ?? 4 };
    doc.updateSource({ ...tam, [`flags.${DVV.ID}.nombreBase`]: data.name?.replace(/\s·\s\d+\/\d+$/, "") ?? actor.name });
  }
}
