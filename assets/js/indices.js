// TradFi Chile - UF, USD/CLP, IPSA (CORREGIDO)
(function() {
  'use strict';

  const SERIES_CONFIG = {
    uf: { name: 'UF', color: '#3b82f6', source: 'mindicador', ticker: 'uf', unit: 'UF' },
    usd: { name: 'USD/CLP', color: '#f59e0b', source: 'mindicador', ticker: 'dolar', unit: '$' },
    ipsa: { name: 'IPSA', color: '#a855f7', source: 'stooq', ticker: 'ech.us', unit: '' }
  };

  let state = {
    activeSeries: ['uf', 'usd', 'ipsa'],
    period: 'YTD',
    mode: 'Base100',
    rawData: {},
    filteredData: {},
    t0Values: {},
    chart: null,
    seriesObjects: {},
    leftScale: null,
    rightScale: null
  };

  async function init() {
    const container = document.getElementById('c-chile');
    if (!container) return;

    setupControls();
    
    try {
      await loadAllData();
      createChart(container);
      updateChart();
      hideLoading();
      console.log('✅ TradFi Chile cargado');
    } catch (error) {
      console.error('❌ Error TradFi Chile:', error);
      showError(container, 'Error al cargar datos de Chile');
    }
  }

  function setupControls() {
    const card = document.getElementById('card-chile');
    
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
    console.log('📡 Cargando datos TradFi Chile...');
    
    for (const [id, config] of Object.entries(SERIES_CONFIG)) {
      try {
        console.log(`Cargando ${config.name}...`);
        const raw = config.source === 'mindicador' 
          ? await fetchMindicador(config.ticker)
          : await fetchStooq(config.ticker);
        
        state.rawData[id] = raw;
        console.log(`✅ ${config.name}: ${raw.length} puntos`);
      } catch (error) {
        console.error(`❌ Error loading ${id}:`, error);
        state.rawData[id] = [];
      }
    }
  }

  async function fetchMindicador(indicator) {
    // Intentar obtener todo el año actual
    const url = `https://mindicador.cl/api/${indicator}/${new Date().getFullYear()}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Si falla, intentar sin año específico
        const res2 = await fetch(`https://mindicador.cl/api/${indicator}`);
        if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
        const json2 = await res2.json();
        return parseMindicadorData(json2);
      }
      
      const json = await res.json();
      return parseMindicadorData(json);
    } catch (error) {
      console.error('Error en fetchMindicador:', error);
      // Fallback: intentar API sin año
      const res = await fetch(`https://mindicador.cl/api/${indicator}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return parseMindicadorData(json);
    }
  }

  function parseMindicadorData(json) {
    if (!json.serie || !Array.isArray(json.serie)) {
      throw new Error('Formato de datos inválido');
    }

    return json.serie
      .map(d => {
        const date = d.fecha.split('T')[0];
        const value = parseFloat(d.valor);
        if (isNaN(value)) return null;
        return { time: date, value };
      })
      .filter(d => d !== null)
      .reverse(); // Ordenar de más antiguo a más reciente
  }

  async function fetchStooq(ticker) {
    const url = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
    const res = await fetch(window.__BD_PROXY + encodeURIComponent(url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
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
      case '1M':
        cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        break;
      case '3M':
        cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        break;
      case '6M':
        cutoff = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
        break;
      case 'YTD':
        cutoff = new Date(now.getFullYear(), 0, 1);
        break;
      case '1Y':
        cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        break;
      case 'All':
        return data;
      default:
        cutoff = new Date(now.getFullYear(), 0, 1);
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

    // Tooltip mejorado
    const tooltip = document.createElement('div');
    tooltip.style = `position:absolute;display:none;padding:10px 14px;background:#1a2434;border:1px solid #2e3e55;border-radius:8px;color:#dbe4f3;font-size:12px;pointer-events:none;z-index:10;line-height:1.6;min-width:220px;max-width:320px;`;
    container.appendChild(tooltip);

    state.chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        tooltip.style.display = 'none';
        return;
      }

      const dateStr = new Date(param.time * 1000).toISOString().split('T')[0];
      let html = `<div style="font-weight:600;margin-bottom:8px;color:#fff;border-bottom:1px solid #2e3e55;padding-bottom:4px">${dateStr}</div>`;

      let hasData = false;

      state.activeSeries.forEach(id => {
        const series = state.seriesObjects[id];
        if (!series) return;

        const price = param.seriesData.get(series);
        if (!price) return;

        hasData = true;
        const config = SERIES_CONFIG[id];
        const t0 = state.t0Values[id];
        
        // Buscar el valor real en los datos filtrados
        const dataPoint = state.filteredData[id].find(d => d.time === param.time);
        const realValue = dataPoint ? dataPoint.value : price.value;
        
        const base100 = (realValue / t0) * 100;
        const percent = ((realValue / t0) - 1) * 100;

        html += `
          <div style="margin:6px 0">
            <div style="color:${config.color};font-weight:600;margin-bottom:3px;display:flex;align-items:center;gap:6px">
              <span style="font-size:14px">●</span> 
              <span>${config.name}</span>
            </div>
            <div style="margin-left:20px;font-size:11px;color:#96a3b7">
              <div style="margin:2px 0">
                <span style="display:inline-block;width:60px">Real:</span>
                <strong style="color:#dbe4f3">${config.unit}${realValue.toLocaleString('es-CL', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
              </div>
              <div style="margin:2px 0">
                <span style="display:inline-block;width:60px">Base100:</span>
                <strong style="color:#dbe4f3">${base100.toFixed(2)}</strong>
              </div>
              <div style="margin:2px 0">
                <span style="display:inline-block;width:60px">Var %:</span>
                <strong style="color:${percent >= 0 ? '#10b981' : '#ef4444'}">${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%</strong>
              </div>
            </div>
          </div>
        `;
      });

      if (hasData) {
        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        
        const left = Math.min(param.point.x + 15, container.clientWidth - tooltip.offsetWidth - 10);
        const top = Math.min(param.point.y + 15, container.clientHeight - tooltip.offsetHeight - 10);
        
        tooltip.style.left = Math.max(10, left) + 'px';
        tooltip.style.top = Math.max(10, top) + 'px';
      } else {
        tooltip.style.display = 'none';
      }
    });
  }

  function updateChart() {
    if (!state.chart) return;

    console.log(`🔄 Actualizando chart - Modo: ${state.mode}, Período: ${state.period}`);

    // Limpiar series
    Object.values(state.seriesObjects).forEach(s => state.chart.removeSeries(s));
    state.seriesObjects = {};

    // Configurar escalas según modo
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

    // Agregar series activas
    state.activeSeries.forEach((id, idx) => {
      const config = SERIES_CONFIG[id];
      const raw = state.rawData[id];
      
      if (!raw || raw.length === 0) {
        console.warn(`⚠️ No hay datos para ${config.name}`);
        return;
      }

      const filtered = filterByPeriod(raw);
      if (filtered.length === 0) {
        console.warn(`⚠️ No hay datos filtrados para ${config.name} en período ${state.period}`);
        return;
      }

      state.filteredData[id] = filtered;
      state.t0Values[id] = filtered[0].value;

      const transformed = transformData(filtered, state.t0Values[id]);
      if (transformed.length === 0) return;

      // Asignar escala según modo
      let priceScaleId = 'right';
      if (state.mode === 'Real') {
        // En Real: UF→left, USD/CLP→right, IPSA→left
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
              return config.unit + price.toLocaleString('es-CL', {minimumFractionDigits: 2, maximumFractionDigits: 2});
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

      console.log(`✅ Serie ${config.name} agregada (${transformed.length} puntos, t₀=${state.t0Values[id].toFixed(2)})`);
    });

    state.chart.timeScale().fitContent();
  }

  function hideLoading() {
    const loading = document.querySelector('#c-chile .bd-loading');
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

  console.log('✅ app.js (TradFi Chile) cargado');

})();
