// Simulador de sensores ESP32 — envía lecturas al endpoint /api/sensor-data
// Uso:  node simulate-sensor.js

const URL = 'http://localhost:3000/api/sensor-data';
const sensores = ['ZONA-CENTRO-01', 'ZONA-CHAPINERO-02', 'ZONA-KENNEDY-03', 'ZONA-SUBA-04', 'ZONA-USAQUEN-05'];

async function enviar() {
  const sensorId = sensores[Math.floor(Math.random() * sensores.length)];
  const tipo = Math.random() > 0.5 ? 'agua' : 'sedimento';
  // distancia desde el sensor (cm). Menor distancia = más nivel.
  const distancia = Math.round((20 + Math.random() * 70) * 10) / 10;
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensorId, distancia, tipo })
    });
    const j = await r.json();
    console.log(`→ ${sensorId} ${tipo} dist=${distancia}cm → nivel=${j.lectura?.nivel}cm [${j.lectura?.estado}]`);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

console.log('Simulando sensores ESP32 cada 3s. Ctrl+C para detener.\n');
enviar();
setInterval(enviar, 3000);
