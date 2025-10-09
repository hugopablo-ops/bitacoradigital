// Índices Globales - SPY, EWG, EWJ (YTD Base100)
(function() {
  'use strict';

  const SERIES = {
    spy: { name: 'SPY', color: '#3b82f6', ticker: 'spy.us' },
    ewg: { name: 'EWG', color: '#10b981', ticker: 'ewg.us' },
    ewj: { name: 'EWJ', color: '#f59e0b', ticker: 'ewj.us' }
  };

  let chart = null;

  async function init() {
    const container = document.getElementById('c-indices');
    if (!container) {
      console.error('❌ No se encontró #c-indices');
      return;
    }

    console.log('📊 Iniciando carga de índices...');

    try {
      // Cargar datos
      const data = await loadAllData();
      
      // Verificar que hay datos
      const totalPoints = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`✅ Datos cargados: ${totalPoints} puntos totales`);
      
      // Crear gráfico
      createChart(container, data);
      
      // Ocultar loading
      hideLoading();
      
    } catch (error) {
      console.error('❌ Error Índices:', error);
      showError(container, 'Error al cargar índices internacionales');
    }
  }

  async function loadAllData() {
    const results = {};
    
    for (const [id, config] of Object.entries(SERIES)) {
      try {
        console.log(`📡 Cargando ${config.name} (${config.ticker})...`);
        const raw = await fetchStooq(config.ticker);
        console.log(`✅ ${config.name}: ${raw.length} puntos`);
        results[id] = normalizeToBase100(filterYTD(raw));
      } catch (error) {
        console.error(`❌ Error loading ${id}:`, error);
        results[id] = [];
      }
    }
    
    return results;
  }

  async function fetchStooq(ticker) {
    const url = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
    const proxyUrl = window.__BD_PROXY + encodeURIComponent(url);
    
    const res = await fetch(proxyUrl);
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

  function filterYTD(data) {
    const now = new Date();
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    return data.filter(d => new Date(d.time) >= ytdStart);
  }

  function normalizeToBase100(data) {
    if (!data || data.length === 0) return [];
    const first = data[0].value;
    return data.map(d => ({
      time: d.time,
      value: (d.value / first) * 100
    }));
  }

  function createChart(container, data) {
    chart = LightweightCharts.createChart(container, {
      layout: {
        background: { color: '#141c27' },
        textColor: '#96a3b7'
      },
      grid: {
        vertLines: { color: '#1c2636' },
        horzLines: { color: '#1c2636' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor: '#1c2636'
      },
      timeScale: {
        borderColor: '#1c2636',
        timeVisible: true,
        secondsVisible: false
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: false
      },
      handleScale: {
        axisPressedMouseMove: false,
        mouseWheel: false,
        pinch: false
      }
    });

    // Agregar series
    let seriesAdded = 0;
    Object.entries(SERIES).forEach(([id, config]) => {
      if (data[id] && data[id].length > 0) {
        const series = chart.addLineSeries({
          color: config.color,
          lineWidth: 2,
          title: config.name,
          priceFormat: {
            type: 'custom',
            formatter: (price) => price.toFixed(2)
          }
        });
        series.setData(data[id]);
        seriesAdded++;
        console.log(`✅ Serie ${config.name} agregada al chart`);
      }
    });

    console.log(`📈 Total de series en el gráfico: ${seriesAdded}`);
    chart.timeScale().fitContent();
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

  // Click handler
  document.getElementById('card-indices')?.addEventListener('click', () => {
    window.location.href = '/detail/indices';
  });

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('✅ indices.js cargado');

})();
