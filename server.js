// Dashboard de Monitoreo Inteligente de Alcantarillado - Bogotá (EAAB)
// Backend: Node.js + Express + Socket.io

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');
const { generarSugerenciaMantenimiento } = require('./ai/genkit-middleware');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- "Base de datos" en memoria + JSON ----------
const DATA_FILE = path.join(__dirname, 'data', 'sensores.json');

function cargarSensores() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
function guardarSensores(s) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2));
}

// Estructura: { [sensorId]: { sensorId, ubicacion, lat, lon, profundidadTotal,
//   distanciaVacia, ultimaLectura: { distancia, tipo, nivel, estado, ts },
//   historico: [...], alertas: [...] } }
let sensores = cargarSensores();

// Si está vacío, sembrar con sensores reales de zonas de Bogotá
if (Object.keys(sensores).length === 0) {
  const semilla = [
    { sensorId: 'ZONA-CENTRO-01', ubicacion: 'Calle 19 #7-30, Centro', lat: 4.6097, lon: -74.0717 },
    { sensorId: 'ZONA-CHAPINERO-02', ubicacion: 'Cra 13 #63-45, Chapinero', lat: 4.6533, lon: -74.0636 },
    { sensorId: 'ZONA-KENNEDY-03', ubicacion: 'Av. 1ro de Mayo, Kennedy', lat: 4.6280, lon: -74.1469 },
    { sensorId: 'ZONA-SUBA-04', ubicacion: 'Cra 91 #145-20, Suba', lat: 4.7569, lon: -74.0931 },
    { sensorId: 'ZONA-USAQUEN-05', ubicacion: 'Cl 116 #15-40, Usaquén', lat: 4.7036, lon: -74.0306 }
  ];
  for (const s of semilla) {
    sensores[s.sensorId] = {
      ...s,
      profundidadTotal: 100, // cm — profundidad de la alcantarilla
      distanciaVacia: 90,    // cm — distancia medida cuando está vacía
      ultimaLectura: null,
      historico: [],
      alertas: []
    };
  }
  guardarSensores(sensores);
}

// ---------- Lógica de evaluación ----------
// Calcula el nivel real (cm) restando la distancia medida del sensor a la
// distancia "vacía" de referencia (metodología EAAB).
function calcularNivel(sensor, distancia) {
  const nivel = sensor.distanciaVacia - distancia;
  return Math.max(0, Math.round(nivel * 10) / 10);
}

function evaluarEstado(tipo, nivel) {
  // Umbrales según el documento del proyecto
  if (tipo === 'sedimento') {
    if (nivel > 15) return { estado: 'critico', color: '#ef4444', mensaje: 'Sedimento crítico (>15cm)' };
    if (nivel > 8)  return { estado: 'alerta',  color: '#f59e0b', mensaje: 'Sedimento elevado' };
    return { estado: 'normal', color: '#22c55e', mensaje: 'Sedimento normal' };
  }
  // agua
  if (nivel > 60) return { estado: 'critico', color: '#ef4444', mensaje: 'Riesgo de encharcamiento' };
  if (nivel > 35) return { estado: 'alerta',  color: '#f59e0b', mensaje: 'Nivel de agua alto' };
  return { estado: 'normal', color: '#22c55e', mensaje: 'Nivel de agua normal' };
}

// Detecta obstrucción súbita comparando contra las últimas lecturas
function detectarObstruccionSubita(sensor, nuevoNivel, tipo) {
  const recientes = sensor.historico
    .filter(h => h.tipo === tipo)
    .slice(-5);
  if (recientes.length < 3) return false;
  const promedio = recientes.reduce((a, b) => a + b.nivel, 0) / recientes.length;
  return nuevoNivel - promedio > 10; // salto súbito de +10cm
}

// ---------- Endpoints API ----------

// Endpoint principal del sensor (ESP32)
// POST /api/sensor-data
// Body: { sensorId, distancia, tipo: "agua" | "sedimento" }
app.post('/api/sensor-data', (req, res) => {
  const { sensorId, distancia, tipo } = req.body || {};

  if (!sensorId || typeof distancia !== 'number' || !['agua', 'sedimento'].includes(tipo)) {
    return res.status(400).json({
      error: 'Payload inválido. Se esperaba { sensorId: string, distancia: number, tipo: "agua"|"sedimento" }'
    });
  }

  let sensor = sensores[sensorId];
  if (!sensor) {
    // Auto-registro de sensores nuevos
    sensor = sensores[sensorId] = {
      sensorId,
      ubicacion: 'Sin georreferenciar',
      lat: 4.7110, lon: -74.0721,
      profundidadTotal: 100,
      distanciaVacia: 90,
      ultimaLectura: null,
      historico: [],
      alertas: []
    };
  }

  const nivel = calcularNivel(sensor, distancia);
  const evalu = evaluarEstado(tipo, nivel);
  const ts = new Date().toISOString();

  const lectura = { distancia, tipo, nivel, estado: evalu.estado, color: evalu.color, mensaje: evalu.mensaje, ts };
  sensor.ultimaLectura = lectura;
  sensor.historico.push(lectura);
  if (sensor.historico.length > 200) sensor.historico.shift();

  // Alertas
  const alertasNuevas = [];
  if (evalu.estado === 'critico') {
    alertasNuevas.push({
      tipo: tipo === 'sedimento' ? 'Obstrucción por sedimento' : 'Riesgo de encharcamiento',
      severidad: 'critica',
      ubicacion: sensor.ubicacion,
      sensorId,
      mensaje: evalu.mensaje,
      ts,
      atendida: false
    });
  }
  if (detectarObstruccionSubita(sensor, nivel, tipo)) {
    alertasNuevas.push({
      tipo: 'Obstrucción súbita detectada',
      severidad: 'critica',
      ubicacion: sensor.ubicacion,
      sensorId,
      mensaje: 'Cambio abrupto en lecturas — posible bloqueo del ducto',
      ts,
      atendida: false
    });
  }
  sensor.alertas.push(...alertasNuevas);

  guardarSensores(sensores);

  // Emitir en tiempo real al frontend
  io.emit('sensor:update', { sensor });
  alertasNuevas.forEach(a => io.emit('alerta:nueva', a));

  res.json({ ok: true, lectura, alertas: alertasNuevas });
});

// Lista todos los sensores (estado actual)
app.get('/api/sensores', (req, res) => {
  res.json(Object.values(sensores));
});

// Histórico de un sensor
app.get('/api/sensores/:id/historico', (req, res) => {
  const s = sensores[req.params.id];
  if (!s) return res.status(404).json({ error: 'Sensor no encontrado' });
  res.json(s.historico);
});

// Todas las alertas (más recientes primero)
app.get('/api/alertas', (req, res) => {
  const todas = Object.values(sensores).flatMap(s => s.alertas);
  todas.sort((a, b) => b.ts.localeCompare(a.ts));
  res.json(todas);
});

// Marcar alerta como atendida
app.post('/api/alertas/atender', (req, res) => {
  const { sensorId, ts } = req.body || {};
  const s = sensores[sensorId];
  if (!s) return res.status(404).json({ error: 'Sensor no encontrado' });
  const a = s.alertas.find(x => x.ts === ts);
  if (a) a.atendida = true;
  guardarSensores(sensores);
  io.emit('alerta:atendida', { sensorId, ts });
  res.json({ ok: true });
});

// Sugerencia de mantenimiento (espacio para Genkit AI)
app.get('/api/sensores/:id/sugerencia', async (req, res) => {
  const s = sensores[req.params.id];
  if (!s) return res.status(404).json({ error: 'Sensor no encontrado' });
  try {
    const sugerencia = await generarSugerenciaMantenimiento(s);
    res.json({ sensorId: s.sensorId, sugerencia });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Socket.io ----------
io.on('connection', socket => {
  console.log('[socket] cliente conectado:', socket.id);
  socket.emit('snapshot', Object.values(sensores));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🛰️  Dashboard Alcantarillado Bogotá`);
  console.log(`    http://localhost:${PORT}`);
  console.log(`    POST datos a  http://localhost:${PORT}/api/sensor-data\n`);
});
