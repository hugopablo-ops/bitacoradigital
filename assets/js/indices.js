(() => {
/* Bitácora Digital - Índices Internacionales
   SPY (S&P 500), EWG (Alemania), EWJ (Japón)
   - MEJORADO: Selector de periodo (1M, 3M, 6M, YTD, 1Y, All)
   - Botones Real/% con mejor visibilidad
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
let currentPeriod = 'YTD';
let seriesVisibility = { spy: true, ewg: true, ewj: true };

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
  
  const fmtReal = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  
  const fmtMetric = new Intl.NumberFormat('en-US', {
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
      { key: 'spy', label: 'SPY (S&P 500)', color: COLORS.spy },
      { key: 'ewg', label: 'EWG (Alemania)', color: COLORS.ewg },
      { key: 'ewj', label: 'EWJ (Japón)', color: COLORS.ewj }
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
        realFormatted = '$' + fmtReal.format(realValue);
      }
      
      html += `
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
          <span style="font-weight:500;color:#96a3b7;min-width:110px;font-size:12px">${s.label}:</span>
          ${metricLabel ? `<span style="color:#cbd5e0;font-size:11px;min-width:45px">${metricValue}</span>` : ''}
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

// === CONTROLES MEJORADOS ===
function addControls(container) {
  const controlsWrapper = document.createElement('div');
  controlsWrapper.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
  `;
  
  // Selector de Periodo
  const periodSelector = document.createElement('div');
  periodSelector.style.cssText = `
    display: flex;
    gap: 4px;
    background: rgba(15, 22, 32, 0.95);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid #1a2434;
    backdrop-filter: blur(8px);
  `;
  
  const periods = ['1M', '3M', '6M', 'YTD', '1Y', 'All'];
  
  periods.forEach(p => {
    const btn = document.createElement('button');
    const isActive = currentPeriod === p;
    btn.style.cssText = `
      padding: 6px 10px;
      background: ${isActive ? '#1f9df2' : 'transparent'};
      color: ${isActive ? '#ffffff' : '#96a3b7'};
      border: 1px solid ${isActive ? '#1f9df2' : 'transparent'};
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 42px;
      text-align: center;
    `;
    btn.textContent = p;
    btn.onmouseover = () => {
      if (currentPeriod !== p) {
        btn.style.background = 'rgba(31, 157, 242, 0.15)';
        btn.style.borderColor = '#1f9df2';
        btn.style.color = '#1f9df2';
      }
    };
    btn.onmouseout = () => {
      if (currentPeriod !== p) {
        btn.style.background = 'transparent';
        btn.style.borderColor = 'transparent';
        btn.style.color = '#96a3b7';
      }
    };
    btn.onclick = () => switchPeriod(p);
    periodSelector.appendChild(btn);
  });
  
  controlsWrapper.appendChild(periodSelector);
  
  // Selector de Modo
  const modeSelector = document.createElement('div');
  modeSelector.style.cssText = `
    display: flex;
    gap: 4px;
    background: rgba(15, 22, 32, 0.95);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid #1a2434;
    backdrop-filter: blur(8px);
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
      padding: 6px 10px;
      background: ${isActive ? m.color : 'transparent'};
      color: ${isActive ? '#ffffff' : '#96a3b7'};
      border: 1px solid ${isActive ? m.color : 'transparent'};
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      flex: 1;
      text-align: center;
      white-space: nowrap;
    `;
    btn.textContent = m.label;
    btn.onmouseover = () => {
      if (currentMode !== m.id) {
        btn.style.background = `${m.color}20`;
        btn.style.borderColor = m.color;
        btn.style.color = m.color;
      }
    };
    btn.onmouseout = () => {
      if (currentMode !== m.id) {
        btn.style.background = 'transparent';
        btn.style.borderColor = 'transparent';
        btn.style.color = '#96a3b7';
      }
    };
    btn.onclick = () => switchMode(m.id);
    modeSelector.appendChild(btn);
  });
  
  controlsWrapper.appendChild(modeSelector);
  container.appendChild(controlsWrapper);
  
  // Leyenda
  const legend = document.createElement('div');
  legend.style.cssText = `
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 8px;
    z-index: 100;
    background: rgba(15, 22, 32, 0.85);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #1a2434;
    backdrop-filter: blur(8px);
  `;
  
  const items = [
    { key: 'spy', label: 'SPY', color: COLORS.spy },
    { key: 'ewg', label: 'EWG', color: COLORS.ewg },
    { key: 'ewj', label: 'EWJ', color: COLORS.ewj }
  ];
  
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: transparent;
      border: 1px solid ${item.color};
      border-radius: 6px;
      color: ${item.color};
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      opacity: ${seriesVisibility[item.key] ? '1' : '0.4'};
    `;
    
    const dot = document.createElement('span');
    dot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${item.color};
    `;
    
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(item.label));
    
    btn.onclick = () => {
      seriesVisibility[item.key] = !seriesVisibility[item.key];
      seriesInstances[item.key].applyOptions({
        visible: seriesVisibility[item.key]
      });
      btn.style.opacity = seriesVisibility[item.key] ? '1' : '0.4';
    };
    
    legend.appendChild(btn);
  });
  
  container.appendChild(legend);
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
  const container = document.getElementById('c-indices');
  if (!container || !rawData.spy.length) return;
  
  container.innerHTML = '';
  chartInstance = createChart(container, currentMode);
  
  let spyData, ewgData, ewjData;
  
  if (currentMode === 'base100') {
    spyData = toBase100(rawData.spy);
    ewgData = toBase100(rawData.ewg);
    ewjData = toBase100(rawData.ewj);
    
    seriesInstances.spy = createSeries(chartInstance, 'SPY', COLORS.spy, 'right');
    seriesInstances.ewg = createSeries(chartInstance, 'EWG', COLORS.ewg, 'right');
    seriesInstances.ewj = createSeries(chartInstance, 'EWJ', COLORS.ewj, 'right');
    
  } else if (currentMode === 'deltapct') {
    spyData = toDeltaPct(rawData.spy);
    ewgData = toDeltaPct(rawData.ewg);
    ewjData = toDeltaPct(rawData.ewj);
    
    seriesInstances.spy = createSeries(chartInstance, 'SPY', COLORS.spy, 'right');
    seriesInstances.ewg = createSeries(chartInstance, 'EWG', COLORS.ewg, 'right');
    seriesInstances.ewj = createSeries(chartInstance, 'EWJ', COLORS.ewj, 'right');
    
  } else {
    spyData = rawData.spy;
    ewgData = rawData.ewg;
    ewjData = rawData.ewj;
    
    seriesInstances.spy = createSeries(chartInstance, 'SPY', COLORS.spy, 'left');
    seriesInstances.ewg = createSeries(chartInstance, 'EWG', COLORS.ewg, 'right');
    seriesInstances.ewj = createSeries(chartInstance, 'EWJ', COLORS.ewj, 'right');
  }
  
  seriesInstances.spy.setData(spyData);
  seriesInstances.ewg.setData(ewgData);
  seriesInstances.ewj.setData(ewjData);
  
  Object.keys(seriesVisibility).forEach(key => {
    seriesInstances[key].applyOptions({ visible: seriesVisibility[key] });
  });
  
  setupTooltip(container, chartInstance, currentMode);
  addControls(container);
  chartInstance.timeScale().fitContent();
  
  container.onclick = (e) => {
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'button') return;
    window.location.href = '/detail/indices';
  };
}

// === CARGAR DATOS ===
async function loadData() {
  const container = document.getElementById('c-indices');
  const noteEl = document.getElementById('c-indices-note');
  
  if (!container) return;
  
  try {
    console.log(`\n🚀 === CARGANDO ÍNDICES (${currentPeriod}) ===`);
    
    container.innerHTML = `
      <div class="bd-loading">
        <div class="bd-spinner"></div>
        <div>Cargando ${currentPeriod}...</div>
      </div>
    `;
    
    const [spy, ewg, ewj] = await Promise.all([
      fetchStooq('spy.us', currentPeriod),
      fetchStooq('ewg.us', currentPeriod),
      fetchStooq('ewj.us', currentPeriod)
    ]);
    
    console.log('\n✅ Índices cargados');
    
    const merged = mergeSeries(spy, ewg, ewj);
    rawData = merged;
    
    console.log('\n📊 Renderizando índices...');
    renderChart();
    console.log('✅ Índices renderizados!\n');
    
    if (noteEl) noteEl.style.display = 'none';
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    
    container.innerHTML = `
      <div style="padding:1.5rem;color:#f56565;text-align:center;line-height:1.6">
        <strong>Error al cargar índices (${currentPeriod})</strong><br>
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
