(() => {
/* Bitácora Digital - app.js (Home)
   - TradFi Chile (UF, USD/CLP, IPSA proxy ECH)
   - Log + Base 100 + fechas alineadas + click a detalle
*/

// === URL del Worker (Cloudflare) para proxy Stooq ===
const STOOQ_PROXY = 'https://tradfi.hugopablo.workers.dev/?url=';

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
  const sets = seriesArray.map(s => new Set(s.map(p => p.time)));
  const commonDates = [...sets[0]]
    .filter(t => sets.every(S => S.has(t)))
    .sort();
  return seriesArray.map(s => s.filter(p => commonDates.includes(p.time)));
}

// Fetchers
async function fetchMindicador(tipo) {
  const url = `https://mindicador.cl/api/${tipo}`;
  console.log(`Fetching mindicador: ${tipo}`);
  
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`mindicador ${tipo} failed: ${response.status}`);
  }
  
  const json = await response.json();
  const points = json.serie.map(x => {
    const d = new Date(x.fecha);
    return { 
      time: isoMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), 
      value: Number(x.valor) 
    };
  });
  
  console.log(`✓ Mindicador ${tipo}: ${points.length} puntos`);
  return toMonthlyLast(points);
}

// Stooq mensual → via PROXY (CSV)
async function fetchStooqMonthly(ticker) {
  const realUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=m`;
  const proxyUrl = STOOQ_PROXY + encodeURIComponent(realUrl);
  
  console.log(`Fetching Stooq: ${ticker}`);
  console.log(`Proxy URL: ${proxyUrl}`);
  
  const response = await fetch(proxyUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`stooq ${ticker} failed: ${response.status}`);
  }
  
  const csv = await response.text();
  const lines = csv.trim().split(/\r?\n/).slice(1); // Skip header
  const out = [];
  
  for (const line of lines) {
    const [date, open, high, low, close, vol] = line.split(',');
    if (!date || !close) continue;
    out.push({ time: date, value: Number(close) });
  }
  
  console.log(`✓ Stooq ${ticker}: ${out.length} puntos`);
  return out;
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
      mode: 2  // 2 = logarithmic scale
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

// Dibujo del primer comparativo (TradFi Chile)
async function drawChile() {
  const root = document.getElementById('c-chile');
  const note = document.getElementById('c-chile-note');
  
  if (!root) {
    console.warn('Container #c-chile not found');
    return;
  }

  try {
    console.log('=== Iniciando carga de TradFi Chile ===');
    
    // Fetch all data in parallel
    const [uf, usd, ech] = await Promise.all([
      fetchMindicador('uf'),
      fetchMindicador('dolar'),
      fetchStooqMonthly('ech.us')
    ]);

    console.log('✓ Datos cargados exitosamente');
    console.log(`UF: ${uf.length}, USD: ${usd.length}, ECH: ${ech.length}`);

    // Intersect and normalize
    let [ufAligned, usdAligned, echAligned] = intersectDates([uf, usd, ech]);
    
    console.log(`Después de intersección: ${ufAligned.length} puntos comunes`);
    
    if (ufAligned.length === 0) {
      throw new Error('No hay fechas comunes entre las series');
    }

    ufAligned = base100(ufAligned);
    usdAligned = base100(usdAligned);
    echAligned = base100(echAligned);

    // Clear loading message
    root.innerHTML = '';

    // Create chart
    const chart = makeChart(root);
    
    // Add series
    addLine(chart, 'UF', COLORS[0]).setData(ufAligned);
    addLine(chart, 'USD/CLP', COLORS[1]).setData(usdAligned);
    addLine(chart, 'IPSA (ECH)', COLORS[2]).setData(echAligned);

    console.log('✓ Gráfico renderizado exitosamente');

    // Click → detalle
    root.style.cursor = 'pointer';
    root.onclick = () => { 
      window.location.href = '/detail/tradfi-cl'; 
    };
    
    if (note) {
      note.style.display = 'none';
    }

  } catch (error) {
    console.error('❌ Error dibujando TradFi Chile:', error);
    root.innerHTML = `<div class="bd-error">Error al cargar datos: ${error.message}</div>`;
    
    if (note) {
      note.textContent = `Error: ${error.message}`;
      note.style.display = 'block';
      note.style.color = '#f56565';
    }
  }
}

// Initialize when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing charts...');
  drawChile();
});

})();
