// Índices - SPY, EWG, EWJ (TOOLTIPS CORREGIDOS)
(function() {
  'use strict';

  const SERIES_CONFIG = {
    spy: { name: 'SPY', color: '#3b82f6', ticker: 'spy.us', unit: '$' },
    ewg: { name: 'EWG', color: '#10b981', ticker: 'ewg.us', unit: '$' },
    ewj: { name: 'EWJ', color: '#f59e0b', ticker: 'ewj.us', unit: '$' }
  };

  let state = {
    activeSeries: ['spy', 'ewg', 'ewj'],
    period: 'YTD',
    mode: 'Base100',
    rawData: {},
    filteredData: {},
    t0Values: {},
    chart: null,
    seriesObjects: {},
    tooltip: null
  };

  async function init() {
    const container = document.getElementById('c-indices');
    if (!container) {
      console.error('❌ No se encontró #c-indices');
      return;
    }

    // Asegurar que el contenedor tenga position relative
    container.style.position = 'relative';

    console.log('📊 Iniciando Índices...');
    setupControls();
    
    try {
      await loadAllData();
      createChart(container);
      updateChart();
      hideLoading();
      console.log('✅ Índices cargados con tooltips');
    } catch (error) {
      console.error('❌ Error Índices:', error);
      showError(container, 'Error al cargar índices');
    }
  }

  function setupControls() {
    const card = document.getElementById('card-indices');
    
    card.querySelectorAll('.btn-series').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const series = e.currentTarget.dataset.series;
        const idx = state.activeSeries.indexOf(series);
        
        if (idx > -1) {
          state.activeSeries.splice(idx, 1);
          e.currentTarget.classList.remove('active');
        } else {
          state.activeSeries.push(series);
          e.currentTarget.classList.add('active');
        }
        
        updateChart();
      });
    });

    card.querySelectorAll('[data-period]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        card.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.period = e.currentTarget.dataset.period;
        updateChart();
      });
    });

    card.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        card.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.mode = e.currentTarget.dataset.mode;
        updateChart();
      });
    });
  }

  async function loadAllData() {
    for (const [id, config] of Object.entries(SERIES_CONFIG)) {
      try {
        console.log(`📡 Cargando ${config.name}...`);
        const raw = await fetchStooq(config.ticker);
        state.rawData[id] = raw;
        console.log(`✅ ${config.name}: ${raw.length} puntos`);
      } catch (error) {
        console.error(`❌ Error loading ${id}:`, error);
        state.rawData[id] = [];
      }
    }
  }

  async function fetchStooq(ticker) {
    const url = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
    const res = await fetch(window.__BD_PROXY + encodeURIComponent(url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
    if (!csv || csv.length < 50) throw new Error('CSV vacío');
    
    return csv.trim().split('\n').slice(1)
      .map(line => {
        const [date, , , , close] = line.split(',');
        const value = parseFloat(close);
        if (isNaN(value)) return null;
        return { time: date, value };
      })
      .filter(d => d !== null);
  }

  function filterByPeriod(data) {
    if (!data || data.length === 0) return [];
    
    const now = new Date();
    let cutoff;

    switch (state.period) {
      case '1M': cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
      case '3M': cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
      case '6M': cutoff = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
      case 'YTD': cutoff = new Date(now.getFullYear(), 0, 1); break;
      case '1Y': cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
      case 'All': return data;
      default: cutoff = new Date(now.getFullYear(), 0, 1);
    }

    return data.filter(d => new Date(d.time) >= cutoff);
  }

  function transformData(data, t0) {
    if (!data || data.length === 0) return [];

    if (state.mode === 'Real') {
      return data.map(d => ({ ...d, realValue: d.value }));
    }

    return data.map(d => {
      const value = state.mode === 'Base100' 
        ? (d.value / t0) * 100
        : ((d.value / t0) - 1) * 100;
      return { time: d.time, value, realValue: d.value };
    });
  }

  function createChart(container) {
    state.chart = LightweightCharts.createChart(container, {
      layout: { background: { color: '#141c27' }, textColor: '#96a3b7' },
      grid: { vertLines: { color: '#1c2636' }, horzLines: { color: '#1c2636' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1c2636' },
      leftPriceScale: { borderColor: '#1c2636' },
      timeScale: { borderColor: '#1c2636', timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: false, pressedMouseMove: false },
      handleScale: { axisPressedMouseMove: false, mouseWheel: false, pinch: false }
    });

    // Crear tooltip
    state.tooltip = document.createElement('div');
    state.tooltip.style.cssText = `
      position: absolute;
      display: none;
      padding: 12px 16px;
      background: rgba(10, 15, 30, 0.98);
      border: 1px solid #2e3e55;
      border-radius: 8px;
      color: #dbe4f3;
      font-size: 13px;
      pointer-events: none;
      z-index: 1000;
      line-height: 1.6;
      min-width: 240px;
      max-width: 340px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
      font-family: inherit;
    `;
    container.appendChild(state.tooltip);

    // Evento de crosshair
    state.chart.subscribeCrosshairMove((param) => {
      if (!param.time || param.point.x < 0 || param.point.y < 0) {
        state.tooltip.style.display = 'none';
        return;
      }

      const dateStr = new Date(param.time * 1000).toISOString().split('T')[0];
      let html = `<div style="font-weight:700;margin-bottom:10px;color:#fff;border-bottom:1px solid #2e3e55;padding-bottom:6px;font-size:14px">${dateStr}</div>`;

      let hasData = false;

      state.activeSeries.forEach(id => {
        const series = state.seriesObjects[id];
        if (!series) return;

        const price = param.seriesData.get(series);
        if (!price) return;

        hasData = true;
        const config = SERIES_CONFIG[id];
        const t0 = state.t0Values[id];
        
        const dataPoint = state.filteredData[id]?.find(d => d.time === param.time);
        const realValue = dataPoint ? dataPoint.value : price.value;
        
        const base100 = (realValue / t0) * 100;
        const percent = ((realValue / t0) - 1) * 100;

        html += `
          <div style="margin:8px 0;padding:8px 0;border-top:1px solid rgba(255,255,255,0.05)">
            <div style="color:${config.color};font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:8px;font-size:14px">
              <span style="font-size:16px">●</span> 
              <span>${config.name}</span>
            </div>
            <div style="margin-left:24px;font-size:12px;color:#96a3b7">
              <div style="margin:3px 0;display:flex;justify-content:space-between">
                <span style="color:#7a8a9f">Real:</span>
                <strong style="color:#dbe4f3;margin-left:12px">${config.unit}${realValue.toFixed(2)}</strong>
              </div>
              <div style="margin:3px 0;display:flex;justify-content:space-between">
                <span style="color:#7a8a9f">Base100:</span>
                <strong style="color:#dbe4f3;margin-left:12px">${base100.toFixed(2)}</strong>
              </div>
              <div style="margin:3px 0;display:flex;justify-content:space-between">
                <span style="color:#7a8a9f">Var %:</span>
                <strong style="color:${percent >= 0 ? '#10b981' : '#ef4444'};margin-left:12px">${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%</strong>
              </div>
            </div>
          </div>
        `;
      });

      if (hasData) {
        state.tooltip.innerHTML = html;
        state.tooltip.style.display = 'block';
        
        const containerRect = container.getBoundingClientRect();
        const tooltipRect = state.tooltip.getBoundingClientRect();
        
        let left = param.point.x + 20;
        let top = param.point.y + 20;
        
        if (left + tooltipRect.width > containerRect.width) {
          left = param.point.x - tooltipRect.width - 20;
        }
        
        if (top + tooltipRect.height > containerRect.height) {
          top = param.point.y - tooltipRect.height - 20;
        }
        
        state.tooltip.style.left = Math.max(10, left) + 'px';
        state.tooltip.style.top = Math.max(10, top) + 'px';
      } else {
        state.tooltip.style.display = 'none';
      }
    });

    console.log('✅ Tooltip Índices configurado');
  }

  function updateChart() {
    if (!state.chart) return;

    Object.values(state.seriesObjects).forEach(s => state.chart.removeSeries(s));
    state.seriesObjects = {};

    if (state.mode === 'Real') {
      state.chart.applyOptions({
        rightPriceScale: { visible: true },
        leftPriceScale: { visible: true }
      });
    } else {
      state.chart.applyOptions({
        rightPriceScale: { visible: true },
        leftPriceScale: { visible: false }
      });
    }

    state.activeSeries.forEach((id, idx) => {
      const config = SERIES_CONFIG[id];
      const raw = state.rawData[id];
      
      if (!raw || raw.length === 0) return;

      const filtered = filterByPeriod(raw);
      if (filtered.length === 0) return;

      state.filteredData[id] = filtered;
      state.t0Values[id] = filtered[0].value;

      const transformed = transformData(filtered, state.t0Values[id]);
      if (transformed.length === 0) return;

      let priceScaleId = 'right';
      if (state.mode === 'Real') {
        priceScaleId = idx % 2 === 0 ? 'left' : 'right';
      }

      const series = state.chart.addLineSeries({
        color: config.color,
        lineWidth: 2,
        title: config.name,
        priceScaleId,
        priceFormat: {
          type: 'custom',
          formatter: (price) => {
            if (state.mode === 'Real') {
              return config.unit + price.toFixed(2);
            }
            if (state.mode === 'Base100') {
              return price.toFixed(2);
            }
            return price.toFixed(2) + '%';
          }
        }
      });

      series.setData(transformed);
      state.seriesObjects[id] = series;
    });

    state.chart.timeScale().fitContent();
  }

  function hideLoading() {
    const loading = document.querySelector('#c-indices .bd-loading');
    if (loading) loading.style.display = 'none';
  }

  function showError(container, message) {
    container.innerHTML = `
      <div class="bd-error">
        <div>❌ ${message}</div>
        <button class="bd-retry" onclick="location.reload()">Reintentar</button>
      </div>
    `;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('✅ indices.js cargado');

})();
