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
