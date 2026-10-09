/**
 * Pre-iluminación de escenas desde el plano.
 *
 * La luz NO se pinta en el mapa (MAPS_SPEC.md §2): se coloca como objetos
 * AmbientLight de Foundry. Un plano declara sus luces de dos formas:
 *
 *   - `plano.luces`: [{ x, y, preset, nombre? }] en pies (p. ej. las luces de
 *     emergencia del apagón, que no son un mueble).
 *   - `mueble.luz`: "<preset>" en un mueble (el brillo frío del relicario, la
 *     lámpara del living). La luz va al centro del mueble.
 *
 * Los radios bright/dim están en pies (la escena mide en casillas de 5 ft).
 */

import { PX_POR_PIE } from "./planos.mjs";

export const PRESETS = {
  // Luz de emergencia del apagón: roja, mínima, pulsando.
  emergencia: {
    bright: 3, dim: 15, color: "#d12a1e", alpha: 0.6,
    animation: { type: "pulse", speed: 2, intensity: 3 }
  },
  // El relicario: un brillo frío apenas perceptible.
  relicario: {
    bright: 0, dim: 8, color: "#8fb3c9", alpha: 0.35,
    animation: { type: "fog", speed: 1, intensity: 2 }
  },
  // LEDs y pantallas de un rack a consumo máximo.
  pantalla: {
    bright: 0, dim: 10, color: "#4fd1a5", alpha: 0.4,
    animation: { type: "flame", speed: 1, intensity: 1 }
  },
  // Lámpara de pie o de mesa, cálida.
  lampara: {
    bright: 8, dim: 20, color: "#ffc77a", alpha: 0.45,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // Tubo fluorescente frío.
  fluorescente: {
    bright: 10, dim: 20, color: "#dbe6ee", alpha: 0.3,
    animation: { type: null, speed: 5, intensity: 5 }
  },
  // Vela.
  vela: {
    bright: 3, dim: 12, color: "#ffc547", alpha: 0.5,
    animation: { type: "torch", speed: 4, intensity: 1 }
  },
  // La bengala de Elías.
  bengala: {
    bright: 20, dim: 40, color: "#ff3b1f", alpha: 0.7,
    animation: { type: "torch", speed: 6, intensity: 6 }
  }
};

/** Construye un documento AmbientLight de Foundry a partir de un preset. */
export function luz(idEstable, semilla, xPie, yPie, preset, nombre) {
  const p = PRESETS[preset];
  if (!p) throw new Error(`preset de luz desconocido: ${preset}`);
  return {
    _id: idEstable(`luz:${semilla}`),
    ...(nombre ? { name: nombre } : {}),
    x: Math.round(xPie * PX_POR_PIE),
    y: Math.round(yPie * PX_POR_PIE),
    elevation: 0,
    rotation: 0,
    walls: true,
    vision: false,
    config: {
      negative: false, priority: 0, alpha: p.alpha, angle: 360,
      bright: p.bright, dim: p.dim, color: p.color, coloration: 1,
      attenuation: 0.6, luminosity: 0.5, saturation: 0, contrast: 0, shadows: 0,
      animation: { type: p.animation.type, speed: p.animation.speed, intensity: p.animation.intensity, reverse: false },
      darkness: { min: 0, max: 1 }
    },
    hidden: false,
    locked: false,
    flags: {}
  };
}

/** Todas las luces de un plano: las declaradas y las de los muebles con `luz`. */
export function lucesDePlano(plano, idEstable) {
  const luces = [];
  for (const [i, l] of (plano.luces ?? []).entries()) {
    luces.push(luz(idEstable, `${plano.id}:l${i}`, l.x, l.y, l.preset, l.nombre));
  }
  for (const [i, m] of (plano.muebles ?? []).entries()) {
    const preset = m.luz ?? (m.tipo === "vela" ? "vela" : null);
    if (!preset) continue;
    const cx = m.x + (m.w ?? 1) / 2, cy = m.y + (m.h ?? 1) / 2;
    luces.push(luz(idEstable, `${plano.id}:m${i}`, cx, cy, preset));
  }
  return luces;
}
