// Middleware para integrar Genkit AI (u otro LLM)
// Reemplaza esta función con tu flujo de Genkit cuando lo conectes.
//
// Ejemplo de integración real con Genkit:
//
//   const { genkit } = require('genkit');
//   const { googleAI } = require('@genkit-ai/googleai');
//   const ai = genkit({ plugins: [googleAI()] });
//
//   const sugerenciaFlow = ai.defineFlow('sugerenciaMantenimiento', async (sensor) => {
//     const { text } = await ai.generate({
//       model: 'googleai/gemini-1.5-flash',
//       prompt: `Eres ingeniero de la EAAB. Analiza el histórico ...`
//     });
//     return text;
//   });

async function generarSugerenciaMantenimiento(sensor) {
  const hist = sensor.historico.slice(-20);
  if (hist.length === 0) {
    return 'Sin lecturas suficientes para generar una sugerencia.';
  }

  const sedimentos = hist.filter(h => h.tipo === 'sedimento').map(h => h.nivel);
  const aguas = hist.filter(h => h.tipo === 'agua').map(h => h.nivel);
  const promSed = sedimentos.length ? sedimentos.reduce((a, b) => a + b, 0) / sedimentos.length : 0;
  const promAgua = aguas.length ? aguas.reduce((a, b) => a + b, 0) / aguas.length : 0;
  const criticas = sensor.alertas.filter(a => a.severidad === 'critica').length;

  // --- Heurística temporal (placeholder hasta integrar Genkit) ---
  const recomendaciones = [];
  if (promSed > 15) {
    recomendaciones.push('Programar limpieza mecánica urgente — sedimento promedio supera el umbral crítico (15 cm).');
  } else if (promSed > 8) {
    recomendaciones.push('Programar limpieza preventiva en los próximos 7 días.');
  } else {
    recomendaciones.push('Sedimento dentro de rangos normales. Mantener inspección rutinaria mensual.');
  }
  if (promAgua > 60) {
    recomendaciones.push('Verificar pendiente y obstrucciones aguas abajo — riesgo de encharcamiento.');
  }
  if (criticas >= 3) {
    recomendaciones.push(`Se han registrado ${criticas} alertas críticas — escalar a cuadrilla EAAB de respuesta.`);
  }

  return {
    sensor: sensor.sensorId,
    ubicacion: sensor.ubicacion,
    promedioSedimento: Math.round(promSed * 10) / 10,
    promedioAgua: Math.round(promAgua * 10) / 10,
    alertasCriticas: criticas,
    recomendaciones,
    generadoPor: 'heuristica-local (sustituir por Genkit AI)',
    ts: new Date().toISOString()
  };
}

module.exports = { generarSugerenciaMantenimiento };
