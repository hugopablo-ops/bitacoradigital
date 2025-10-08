(() => {
/* Bitácora Digital - app.js (TradFi Chile)
   VERSIÓN MEJORADA: Controles externos al gráfico
   Layout limpio sin superposiciones
*/

// === CONFIGURACIÓN ===
const STOOQ_PROXY = window.__BD_PROXY || 'https://tradfi.hugopablo.workers.dev/?url=';
const COLORS = {
  uf: '#63b3ed',
  usd: '#f6ad55', 
  ipsa: '#9f7aea'
};

// Estado global
let chartInstance = null;
let seriesInstances = {};
let rawData = { uf: [], usd: [], ipsa: [] };
let currentMode = 'base100';
let currentPeriod = 'YTD';
let seriesVisibility = { uf: true, usd: true, ipsa: true };

// === UTILIDADES ===
function getDateRange(period) {
  const now = new Date();
  let start;
  
  switch(period) {
    case '1M':
      start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      break;
    case '3M':
      start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      break;
    case '6M':
      start = new Date(now);
      start.setMonth(start.getMonth() - 6);
      break;
    case 'YTD':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case '1Y':
      start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      break;
    case 'All':
      start = new Date(now);
      start.setFullYear(start.getFullYear() - 15);
      break;
    default:
      start = new Date(now.getFullYear(), 0, 1);
  }
  
  return {
    start: start.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0]
  };
}

function parseDate(dateStr) {
  const d = new Date(dateStr);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
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

function mergeSeries(uf, usd, ipsa) {
  const allDates = new Set([
    ...uf.map(p => p.time),
    ...usd.map(p => p.time),
    ...ipsa.map(p => p.time)
  ]);
  
  const dates = Array.from(allDates).sort();
  const ufMap = new Map(uf.map(p => [p.time, p.value]));
  const usdMap = new Map(usd.map(p => [p.time, p.value]));
  const ipsaMap = new Map(ipsa.map(p => [p.time, p.value]));
  
  const merged = { uf: [], usd: [], ipsa: [] };
  
  dates.forEach(date => {
    if (ufMap.has(date)) merged.uf.push({ time: date, value: ufMap.get(date) });
    if (usdMap.has(date)) merged.usd.push({ time: date, value: usdMap.get(date) });
    if (ipsaMap.has(date)) merged.ipsa.push({ time: date, value: ipsaMap.get(date) });
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

// === MINDICADOR ===
async function fetchMindicador(tipo, period) {
  console.log(`\n📡 Mindicador: ${tipo} (periodo: ${period})`);
  
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 15 }, (_, i) => currentYear - i);
  
  try {
    const yearlyData = await Promise.all(
      years.map(async (year) => {
        const url = `https://mindicador.cl/api/${tipo}/${year}`;
        
        try {
          const response = await fetchWithTimeout(url, { cache: 'no-store' }, 30000);
          if (!response.ok) return [];
          
          const json = await response.json();
          if (!json.serie || !Array.isArray(json.serie)) return [];
          
          return json.serie.map(x => {
            const d = parseDate(x.fecha);
            return {
              time: d.toISOString().split('T')[0],
              value: Number(x.valor)
            };
          });
        } catch (err) {
          return [];
        }
      })
    );
    
    const allPoints = yearlyData.flat();
    if (allPoints.length === 0) throw new Error('No se obtuvieron datos');
    
    const { start, end } = getDateRange(period);
    const filteredPoints = allPoints
      .filter(p => p.time >= start && p.time <= end)
      .sort((a, b) => a.time.localeCompare(b.time));
    
    const byDate = {};
    filteredPoints.forEach(p => { byDate[p.time] = p.value; });
    const uniquePoints = Object.entries(byDate).map(([time, value]) => ({ time, value }));
    
    console.log(`   ✅ ${uniquePoints.length} puntos`);
    return forwardFill(uniquePoints);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// === STOOQ ===
async function fetchStooq(ticker, period) {
  console.log(`\n📡 Stooq: ${ticker} (periodo: ${period})`);
  
  const { start, end } = getDateRange(period);
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
      throw new Error('CSV sin columnas Date/Close');
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
    
    if (points.length === 0) throw new Error('No hay datos en el rango');
    
    const sorted = points.sort((a, b) => a.time.localeCompare(b.time));
    console.log(`   ✅ ${sorted.length} puntos`);
    return forwardFill(sorted);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// === GRÁFICO ===
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
    title: label,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    lastValueVisible: true,
    priceLineVisible: false
  });
}

// === TOOLTIP ===
function setupTooltip(container, chart, mode) {
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: absolute;
    display: none;
    padding: 14px 16px;
    background: rgba(15, 22, 32, 0.98);
    border: 1px solid #2a3f5f;
    border-radius: 10px;
    color: #dbe4f3;
    font-size: 13px;
    line-height: 1.8;
    pointer-events: none;
    z-index: 1000;
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    min-width: 240px;
  `;
  container.appendChild(tooltip);
  
  const fmtReal = new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  
  const fmtMetric = new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: mode === 'deltapct' ? 'always' : 'auto'
  });
  
  chart.subscribeCrosshairMove(param => {
    if (!param.time || param.point.x < 0 || param.point.y < 0) {
      tooltip.style.display = 'none';
      return;
    }
    
    const dateStr = new Date(param.time).toLocaleDateString('es-CL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    
    let html = `<div style="font-weight:600;margin-bottom:10px;color:#fff;border-bottom:1px solid #2a3f5f;padding-bottom:6px">${dateStr}</div>`;
    
    const series = [
      { key: 'uf', label: 'UF', color: COLORS.uf },
      { key: 'usd', label: 'USD/CLP', color: COLORS.usd },
      { key: 'ipsa', label: 'IPSA', color: COLORS.ipsa }
    ];
    
    series.forEach(s => {
      if (!seriesVisibility[s.key]) return;
      
      const chartData = param.seriesData.get(seriesInstances[s.key]);
      if (!chartData || chartData.value === undefined) return;
      
      const rawPoint = rawData[s.key].find(p => p.time === param.time);
      const realValue = rawPoint ? rawPoint.value : null;
      
      let metricValue = '—';
      let metricLabel = '';
      
      if (mode === 'base100') {
        metricValue = fmtMetric.format(chartData.value);
        metricLabel = 'Base100';
      } else if (mode === 'deltapct') {
        metricValue = fmtMetric.format(chartData.value) + '%';
        metricLabel = 'Δ%';
      }
      
      let realFormatted = '—';
      if (realValue !== null) {
        if (s.key === 'ipsa') {
          realFormatted = fmtReal.format(realValue) + ' pts';
        } else {
          realFormatted = '$' + fmtReal.format(realValue);
        }
      }
      
      html += `
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
          <span style="font-weight:500;color:#96a3b7;min-width:65px">${s.label}:</span>
          ${metricLabel ? `<span style="color:#cbd5e0;font-size:11px;min-width:50px">${metricValue}</span>` : ''}
          <span style="margin-left:auto;font-weight:600;color:${s.color};font-variant-numeric:tabular-nums">
            ${realFormatted}
          </span>
        </div>
      `;
    });
    
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    
    const x = Math.min(param.point.x + 20, container.clientWidth - tooltip.offsetWidth - 20);
    const y = Math.max(param.point.y - tooltip.offsetHeight - 20, 10);
    
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  });
}

// === CONTROLES EXTERNOS - LAYOUT LIMPIO ===
function addControlsBar(containerParent) {
  // Crear barra de controles ANTES del gráfico
  const controlsBar = document.createElement('div');
  controlsBar.id = 'controls-bar-chile';
  controlsBar.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: rgba(15, 22, 32, 0.6);
    border-radius: 10px;
    margin-bottom: 16px;
    gap: 16px;
    flex-wrap: wrap;
    border: 1px solid #1a2434;
  `;
  
  // === LADO IZQUIERDO: Leyenda de series ===
  const leftSide = document.createElement('div');
  leftSide.style.cssText = `
    display: flex;
    gap: 12px;
    align-items: center;
  `;
  
  const items = [
    { key: 'uf', label: 'UF', color: COLORS.uf },
    { key: 'usd', label: 'USD/CLP', color: COLORS.usd },
    { key: 'ipsa', label: 'IPSA', color: COLORS.ipsa }
  ];
  
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: transparent;
      border: 1px solid ${item.color};
      border-radius: 6px;
      color: ${item.color};
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      opacity: ${seriesVisibility[item.key] ? '1' : '0.35'};
    `;
    
    const dot = document.createElement('span');
    dot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${item.color};
      display: block;
    `;
    
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(item.label));
    
    btn.onclick = () => {
      seriesVisibility[item.key] = !seriesVisibility[item.key];
      seriesInstances[item.key].applyOptions({
        visible: seriesVisibility[item.key]
      });
      btn.style.opacity = seriesVisibility[item.key] ? '1' : '0.35';
    };
    
    leftSide.appendChild(btn);
  });
  
  // === LADO DERECHO: Controles de periodo y modo ===
  const rightSide = document.createElement('div');
  rightSide.style.cssText = `
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  `;
  
  // Selector de Periodo
  const periodGroup = document.createElement('div');
  periodGroup.style.cssText = `
    display: flex;
    gap: 4px;
    background: rgba(10, 15, 25, 0.8);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid #233048;
  `;
  
  const periods = ['1M', '3M', '6M', 'YTD', '1Y', 'All'];
  
  periods.forEach(p => {
    const btn = document.createElement('button');
    const isActive = currentPeriod === p;
    btn.style.cssText = `
      padding: 8px 14px;
      background: ${isActive ? '#1f9df2' : 'transparent'};
      color: ${isActive ? '#ffffff' : '#8a99b3'};
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 48px;
      text-align: center;
    `;
    btn.textContent = p;
    
    btn.onmouseover = () => {
      if (currentPeriod !== p) {
        btn.style.background = 'rgba(31, 157, 242, 0.2)';
        btn.style.color = '#1f9df2';
      }
    };
    btn.onmouseout = () => {
      if (currentPeriod !== p) {
        btn.style.background = 'transparent';
        btn.style.color = '#8a99b3';
      }
    };
    btn.onclick = () => switchPeriod(p);
    
    periodGroup.appendChild(btn);
  });
  
  rightSide.appendChild(periodGroup);
  
  // Separador visual
  const separator = document.createElement('div');
  separator.style.cssText = `
    width: 1px;
    height: 32px;
    background: #233048;
  `;
  rightSide.appendChild(separator);
  
  // Selector de Modo
  const modeGroup = document.createElement('div');
  modeGroup.style.cssText = `
    display: flex;
    gap: 4px;
    background: rgba(10, 15, 25, 0.8);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid #233048;
  `;
  
  const modes = [
    { id: 'real', label: 'Real', color: '#10b981' },
    { id: 'base100', label: 'Base100', color: '#3b82f6' },
    { id: 'deltapct', label: '%', color: '#8b5cf6' }
  ];
  
  modes.forEach(m => {
    const btn = document.createElement('button');
    const isActive = currentMode === m.id;
    btn.style.cssText = `
      padding: 8px 14px;
      background: ${isActive ? m.color : 'transparent'};
      color: ${isActive ? '#ffffff' : '#8a99b3'};
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 68px;
      text-align: center;
    `;
    btn.textContent = m.label;
    
    btn.onmouseover = () => {
      if (currentMode !== m.id) {
        btn.style.background = `${m.color}30`;
        btn.style.color = m.color;
      }
    };
    btn.onmouseout = () => {
      if (currentMode !== m.id) {
        btn.style.background = 'transparent';
        btn.style.color = '#8a99b3';
      }
    };
    btn.onclick = () => switchMode(m.id);
    
    modeGroup.appendChild(btn);
  });
  
  rightSide.appendChild(modeGroup);
  
  // Ensamblar barra completa
  controlsBar.appendChild(leftSide);
  controlsBar.appendChild(rightSide);
  
  // Insertar ANTES del contenedor del gráfico
  containerParent.insertBefore(controlsBar, containerParent.firstChild);
}

function switchMode(newMode) {
  if (newMode === currentMode) return;
  currentMode = newMode;
  renderChart();
}

function switchPeriod(newPeriod) {
  if (newPeriod === currentPeriod) return;
  currentPeriod = newPeriod;
  loadData();
}

// === RENDERIZAR ===
function renderChart() {
  const containerParent = document.getElementById('c-chile').parentElement;
  const container = document.getElementById('c-chile');
  
  if (!container || !rawData.uf.length) return;
  
  // Limpiar controles anteriores si existen
  const oldControls = document.getElementById('controls-bar-chile');
  if (oldControls) oldControls.remove();
  
  // Limpiar gráfico
  container.innerHTML = '';
  
  // Crear gráfico
  chartInstance = createChart(container, currentMode);
  
  let ufData, usdData, ipsaData;
  
  if (currentMode === 'base100') {
    ufData = toBase100(rawData.uf);
    usdData = toBase100(rawData.usd);
    ipsaData = toBase100(rawData.ipsa);
    
    seriesInstances.uf = createSeries(chartInstance, 'UF', COLORS.uf, 'right');
    seriesInstances.usd = createSeries(chartInstance, 'USD/CLP', COLORS.usd, 'right');
    seriesInstances.ipsa = createSeries(chartInstance, 'IPSA', COLORS.ipsa, 'right');
    
  } else if (currentMode === 'deltapct') {
    ufData = toDeltaPct(rawData.uf);
    usdData = toDeltaPct(rawData.usd);
    ipsaData = toDeltaPct(rawData.ipsa);
    
    seriesInstances.uf = createSeries(chartInstance, 'UF', COLORS.uf, 'right');
    seriesInstances.usd = createSeries(chartInstance, 'USD/CLP', COLORS.usd, 'right');
    seriesInstances.ipsa = createSeries(chartInstance, 'IPSA', COLORS.ipsa, 'right');
    
  } else {
    ufData = rawData.uf;
    usdData = rawData.usd;
    ipsaData = rawData.ipsa;
    
    seriesInstances.uf = createSeries(chartInstance, 'UF', COLORS.uf, 'left');
    seriesInstances.usd = createSeries(chartInstance, 'USD/CLP', COLORS.usd, 'right');
    seriesInstances.ipsa = createSeries(chartInstance, 'IPSA', COLORS.ipsa, 'right');
  }
  
  seriesInstances.uf.setData(ufData);
  seriesInstances.usd.setData(usdData);
  seriesInstances.ipsa.setData(ipsaData);
  
  Object.keys(seriesVisibility).forEach(key => {
    seriesInstances[key].applyOptions({ visible: seriesVisibility[key] });
  });
  
  setupTooltip(container, chartInstance, currentMode);
  
  // Agregar barra de controles EXTERNA
  addControlsBar(containerParent);
  
  chartInstance.timeScale().fitContent();
  
  container.onclick = (e) => {
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'button') return;
    window.location.href = '/detail/tradfi-cl';
  };
}

// === CARGAR DATOS ===
async function loadData() {
  const container = document.getElementById('c-chile');
  const noteEl = document.getElementById('c-chile-note');
  
  if (!container) {
    console.warn('❌ Contenedor #c-chile no encontrado');
    return;
  }
  
  try {
    console.log(`\n🚀 === CARGANDO TRADFI CHILE (${currentPeriod}) ===`);
    
    container.innerHTML = `
      <div class="bd-loading">
        <div class="bd-spinner"></div>
        <div>Cargando ${currentPeriod}...</div>
      </div>
    `;
    
    const [uf, usd, ipsa] = await Promise.all([
      fetchMindicador('uf', currentPeriod),
      fetchMindicador('dolar', currentPeriod),
      fetchStooq('ech.us', currentPeriod)
    ]);
    
    console.log('\n✅ Datos cargados');
    
    const merged = mergeSeries(uf, usd, ipsa);
    rawData = merged;
    
    console.log('\n📊 Renderizando gráfico...');
    renderChart();
    console.log('✅ ¡Gráfico renderizado!\n');
    
    if (noteEl) noteEl.style.display = 'none';
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    
    container.innerHTML = `
      <div style="padding:1.5rem;color:#f56565;text-align:center;line-height:1.6">
        <strong>Error al cargar datos (${currentPeriod})</strong><br>
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

// === INIT ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadData);
} else {
  loadData();
}

})();
