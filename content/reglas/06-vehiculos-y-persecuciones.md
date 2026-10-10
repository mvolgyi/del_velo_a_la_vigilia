---
id: vehiculos-y-persecuciones
nombre: "Vehículos y persecuciones"
carpeta: Reglas
orden: 60
jugadores: si
---

# Vehículos y persecuciones

Málaga de noche es de quien tiene coche. Estas reglas siguen la lógica de H5: contiendas, márgenes y Desesperación.

## Conducir

Ir de Huelin al centro no pide tirada. Se tira @tirada{attributes.dexterity+skills.drive|0|Destreza + Conducir} cuando hay estrés: huir, seguir a alguien, esquivar un choque. Para seguir sin ser visto o leer el tráfico, @tirada{attributes.wits+skills.drive|0|Astucia + Conducir}.

Suma la **maniobra** del vehículo a la reserva (+1 la patrulla, −1 la furgoneta y la ambulancia).

| Situación | Dificultad / penalizador |
|---|---|
| Calle despejada, conducción tensa | 2 |
| Lluvia o asfalto mojado del puerto | +1 dif. |
| De noche sin luces (para no ser visto) | +2 dif. |
| Callejón del centro histórico, peatonal | +2 dif.; −2 extra a furgoneta y ambulancia |
| Contramano por la Alameda | +3 dif. y +1 Peligro |

Un fallo total es un golpe: el coche recibe 2 de daño.

## Persecución

La persecución es una contienda que se repite por turnos. Cada turno, el que huye y el que persigue tiran Destreza + Conducir + maniobra. El que gana suma su margen a una **ventaja** acumulada; el que pierde no resta, pero si saca fallo total, su rival gana 2 de ventaja gratis.

- **3 de ventaja para el que huye:** escapa. Los perde en el tráfico o en un garaje.
- **3 de ventaja para el perseguidor:** alcanza. Puede cerrar el paso, embestir o dejar que sus pasajeros disparen a quemarropa.
- La **velocidad** inclina la balanza: el vehículo *rápido* suma +1 al margen de cada turno ganado contra uno *lento*, si el tramo es recto (avenida, autovía del puerto). En callejones no cuenta.

**Desesperación por Credo.** Los dados de Desesperación entran cuando la persecución encaja con el Credo:
- **Marciales:** cuando persiguen para alcanzar y pelear, o embisten.
- **Clandestinos:** cuando huyen, se esconden o se pegan detrás de un coche sin ser vistos.

Otros Credos, solo si la persecución sirve a su causa directa. Las Extralimitaciones al volante son espectaculares: semáforos en rojo, terrazas arrasadas y una patrulla en camino.

## Embestir y atropellar

Embestir es una contienda: Destreza + Conducir contra Destreza + Conducir del otro conductor, o contra Destreza + Atletismo si es un peatón. Daño = **margen + N**:

| Vehículo | N |
|---|---|
| Taxi, coche, sedán, patrulla | +2 |
| Furgoneta, ambulancia | +3 |

Contra otro coche, el daño va a su estructura y sus ocupantes reciben la mitad como superficial. Contra un peatón, el atropello es superficial a poca velocidad y agravado lanzado (huesos rotos). El propio vehículo recibe la mitad del daño que hizo, redondeando hacia abajo, y sus ocupantes 1 superficial.

## Disparar desde o contra un vehículo

- **Pasajeros disparando:** −2 dados con el coche en movimiento, −3 si el conductor está maniobrando fuerte ese turno. El conductor no puede disparar y conducir a la vez sin un −3 a ambas cosas.
- **Contra los ocupantes:** el coche es cobertura. Quien está adentro se defiende con su reserva completa; el **blindaje** resta su valor al daño de cada impacto.
- **Neumáticos:** apuntar a una rueda es Compostura + Armas de fuego a dificultad 3. Si acierta, el conductor tira a dificultad +2 hasta que pare.
- **El conductor:** si queda incapacitado, el coche choca en el turno siguiente salvo que alguien agarre el volante (Destreza + Conducir, dif. 3).

## Daño al vehículo

Cada vehículo tiene **estructura** (de 6 a 10). Con la mitad o menos está **averiado**: −1 dado a Conducir y pierde un paso de velocidad. En 0, **destruido**: no anda, y si el daño fue de fuego, arde en dos turnos. Una @item{molotov} contra un coche daña la estructura y alcanza a los ocupantes si van con las ventanillas abiertas.

## Subir, bajar y viajar

En Foundry cada vehículo es un token. Para subir, poné tu token al lado y usá el botón **Subir** en el HUD del token del vehículo; para bajar, **Bajar**. Los pasajeros viajan dentro: desaparecen del mapa y se mueven con el vehículo. No entran más personas que **plazas**; el primero en subir es el conductor, salvo que el Narrador lo reasigne.

## Los vehículos de la crónica

| Vehículo | Plazas | Estructura | Maniobra | Blindaje | Dónde está |
|---|---|---|---|---|---|
| @vehiculo{seat-celula} | 5 | 7 | 0 | 0 | Garaje de Huelin |
| @vehiculo{sedan-somnia-1} | 5 | 8 | 0 | 1 | Plaza de Huelin, frente al portal de Elías |
| @vehiculo{sedan-somnia-2} | 5 | 8 | 0 | 1 | Carretería, frente a Somnia |
| @vehiculo{ambulancia-somnia} | 4 | 10 | −1 | 0 | Muelle de carga de Somnia |
| @vehiculo{furgoneta-ghoul} | 3 | 9 | −1 | 0 | Muelle Uno, muelles de carga |
| @vehiculo{taxi-malaga} | 5 | 6 | 0 | 0 | Parada de la estación María Zambrano |
| @vehiculo{patrulla-policia} | 5 | 8 | +1 | 0 | Comisaría Provincial |

Los sedanes y la patrulla son *rápidos*; la ambulancia y la furgoneta, *lentas*; el resto, normales.

## Robar un coche

Abrir y puentear un coche viejo es @tirada{attributes.dexterity+skills.larceny|2|Destreza + Latrocinio (dif. 2)}. Uno moderno con llave de proximidad pide además @tirada{attributes.intelligence+skills.technology|3|Inteligencia + Tecnología (dif. 3)}, o quitarle la llave al dueño. Si la alarma suena, la calle entera mira.

Los sedanes de Somnia llevan un **GPS de flota**. Si la célula se lleva uno sin encontrarlo (Astucia + Tecnología, dif. 2), un auto negro aparece detrás en veinte minutos. Pero el GPS también es un regalo: su historial de rutas muestra todos los portales que vigila @npc{maton-somnia|la gente de Somnia}, y lleva hasta el garaje donde aparca la @npc{dra-salas|Dra. Salas}.

Cada coche robado en zona con cámaras suma +1 Peligro. Robar la patrulla suma +2 y trae a toda la policía de Málaga.
