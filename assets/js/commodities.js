// ============================================
// Commodities Dashboard
// Oro (IAU), Plata (SLV), Cobre (COPX), Litio (LIT)
// Todos vía Stooq proxy
// ============================================

(function() {
  'use strict';

  console.log('=== CARGANDO COMMODITIES (YTD) ===');

  const DASHBOARD_ID = 'commodities';
  const CONTAINER_ID = 'c-commod';
  const DETAIL_URL = '/detail/commodities';

  // Configuración de series
  // Nota: Usando ETFs como proxies para los commodities
  const SERIES_CONFIG = {
    gold: { 
      name: 'Oro (IAU)', 
      color: '#fbbf24',
      ticker: 'iau.us',
      description: 'iShares Gold Trust ETF'
    },
    silver: { 
      name: 'Plata (SLV)', 
      color: '#9ca3af',
      ticker: 'slv.us',
      description: 'iShares Silver Trust ETF'
    },
    copper: { 
      name: 'Cobre (COPX)', 
      color: '#f97316',
      ticker: 'copx.us',
      description: 'Global X Copper Miners ETF'
    },
    lithium: { 
      name: 'Litio (LIT)', 
      color: '#06b6d4',
      ticker: 'lit.us',
      description: 'Global X Lithium & Battery ETF'
    }
  };

  // Estado del dashboard
  let state = {
    activeSeries: ['gold', 'silver', 'copper', 'lithium'],
    period: 'YTD',
    mode: 'Real',
    data: {},
    chart: null,
    chartSeries: {}
  };

  // Inicialización
  function init() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) {
      console.error(`❌ No se encontró el contenedor #${CONTAINER_ID}`);
      return;
    }

    console.log(`✅ Contenedor encontrado: #${CONTAINER_ID}`);
    setupEventListeners();
    loadAllData();
  }

  // Event Listeners
  function setupEventListeners() {
    const card = document.querySelector(`[data-dashboard="${DASHBOARD_ID}"]`);
    if (!card) {
      console.error(`❌ No se encontró la tarjeta [data-dashboard="${DASHBOARD_ID}"]`);
      return;
    }

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

    console.log('✅ Event listeners configurados');
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
    console.log('📡 Iniciando carga de commodities...');
    
    try {
      const promises = Object.entries(SERIES_CONFIG).map(async ([id, config]) => {
        try {
          console.log(`📊 Cargando ${config.name} (${config.ticker})...`);
          const data = await fetchStooq(config.ticker);
          console.log(`✅ ${config.name}: ${data.length} puntos cargados`);
          return [id, data];
        } catch (error) {
          console.error(`❌ Error cargando ${config.name}:`, error);
          return [id, []];
        }
      });

      const results = await Promise.all(promises);
      state.data = Object.fromEntries(results);

      console.log('✅ Todos los datos de commodities cargados:', {
        gold: state.data.gold?.length || 0,
        silver: state.data.silver?.length || 0,
        copper: state.data.copper?.length || 0,
        lithium: state.data.lithium?.length || 0
      });
      
      initChart();
      updateChart();
    } catch (error) {
      console.error('❌ Error general cargando datos:', error);
      showError('Error al cargar commodities. Por favor, recarga la página.');
    } finally {
      showLoading(false);
    }
  }

  // Fetch Stooq vía proxy
  async function fetchStooq(ticker) {
    if (!window.__BD_PROXY) {
      throw new Error('Proxy no configurado. Asegúrate de definir window.__BD_PROXY');
    }

    const stooqUrl = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
    const proxyUrl = window.__BD_PROXY + encodeURIComponent(stooqUrl);

    console.log(`🔗 Fetching: ${ticker}`);

    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const csv = await response.text();
    
    if (!csv || csv.length < 50) {
      throw new Error('CSV vacío o inválido');
    }

    return parseStooqCSV(csv);
  }

  // Parse Stooq CSV
  function parseStooqCSV(csv) {
    const lines = csv.trim().split('\n');
    
    if (lines.length < 2) {
      throw new Error('CSV sin datos');
    }

    const dataLines = lines.slice(1);
    
    const parsed = dataLines
      .map(line => {
        const parts = line.split(',');
        if (parts.length < 5) return null;

        const [date, , , , close] = parts;
        const value = parseFloat(close);
        
        if (isNaN(value) || !date) return null;
        
        return { time: date, value };
      })
      .filter(item => item !== null);

    console.log(`📈 CSV parseado: ${parsed.length} registros válidos`);
    
    return parsed;
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
    if (!container) {
      console.error('❌ Contenedor no disponible para inicializar chart');
      return;
    }
    
    if (state.chart) {
      console.log('⚠️ Chart ya inicializado, reutilizando...');
      return;
    }

    console.log('🎨 Inicializando Lightweight Charts...');

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
    console.log('✅ Chart inicializado correctamente');
  }

  // Actualizar chart
  function updateChart() {
    if (!state.chart) {
      console.error('❌ No hay chart disponible para actualizar');
      return;
    }

    console.log('🔄 Actualizando chart de commodities...');

    // Limpiar series existentes
    Object.values(state.chartSeries).forEach(series => {
      state.chart.removeSeries(series);
    });
    state.chartSeries = {};

    // Agregar series activas
    let seriesAdded = 0;
    
    state.activeSeries.forEach((seriesId, index) => {
      const config = SERIES_CONFIG[seriesId];
      const rawData = state.data[seriesId];
      
      if (!rawData || rawData.length === 0) {
        console.warn(`⚠️ No hay datos para ${config.name}`);
        return;
      }

      const normalizedData = normalizeData(rawData);
      if (normalizedData.length === 0) {
        console.warn(`⚠️ No hay datos normalizados para ${config.name}`);
        return;
      }

      console.log(`📊 Agregando serie ${config.name}: ${normalizedData.length} puntos`);

      const series = state.chart.addLineSeries({
        color: config.color,
        lineWidth: 2,
        title: config.name,
        priceScaleId: state.mode === 'Real' ? (index % 2 === 0 ? 'right' : 'left') : 'right',
        priceFormat: {
          type: 'custom',
          formatter: (price) => {
            if (state.mode === 'Real') {
              return '$' + price.toFixed(2);
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
      seriesAdded++;

      series.applyOptions({
        priceLineVisible: false,
        lastValueVisible: true
      });
    });

    console.log(`✅ ${seriesAdded} series de commodities agregadas al chart`);

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
    errorDiv.innerHTML = `
      <p style="margin-bottom: 0.5rem;">❌ ${message}</p>
      <button onclick="location.reload()" style="
        padding: 0.5rem 1rem;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
        font-size: 0.875rem;
      ">
        Reintentar
      </button>
    `;
    container.appendChild(errorDiv);
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('✅ commodities.js cargado correctamente');

})();
