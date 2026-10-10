#!/usr/bin/env python3
"""
Mapa de ciudad de Málaga (nivel 2, «asentamiento») desde OpenStreetMap.

Renderiza assets/mapas/malaga.webp y content/malaga/geo.json con la estética de
los planos de la crónica (MAPS_SPEC.md §5): cenital, paleta fría desaturada,
tinta fina, sin texto, sin marcadores, sin leyenda, sin grid, a sangre.

Uso:
    python3 tools/malaga-mapa.py [--cache DIR] [--descargar] [--escala 2.0]

    --cache DIR    carpeta con las respuestas crudas de Overpass (una por capa:
                   calles, edificios, agua, verde, playa, ferrocarril, puerto).
                   Por defecto /tmp/malaga-osm.
    --descargar    baja las capas que falten (una consulta por capa, con pausas;
                   prueba overpass-api.de, maps.mail.ru y kumi.systems).
    --escala M     metros por píxel en X (2.0; si el ancho pasa de 4096 px se
                   sube solo a 2.2).

Requiere Python 3 con Pillow e ImageMagick (`magick`) para el webp.

Datos: © OpenStreetMap contributors, licencia ODbL. La atribución es
obligatoria en cualquier lugar donde se muestre el mapa (nota de la escena).

Proyección: equirectangular con corrección de latitud media, para que el metro
sea isotrópico (mismo tamaño en X y en Y):

    latMedia = (sur + norte) / 2
    mX       = (este - oeste) * 111319.49 * cos(latMedia)      # metros en X
    ancho    = round(mX / metrosPorPixel)
    alto     = round((norte - sur) * 111319.49 / metrosPorPixel)
    x = (lon - oeste) / (este - oeste) * ancho
    y = (norte - lat) / (norte - sur) * alto

(metrosPorPixel se reajusta a mX / ancho tras redondear el ancho.)
"""

import argparse
import json
import math
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image, ImageChops, ImageDraw, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

OESTE, ESTE, SUR, NORTE = -4.490, -4.400, 36.690, 36.740
M_POR_GRADO = 111319.49  # metros por grado en el ecuador (WGS84, esfera)
SS = 2  # supersampling: se dibuja al doble y se reduce con Lanczos
ATRIBUCION = "© OpenStreetMap contributors (ODbL)"

# ---------------------------------------------------------------- descarga ---

B = f"{SUR},{OESTE},{NORTE},{ESTE}"
BW = f"{SUR - 0.03},{OESTE - 0.04},{NORTE + 0.03},{ESTE + 0.04}"  # costa: más ancho
CONSULTAS = {
    "calles": f"way[highway]({B});out geom;",
    "edificios": f"(way[building]({B});relation[building]({B}););out geom;",
    "agua": (f'(way[natural=water]({B});relation[natural=water]({B});'
             f'way[waterway~"^(river|stream|canal|riverbank)$"]({B});'
             f'way[natural=coastline]({BW}););out geom;'),
    "verde": (f'(way[leisure~"^(park|garden|pitch|golf_course)$"]({B});'
              f'relation[leisure~"^(park|garden)$"]({B});'
              f'way[landuse~"^(grass|forest|cemetery|recreation_ground|meadow|village_green)$"]({B});'
              f'relation[landuse~"^(grass|forest|cemetery)$"]({B});'
              f'way[amenity=grave_yard]({B});way[natural~"^(wood|scrub|grassland)$"]({B});'
              f'relation[natural~"^(wood|scrub)$"]({B}););out geom;'),
    "playa": (f'(way[natural~"^(beach|sand)$"]({B});'
              f'relation[natural~"^(beach|sand)$"]({B}););out geom;'),
    "ferrocarril": f'way[railway~"^(rail|light_rail|subway)$"]({B});out geom;',
    "puerto": (f'(way[landuse~"^(industrial|port|harbour|railway)$"]({B});'
               f'relation[landuse~"^(industrial|port)$"]({B});'
               f'way[man_made~"^(pier|breakwater|groyne|quay)$"]({B});'
               f'relation[man_made~"^(pier|breakwater)$"]({B}););out geom;'),
}
ESPEJOS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def descargar(cache):
    os.makedirs(cache, exist_ok=True)
    for capa, q in CONSULTAS.items():
        destino = os.path.join(cache, f"{capa}.json")
        if os.path.exists(destino) and os.path.getsize(destino) > 0:
            continue
        datos = urllib.parse.urlencode({"data": f"[out:json][timeout:180];{q}"}).encode()
        for intento in range(8):  # Overpass devuelve 504 cuando está cargado
            for url in ESPEJOS:
                try:
                    req = urllib.request.Request(url, data=datos, headers={
                        "User-Agent": "del-velo-a-la-vigilia-map/1.0"})
                    with urllib.request.urlopen(req, timeout=300) as r:
                        cuerpo = r.read()
                    json.loads(cuerpo)
                    with open(destino, "wb") as f:
                        f.write(cuerpo)
                    print(f"  {capa}: {len(cuerpo)} bytes ({url})", flush=True)
                    break
                except Exception as e:  # noqa: BLE001
                    print(f"  {capa}: {url} falló ({e}); pausa", flush=True)
                    time.sleep(30 + 15 * intento)
            else:
                continue
            break
        time.sleep(10)


# -------------------------------------------------------------- geometría ---

class Proyeccion:
    def __init__(self, mpp):
        self.latm = (SUR + NORTE) / 2
        mx = (ESTE - OESTE) * M_POR_GRADO * math.cos(math.radians(self.latm))
        if mx / mpp > 4096:
            mpp = 2.2
        self.ancho = round(mx / mpp)
        self.mpp = mx / self.ancho
        self.alto = round((NORTE - SUR) * M_POR_GRADO / self.mpp)

    def px(self, lat, lon, s=1):
        x = (lon - OESTE) / (ESTE - OESTE) * self.ancho
        y = (NORTE - lat) / (NORTE - SUR) * self.alto
        return (x * s, y * s)


def cargar(cache, capa):
    with open(os.path.join(cache, f"{capa}.json"), encoding="utf8") as f:
        return json.load(f)["elements"]


def anillos(el):
    """Anillos (lista de [(lat,lon)]) exteriores e interiores de un way/relation."""
    if el["type"] == "way":
        g = [(p["lat"], p["lon"]) for p in el.get("geometry", []) if p]
        return [g], []
    ext, inn = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or not m.get("geometry"):
            continue
        g = [(p["lat"], p["lon"]) for p in m["geometry"] if p]
        (inn if m.get("role") == "inner" else ext).append(g)
    return coser(ext), coser(inn)


def coser(trozos):
    """Une los ways de una multipolígono en anillos cerrados por sus extremos."""
    trozos = [t[:] for t in trozos if len(t) > 1]
    cerrados = []
    while trozos:
        a = trozos.pop()
        cambio = True
        while a[0] != a[-1] and cambio:
            cambio = False
            for i, t in enumerate(trozos):
                if t[0] == a[-1]:
                    a += t[1:]
                elif t[-1] == a[-1]:
                    a += t[::-1][1:]
                elif t[-1] == a[0]:
                    a = t + a[1:]
                elif t[0] == a[0]:
                    a = t[::-1] + a[1:]
                else:
                    continue
                trozos.pop(i)
                cambio = True
                break
        cerrados.append(a)
    return cerrados


# ---------------------------------------------------------------- paleta ----
# Noche fría y desaturada (MAPS_SPEC §5): azules y grises, nunca cálido.
C = {
    "tierra": (58, 62, 68),
    "industria": (66, 69, 74),
    "verde": (58, 66, 64),
    "cementerio": (64, 69, 69),
    "playa": (98, 98, 95),
    "agua": (33, 45, 52),
    "orilla": (48, 63, 70),
    "muelle": (80, 83, 88),
    "edificio": (110, 115, 122),
    "tinta": (22, 24, 29),
    "via_base": (30, 32, 37),
    "via_traviesa": (88, 90, 95),
    "plaza": (78, 83, 89),
}
# highway → (ancho en metros, color, prioridad de dibujo)
CALLES = {
    "motorway": (24, (132, 138, 146), 9), "motorway_link": (12, (120, 126, 134), 8),
    "trunk": (20, (128, 134, 142), 9), "trunk_link": (11, (116, 122, 130), 8),
    "primary": (17, (122, 128, 136), 7), "primary_link": (10, (112, 118, 126), 7),
    "secondary": (14, (112, 118, 126), 6), "secondary_link": (9, (104, 110, 118), 6),
    "tertiary": (11, (102, 108, 116), 5), "tertiary_link": (8, (96, 102, 110), 5),
    "residential": (7.5, (84, 90, 98), 4), "unclassified": (7.5, (84, 90, 98), 4),
    "living_street": (6, (82, 87, 94), 3), "pedestrian": (6, (80, 85, 91), 3),
    "road": (7, (84, 90, 98), 3),
    "service": (4.5, (74, 79, 86), 2),
    "footway": (2.2, (72, 76, 82), 1), "path": (2, (70, 74, 80), 1),
    "cycleway": (2.2, (72, 76, 82), 1), "steps": (2.2, (72, 76, 82), 1),
    "track": (3, (68, 72, 78), 1),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="/tmp/malaga-osm")
    ap.add_argument("--descargar", action="store_true")
    ap.add_argument("--escala", type=float, default=2.0)
    ap.add_argument("--salida", default=os.path.join(RAIZ, "assets/mapas/malaga.webp"))
    args = ap.parse_args()

    if args.descargar:
        descargar(args.cache)

    P = Proyeccion(args.escala)
    W, H = P.ancho * SS, P.alto * SS
    m2px = SS / P.mpp  # metros → píxeles del lienzo supersampleado
    print(f"lienzo {P.ancho}x{P.alto} px, {P.mpp:.4f} m/px")
    cuenta = {}

    def pts(g):
        return [P.px(la, lo, SS) for la, lo in g]

    def rellenar(dr, el, color, hueco):
        ext, inn = anillos(el)
        for r in ext:
            if len(r) > 2:
                dr.polygon(pts(r), fill=color)
        for r in inn:
            if len(r) > 2:
                dr.polygon(pts(r), fill=hueco)

    def linea(dr, g, ancho_m, color, minimo=1):
        a = max(minimo, round(ancho_m * m2px))
        p = pts(g)
        if len(p) < 2:
            return
        dr.line(p, fill=color, width=a, joint="curve")
        r = a / 2
        if a > 3:  # remates redondos
            for x, y in (p[0], p[-1]):
                dr.ellipse((x - r, y - r, x + r, y + r), fill=color)

    img = Image.new("RGB", (W, H), C["tierra"])
    dr = ImageDraw.Draw(img)

    # 1. suelo industrial/portuario
    puerto = cargar(args.cache, "puerto")
    n = 0
    for el in puerto:
        t = el.get("tags", {})
        if t.get("landuse") in ("industrial", "port", "harbour", "railway"):
            rellenar(dr, el, C["industria"], C["tierra"]); n += 1
    cuenta["suelo portuario/industrial"] = n

    # 2. verde y cementerios
    n = 0
    for el in cargar(args.cache, "verde"):
        t = el.get("tags", {})
        cem = t.get("landuse") == "cemetery" or t.get("amenity") == "grave_yard"
        rellenar(dr, el, C["cementerio"] if cem else C["verde"], C["tierra"]); n += 1
    cuenta["zonas verdes/cementerios"] = n

    # 3. playa
    n = 0
    for el in cargar(args.cache, "playa"):
        rellenar(dr, el, C["playa"], C["tierra"]); n += 1
    cuenta["playa/arena"] = n

    # 4. agua: mar por relleno desde una esquina con la costa como barrera
    agua = cargar(args.cache, "agua")
    costa = [el for el in agua if el.get("tags", {}).get("natural") == "coastline"]
    mascara = Image.new("L", (P.ancho, P.alto), 0)
    dm = ImageDraw.Draw(mascara)
    for el in costa:
        g = [P.px(p["lat"], p["lon"]) for p in el.get("geometry", [])]
        if len(g) > 1:
            dm.line(g, fill=255, width=2)
    ImageDraw.floodfill(mascara, (P.ancho - 2, P.alto - 2), 128)
    mar = mascara.point(lambda v: 255 if v >= 128 else 0)  # mar + línea de costa
    mar = mar.resize((W, H), Image.NEAREST).filter(ImageFilter.GaussianBlur(1))
    mar_pct = mascara.histogram()[128] / (P.ancho * P.alto)
    if mar_pct > 0.6 or mar_pct < 0.05:
        print(f"AVISO: el mar ocupa {mar_pct:.0%}; ¿se filtró el relleno?", file=sys.stderr)
    # orilla: franja algo más clara pegada a la costa; agua profunda adentro
    hondo = mar.filter(ImageFilter.GaussianBlur(5 * SS)).point(lambda v: min(255, max(0, (v - 128) * 2)))
    img.paste(C["orilla"], (0, 0), mar)
    img.paste(C["agua"], (0, 0), hondo)
    cuenta["costa (ways)"] = len(costa)

    n = 0
    for el in agua:  # ríos y arroyos (línea) bajo los polígonos de agua
        t = el.get("tags", {})
        if t.get("waterway") in ("river", "stream", "canal") and t.get("tunnel") != "culvert":
            linea(dr, [(p["lat"], p["lon"]) for p in el["geometry"]],
                  18 if t["waterway"] == "river" else 3, C["agua"]); n += 1
    for el in agua:
        t = el.get("tags", {})
        if t.get("natural") == "water" or t.get("waterway") == "riverbank":
            rellenar(dr, el, C["agua"], C["tierra"]); n += 1
    cuenta["agua interior (ríos, estanques)"] = n

    # 5. muelles y espigones (sobre el agua)
    n = 0
    for el in puerto:
        t = el.get("tags", {})
        mm = t.get("man_made")
        if mm not in ("pier", "breakwater", "groyne", "quay"):
            continue
        n += 1
        g = el.get("geometry") or []
        cerrado = el["type"] == "relation" or (g and g[0] == g[-1] and t.get("area") != "no")
        if cerrado:
            rellenar(dr, el, C["muelle"], C["agua"])
        else:
            linea(dr, [(p["lat"], p["lon"]) for p in g], 10 if mm == "breakwater" else 6, C["muelle"])
    cuenta["muelles/espigones"] = n

    # 6. plazas peatonales (highway area)
    calles = cargar(args.cache, "calles")
    for el in calles:
        t = el.get("tags", {})
        if t.get("area") == "yes" and t.get("highway") in ("pedestrian", "footway", "service"):
            rellenar(dr, el, C["plaza"], C["tierra"])

    # 7. edificios: sombra abajo-derecha, relleno, tinta
    edificios = cargar(args.cache, "edificios")
    forma = Image.new("L", (W, H), 0)
    df = ImageDraw.Draw(forma)
    for el in edificios:
        rellenar(df, el, 255, 0)
    cuenta["edificios"] = len(edificios)
    off = round(3 * SS)
    sombra = Image.new("L", (W, H), 0)  # desplazar sin envolver (offset envuelve los bordes)
    sombra.paste(forma.crop((0, 0, W - off, H - off)), (off, off))
    sombra = sombra.filter(ImageFilter.GaussianBlur(2.5 * SS))
    sombra = sombra.point(lambda v: int(v * 0.55))
    img.paste((8, 10, 14), (0, 0), sombra)
    img.paste(C["edificio"], (0, 0), forma)
    # textura de tejados: leve variación de valor dentro de las manzanas
    tex = Image.effect_noise((W // 24, H // 24), 40).resize((W, H), Image.BICUBIC)
    tex = tex.point(lambda v: 116 + (v - 128) * 0.12)
    img = Image.composite(ImageChops.soft_light(img, Image.merge("RGB", (tex,) * 3)), img, forma)
    dr = ImageDraw.Draw(img)
    for el in edificios:
        ext, inn = anillos(el)
        for r in ext + inn:
            if len(r) > 2:
                dr.line(pts(r) + [pts(r)[0]], fill=C["tinta"], width=SS)

    # 8. ferrocarril (no túneles)
    n = 0
    for el in cargar(args.cache, "ferrocarril"):
        t = el.get("tags", {})
        if t.get("tunnel") in ("yes", "building_passage") or t.get("railway") == "subway":
            continue
        g = [(p["lat"], p["lon"]) for p in el["geometry"]]
        linea(dr, g, 5, C["via_base"])
        linea(dr, g, 1.2, C["via_traviesa"])
        n += 1
    cuenta["vías de tren"] = n

    # 9. calles por jerarquía: casco oscuro y relleno; puentes al final
    lista = []
    for el in calles:
        t = el.get("tags", {})
        h = t.get("highway")
        if h not in CALLES or t.get("area") == "yes" or t.get("tunnel") in ("yes", "building_passage"):
            continue
        if t.get("covered") == "yes":
            continue
        ancho, color, prio = CALLES[h]
        puente = t.get("bridge") not in (None, "no")
        lista.append(((1 if puente else 0, prio), ancho, color, [(p["lat"], p["lon"]) for p in el["geometry"]]))
    lista.sort(key=lambda e: e[0])
    for capa in (0, 1):
        sub = [e for e in lista if e[0][0] == capa]
        for _, ancho, _, g in sub:  # casco (tinta)
            if ancho >= 4:
                linea(dr, g, ancho + 1.5, C["tinta"])
        for _, ancho, color, g in sub:
            linea(dr, g, ancho, color)
    cuenta["calles (ways dibujados)"] = len(lista)

    # 10. reducir y grano
    img = img.resize((P.ancho, P.alto), Image.LANCZOS)
    w, h = img.size
    fino = Image.effect_noise((w, h), 30).point(lambda v: 128 + (v - 128) * 0.25)
    grueso = Image.effect_noise((w // 32, h // 32), 50).resize((w, h), Image.BICUBIC)
    grueso = grueso.point(lambda v: 128 + (v - 128) * 0.18)
    for capa in (fino, grueso):
        img = ImageChops.soft_light(img, Image.merge("RGB", (capa,) * 3))

    png = args.salida.replace(".webp", ".tmp.png")
    img.save(png)
    subprocess.run(["magick", png, "-quality", "85", "-define", "webp:method=6", args.salida], check=True)
    os.remove(png)

    geo = {
        "bbox": {"oeste": OESTE, "este": ESTE, "sur": SUR, "norte": NORTE},
        "ancho": P.ancho, "alto": P.alto,
        "metrosPorPixel": round(P.mpp, 6),
        "proyeccion": "equirectangular",
        "latMedia": P.latm,
        "formula": "x = (lon - oeste) / (este - oeste) * ancho; y = (norte - lat) / (norte - sur) * alto",
        "atribucion": ATRIBUCION,
    }
    destino_geo = os.path.join(RAIZ, "content/malaga/geo.json")
    os.makedirs(os.path.dirname(destino_geo), exist_ok=True)
    with open(destino_geo, "w", encoding="utf8") as f:
        json.dump(geo, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(cuenta, ensure_ascii=False, indent=2))
    print(f"mar: {mar_pct:.1%} del área; {args.salida} {os.path.getsize(args.salida)} bytes")


if __name__ == "__main__":
    main()
