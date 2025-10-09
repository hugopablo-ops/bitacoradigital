// Índices Globales - SPY, EWG, EWJ
(function() {
  'use strict';

  const SERIES_CONFIG = {
    spy: { name: 'SPY', color: '#3b82f6', ticker: 'spy.us' },
    ewg: { name: 'EWG', color: '#10b981', ticker: 'ewg.us' },
    ewj: { name: 'EWJ', color: '#f59e0b', ticker: 'ewj.us' }
  };

  let state = {
    activeSeries: ['spy', 'ewg', 'ewj'],
    period: 'YTD',
    mode: 'Base100',
    rawData: {},
    chart: null,
    seriesObjects: {}
  };

  async function init() {
    const container = document.getElementById('c-indices');
    if (!container) {
      console.error('❌ No se encontró #c-indices');
      return;
    }

    console.log('📊 Iniciando Índices...');
    setupControls();
    
    try {
      await loadAllData();
      createChart(container);
      updateChart();
      hideLoading();
      console.log('✅ Índices cargados correctamente');
    } catch (error) {
      console.error('❌ Error Índices:', error);
      showError(container, 'Error al cargar índices');
    }
  }

  function setupControls() {
    const card = document.getElementById('card-indices');
    
    // Series toggles
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

    // Period toggles
    card.querySelectorAll('[data-period]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        card.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.period = e.currentTarget.dataset.period;
        updateChart();
      });
    });

    // Mode toggles
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

  function normalizeData(data) {
    const filtered = filterByPeriod(data);
    if (!filtered.length) return [];

    if (state.mode === 'Real') {
      return filtered;
    }

    const first = filtered[0].value;
    return filtered.map(d => {
      const value = state.mode === 'Base100' 
        ? (d.value / first) * 100
        : ((d.value - first) / first) * 100;
      return { time: d.time, value, originalValue: d.value };
    });
  }

  function createChart(container) {
    state.chart = LightweightCharts.createChart(container, {
      layout: { background: { color: '#141c27' }, textColor: '#96a3b7' },
      grid: { vertLines: { color: '#1c2636' }, horzLines: { color: '#1c2636' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1c2636' },
      timeScale: { borderColor: '#1c2636', timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: false, pressedMouseMove: false },
      handleScale: { axisPressedMouseMove: false, mouseWheel: false, pinch: false }
    });

    // Custom tooltip
    const tooltip = document.createElement('div');
    tooltip.style = `position:absolute;display:none;padding:8px 12px;background:#1a2434;border:1px solid #2e3e55;border-radius:6px;color:#dbe4f3;font-size:12px;pointer-events:none;z-index:10;`;
    container.appendChild(tooltip);

    state.chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        tooltip.style.display = 'none';
        return;
      }

      const data = state.activeSeries
        .map(id => {
          const series = state.seriesObjects[id];
          const price = param.seriesData.get(series);
          return price ? { id, price: price.value, config: SERIES_CONFIG[id] } : null;
        })
        .filter(Boolean);

      if (data.length) {
        tooltip.innerHTML = data.map(d => 
          `<div style="margin:2px 0"><span style="color:${d.config.color}">●</span> ${d.config.name}: <strong>${d.price.toFixed(2)}</strong></div>`
        ).join('');
        
        tooltip.style.display = 'block';
        tooltip.style.left = param.point.x + 15 + 'px';
        tooltip.style.top = param.point.y + 15 + 'px';
      }
    });
  }

  function updateChart() {
    if (!state.chart) return;

    // Remove old series
    Object.values(state.seriesObjects).forEach(s => state.chart.removeSeries(s));
    state.seriesObjects = {};

    // Add active series
    state.activeSeries.forEach(id => {
      const config = SERIES_CONFIG[id];
      const raw = state.rawData[id];
      if (!raw || !raw.length) return;

      const normalized = normalizeData(raw);
      if (!normalized.length) return;

      const series = state.chart.addLineSeries({
        color: config.color,
        lineWidth: 2,
        title: config.name,
        priceFormat: {
          type: 'custom',
          formatter: (price) => {
            if (state.mode === 'Real') return '$' + price.toFixed(2);
            if (state.mode === 'Base100') return price.toFixed(2);
            return price.toFixed(2) + '%';
          }
        }
      });

      series.setData(normalized);
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
