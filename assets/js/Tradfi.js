(() => {
/* Bitácora Digital - app.js (Home) - TradFi Chile YTD
   UF, USD/CLP, IPSA (proxy ECH)
   - Comparación YTD con 3 modos
   - Base100 (default), Delta%, Real
   - Timeout aumentado a 30s
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
let seriesVisibility = { uf: true, usd: true, ipsa: true };

// === UTILIDADES ===
function getYTDRange() {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return {
    start: yearStart.toISOString().split('T')[0],
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

// === MINDICADOR: OBTENER DATOS POR AÑO ===
async function fetchMindicador(tipo) {
  console.log(`\n📡 Mindicador: ${tipo} (últimos 15 años)`);
  
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 15 }, (_, i) => currentYear - i);
  
  try {
    const yearlyData = await Promise.all(
      years.map(async (year) => {
        const url = `https://mindicador.cl/api/${tipo}/${year}`;
        
        try {
          const response = await fetchWithTimeout(url, { cache: 'no-store' }, 30000);
          
          if (!response.ok) {
            console.warn(`   ⚠️ Año ${year}: HTTP ${response.status}`);
            return [];
          }
          
          const json = await response.json();
          
          if (!json.serie || !Array.isArray(json.serie)) {
            console.warn(`   ⚠️ Año ${year}: sin datos`);
            return [];
          }
          
          return json.serie.map(x => {
            const d = parseDate(x.fecha);
            return {
              time: d.toISOString().split('T')[0],
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
    
    // Filtrar solo YTD
    const { start, end } = getYTDRange();
    const ytdPoints = allPoints
      .filter(p => p.time >= start && p.time <= end)
      .sort((a, b) => a.time.localeCompare(b.time));
    
    // Eliminar duplicados por fecha (quedarse con el último)
    const byDate = {};
    ytdPoints.forEach(p => { byDate[p.time] = p.value; });
    const uniquePoints = Object.entries(byDate).map(([time, value]) => ({ time, value }));
    
    console.log(`   ✅ Total: ${uniquePoints.length} puntos YTD`);
    console.log(`   Rango: ${uniquePoints[0]?.time} → ${uniquePoints[uniquePoints.length-1]?.time}`);
    
    return forwardFill(uniquePoints);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// === STOOQ: OBTENER ETF ECH VIA PROXY ===
async function fetchStooqYTD(ticker) {
  console.log(`\n📡 Stooq YTD: ${ticker}`);
  
  const { start, end } = getYTDRange();
  const realUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
  const proxyUrl = STOOQ_PROXY + encodeURIComponent(realUrl);
  
  try {
    const response = await fetchWithTimeout(proxyUrl, { cache: 'no-store' }, 30000);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const csv = await response.text();
    
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
      
      if (date >= start && date <= end) {
        points.push({ time: date, value });
      }
    }
    
    if (points.length === 0) {
      throw new Error('No se parsearon datos del CSV');
    }
    
    const monthly = points.sort((a, b) => a.time.localeCompare(b.time));
    console.log(`   ✅ Total: ${monthly.length} puntos YTD`);
    console.log(`   Rango: ${monthly[0]?.time} → ${monthly[monthly.length-1]?.time}`);
    
    return forwardFill(monthly);
    
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
      { key: 'ipsa', label: 'IPSA (ECH)', color: COLORS.ipsa }
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
    border: 1px solid #1a2434;
  `;
  
  const modes = [
    { id: 'base100', label: 'Base 100' },
    { id: 'deltapct', label: 'Delta %' },
    { id: 'real', label: 'Real' }
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
    gap: 10px;
    z-index: 100;
    background: rgba(15, 22, 32, 0.8);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #1a2434;
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
  const container = document.getElementById('c-chile');
  if (!container || !rawData.uf.length) return;
  
  container.innerHTML = '';
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
  addControls(container);
  chartInstance.timeScale().fitContent();
  
  container.onclick = (e) => {
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'button') return;
    window.location.href = '/detail/tradfi-cl';
  };
}

// === CARGAR DATOS ===
async function loadYTDData() {
  const container = document.getElementById('c-chile');
  const noteEl = document.getElementById('c-chile-note');
  
  if (!container) {
    console.warn('❌ Contenedor #c-chile no encontrado');
    return;
  }
  
  try {
    console.log('\n🚀 === CARGANDO TRADFI CHILE YTD ===');
    
    const { start, end } = getYTDRange();
    console.log(`   Periodo: ${start} → ${end}`);
    
    const [uf, usd, ipsa] = await Promise.all([
      fetchMindicador('uf'),
      fetchMindicador('dolar'),
      fetchStooqYTD('ech.us')
    ]);
    
    console.log('\n✅ Datos YTD cargados');
    
    const merged = mergeSeries(uf, usd, ipsa);
    rawData = merged;
    
    console.log('\n📊 Renderizando gráfico YTD...');
    
    renderChart();
    
    console.log('✅ ¡Gráfico YTD renderizado!\n');
    
    if (noteEl) noteEl.style.display = 'none';
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    
    container.innerHTML = `
      <div style="padding:1.5rem;color:#f56565;text-align:center;line-height:1.6">
        <strong>Error al cargar datos YTD</strong><br>
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
  document.addEventListener('DOMContentLoaded', loadYTDData);
} else {
  loadYTDData();
}

})();
