# MAPS_SPEC — Especificación de mapas de Del Velo a la Vigilia

Contrato **obligatorio** para todo mapa y asset visual de la crónica *Somnia
Biotech* (Hunter: The Reckoning 5e, Málaga, hoy). El skill `battlemaps` lee este
archivo al empezar cualquier tarea de mapas y aplica su checklist antes de
entregar. Lo que dice acá gana sobre cualquier default del skill.

Verificado contra Foundry v14.365, sistema wod5e 5.3.28.

---

## 1. Qué mapas tiene la crónica

La crónica transcurre en interiores: todos los mapas son de **nivel 3 (battlemap
de interior)**, construidos desde un plano. No hay mapa regional ni de
asentamiento; si algún día hace falta un mapa de Málaga o del barrio, es nivel 1
o 2 y se genera con `tools/generar-arte.mjs` siguiendo el mismo contrato.

| Plano (`content/planos/`) | Escena | Acto | Oscuridad | Luces |
|---|---|---|---|---|
| `somnia-planta-nueva` | Somnia Biotech — planta nueva (el apagón) | 1 | 0.9 | 5 de emergencia rojas en pasillos, nada más |
| `somnia-planta-vieja` | Somnia Biotech — la planta vieja | 1 y 3 | 0.95 | el rack prohibido |
| `piso-de-elias` | El piso de Elías Roca | Interludio | 0.55 | lámpara del living, tubo de la cocina |
| `convento-planta` | El convento desconsagrado (de día) | 2 | 0.1 + luz global | ninguna |
| `cripta` | La cripta del relicario | 3 | 1.0 | brillo frío mínimo del relicario |

**Coherencia entre mapas (obligatoria).** Las transiciones son regiones
`teleportToken` gemelas, derivadas del plano:

```
planta nueva (muelle, puerta pesada al este) ⇄ planta vieja (umbral oeste)
planta vieja (escalera de piedra, sur)       ⇄ cripta (pasillo lateral, este)
convento (sacristía, puerta de piedra)       ⇄ cripta (escalera oeste)
```

Si se mueve un acceso en un plano, se mueve su gemelo: la orientación de un
acceso en un mapa manda sobre el mapa de destino.

---

## 2. Qué va en la imagen y qué NO

El Narrador recibe en Foundry, derivado del plano: muros, puertas, muros de
vidrio, regiones de transición y luces. El mapa se entrega **limpio**.

### Sí incluir (estructural e inamovible)

- Arquitectura, materiales de piso, exterior inmediato (asfalto mojado,
  empedrado, roca).
- **Mobiliario fijo**: camillas médicas ancladas, racks, mostradores,
  casilleros, estanterías, heladera, mesadas, sanitarios, altar, bancos de
  iglesia, relicario, nichos, columnas, escaleras.
- Paños de **vidrio** fijo (perfil fino con montantes): son muros, no puertas.
- Suciedad permanente: rayones, marcas de ruedas, manchas de aceite, humedad,
  salitre, mugre de zócalo.
- **Tono ambiente uniforme** por paleta (el rojo de emergencia de la clínica a
  oscuras, el frío húmedo de la cripta): un lavado parejo de toda la imagen.

> **Tolerancia (dressing).** Las sillas de oficina que el modelo dibuja junto a
> un escritorio fijo y los objetos chicos *sobre* un mueble fijo (teclado,
> carpetas, una notebook cerrada) se toleran como decoración: no son las sillas
> o mesas que la trama mueve. Lo que la trama usa (la mesa con el cuaderno de
> Mara, el disco duro, los viales, las vías) siempre va como tile.

### NO incluir (nunca)

- **Puertas dibujadas**, abiertas o cerradas. El vano queda vacío con un umbral
  tenue; la hoja la pone Foundry (muro con `door`). Vale también para
  persianas metálicas, puertas de vidrio y trampillas.
- **Fuentes de luz pintadas**: ni pantallas encendidas, ni lámparas prendidas,
  ni charcos rojos bajo las luces de emergencia, ni halos. La luz de emergencia
  es un *tono*, no un foco; los focos son AmbientLight de Foundry.
- **Texto de cualquier tipo**: carteles de salida, logos de Somnia, números de
  sala, letras en pantallas, cajas, pósters o en el piso. Las fotos del corcho
  de Elías son manchas de valor, no imágenes legibles.
- **Tokens, personas, pacientes en las camas, cadáveres, criaturas.**
- **Muebles móviles** (regla 9 del skill): sillas, sofás, mesas, carros, palets,
  lámparas, vías/tubos. El renderer no los dibuja y la nota de la escena los
  lista para colocarlos como tiles.
- **Grid pintado.** Las juntas de las baldosas que caen sobre la casilla son
  válidas (es como el piso «lee» el grid); líneas de grid dibujadas encima, no.
- **Nada de fantasía**: runas, brillos mágicos, antorchas o utilería medieval en
  lugares modernos. Lo medieval vive solo en el convento y la cripta.

---

## 3. Assets sueltos (tiles)

Mismos requisitos que el skill: PNG con alfa real, cenital estricto, mismo
estilo, **150 px por casilla**, recortado, sin sombra en el suelo (o mínima y
neutra), sin luz pintada.

Prioridad para esta crónica (son los móviles que los planos ya declaran):

| Categoría | Tiles |
|---|---|
| Mobiliario | silla de oficina, sofá gastado, mesa del living, mesa de cocina, carro de limpieza, carro de instrumental, palet |
| Equipo médico | vías/tubos de plasma (rectos y curvos), soporte de suero, monitor rodante |
| Puertas | hoja de puerta metálica, puerta de vidrio doble, persiana metálica, puerta de piedra |
| Trama | bidón de gasoil, bengala (apagada y encendida, **sin glow**), disco duro, caja de viales, cuaderno de Mara, línea de sal |
| Horror | charco y salpicaduras de sangre, camilla volcada, vidrio roto |

---

## 4. Grid y escala

- **Casilla:** 5 pies (convención del módulo; Foundry `distance: 5`, `units: ft`).
- **Resolución:** **150 px por casilla**, fija. Los planos se escriben en pies y
  el motor usa `PX_POR_PIE = 30` (30 × 5 = 150).
- **Alineación:** muros, pasillos y vanos sobre múltiplos de 5 pies (o 2,5 para
  medias casillas; puertas interiores de 3–4 pies se toleran).
- **Tamaño:** entre **40 × 30 y 80 × 60 pies** (1200 × 900 a 2400 × 1800 px).
  Un lugar más grande se parte en varios planos unidos por regiones (así nació
  la planta vieja). Tope duro: 8192 px de lado.
- **Escena:** padding 0.25, grid cuadrado de 150 px con `alpha 0` (el piso ya
  lee la retícula; el Narrador lo sube si quiere), visión de token y niebla de
  exploración activadas, oscuridad según la tabla de §1.
- **La escena mide exactamente `ancho × alto × 30` px.** Si el fondo no coincide,
  construir-contenido avisa y usa las medidas del plano.

---

## 5. Estilo visual

**Fuente única de verdad:** el bloque `estilos.battlemap` de
[`tools/arte.config.json`](tools/arte.config.json) para lo pintado, y las
`PALETAS` de [`tools/planos.mjs`](tools/planos.mjs) para el esquema. No se
describe el estilo por mapa; el plano sólo describe su sujeto (`exterior`,
`desc` de muebles). Cambiar el look de la crónica = editar esos dos lugares y
regenerar.

Canon:

- **Medio:** fotorrealismo ilustrado — tinta oscura y firme en el canto de cada
  muro y objeto, materiales reales pintados por debajo, sombras proyectadas
  abajo-derecha. Estética de pack de battlemaps modernos publicado.
- **Paleta:** World of Darkness moderno, fría y desaturada — azules y grises de
  hospital, blancos fluorescentes apagados, asfalto mojado, acero y vidrio.
  Piedra medieval húmeda solo en convento y cripta. Acento: rojo de emergencia
  como tono, sangre seca puntual. Nunca cálido ni dorado.
- **Paletas del renderer:** `clinica` (linóleo/baldosa clara, gris frío, tono
  rojo de emergencia al 5%), `departamento` (parquet gastado, muros
  amarillentos), `convento` (piedra, damero de iglesia, empedrado),
  `cripta` (piedra medieval húmeda, salitre, roca negra, tono frío). Ninguna
  lleva musgo.
- **Métricas** (`magick … -colorspace HSL`, medidas sobre el set entregado):
  saturación media **5–12%** (techo 15%); luminancia media 40–51% en clínica,
  departamento y convento (la noche la pone la oscuridad de la escena, no el
  mapa), ~25% en la cripta; contraste (desvío del gris) 14–20. Un mapa nuevo
  fuera de esos rangos no encaja en el set.

  | Mapa | sat | lum | contraste |
  |---|---|---|---|
  | somnia-planta-nueva (referencia) | 6.0 | 47.8 | 19.5 |
  | somnia-planta-vieja | 5.3 | 51.1 | 13.7 |
  | piso-de-elias | 12.3 | 39.9 | 18.6 |
  | convento-planta | 7.4 | 40.7 | 16.4 |
  | cripta | 8.3 | 25.1 | 16.2 |
- **Cenital estricto y a sangre**: ningún canto lateral de muro, sin borde,
  marco, viñeta ni margen.

**Referencia de set.** `referencia` en `arte.config.json` (hoy
`somnia-planta-nueva`) se pinta primero; los demás mapas reciben un recorte suyo
como segunda imagen, sólo como referencia de render. Si un mapa nuevo no
encaja, se corrige el prompt del sujeto (el `exterior` o los `desc`), nunca el
contrato.

---

## 6. Pipeline y formatos

```
content/planos/<archivo>.json         fuente (pies): habitaciones, vanos, muebles, luces, regiones
   │  node tools/construir-planos.mjs   (npm run planos)
   ▼
assets/mapas/<id>.esquema.webp         esquema vectorial, escala exacta (q92)
   │  node tools/pintar-planos.mjs      (npm run pintar; --solo <id>, --forzar)
   ▼
assets/mapas/<id>.webp                 mapa pintado y corregido (q88)
   │  node tools/construir-contenido.mjs
   ▼
packs-src/escenas/*.json               escena + muros + puertas + vidrios + regiones + luces
```

- El **plano JSON es la fuente**; los `.webp` son artefactos.
- `construir-planos` nunca escribe `<id>.webp`, para no pisar un mapa pintado.
- Si falta el pintado, la escena usa el **esquema como fondo provisional** y el
  build lo avisa (flag `provisional: true` en la escena).
- **Corrección afín**: `pintar-planos` registra el repintado contra el esquema
  por perfiles de bordes (columnas ↔ muros verticales, filas ↔ horizontales),
  encuentra escala y desplazamiento de cada eje, rechaza más de **3%** de
  anisotropía o una superposición pobre (`calidad < 0.35`), y reescala para que
  cada muro caiga sobre el plano. Antes de mandar el esquema lo rellena con el
  color del exterior hasta la proporción soportada por el modelo más cercana.
- **Prompt por posición:** las habitaciones se describen al modelo por su
  posición en la imagen (no por nombre): con los nombres en el prompt el modelo
  rotula las salas, y eso es texto horneado.
- **Retoque determinista permitido:** si el modelo abre un hueco donde el plano
  tiene muro (pasó en el extremo norte del pasillo de cristal), se cierra
  clonando un tramo del mismo muro pintado con `magick … -composite`. Nunca se
  pinta a mano ni se mezcla el esquema con el pintado. El retoque se anota en
  el reporte de entrega, porque un `--forzar` lo pierde.
- **Nombres:** el id del plano ES el nombre del archivo (`somnia-planta-nueva.webp`,
  `somnia-planta-nueva.esquema.webp`) y el id de la escena; las versiones las
  lleva git. Tiles: `assets/tiles/tile-<categoría>-<nombre>[-<variante>]-v<n>.png`
  (`tile-silla-oficina-v1.png`, `tile-bengala-encendida-v1.png`).

### Formato del plano (resumen)

| Campo | Qué es |
|---|---|
| `id`, `nombre`, `orden` | id estable (archivo y escena), nombre de la escena, orden de navegación |
| `ancho`, `alto` | lienzo en pies |
| `paleta`, `fondo` | `clinica` · `departamento` · `convento` · `cripta`; `fondo` pisa el exterior (`asfalto`, `edificio`, `empedrado`, `roca`, `solar`) |
| `oscuridad`, `luzGlobal` | darkness de la escena; luz global para escenas de día |
| `exterior` | texto para el modelo: qué rodea al edificio |
| `nota` | nota del Narrador (va a los flags de la escena, con la lista de móviles) |
| `habitaciones[]` | `{ nombre, x, y, w, h, piso }` — piso: `linoleo`, `baldosa`, `azulejo`, `terrazo`, `moqueta`, `tecnico`, `hormigon`, `parquet`, `piedra`, `iglesia`, `piedra-humeda`, `tierra`, `grava` |
| `vanos[]` | `{ x, y, w, eje, tipo, estado?, sonido? }` — `abierto`, `puerta`, `secreta`, `puerta-vidrio`, `vidrio`, `arcada`; `estado`: `cerrada` · `abierta` · `trabada` |
| `muebles[]` | `{ tipo, x, y, w, h, desc?, fijo?, luz?, cabecera?, hacia? }` |
| `luces[]` | `{ x, y, preset, nombre? }` — presets en `tools/iluminacion.mjs` |
| `regiones[]` | `{ id, nombre, x, y, w, h, destino: "<plano>:<región>" }` |

En Foundry: `puerta` = muro con `door 1`; `secreta` = `door 2` (se ve pared);
`puerta-vidrio` = `door 1` con `sight 0` y `light 0` (cerrada se ve a través);
`vidrio` = muro con `move 20`, `sight 0`, `light 0`, `sound 20` (bloquea el paso,
no la vista; el vidrio del ala de ensayos es insonorizado).

Tipos de mueble: fijos por defecto `camilla-medica`, `rack`, `escritorio`,
`cama`, `heladera`, `mesada`, `estante`, `casillero`, `corcho`, `mostrador`,
`lector`, `relicario`, `nicho`, `altar`, `columna`, `banco`, `pila`,
`escalera`, `trampilla` (solo el marco), `inodoro`, `lavabo`, `ducha`,
`contenedor`, `maquina`; móviles por defecto `silla`, `sofa`, `mesa`,
`camilla`, `tubos`, `lampara`, `carro`, `palet`. `fijo: true/false` lo pisa.

---

## 7. Checklist de control de calidad

Se corre **antes de dar por terminado cualquier mapa**. Si algo falla, se rehace
(o se deja el esquema), no se entrega con la falla anotada.

- [ ] **Cenital 100%.** Ningún canto lateral de muro, ningún objeto en
      perspectiva.
- [ ] **Alineación medida:** los muros del plano dibujados en rojo sobre el mapa
      final caen sobre los muros pintados (tolerancia: ⅙ de pie, ~5 px).
- [ ] **Nada horneado que sea del Narrador:** sin hojas de puerta, sin luz
      pintada (pantallas, lámparas, focos rojos), sin personas, sin muebles
      móviles inventados (carros, sofás, plantas; ver la tolerancia de §2),
      **sin texto ni pseudo-texto de ningún tipo** (ni rótulos de sala, ni
      garabatos en pantallas).
- [ ] **Sin muros inventados:** el modelo no subdividió salas ni agregó tabiques,
      muretes o canteros que Foundry no tiene.
- [ ] **Huecos intactos:** cada vano del plano sigue abierto en el pintado.
- [ ] **A sangre:** sin margen, marco ni viñeta.
- [ ] **Escala:** mapa de `ancho × alto × 30` px exactos; 150 px por casilla.
- [ ] **Estilo coherente** con la referencia: hoja de contactos y métricas de
      saturación/luminancia de §5.
- [ ] **Transiciones:** cada región tiene su gemela en el plano destino
      (construir-contenido avisa si no).
- [ ] **Tiles:** alfa real, recortados, sin sombra en el suelo, sin luz pintada.

Comandos útiles:

```bash
# métricas de estilo
magick assets/mapas/<id>.webp -colorspace HSL -format "sat %[fx:mean.g*100] lum %[fx:mean.b*100]\n" info:
# hoja de contactos contra la referencia
magick montage assets/mapas/somnia-planta-nueva.webp assets/mapas/<id>.webp -tile 2x1 -geometry 900x675+8+8 hoja.jpg
# conservar el crudo del modelo para inspeccionarlo
DVV_CONSERVAR_CRUDO=1 node tools/pintar-planos.mjs --solo <id> --forzar
```
