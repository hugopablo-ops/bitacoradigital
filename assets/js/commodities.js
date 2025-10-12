// Commodities - Oro, Plata, Cobre, Litio (TOOLTIPS FUNCIONANDO)
(function() {
  'use strict';

  const SERIES_CONFIG = {
    gold: { name: 'Oro', color: '#fbbf24', ticker: 'iau.us', unit: '$' },
    silver: { name: 'Plata', color: '#9ca3af', ticker: 'slv.us', unit: '$' },
    copper: { name: 'Cobre', color: '#f97316', ticker: 'copx.us', unit: '$' },
    lithium: { name: 'Litio', color: '#06b6d4', ticker: 'lit.us', unit: '$' }
  };

  let state = {
    activeSeries: ['gold', 'silver', 'copper', 'lithium'],
    period: 'YTD',
    mode: 'Real',
    rawData: {},
    filteredData: {},
    t0Values: {},
    chart: null,
    seriesObjects: {}
  };

  let tooltipDiv = null;

  async function init() {
    const container = document.getElementById('c-commod');
    if (!container) {
      console.error('❌ No se encontró #c-commod');
      return;
    }

    console.log('📊 Iniciando Commodities...');
    setupControls();
    
    try {
      await loadAllData();
      createChart(container);
      updateChart();
      hideLoading();
      console.log('✅ Commodities cargados');
    } catch (error) {
      console.error('❌ Error Commodities:', error);
      showError(container, 'Error al cargar commodities');
    }
  }

  function setupControls() {
    const card = document.getElementById('card-commodities');
    
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
    if (!data || !data.length) return [];

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

    // Crear tooltip si no existe
    if (!tooltipDiv) {
      tooltipDiv = document.createElement('div');
      tooltipDiv.style.position = 'absolute';
      tooltipDiv.style.display = 'none';
      tooltipDiv.style.padding = '12px';
      tooltipDiv.style.background = 'rgba(0, 0, 0, 0.95)';
      tooltipDiv.style.color = '#fff';
      tooltipDiv.style.border = '1px solid #fbbf24';
      tooltipDiv.style.borderRadius = '6px';
      tooltipDiv.style.fontSize = '12px';
      tooltipDiv.style.zIndex = '9999';
      tooltipDiv.style.pointerEvents = 'none';
      tooltipDiv.style.lineHeight = '1.6';
      tooltipDiv.style.minWidth = '200px';
      tooltipDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
      container.style.position = 'relative';
      container.appendChild(tooltipDiv);
    }

    // Tooltip handler
    state.chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        tooltipDiv.style.display = 'none';
        return;
      }

      const dateStr = new Date(param.time * 1000).toISOString().split('T')[0];
      let html = `<div style="font-weight:bold;margin-bottom:8px;border-bottom:1px solid #555;padding-bottom:4px">${dateStr}</div>`;

      let hasData = false;

      state.activeSeries.forEach(id => {
        const series = state.seriesObjects[id];
        if (!series) return;

        const data = param.seriesData.get(series);
        if (!data || data.value === undefined) return;

        hasData = true;
        const config = SERIES_CONFIG[id];
        const t0 = state.t0Values[id];
        
        // Buscar valor real
        const point = state.filteredData[id]?.find(d => d.time === param.time);
        const realValue = point ? point.value : data.value;
        
        const base100 = (realValue / t0) * 100;
        const percent = ((realValue / t0) - 1) * 100;

        html += `
          <div style="margin:6px 0;padding:6px 0;border-top:1px solid rgba(255,255,255,0.1)">
            <div style="color:${config.color};font-weight:bold;margin-bottom:4px">
              ● ${config.name}
            </div>
            <div style="margin-left:16px;font-size:11px;color:#ccc">
              <div>Real: <strong>${config.unit}${realValue.toFixed(2)}</strong></div>
              <div>Base100: <strong>${base100.toFixed(2)}</strong></div>
              <div>Var %: <strong style="color:${percent >= 0 ? '#10b981' : '#ef4444'}">${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%</strong></div>
            </div>
          </div>
        `;
      });

      if (hasData) {
        tooltipDiv.innerHTML = html;
        tooltipDiv.style.display = 'block';
        
        const x = param.point.x;
        const y = param.point.y;
        
        tooltipDiv.style.left = (x + 15) + 'px';
        tooltipDiv.style.top = (y + 15) + 'px';
      } else {
        tooltipDiv.style.display = 'none';
      }
    });

    console.log('✅ Tooltip Commodities configurado');
  }

  function updateChart() {
    if (!state.chart) return;

    Object.values(state.seriesObjects).forEach(s => state.chart.removeSeries(s));
    state.seriesObjects = {};

    if (state.mode === 'Real') {
      state.chart.applyOptions({
        rightPriceScale: { visible: true },
        leftPriceScale: { visible: false }
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
      if (!raw || !raw.length) return;

      const filtered = filterByPeriod(raw);
      if (!filtered.length) return;

      state.filteredData[id] = filtered;
      state.t0Values[id] = filtered[0].value;

      const transformed = transformData(filtered, state.t0Values[id]);
      if (!transformed.length) return;

      let priceScaleId = 'right';
      if (state.mode === 'Real' && state.activeSeries.length > 1) {
        state.chart.applyOptions({ leftPriceScale: { visible: true } });
        priceScaleId = ['right', 'left', 'right', 'right'][idx % 4];
      }

      const series = state.chart.addLineSeries({
        color: config.color,
        lineWidth: 2,
        title: config.name,
        priceScaleId,
        priceFormat: {
          type: 'custom',
          formatter: (price) => {
            if (state.mode === 'Real') return config.unit + price.toFixed(2);
            if (state.mode === 'Base100') return price.toFixed(2);
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
    const loading = document.querySelector('#c-commod .bd-loading');
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

})();
