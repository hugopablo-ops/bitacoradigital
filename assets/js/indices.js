(() => {
/* Bitácora Digital - Índices Internacionales YTD
   SPY (S&P 500), EWG (Alemania), EWJ (Japón)
   - Comparación YTD con 3 modos
   - Base100 (default), Delta%, Real
   - Timeout aumentado a 30s
*/

// === CONFIGURACIÓN ===
const STOOQ_PROXY = window.__BD_PROXY || 'https://tradfi.hugopablo.workers.dev/?url=';
const COLORS = {
  spy: '#48bb78',
  ewg: '#ed8936',
  ewj: '#9f7aea'
};

// Estado global
let chartInstance = null;
let seriesInstances = {};
let rawData = { spy: [], ewg: [], ewj: [] };
let currentMode = 'base100';
let seriesVisibility = { spy: true, ewg: true, ewj: true };

// === UTILIDADES ===
function getYTDRange() {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return {
    start: yearStart.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0]
  };
}

function forwardFill(data, maxGap = 2) {
  if (!data.length) return data;
  const filled = [data[0]];
  
  for (let i = 1; i < data.length; i++) {
    const prev = filled[filled.length - 1];
    const curr = data[i];
    const prevDate = new Date(prev.time);
    const currDate = new Date(curr.time);
    const daysDiff = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > 1 && daysDiff <= maxGap + 1) {
      for (let j = 1; j < daysDiff; j++) {
        const fillDate = new Date(prevDate);
        fillDate.setDate(fillDate.getDate() + j);
        filled.push({
          time: fillDate.toISOString().split('T')[0],
          value: prev.value
        });
      }
    }
    filled.push(curr);
  }
  return filled;
}

function mergeSeries(spy, ewg, ewj) {
  const allDates = new Set([
    ...spy.map(p => p.time),
    ...ewg.map(p => p.time),
    ...ewj.map(p => p.time)
  ]);
  
  const dates = Array.from(allDates).sort();
  const spyMap = new Map(spy.map(p => [p.time, p.value]));
  const ewgMap = new Map(ewg.map(p => [p.time, p.value]));
  const ewjMap = new Map(ewj.map(p => [p.time, p.value]));
  
  const merged = { spy: [], ewg: [], ewj: [] };
  
  dates.forEach(date => {
    if (spyMap.has(date)) merged.spy.push({ time: date, value: spyMap.get(date) });
    if (ewgMap.has(date)) merged.ewg.push({ time: date, value: ewgMap.get(date) });
    if (ewjMap.has(date)) merged.ewj.push({ time: date, value: ewjMap.get(date) });
  });
  
  return merged;
}

function toBase100(arr) {
  if (!arr?.length) return arr;
  const t0 = arr[0].value;
  return arr.map(p => ({ time: p.time, value: (p.value / t0) * 100 }));
}

function toDeltaPct(arr) {
  if (!arr?.length) return arr;
  const t0 = arr[0].value;
  return arr.map(p => ({ time: p.time, value: ((p.value - t0) / t0) * 100 }));
}

async function fetchWithTimeout(url, options = {}, timeout = 30000) {
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
    if (error.name === 'AbortError') throw new Error(`Timeout (${timeout}ms)`);
    throw error;
  }
}

// === OBTENER DATOS DE STOOQ ===
async function fetchStooqYTD(ticker) {
  console.log(`\n📡 Stooq YTD: ${ticker}`);
  const { start, end } = getYTDRange();
  const realUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
  const proxyUrl = STOOQ_PROXY + encodeURIComponent(realUrl);
  
  try {
    const response = await fetchWithTimeout(proxyUrl, { cache: 'no-store' }, 30000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
     const csv = await response.text();
    if (csv.length < 50) throw new Error('CSV vacío');
    
    const lines = csv.trim().split(/\r?\n/);
    const header = lines[0];
    
    if (!header.includes('Date') || !header.includes('Close')) {
      throw new Error('CSV sin Date/Close');
    }
    
    const points = [];
    for (const line of lines.slice(1)) {
      const [date, , , , close] = line.split(',');
      if (!date || !close) continue;
      
      const value = Number(close);
      if (!Number.isFinite(value)) continue;
      
      if (date >= start && date <= end) {
        points.push({ time: date, value });
      }
    }
    
    const sorted = points.sort((a, b) => a.time.localeCompare(b.time));
    console.log(`   ✅ ${sorted.length} puntos (${sorted[0]?.time} → ${sorted[sorted.length-1]?.time})`);
    
    return forwardFill(sorted);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// === CREAR GRÁFICO ===
function createChart(container, mode) {
  const isReal = mode === 'real';
  
  const chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#cfe0ff'
    },
    rightPriceScale: {
      borderColor: '#233048',
      visible: true,
      scaleMargins: { top: 0.1, bottom: 0.1 }
    },
    leftPriceScale: {
      borderColor: '#233048',
      visible: isReal,
      scaleMargins: { top: 0.1, bottom: 0.1 }
    },
    timeScale: {
      borderColor: '#233048',
      rightOffset: 3,
      timeVisible: true
    },
    grid: {
      vertLines: { color: '#1a2434' },
      horzLines: { color: '#1a2434' }
    },
    localization: { locale: 'es-CL' },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        width: 1,
        color: '#4a5568',
        style: LightweightCharts.LineStyle.Solid
      },
      horzLine: { visible: false }
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true
    }
  });
  
  return chart;
}

function createSeries(chart, label, color, priceScaleId = 'right') {
  return chart.addLineSeries({
    color,
    lineWidth: 2.5,
    priceScaleId,
