/**
 * Constantes del módulo.
 *
 * Este archivo no importa nada a propósito: es la hoja del grafo de módulos.
 * El id se repite en flags, settings, rutas de plantillas y clases CSS, y un
 * typo en el scope de un setFlag produce «Invalid scope for flag» sin otro
 * síntoma. Se define una sola vez acá.
 */
export class DVV {
  static ID = "del-velo-a-la-vigilia";

  /** Prefijo de los ids de Facultad que este módulo registra en wod5e. */
  static PREFIJO_EDGE = "dvv-";

  static FLAGS = {
    /** { fe, metodo, carne, historial[] } en el actor. */
    BALIZAS: "balizas",
    /** { imbuido: { fecha, rama }, ... } en el actor: qué caminos le otorgó la cronista. */
    CAMINOS: "caminos",
    /** id de poder / ítem / estado dentro de los documentos de compendio. */
    ORIGEN: "origen",
    /** id del poder (`dvv-imb-hendir`) en reservas y mejoras. */
    PODER: "poder"
  };

  static SETTINGS = {
    /** Registro de Peligro de la sesión: [{ fecha, actor, motivo, aplicado }]. */
    REGISTRO_PELIGRO: "registro-peligro",
    /** Si al registrar +1 de Peligro también sube el Danger de la Célula. */
    SUBIR_DANGER: "subir-danger-automatico",
    /** Si tras un «1» en dados de Desesperación se publica el recordatorio. */
    RECORDATORIOS: "recordatorios-desesperacion"
  };

  static BALIZAS = ["fe", "metodo", "carne"];

  /** Compendios del módulo, por nombre corto. */
  static PACKS = {
    RESERVAS: "reservas",
    MEJORAS: "mejoras",
    ESTADOS: "estados",
    RASGOS: "rasgos",
    ARSENAL: "arsenal",
    REGLAS: "reglas",
    CRONICA: "cronica",
    PERSONAJES: "personajes",
    ESCENAS: "escenas",
    MACROS: "macros"
  };

  static pack(nombre) {
    return game.packs.get(`${this.ID}.${nombre}`);
  }

  static ruta(rel) {
    return `modules/${this.ID}/${rel}`;
  }

  static log(...args) {
    if (CONFIG.debug?.[this.ID]) console.log(this.ID, "|", ...args);
  }
}
