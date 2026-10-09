import { DVV } from "./constantes.mjs";

/**
 * Compatibilidad con wod5e.
 *
 * El sistema, al preparar los datos de un actor, sincroniza con `actor.update()`
 * la salud y la voluntad derivadas y el permiso por defecto. Lo hace también
 * cuando no puede: sobre actores de un compendio bloqueado (al abrir la
 * ficha desde el compendio: «You may not update documents in the locked
 * compendium»), sobre actores que todavía no están en el mundo (al importar
 * la Aventura: «Actor id … does not exist») y sobre actores sin id (al crear
 * un cazador: «You must provide an _id»). Ninguna de esas sincronizaciones
 * hace falta: la siguiente preparación de datos las vuelve a calcular.
 *
 * Este parche envuelve `Actor#update` y omite SOLO esas escrituras derivadas
 * en esos tres casos. Cualquier otra actualización pasa intacta.
 */
const CLAVES_DERIVADAS = ["system.health.value", "system.willpower.value", "ownership.default", "system.formOverride"];

export function instalarParches() {
  const Clase = CONFIG.Actor.documentClass;
  if (!Clase || Clase.prototype[Symbol.for("dvv.parche-update")]) return;

  const original = Clase.prototype.update;
  Clase.prototype.update = function (data, options) {
    if (data && esSincronizacionDerivada(data) && !puedeActualizarse(this)) {
      DVV.log("omitida sincronización derivada de wod5e sobre", this.name, Object.keys(data));
      return Promise.resolve(this);
    }
    return original.call(this, data, options);
  };
  Clase.prototype[Symbol.for("dvv.parche-update")] = true;
  console.log(`${DVV.ID} | Parche de compatibilidad wod5e instalado (Actor#update)`);
}

function esSincronizacionDerivada(data) {
  const claves = Object.keys(foundry.utils.flattenObject(data));
  return claves.length > 0 && claves.every(k => CLAVES_DERIVADAS.includes(k));
}

function puedeActualizarse(actor) {
  if (!actor.id) return false;
  if (actor.pack) return game.packs.get(actor.pack)?.locked === false;
  if (actor.isToken) return true;
  return game.actors.has(actor.id);
}
