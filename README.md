# Dashboard Inteligente de Alcantarillado · Bogotá (EAAB)

Stack: **Node.js + Express + Socket.io** (backend) · **HTML5 + Tailwind CSS + JS vanilla + Leaflet + Chart.js** (frontend).

## Instalación

```bash
npm install
npm start          # → http://localhost:3000
```

(Opcional) en otra terminal, simulador de sensores ESP32:

```bash
npm run simulate
```

## Endpoint principal — datos del sensor (ESP32)

`POST http://localhost:3000/api/sensor-data`

```json
{ "sensorId": "ZONA-CENTRO-01", "distancia": 75.4, "tipo": "sedimento" }
```

`tipo` ∈ `"agua" | "sedimento"`. El servidor calcula el nivel real restando la
distancia medida de la **distancia vacía** configurada por sensor (metodología
EAAB), evalúa el estado contra los umbrales del proyecto (sedimento > 15 cm =
crítico) y emite la actualización en tiempo real al dashboard vía Socket.io.

### Ejemplo ESP32 (Arduino C++)

```cpp
String json = "{\"sensorId\":\"ZONA-CENTRO-01\",\"distancia\":" +
              String(distanciaCalculada) + ",\"tipo\":\"sedimento\"}";
http.begin("http://TU_IP:3000/api/sensor-data");
http.addHeader("Content-Type", "application/json");
http.POST(json);
http.end();
```

## Otras rutas

| Método | Ruta | Descripción |
|---|---|---|
| GET  | `/api/sensores` | Estado actual de todos los sensores |
| GET  | `/api/sensores/:id/historico` | Histórico de lecturas del sensor |
| GET  | `/api/sensores/:id/sugerencia` | Sugerencia de mantenimiento (Genkit AI) |
| GET  | `/api/alertas` | Todas las alertas, más recientes primero |
| POST | `/api/alertas/atender` | `{ sensorId, ts }` — marcar como atendida |

## Integración con Genkit AI

`ai/genkit-middleware.js` expone `generarSugerenciaMantenimiento(sensor)`.
Hoy contiene una heurística local; reemplázala por tu flujo de Genkit
(ejemplo comentado dentro del archivo) y el frontend lo consumirá tal cual.

## Características

- Tabla y mapa que se actualizan **en vivo** con cada POST del sensor.
- Marcadores Leaflet cambian de color según el estado (verde/amarillo/rojo).
- Banner rojo + sonido cuando se detecta una **obstrucción crítica o súbita**.
- Cálculo automático del nivel real (resta `distanciaVacia − distancia`).
- Persistencia en `data/sensores.json` (sin base de datos externa).
