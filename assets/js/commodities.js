(() => {
/* Bitácora Digital - Commodities YTD
   Oro (GLD), Plata (SLV), Cobre (COPX), Litio (ALB)
   - Usando ETFs para mejor disponibilidad de datos
   - Timeout aumentado a 30s
*/

// === CONFIGURACIÓN ===
const STOOQ_PROXY = window.__BD_PROXY || 'https://tradfi.hugopablo.workers.dev/?url=';
const COLORS = {
  gold: '#FFD700',
  silver: '#C0C0C0',
  copper: '#B87333',
  lithium: '#7DF9FF'
};

// Estado global
let chartInstance = null;
let seriesInstances = {};
let rawData = { gold: [], silver: [], copper: [], lithium: [] };
let currentMode = 'real';
let seriesVisibility = { gold: true, silver: true, copper: true, lithium: true };

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

function mergeSeries(gold, silver, copper, lithium) {
  const allDates = new Set([
    ...gold.map(p => p.time),
    ...silver.map(p => p.time),
    ...copper.map(p => p.time),
    ...lithium.map(p => p.time)
  ]);
  
  const dates = Array.from(allDates).sort();
  const goldMap = new Map(gold.map(p => [p.time, p.value]));
  const silverMap = new Map(silver.map(p => [p.time, p.value]));
  const copperMap = new Map(copper.map(p => [p.time, p.value]));
  const lithiumMap = new Map(lithium.map(p => [p.time, p.value]));
  
  const merged = { gold: [], silver: [], copper: [], lithium: [] };
  
  dates.forEach(date => {
    if (goldMap.has(date)) merged.gold.push({ time: date, value: goldMap.get(date) });
    if (silverMap.has(date)) merged.silver.push({ time: date, value: silverMap.get(date) });
    if (copperMap.has(date)) merged.copper.push({ time: date, value: copperMap.get(date) });
    if (lithiumMap.has(date)) merged.lithium.push({ time: date, value: lithiumMap.get(date) });
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
async function fetchCommodityYTD(ticker, name) {
  console.log(`\n📡 Commodity YTD: ${name} (${ticker})`);
  const { start, end } = getYTDRange();
  const realUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
  const proxyUrl = STOOQ_PROXY + encodeURIComponent(realUrl);
  
  try {
    const response = await fetchWithTimeout(proxyUrl, { cache: 'no-store' }, 30000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const csv = await response.text();
    
    if (csv.length < 50) throw new Error('CSV muy corto');
    
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
    
    if (points.length === 0) {
      throw new Error('No hay datos en el rango YTD');
    }
    
    const sorted = points.sort((a, b) => a.time.localeCompare(b.time));
    console.log(`   ✅ ${sorted.length} puntos (${sorted[0]?.time} → ${sorted[sorted.length-1]?.time})`);
    
    return forwardFill(sorted);
    
  } catch (error) {
    console.error(`   ❌ Error ${name}: ${error.message}`);
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
    min-width: 260px;
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
      { key: 'gold', label: 'Oro ETF (GLD)', color: COLORS.gold },
      { key: 'silver', label: 'Plata ETF (SLV)', color: COLORS.silver },
      { key: 'copper', label: 'Cobre ETF (COPX)', color: COLORS.copper },
      { key: 'lithium', label: 'Litio (ALB)', color: COLORS.lithium }
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
          <span style="font-weight:500;color:#96a3b7;min-width:120px;font-size:12px">${s.label}:</span>
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

// === CONTROLES ===
function addControls(container) {
  const modeChips = document.createElement('div');
  modeChips.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    gap: 6px;
    z-index: 100;
    background: rgba(15, 22, 32, 0.9);
    padding: 6px;
    border-radius: 8px;
    border
    : 1px solid #1a2434;
  `;
  
  const modes = [
    { id: 'real', label: 'Real' },
    { id: 'base100', label: 'Base 100' },
    { id: 'deltapct', label: 'Delta %' }
  ];
  
  modes.forEach(m => {
    const chip = document.createElement('button');
    const isActive = currentMode === m.id;
    chip.style.cssText = `
      padding: 6px 12px;
      background: ${isActive ? '#1f9df2' : 'transparent'};
      color: ${isActive ? '#fff' : '#96a3b7'};
      border: 1px solid ${isActive ? '#1f9df2' : '#2a3f5f'};
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    `;
    chip.textContent = m.label;
    chip.onclick = () => switchMode(m.id);
    modeChips.appendChild(chip);
  });
  
  container.appendChild(modeChips);
  
  const legend = document.createElement('div');
  legend.style.cssText = `
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 8px;
    z-index: 100;
    background: rgba(15, 22, 32, 0.8);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #1a2434;
    flex-wrap: wrap;
  `;
  
  const items = [
    { key: 'gold', label: 'Oro', color: COLORS.gold },
    { key: 'silver', label: 'Plata', color: COLORS.silver },
    { key: 'copper', label: 'Cobre', color: COLORS.copper },
    { key: 'lithium', label: 'Litio', color: COLORS.lithium }
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

// === RENDERIZAR ===
function renderChart() {
  const container = document.getElementById('c-commodities');
  if (!container || !rawData.gold.length) return;
  
  container.innerHTML = '';
  chartInstance = createChart(container, currentMode);
  
  let goldData, silverData, copperData, lithiumData;
  
  if (currentMode === 'base100') {
    goldData = toBase100(rawData.gold);
    silverData = toBase100(rawData.silver);
    copperData = toBase100(rawData.copper);
    lithiumData = toBase100(rawData.lithium);
    
    seriesInstances.gold = createSeries(chartInstance, 'Oro', COLORS.gold, 'right');
    seriesInstances.silver = createSeries(chartInstance, 'Plata', COLORS.silver, 'right');
    seriesInstances.copper = createSeries(chartInstance, 'Cobre', COLORS.copper, 'right');
    seriesInstances.lithium = createSeries(chartInstance, 'Litio', COLORS.lithium, 'right');
    
  } else if (currentMode === 'deltapct') {
    goldData = toDeltaPct(rawData.gold);
    silverData = toDeltaPct(rawData.silver);
    copperData = toDeltaPct(rawData.copper);
    lithiumData = toDeltaPct(rawData.lithium);
    
    seriesInstances.gold = createSeries(chartInstance, 'Oro', COLORS.gold, 'right');
    seriesInstances.silver = createSeries(chartInstance, 'Plata', COLORS.silver, 'right');
    seriesInstances.copper = createSeries(chartInstance, 'Cobre', COLORS.copper, 'right');
    seriesInstances.lithium = createSeries(chartInstance, 'Litio', COLORS.lithium, 'right');
    
  } else {
    goldData = rawData.gold;
    silverData = rawData.silver;
    copperData = rawData.copper;
    lithiumData = rawData.lithium;
    
    seriesInstances.gold = createSeries(chartInstance, 'Oro', COLORS.gold, 'left');
    seriesInstances.silver = createSeries(chartInstance, 'Plata', COLORS.silver, 'right');
    seriesInstances.copper = createSeries(chartInstance, 'Cobre', COLORS.copper, 'right');
    seriesInstances.lithium = createSeries(chartInstance, 'Litio', COLORS.lithium, 'right');
  }
  
  seriesInstances.gold.setData(goldData);
  seriesInstances.silver.setData(silverData);
  seriesInstances.copper.setData(copperData);
  seriesInstances.lithium.setData(lithiumData);
  
  Object.keys(seriesVisibility).forEach(key => {
    seriesInstances[key].applyOptions({ visible: seriesVisibility[key] });
  });
  
  setupTooltip(container, chartInstance, currentMode);
  addControls(container);
  chartInstance.timeScale().fitContent();
  
  container.onclick = (e) => {
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'button') return;
    window.location.href = '/detail/commodities';
  };
}

// === CARGAR DATOS ===
async function loadCommoditiesData() {
  const container = document.getElementById('c-commodities');
  const noteEl = document.getElementById('c-commodities-note');
  
  if (!container) return;
  
  try {
    console.log('\n🚀 === CARGANDO COMMODITIES YTD ===');
    
    const { start, end } = getYTDRange();
    console.log(`   Periodo: ${start} → ${end}`);
    
    // Usar ETFs que SÍ están disponibles en Stooq:
    // gld.us = SPDR Gold Shares (proxy Oro)
    // slv.us = iShares Silver Trust (proxy Plata)
    // copx.us = Global X Copper Miners ETF (proxy Cobre)
    // alb.us = Albemarle Corp (proxy Litio)
    
    const [gold, silver, copper, lithium] = await Promise.all([
      fetchCommodityYTD('gld.us', 'Oro ETF'),
      fetchCommodityYTD('slv.us', 'Plata ETF'),
      fetchCommodityYTD('copx.us', 'Cobre ETF'),
      fetchCommodityYTD('alb.us', 'Litio')
    ]);
    
    console.log('\n✅ Commodities cargados');
    
    const merged = mergeSeries(gold, silver, copper, lithium);
    rawData = merged;
    
    console.log('\n📊 Renderizando commodities...');
    renderChart();
    console.log('✅ Commodities renderizados!\n');
    
    if (noteEl) noteEl.style.display = 'none';
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    
    container.innerHTML = `
      <div style="padding:1.5rem;color:#f56565;text-align:center;line-height:1.6">
        <strong>Error al cargar commodities</strong><br>
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
  document.addEventListener('DOMContentLoaded', loadCommoditiesData);
} else {
  loadCommoditiesData();
}

})();
