// Frontend dashboard — vanilla JS + Socket.io + Leaflet + Chart.js

const socket = io();
let sensores = {}; // sensorId -> sensor
let markers = {};  // sensorId -> Leaflet marker
let map, chartAgua, chartSedimento;

// --- Reloj ---
setInterval(() => {
  document.getElementById('reloj').textContent = new Date().toLocaleTimeString('es-CO');
}, 1000);

// --- Mapa Leaflet ---
function initMap() {
  map = L.map('map').setView([4.6533, -74.0836], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(map);
}

function colorPorEstado(estado) {
  return estado === 'critico' ? '#ef4444'
       : estado === 'alerta'  ? '#f59e0b'
       : '#22c55e';
}

function pinIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 8px ${color};"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9]
  });
}

function actualizarMarker(s) {
  const color = s.ultimaLectura ? colorPorEstado(s.ultimaLectura.estado) : '#64748b';
  if (markers[s.sensorId]) {
    markers[s.sensorId].setIcon(pinIcon(color));
  } else {
    markers[s.sensorId] = L.marker([s.lat, s.lon], { icon: pinIcon(color) }).addTo(map);
  }
  const u = s.ultimaLectura;
  markers[s.sensorId].bindPopup(`
    <b>${s.sensorId}</b><br>${s.ubicacion}<br>
    ${u ? `${u.tipo}: <b>${u.nivel} cm</b><br><span style="color:${color}">${u.mensaje}</span>` : 'Sin lecturas'}
  `);
}

// --- Charts ---
function initCharts() {
  const opts = (label, color) => ({
    type: 'line',
    data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: color + '33', tension: .3, fill: true }] },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#cbd5e1' } } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' }, title: { display: true, text: 'cm', color: '#94a3b8' } }
      }
    }
  });
  chartAgua      = new Chart(document.getElementById('chart-agua'),      opts('Nivel agua (cm)',    '#3b82f6'));
  chartSedimento = new Chart(document.getElementById('chart-sedimento'), opts('Sedimento (cm)', '#f59e0b'));
}

function refrescarCharts() {
  // Combina los últimos 30 puntos de TODOS los sensores
  const all = Object.values(sensores).flatMap(s => s.historico.map(h => ({ ...h, sensorId: s.sensorId })));
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  const last = all.slice(-30);
  const labels = last.map(p => new Date(p.ts).toLocaleTimeString('es-CO').slice(0,8));

  chartAgua.data.labels = labels;
  chartAgua.data.datasets[0].data = last.map(p => p.tipo === 'agua' ? p.nivel : null);
  chartAgua.update();

  chartSedimento.data.labels = labels;
  chartSedimento.data.datasets[0].data = last.map(p => p.tipo === 'sedimento' ? p.nivel : null);
  chartSedimento.update();
}

// --- KPIs ---
function refrescarKPIs() {
  const arr = Object.values(sensores);
  document.getElementById('kpi-sensores').textContent = arr.length;
  const lecturas = arr.map(s => s.ultimaLectura).filter(Boolean);
  const aguas = lecturas.filter(l => l.tipo === 'agua').map(l => l.nivel);
  const seds  = lecturas.filter(l => l.tipo === 'sedimento').map(l => l.nivel);
  const prom = a => a.length ? (a.reduce((x,y)=>x+y,0)/a.length).toFixed(1) : '—';
  document.getElementById('kpi-agua').textContent      = `${prom(aguas)} cm`;
  document.getElementById('kpi-sedimento').textContent = `${prom(seds)} cm`;
  const criticas = arr.flatMap(s => s.alertas).filter(a => a.severidad === 'critica' && !a.atendida).length;
  document.getElementById('kpi-alertas').textContent = criticas;
}

// --- Tabla ---
function refrescarTabla() {
  const tbody = document.getElementById('tabla-sensores');
  tbody.innerHTML = '';
  Object.values(sensores).forEach(s => {
    const u = s.ultimaLectura;
    const color = u ? colorPorEstado(u.estado) : '#64748b';
    const estadoTxt = u ? u.estado.toUpperCase() : 'SIN DATOS';
    tbody.insertAdjacentHTML('beforeend', `
      <tr class="hover:bg-slate-800/40">
        <td class="py-2 px-2 font-mono text-xs">${s.sensorId}</td>
        <td class="py-2 px-2 text-slate-300">${s.ubicacion}</td>
        <td class="py-2 px-2">${u ? u.tipo : '—'}</td>
        <td class="py-2 px-2 text-right font-bold">${u ? u.nivel + ' cm' : '—'}</td>
        <td class="py-2 px-2"><span class="px-2 py-0.5 rounded text-xs font-semibold" style="background:${color}33;color:${color}">${estadoTxt}</span></td>
        <td class="py-2 px-2 text-xs text-slate-400">${u ? new Date(u.ts).toLocaleString('es-CO') : '—'}</td>
        <td class="py-2 px-2"><button onclick="pedirSugerencia('${s.sensorId}')" class="text-xs px-2 py-1 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/40">🤖 Sugerencia</button></td>
      </tr>
    `);
  });
}

// --- Alertas panel ---
async function refrescarAlertas() {
  const r = await fetch('/api/alertas');
  const alertas = await r.json();
  const cont = document.getElementById('alertas-list');
  document.getElementById('alert-count').textContent = alertas.filter(a => !a.atendida).length;
  if (alertas.length === 0) {
    cont.innerHTML = '<p class="text-sm text-slate-500">Sin alertas activas.</p>';
    return;
  }
  cont.innerHTML = alertas.slice(0, 30).map(a => `
    <div class="border border-slate-700 rounded p-2 ${a.atendida ? 'opacity-50' : ''}">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-sm font-semibold ${a.severidad==='critica'?'text-red-400':'text-amber-400'}">${a.tipo}</p>
          <p class="text-xs text-slate-400">${a.ubicacion}</p>
          <p class="text-xs text-slate-500">${new Date(a.ts).toLocaleString('es-CO')}</p>
        </div>
        ${a.atendida
          ? '<span class="text-xs text-green-400">✓ Atendida</span>'
          : `<button onclick="atender('${a.sensorId}','${a.ts}')" class="text-xs px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/40">Atender</button>`
        }
      </div>
    </div>
  `).join('');
}

async function atender(sensorId, ts) {
  await fetch('/api/alertas/atender', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensorId, ts })
  });
  refrescarAlertas();
  refrescarKPIs();
}

async function pedirSugerencia(sensorId) {
  const r = await fetch(`/api/sensores/${sensorId}/sugerencia`);
  const j = await r.json();
  document.getElementById('modal-content').textContent = JSON.stringify(j.sugerencia, null, 2);
  document.getElementById('modal').classList.remove('hidden');
}

// --- Alerta crítica visual + sonora ---
function dispararAlertaCritica(a) {
  const banner = document.getElementById('alert-banner');
  document.getElementById('alert-banner-text').textContent =
    `🚨 ${a.tipo} — ${a.ubicacion} (${a.sensorId})`;
  banner.classList.remove('hidden');
  try { document.getElementById('alert-sound').play(); } catch {}
}

// --- Socket.io handlers ---
socket.on('connect', () => {
  document.getElementById('status-text').textContent = 'Conectado';
});
socket.on('disconnect', () => {
  document.getElementById('status-text').textContent = 'Desconectado';
});

socket.on('snapshot', (lista) => {
  sensores = Object.fromEntries(lista.map(s => [s.sensorId, s]));
  Object.values(sensores).forEach(actualizarMarker);
  refrescarKPIs(); refrescarTabla(); refrescarCharts(); refrescarAlertas();
});

socket.on('sensor:update', ({ sensor }) => {
  sensores[sensor.sensorId] = sensor;
  actualizarMarker(sensor);
  refrescarKPIs(); refrescarTabla(); refrescarCharts();
});

socket.on('alerta:nueva', (a) => {
  refrescarAlertas(); refrescarKPIs();
  if (a.severidad === 'critica') dispararAlertaCritica(a);
});
socket.on('alerta:atendida', () => { refrescarAlertas(); refrescarKPIs(); });

// --- Init ---
initMap();
initCharts();
