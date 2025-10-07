(() => {
/* Bitácora Digital - app.js (Home) - VERSION DEBUG FECHAS
   - TradFi Chile (UF, USD/CLP, IPSA proxy ECH)
   - Debugging detallado de formatos de fecha
*/

// === URL del Worker (Cloudflare) para proxy Stooq ===
const STOOQ_PROXY = window.__BD_PROXY || 'https://tradfi.hugopablo.workers.dev/?url=';

// Paleta y utilidades
const COLORS = ["#63b3ed","#f6ad55","#9f7aea"]; // UF, USD/CLP, IPSA(ECH)

const isoMonth = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
};

function toMonthlyLast(points) {
  const byMonth = {};
  for (const p of points) {
    byMonth[p.time] = p.value;
  }
  return Object.entries(byMonth)
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

function base100(arr) {
  if (!arr?.length) return arr;
  const firstValidIndex = arr.findIndex(p => Number.isFinite(p.value));
  if (firstValidIndex < 0) return arr;
  const baseValue = arr[firstValidIndex].value;
  return arr.map(p => ({ 
    time: p.time, 
    value: (p.value / baseValue) * 100 
  }));
}

function intersectDates(seriesArray) {
  console.log('\n🔍 ANÁLISIS DE INTERSECCIÓN:');
  
  seriesArray.forEach((series, idx) => {
    const dates = series.map(p => p.time);
    console.log(`   Serie ${idx}: ${dates.length} fechas`);
    console.log(`     Primera: ${dates[0]}`);
    console.log(`     Última: ${dates[dates.length - 1]}`);
    console.log(`     Ejemplo primeras 3: ${dates.slice(0, 3).join(', ')}`);
  });
  
  const sets = seriesArray.map(s => new Set(s.map(p => p.time)));
  const commonDates = [...sets[0]]
    .filter(t => sets.every(S => S.has(t)))
    .sort();
  
  console.log(`   ✓ Fechas comunes encontradas: ${commonDates.length}`);
  if (commonDates.length > 0) {
    console.log(`     Primera común: ${commonDates[0]}`);
    console.log(`     Última común: ${commonDates[commonDates.length - 1]}`);
  }
  
  return seriesArray.map(s => s.filter(p => commonDates.includes(p.time)));
}

// Fetch con timeout
async function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Timeout después de ${timeout}ms`);
    }
    throw error;
  }
}

// Fetchers - OBTENER DATOS HISTÓRICOS POR AÑO
async function fetchMindicador(tipo) {
  console.log(`\n📡 Mindicador: ${tipo} (últimos 10 años)`);
  
  const currentYear = new Date().getFullYear();
  const yearsToFetch = [];
  
  // Obtener los últimos 10 años
  for (let i = 0; i < 10; i++) {
    yearsToFetch.push(currentYear - i);
  }
  
  try {
    // Hacer requests en paralelo para todos los años
    const yearlyPromises = yearsToFetch.map(async (year) => {
      const url = `https://mindicador.cl/api/${tipo}/${year}`;
      console.log(`   Obteniendo datos de ${year}...`);
      
      const response = await fetchWithTimeout(url, { cache: 'no-store' });
      
      if (!response.ok) {
        console.warn(`   ⚠️ Error año ${year}: HTTP ${response.status}`);
        return [];
      }
      
      const json = await response.json();
      
      if (!json.serie || !Array.isArray(json.serie)) {
        console.warn(`   ⚠️ Error año ${year}: formato inválido`);
        return [];
      }
      
      return json.serie.map(x => {
        const d = new Date(x.fecha);
        return { 
          time: isoMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), 
          value: Number(x.valor) 
        };
      });
    });
    
    // Esperar todas las respuestas
    const yearlyResults = await Promise.all(yearlyPromises);
    
    // Combinar todos los puntos
    const allPoints = yearlyResults.flat();
    
    if (allPoints.length === 0) {
      throw new Error('No se obtuvieron datos históricos');
    }
    
    // Agrupar por mes (tomar último valor del mes)
    const monthly = toMonthlyLast(allPoints);
    
    console.log(`   ✅ ${monthly.length} puntos mensuales`);
    console.log(`   Rango: ${monthly[0]?.time} → ${monthly[monthly.length-1]?.time}`);
    
    return monthly;
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// Stooq - CONVERTIR FECHAS A FORMATO YYYY-MM-01
async function fetchStooqMonthly(ticker) {
  const realUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=m`;
  const proxyUrl = STOOQ_PROXY + encodeURIComponent(realUrl);
  
  console.log(`\n📡 Stooq: ${ticker}`);
  console.log(`   Proxy: ${STOOQ_PROXY}`);
  
  try {
    const response = await fetchWithTimeout(proxyUrl, { cache: 'no-store' });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }
    
    const csv = await response.text();
    
    if (!csv || csv.length < 50) {
      throw new Error('CSV vacío');
    }
    
    console.log(`   CSV: ${csv.length} caracteres`);
    
    const lines = csv.trim().split(/\r?\n/);
    const header = lines[0];
    
    console.log(`   Header: ${header}`);
    
    if (!header.includes('Date') || !header.includes('Close')) {
      throw new Error('CSV sin Date/Close');
    }
    
    const out = [];
    
    for (const line of lines.slice(1)) {
      const [date, open, high, low, close, vol] = line.split(',');
      if (!date || !close) continue;
      
      const closeValue = Number(close);
      if (!Number.isFinite(closeValue)) continue;
      
      // CONVERTIR FECHA STOOQ (YYYY-MM-DD) A PRIMER DÍA DEL MES
      const parts = date.split('-');
      if (parts.length === 3) {
        const normalizedDate = `${parts[0]}-${parts[1]}-01`;
        out.push({ time: normalizedDate, value: closeValue });
      }
    }
    
    if (out.length === 0) {
      throw new Error('No se parsearon datos');
    }
    
    // Agrupar por mes (tomar último del mes)
    const monthly = toMonthlyLast(out);
    
    console.log(`   ✅ ${monthly.length} puntos mensuales`);
    console.log(`   Rango: ${monthly[0]?.time} → ${monthly[monthly.length-1]?.time}`);
    console.log(`   Ejemplos: ${monthly.slice(0, 3).map(p => p.time).join(', ')}`);
    
    return monthly;
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// Chart helpers
function makeChart(el) {
  return LightweightCharts.createChart(el, {
    layout: { 
      background: { type: 'solid', color: 'transparent' }, 
      textColor: '#cfe0ff' 
    },
    rightPriceScale: { 
      borderColor: '#233048', 
      mode: 2  // logarithmic
    },
    timeScale: { 
      borderColor: '#233048', 
      rightOffset: 2 
    },
    grid: { 
      vertLines: { color: '#1a2434' }, 
      horzLines: { color: '#1a2434' } 
    },
    localization: { locale: 'es-CL' },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal
    }
  });
}

function addLine(chart, label, color) {
  return chart.addLineSeries({ 
    title: label, 
    color, 
    lineWidth: 2 
  });
}

// Dibujo del comparativo TradFi Chile
async function drawChile() {
  const root = document.getElementById('c-chile');
  const note = document.getElementById('c-chile-note');
  
  if (!root) {
    console.warn('❌ Container #c-chile no encontrado');
    return;
  }

  try {
    console.log('\n🚀 === INICIANDO CARGA TRADFI CHILE ===');
    
    // Fetch en paralelo
    const [uf, usd, ech] = await Promise.all([
      fetchMindicador('uf'),
      fetchMindicador('dolar'),
      fetchStooqMonthly('ech.us')
    ]);

    console.log('\n✅ Todas las fuentes cargadas');

    // Intersectar fechas
    let [ufAligned, usdAligned, echAligned] = intersectDates([uf, usd, ech]);
    
    if (ufAligned.length === 0) {
      throw new Error('No hay fechas comunes entre las series');
    }

    // Normalizar a Base 100
    ufAligned = base100(ufAligned);
    usdAligned = base100(usdAligned);
    echAligned = base100(echAligned);

    console.log('\n📊 Creando gráfico...');

    // Limpiar loading
    root.innerHTML = '';

    // Crear chart
    const chart = makeChart(root);
    
    // Agregar series
    addLine(chart, 'UF', COLORS[0]).setData(ufAligned);
    addLine(chart, 'USD/CLP', COLORS[1]).setData(usdAligned);
    addLine(chart, 'IPSA (ECH)', COLORS[2]).setData(echAligned);

    console.log('✅ Gráfico renderizado exitosamente\n');

    // Click → detalle
    root.style.cursor = 'pointer';
    root.onclick = () => { 
      window.location.href = '/detail/tradfi-cl'; 
    };
    
    if (note) {
      note.style.display = 'none';
    }

  } catch (error) {
    console.error('\n❌ ERROR FATAL:', error);
    
    root.innerHTML = `<div style="padding:1rem;color:#f56565;text-align:center">
      Error al cargar datos: ${error.message}
    </div>`;
    
    if (note) {
      note.textContent = `Error: ${error.message}`;
      note.style.display = 'block';
      note.style.color = '#f56565';
    }
  }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  console.log('🎬 DOM cargado, inicializando...');
  drawChile();
});

})();
