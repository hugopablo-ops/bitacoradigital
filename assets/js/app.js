// ============================================
// TradFi Chile Dashboard
// UF, USD/CLP (mindicador.cl) + IPSA (Stooq: ech.us)
// ============================================

(function() {
  'use strict';

  console.log('=== CARGANDO TRADFI CHILE (YTD) ===');

  const DASHBOARD_ID = 'tradfi-chile';
  const CONTAINER_ID = 'c-chile';
  const DETAIL_URL = '/detail/tradfi-cl';

  // Configuración de series
  const SERIES_CONFIG = {
    uf: { 
      name: 'UF', 
      color: '#3b82f6',
      source: 'mindicador',
      ticker: 'uf'
    },
    usd: { 
      name: 'USD/CLP', 
      color: '#f59e0b',
      source: 'mindicador',
      ticker: 'dolar'
    },
    ipsa: { 
      name: 'IPSA', 
      color: '#a855f7',
      source: 'stooq',
      ticker: 'ech.us'
    }
  };

  // Estado del dashboard
  let state = {
    activeSeries: ['uf', 'usd', 'ipsa'],
    period: 'YTD',
    mode: 'Base100',
    data: {},
    chart: null,
    chartSeries: {}
  };

  // Inicialización
  function init() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) {
      console.error(`No se encontró el contenedor #${CONTAINER_ID}`);
      return;
    }

    setupEventListeners();
    loadAllData();
  }

  // Event Listeners
  function setupEventListeners() {
    const card = document.querySelector(`[data-dashboard="${DASHBOARD_ID}"]`);
    if (!card) return;

    // Series toggles
    card.querySelectorAll('.btn-series').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const series = e.currentTarget.dataset.series;
        toggleSeries(series);
        e.currentTarget.classList.toggle('active');
      });
    });

    // Period toggles
    card.querySelectorAll('.btn-period').forEach(btn => {
      btn.addEventListener('click', (e) => {
        card.querySelectorAll('.btn-period').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.period = e.currentTarget.dataset.period;
        updateChart();
      });
    });

    // Mode toggles
    card.querySelectorAll('.btn-mode').forEach(btn => {
      btn.addEventListener('click', (e) => {
        card.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.mode = e.currentTarget.dataset.mode;
        updateChart();
      });
    });

    // Chart click → detail page
    const chartContainer = document.getElementById(CONTAINER_ID);
    if (chartContainer) {
      chartContainer.addEventListener('click', () => {
        window.location.href = DETAIL_URL;
      });
    }
  }

  // Toggle series
  function toggleSeries(seriesId) {
    const idx = state.activeSeries.indexOf(seriesId);
    if (idx > -1) {
      state.activeSeries.splice(idx, 1);
    } else {
      state.activeSeries.push(seriesId);
    }
    updateChart();
  }

  // Cargar todos los datos
  async function loadAllData() {
    showLoading(true);
    
    try {
      const promises = Object.entries(SERIES_CONFIG).map(async ([id, config]) => {
        try {
          const data = config.source === 'mindicador' 
            ? await fetchMindicador(config.ticker)
            : await fetchStooq(config.ticker);
          return [id, data];
        } catch (error) {
          console.error(`Error cargando ${id}:`, error);
          return [id, []];
        }
      });

      const results = await Promise.all(promises);
      state.data = Object.fromEntries(results);

      console.log('✅ Datos cargados:', Object.keys(state.data));
      
      initChart();
      updateChart();
    } catch (error) {
      console.error('❌ Error cargando datos:', error);
      showError('Error al cargar datos');
    } finally {
      showLoading(false);
    }
  }

  // Fetch Mindicador.cl
  async function fetchMindicador(indicator) {
    const url = `https://mindicador.cl/api/${indicator}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    
    return json.serie
      .map(item => ({
        time: item.fecha.split('T')[0],
        value: parseFloat(item.valor)
      }))
      .reverse()
      .filter(item => !isNaN(item.value));
  }

  // Fetch Stooq vía proxy
  async function fetchStooq(ticker) {
    const stooqUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
    const proxyUrl = window.__BD_PROXY + encodeURIComponent(stooqUrl);

    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const csv = await response.text();
    return parseStooqCSV(csv);
  }

  // Parse Stooq CSV
  function parseStooqCSV(csv) {
    const lines = csv.trim().split('\n').slice(1); // Skip header
    return lines
      .map(line => {
        const [date, , , , close] = line.split(',');
        const value = parseFloat(close);
        if (isNaN(value)) return null;
        return { time: date, value };
      })
      .filter(item => item !== null);
  }

  // Filtrar datos por período
  function filterByPeriod(data) {
    if (!data || data.length === 0) return [];

    const now = new Date();
    let cutoffDate;

    switch (state.period) {
      case '1M':
        cutoffDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        break;
      case '3M':
        cutoffDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        break;
      case '6M':
        cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
        break;
      case 'YTD':
        cutoffDate = new Date(now.getFullYear(), 0, 1);
        break;
      case '1Y':
        cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        break;
      case 'All':
        return data;
      default:
        cutoffDate = new Date(now.getFullYear(), 0, 1);
    }

    return data.filter(item => new Date(item.time) >= cutoffDate);
  }

  // Normalizar datos según modo
  function normalizeData(data) {
    if (!data || data.length === 0) return [];
    
    const filtered = filterByPeriod(data);
    if (filtered.length === 0) return [];

    if (state.mode === 'Real') {
      return filtered;
    }

    const firstValue = filtered[0].value;
    
    return filtered.map(item => {
      let value;
      if (state.mode === 'Base100') {
        value = (item.value / firstValue) * 100;
      } else { // %
        value = ((item.value - firstValue) / firstValue) * 100;
      }
      return { time: item.time, value, originalValue: item.value };
    });
  }

  // Inicializar chart
  function initChart() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container || state.chart) return;

    state.chart = LightweightCharts.createChart(container, {
      layout: {
        background: { color: '#0a0e1a' },
        textColor: '#9ca3af'
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor: '#1f2937',
        visible: state.mode === 'Real'
      },
      leftPriceScale: {
        borderColor: '#1f2937',
        visible: state.mode === 'Real'
      },
      timeScale: {
        borderColor: '#1f2937',
        timeVisible: true,
        secondsVisible: false
      },
      handleScroll: false,
      handleScale: false
    });

    state.chart.timeScale().fitContent();
  }

  // Actualizar chart
  function updateChart() {
    if (!state.chart) return;

    // Limpiar series existentes
    Object.values(state.chartSeries).forEach(series => {
      state.chart.removeSeries(series);
    });
    state.chartSeries = {};

    // Agregar series activas
    state.activeSeries.forEach((seriesId, index) => {
      const config = SERIES_CONFIG[seriesId];
      const rawData = state.data[seriesId];
      
      if (!rawData || rawData.length === 0) return;

      const normalizedData = normalizeData(rawData);
      if (normalizedData.length === 0) return;

      const series = state.chart.addLineSeries({
        color: config.color,
        lineWidth: 2,
        title: config.name,
        priceScaleId: state.mode === 'Real' ? (index % 2 === 0 ? 'right' : 'left') : 'right',
        priceFormat: {
          type: 'custom',
          formatter: (price) => {
            if (state.mode === 'Real') {
              return price.toFixed(2);
            } else if (state.mode === 'Base100') {
              return price.toFixed(2);
            } else {
              return price.toFixed(2) + '%';
            }
          }
        }
      });

      series.setData(normalizedData);
      state.chartSeries[seriesId] = series;

      // Tooltip personalizado
      series.applyOptions({
        priceLineVisible: false,
        lastValueVisible: true
      });
    });

    // Ajustar escalas
    state.chart.priceScale('right').applyOptions({
      visible: state.mode === 'Real' || state.activeSeries.length > 0
    });
    state.chart.priceScale('left').applyOptions({
      visible: state.mode === 'Real' && state.activeSeries.length > 1
    });

    state.chart.timeScale().fitContent();
  }

  // Loading state
  function showLoading(show) {
    const card = document.querySelector(`[data-dashboard="${DASHBOARD_ID}"]`);
    if (!card) return;

    const chartWrapper = card.querySelector('.card-chart');
    if (chartWrapper) {
      if (show) {
        chartWrapper.classList.add('loading');
      } else {
        chartWrapper.classList.remove('loading');
      }
    }
  }

  // Error state
  function showError(message) {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    const errorDiv = document.createElement('div');
    errorDiv.className = 'chart-error';
    errorDiv.textContent = message;
    container.appendChild(errorDiv);
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
