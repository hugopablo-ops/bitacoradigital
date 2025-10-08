(() => {
/* Bitácora Digital - TradFi Chile YTD
   UF, USD/CLP e IPSA — Valores reales superpuestos
   - YTD (01-ene hasta hoy)
   - 3 ejes Y independientes
   - Tooltip con valores reales
   - Toggle visibilidad por serie
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
let seriesData = { uf: [], usd: [], ipsa: [] };
let seriesVisibility = { uf: true, usd: true, ipsa: true };

// === UTILIDADES DE FECHA ===
function getYTDRange() {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1); // 01-ene
  
  return {
    start: yearStart.toISOString().split('T')[0],
    end: now.toISOString().split('T')[0]
  };
}

function parseDate(dateStr) {
  const d = new Date(dateStr);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function formatDateForAPI(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Forward-fill: rellenar máximo 2 días faltantes
function forwardFill(data, maxGap = 2) {
  if (!data.length) return data;
  
  const filled = [data[0]];
  
  for (let i = 1; i < data.length; i++) {
    const prev = filled[filled.length - 1];
    const curr = data[i];
    
    const prevDate = new Date(prev.time);
    const currDate = new Date(curr.time);
    const daysDiff = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));
    
    // Si hay gap de 2-3 días, rellenar con valor anterior
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

// Merge series por fecha común
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
  
  const merged = {
    uf: [],
    usd: [],
    ipsa: []
  };
  
  dates.forEach(date => {
    if (ufMap.has(date)) merged.uf.push({ time: date, value: ufMap.get(date) });
    if (usdMap.has(date)) merged.usd.push({ time: date, value: usdMap.get(date) });
    if (ipsaMap.has(date)) merged.ipsa.push({ time: date, value: ipsaMap.get(date) });
  });
  
  return merged;
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

// === OBTENER DATOS YTD ===
async function fetchMindicadorYTD(tipo) {
  console.log(`\n📡 Mindicador YTD: ${tipo}`);
  
  const { start, end } = getYTDRange();
  const currentYear = new Date().getFullYear();
  
  try {
    const url = `https://mindicador.cl/api/${tipo}/${currentYear}`;
    const response = await fetchWithTimeout(url, { cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const json = await response.json();
    
    if (!json.serie || !Array.isArray(json.serie)) {
      throw new Error('Formato inválido');
    }
    
    const points = json.serie
      .map(x => {
        const d = parseDate(x.fecha);
        return {
          time: d.toISOString().split('T')[0],
          value: Number(x.valor)
        };
      })
      .filter(p => p.time >= start && p.time <= end)
      .sort((a, b) => a.time.localeCompare(b.time));
    
    console.log(`   ✅ ${points.length} puntos YTD (${points[0]?.time} → ${points[points.length-1]?.time})`);
    
    return forwardFill(points);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

async function fetchStooqYTD(ticker) {
  console.log(`\n📡 Stooq YTD: ${ticker}`);
  
  const { start, end } = getYTDRange();
  const realUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=d`; // Diario
  const proxyUrl = STOOQ_PROXY + encodeURIComponent(realUrl);
  
  try {
    const response = await fetchWithTimeout(proxyUrl, { cache: 'no-store' });
    
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
    
    const sorted = points.sort((a, b) => a.time.localeCompare(b.time));
    
    console.log(`   ✅ ${sorted.length} puntos YTD (${sorted[0]?.time} → ${sorted[sorted.length-1]?.time})`);
    
    return forwardFill(sorted);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// === CREAR GRÁFICO CON 3 EJES Y ===
function createChart(container) {
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
      visible: true,
      scaleMargins: { top: 0.1, bottom: 0.1 }
    },
    timeScale: {
      borderColor: '#233048',
      rightOffset: 3,
      timeVisible: true,
      secondsVisible: false
    },
    grid: {
      vertLines: { color: '#1a2434' },
      horzLines: { color: '#1a2434' }
    },
    localization: { 
      locale: 'es-CL',
      timeFormatter: (timestamp) => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('es-CL', { 
          day: '2-digit', 
          month: 'short' 
        });
      }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        width: 1,
        color: '#4a5568',
        style: LightweightCharts.LineStyle.Solid,
        labelBackgroundColor: '#1a2434'
      },
      horzLine: {
        visible: false
      }
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

function createSeries(chart, id, label, color, priceScaleId) {
  return chart.addLineSeries({
    color,
    lineWidth: 2.5,
    priceScaleId,
    title: label,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    lastValueVisible: true,
    priceLineVisible: false,
    lineStyle: 0 // Solid
  });
}

// === TOOLTIP PERSONALIZADO ===
function setupTooltip(container, chart) {
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
    line-height: 1.7;
    pointer-events: none;
    z-index: 1000;
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    min-width: 200px;
  `;
  container.appendChild(tooltip);
  
  const formatter = new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
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
      { key: 'uf', label: 'UF', color: COLORS.uf, prefix: '$', suffix: '' },
      { key: 'usd', label: 'USD/CLP', color: COLORS.usd, prefix: '$', suffix: '' },
      { key: 'ipsa', label: 'IPSA', color: COLORS.ipsa, prefix: '', suffix: ' pts' }
    ];
    
    series.forEach(s => {
      if (!seriesVisibility[s.key]) return;
      
      const data = param.seriesData.get(seriesInstances[s.key]);
      if (data && data.value !== undefined) {
        const formatted = formatter.format(data.value);
        html += `
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
            <span style="width:12px;height:12px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
            <span style="font-weight:500;color:#96a3b7">${s.label}:</span>
            <span style="margin-left:auto;font-weight:600;color:${s.color};font-variant-numeric:tabular-nums">
              ${s.prefix}${formatted}${s.suffix}
            </span>
          </div>
        `;
      }
    });
    
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    
    const x = Math.min(param.point.x + 20, container.clientWidth - tooltip.offsetWidth - 20);
    const y = Math.max(param.point.y - tooltip.offsetHeight - 20, 10);
    
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  });
}

// === CONTROLES DE VISIBILIDAD ===
function addLegendControls(container) {
  const legend = document.createElement('div');
  legend.style.cssText = `
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 12px;
    z-index: 100;
    background: rgba(15, 22, 32, 0.8);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #1a2434;
    backdrop-filter: blur(4px);
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

// === RENDERIZAR GRÁFICO ===
function renderChart() {
  const container = document.getElementById('c-chile');
  if (!container || !seriesData.uf.length) return;
  
  container.innerHTML = '';
  
  // Crear gráfico
  chartInstance = createChart(container);
  
  // Crear las 3 series con ejes independientes
  seriesInstances.uf = createSeries(chartInstance, 'uf', 'UF', COLORS.uf, 'left');
  seriesInstances.usd = createSeries(chartInstance, 'usd', 'USD/CLP', COLORS.usd, 'right');
  seriesInstances.ipsa = createSeries(chartInstance, 'ipsa', 'IPSA', COLORS.ipsa, 'right');
  
  // Setear datos
  seriesInstances.uf.setData(seriesData.uf);
  seriesInstances.usd.setData(seriesData.usd);
  seriesInstances.ipsa.setData(seriesData.ipsa);
  
  // Aplicar visibilidad inicial
  Object.keys(seriesVisibility).forEach(key => {
    seriesInstances[key].applyOptions({
      visible: seriesVisibility[key]
    });
  });
  
  // Tooltip
  setupTooltip(container, chartInstance);
  
  // Controles de leyenda
  addLegendControls(container);
  
  // Fit content
  chartInstance.timeScale().fitContent();
  
  // Click handler (excepto en botones)
  container.onclick = (e) => {
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'button') return;
    window.location.href = '/detail/tradfi-cl';
  };
}

// === CARGAR DATOS YTD ===
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
    
    // Cargar datos en paralelo
    const [uf, usd, ipsa] = await Promise.all([
      fetchMindicadorYTD('uf'),
      fetchMindicadorYTD('dolar'),
      fetchStooqYTD('ech.us')
    ]);
    
    console.log('\n✅ Datos YTD cargados');
    
    // Merge y forward-fill
    const merged = mergeSeries(uf, usd, ipsa);
    seriesData = merged;
    
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

// === INICIALIZACIÓN ===
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadYTDData);
} else {
  loadYTDData();
}

})();
