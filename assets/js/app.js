(() => {
/* Bitácora Digital - app.js (Home) - VERSION LIMPIA Y FUNCIONAL
   TradFi Chile: UF vs USD/CLP vs IPSA (proxy ECH)
   - Datos históricos por año desde Mindicador
   - Stooq via proxy para ECH
   - Base 100 + Log scale
*/

// === CONFIGURACIÓN ===
const STOOQ_PROXY = window.__BD_PROXY || 'https://tradfi.hugopablo.workers.dev/?url=';
const COLORS = ["#63b3ed", "#f6ad55", "#9f7aea"];
const YEARS_TO_FETCH = 10;

// === UTILIDADES ===
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
  const firstValid = arr.findIndex(p => Number.isFinite(p.value));
  if (firstValid < 0) return arr;
  const base = arr[firstValid].value;
  return arr.map(p => ({ time: p.time, value: (p.value / base) * 100 }));
}

function intersectDates(seriesArray) {
  console.log('\n🔍 INTERSECCIÓN DE FECHAS:');
  
  seriesArray.forEach((series, idx) => {
    const dates = series.map(p => p.time);
    console.log(`   Serie ${idx}: ${dates.length} fechas (${dates[0]} → ${dates[dates.length-1]})`);
  });
  
  const sets = seriesArray.map(s => new Set(s.map(p => p.time)));
  const common = [...sets[0]].filter(t => sets.every(S => S.has(t))).sort();
  
  console.log(`   ✅ Fechas comunes: ${common.length}`);
  if (common.length > 0) {
    console.log(`   Rango común: ${common[0]} → ${common[common.length-1]}`);
  }
  
  return seriesArray.map(s => s.filter(p => common.includes(p.time)));
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
      throw new Error(`Timeout (${timeout}ms)`);
    }
    throw error;
  }
}

// === MINDICADOR: OBTENER DATOS POR AÑO ===
async function fetchMindicador(tipo) {
  console.log(`\n📡 Mindicador: ${tipo} (últimos ${YEARS_TO_FETCH} años)`);
  
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: YEARS_TO_FETCH }, (_, i) => currentYear - i);
  
  try {
    const yearlyData = await Promise.all(
      years.map(async (year) => {
        const url = `https://mindicador.cl/api/${tipo}/${year}`;
        
        try {
          const response = await fetchWithTimeout(url, { cache: 'no-store' });
          
          if (!response.ok) {
            console.warn(`   ⚠️ Año ${year}: HTTP ${response.status}`);
            return [];
          }
          
          const json = await response.json();
          
          if (!json.serie || !Array.isArray(json.serie)) {
            console.warn(`   ⚠️ Año ${year}: sin datos`);
            return [];
          }
          
          console.log(`   ✓ Año ${year}: ${json.serie.length} registros`);
          
          return json.serie.map(x => {
            const d = new Date(x.fecha);
            return {
              time: isoMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))),
              value: Number(x.valor)
            };
          });
          
        } catch (err) {
          console.warn(`   ⚠️ Año ${year}: ${err.message}`);
          return [];
        }
      })
    );
    
    const allPoints = yearlyData.flat();
    
    if (allPoints.length === 0) {
      throw new Error('No se obtuvieron datos');
    }
    
    const monthly = toMonthlyLast(allPoints);
    console.log(`   ✅ Total: ${monthly.length} puntos mensuales`);
    console.log(`   Rango: ${monthly[0]?.time} → ${monthly[monthly.length-1]?.time}`);
    
    return monthly;
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// === STOOQ: OBTENER ETF ECH VIA PROXY ===
async function fetchStooqMonthly(ticker) {
  console.log(`\n📡 Stooq: ${ticker}`);
  
  const realUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=m`;
  const proxyUrl = STOOQ_PROXY + encodeURIComponent(realUrl);
  
  console.log(`   Proxy: ${proxyUrl}`);
  
  try {
    const response = await fetchWithTimeout(proxyUrl, { cache: 'no-store' });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.substring(0, 100)}`);
    }
    
    const csv = await response.text();
    console.log(`   CSV: ${csv.length} caracteres`);
    
    if (csv.length < 50) {
      throw new Error('CSV vacío');
    }
    
    const lines = csv.trim().split(/\r?\n/);
    const header = lines[0];
    
    if (!header.includes('Date') || !header.includes('Close')) {
      throw new Error('CSV sin columnas Date/Close');
    }
    
    const points = [];
    
    for (const line of lines.slice(1)) {
      const [date, , , , close] = line.split(',');
      if (!date || !close) continue;
      
      const value = Number(close);
      if (!Number.isFinite(value)) continue;
      
      // Normalizar a primer día del mes: YYYY-MM-DD → YYYY-MM-01
      const parts = date.split('-');
      if (parts.length === 3) {
        const normalized = `${parts[0]}-${parts[1]}-01`;
        points.push({ time: normalized, value });
      }
    }
    
    if (points.length === 0) {
      throw new Error('No se parsearon datos del CSV');
    }
    
    const monthly = toMonthlyLast(points);
    console.log(`   ✅ Total: ${monthly.length} puntos mensuales`);
    console.log(`   Rango: ${monthly[0]?.time} → ${monthly[monthly.length-1]?.time}`);
    
    return monthly;
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// === GRÁFICO ===
function createChart(container) {
  return LightweightCharts.createChart(container, {
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

function addLineSeries(chart, label, color) {
  return chart.addLineSeries({
    title: label,
    color,
    lineWidth: 2
  });
}

// === DIBUJA EL GRÁFICO TRADFI CHILE ===
async function drawChile() {
  const container = document.getElementById('c-chile');
  const noteEl = document.getElementById('c-chile-note');
  
  if (!container) {
    console.warn('❌ Contenedor #c-chile no encontrado');
    return;
  }
  
  try {
    console.log('\n🚀 === INICIANDO TRADFI CHILE ===');
    
    // Cargar las 3 fuentes en paralelo
    const [uf, usd, ech] = await Promise.all([
      fetchMindicador('uf'),
      fetchMindicador('dolar'),
      fetchStooqMonthly('ech.us')
    ]);
    
    console.log('\n✅ Todas las fuentes cargadas');
    
    // Intersectar fechas comunes
    let [ufAligned, usdAligned, echAligned] = intersectDates([uf, usd, ech]);
    
    if (ufAligned.length === 0) {
      throw new Error('No hay fechas comunes entre las series');
    }
    
    // Normalizar a Base 100
    ufAligned = base100(ufAligned);
    usdAligned = base100(usdAligned);
    echAligned = base100(echAligned);
    
    console.log('\n📊 Renderizando gráfico...');
    
    // Limpiar mensaje de carga
    container.innerHTML = '';
    
    // Crear gráfico
    const chart = createChart(container);
    
    // Agregar series
    addLineSeries(chart, 'UF', COLORS[0]).setData(ufAligned);
    addLineSeries(chart, 'USD/CLP', COLORS[1]).setData(usdAligned);
    addLineSeries(chart, 'IPSA (ECH)', COLORS[2]).setData(echAligned);
    
    console.log('✅ ¡Gráfico renderizado exitosamente!\n');
    
    // Hacer clickeable
    container.style.cursor = 'pointer';
    container.onclick = () => {
      window.location.href = '/detail/tradfi-cl';
    };
    
    if (noteEl) {
      noteEl.style.display = 'none';
    }
    
  } catch (error) {
    console.error('\n❌ ERROR FATAL:', error);
    
    container.innerHTML = `
      <div style="padding:1.5rem;color:#f56565;text-align:center;line-height:1.6">
        <strong>Error al cargar datos</strong><br>
        <small style="color:#cbd5e0">${error.message}</small>
      </div>
    `;
    
    if (noteEl) {
      noteEl.textContent = `Error: ${error.message}`;
      noteEl.style.display = 'block';
      noteEl.style.color = '#f56565';
    }
  }
}

// === INICIALIZACIÓN ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🎬 DOM cargado, inicializando...');
    drawChile();
  });
} else {
  console.log('🎬 DOM ya cargado, inicializando...');
  drawChile();
}

})();
