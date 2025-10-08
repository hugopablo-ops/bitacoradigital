(() => {
/* Bitácora Digital - app.js (Home) - VERSION VALORES REALES
   TradFi Chile: UF vs USD/CLP vs IPSA (proxy ECH)
   - Valores reales con múltiples escalas
   - Tooltip comparativo multi-serie
   - Toggle Base 100 / Valores Reales
   - Click → página de detalle
*/

// === CONFIGURACIÓN ===
const STOOQ_PROXY = window.__BD_PROXY || 'https://tradfi.hugopablo.workers.dev/?url=';
const COLORS = ["#63b3ed", "#f6ad55", "#9f7aea"];
const YEARS_TO_FETCH = 15; // 15 años de historia

// Estado global
let currentMode = 'real'; // 'real' o 'base100'
let chartInstance = null;
let seriesData = { uf: [], usd: [], ech: [] };

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
  
  try {
    const response = await fetchWithTimeout(proxyUrl, { cache: 'no-store' });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
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

// === CREAR GRÁFICO CON MÚLTIPLES ESCALAS ===
function createChart(container, mode = 'real') {
  const isLog = mode === 'base100';
  
  const chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#cfe0ff'
    },
    rightPriceScale: {
      borderColor: '#233048',
      mode: isLog ? 2 : 0, // 2 = log, 0 = normal
      visible: true
    },
    leftPriceScale: {
      borderColor: '#233048',
      visible: mode === 'real'
    },
    timeScale: {
      borderColor: '#233048',
      rightOffset: 5,
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
        style: LightweightCharts.LineStyle.Dashed
      },
      horzLine: {
        width: 1,
        color: '#4a5568',
        style: LightweightCharts.LineStyle.Dashed
      }
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true
    }
  });
  
  return chart;
}

function addLineSeries(chart, label, color, priceScale = 'right') {
  return chart.addLineSeries({
    title: label,
    color,
    lineWidth: 2,
    priceScaleId: priceScale,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    lastValueVisible: true,
    priceLineVisible: false
  });
}

// === TOOLTIP PERSONALIZADO ===
function setupTooltip(container, chart, series) {
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: absolute;
    display: none;
    padding: 12px;
    background: rgba(20, 28, 39, 0.95);
    border: 1px solid #2a3f5f;
    border-radius: 8px;
    color: #dbe4f3;
    font-size: 13px;
    line-height: 1.6;
    pointer-events: none;
    z-index: 1000;
    backdrop-filter: blur(4px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  container.appendChild(tooltip);
  
  chart.subscribeCrosshairMove(param => {
    if (
      !param.time ||
      param.point.x < 0 ||
      param.point.y < 0
    ) {
      tooltip.style.display = 'none';
      return;
    }
    
    const dateStr = new Date(param.time).toLocaleDateString('es-CL', {
      year: 'numeric',
      month: 'long'
    });
    
    let tooltipHtml = `<div style="font-weight:600;margin-bottom:6px;color:#fff">${dateStr}</div>`;
    
    series.forEach((s, idx) => {
      const data = param.seriesData.get(s.series);
      if (data) {
        const value = data.value;
        let formattedValue = '';
        
        if (currentMode === 'base100') {
          formattedValue = `${value.toFixed(2)}`;
        } else {
          if (idx === 0) { // UF
            formattedValue = `$${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          } else if (idx === 1) { // USD/CLP
            formattedValue = `$${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          } else { // IPSA
            formattedValue = `${value.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pts`;
          }
        }
        
        tooltipHtml += `
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <span style="width:10px;height:10px;border-radius:50%;background:${s.color}"></span>
            <span style="font-weight:500">${s.label}:</span>
            <span style="margin-left:auto;font-weight:600;color:${s.color}">${formattedValue}</span>
          </div>
        `;
      }
    });
    
    tooltip.innerHTML = tooltipHtml;
    tooltip.style.display = 'block';
    
    const x = Math.min(param.point.x + 20, container.clientWidth - tooltip.offsetWidth - 20);
    const y = Math.max(param.point.y - tooltip.offsetHeight - 20, 10);
    
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  });
}

// === CONTROLES DE VISUALIZACIÓN ===
function addControls(container) {
  const controls = document.createElement('div');
  controls.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    gap: 8px;
    z-index: 100;
  `;
  
  const btnBase100 = createButton('Base 100', currentMode === 'base100');
  const btnReal = createButton('Valores Reales', currentMode === 'real');
  
  btnBase100.onclick = () => switchMode('base100');
  btnReal.onclick = () => switchMode('real');
  
  controls.appendChild(btnReal);
  controls.appendChild(btnBase100);
  container.appendChild(controls);
  
  return { btnBase100, btnReal };
}

function createButton(text, active = false) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    padding: 6px 12px;
    background: ${active ? '#1f9df2' : 'rgba(26, 36, 52, 0.8)'};
    color: ${active ? '#fff' : '#96a3b7'};
    border: 1px solid ${active ? '#1f9df2' : '#2a3f5f'};
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  `;
  
  btn.onmouseenter = () => {
    if (!active) {
      btn.style.background = 'rgba(31, 157, 242, 0.1)';
      btn.style.borderColor = '#1f9df2';
    }
  };
  
  btn.onmouseleave = () => {
    if (!active) {
      btn.style.background = 'rgba(26, 36, 52, 0.8)';
      btn.style.borderColor = '#2a3f5f';
    }
  };
  
  return btn;
}

function switchMode(newMode) {
  if (newMode === currentMode) return;
  currentMode = newMode;
  renderChart();
}

// === RENDERIZAR GRÁFICO ===
function renderChart() {
  const container = document.getElementById('c-chile');
  if (!container || !seriesData.uf.length) return;
  
  // Limpiar contenedor
  container.innerHTML = '';
  
  // Crear nuevo gráfico
  chartInstance = createChart(container, currentMode);
  
  let ufData, usdData, echData;
  
  if (currentMode === 'base100') {
    ufData = base100(seriesData.uf);
    usdData = base100(seriesData.usd);
    echData = base100(seriesData.ech);
    
    const ufSeries = addLineSeries(chartInstance, 'UF', COLORS[0], 'right');
    const usdSeries = addLineSeries(chartInstance, 'USD/CLP', COLORS[1], 'right');
    const echSeries = addLineSeries(chartInstance, 'IPSA (ECH)', COLORS[2], 'right');
    
    ufSeries.setData(ufData);
    usdSeries.setData(usdData);
    echSeries.setData(echData);
    
    setupTooltip(container, chartInstance, [
      { series: ufSeries, label: 'UF', color: COLORS[0] },
      { series: usdSeries, label: 'USD/CLP', color: COLORS[1] },
      { series: echSeries, label: 'IPSA (ECH)', color: COLORS[2] }
    ]);
    
  } else {
    ufData = seriesData.uf;
    usdData = seriesData.usd;
    echData = seriesData.ech;
    
    // UF en escala izquierda
    const ufSeries = addLineSeries(chartInstance, 'UF', COLORS[0], 'left');
    ufSeries.setData(ufData);
    
    // USD/CLP en escala derecha
    const usdSeries = addLineSeries(chartInstance, 'USD/CLP', COLORS[1], 'right');
    usdSeries.setData(usdData);
    
    // IPSA en su propia escala (derecha también, auto-ajuste)
    const echSeries = addLineSeries(chartInstance, 'IPSA (ECH)', COLORS[2], 'right');
    echSeries.setData(echData);
    
    setupTooltip(container, chartInstance, [
      { series: ufSeries, label: 'UF', color: COLORS[0] },
      { series: usdSeries, label: 'USD/CLP', color: COLORS[1] },
      { series: echSeries, label: 'IPSA (ECH)', color: COLORS[2] }
    ]);
  }
  
  // Agregar controles
  addControls(container);
  
  // Fit content
  chartInstance.timeScale().fitContent();
  
  // Click handler para ir a detalle
  container.style.cursor = 'pointer';
  container.onclick = (e) => {
    if (!e.target.tagName || e.target.tagName.toLowerCase() !== 'button') {
      window.location.href = '/detail/tradfi-cl';
    }
  };
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
    const [ufAligned, usdAligned, echAligned] = intersectDates([uf, usd, ech]);
    
    if (ufAligned.length === 0) {
      throw new Error('No hay fechas comunes entre las series');
    }
    
    // Guardar datos alineados
    seriesData = {
      uf: ufAligned,
      usd: usdAligned,
      ech: echAligned
    };
    
    console.log('\n📊 Renderizando gráfico...');
    
    // Renderizar gráfico
    renderChart();
    
    console.log('✅ ¡Gráfico renderizado exitosamente!\n');
    
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
