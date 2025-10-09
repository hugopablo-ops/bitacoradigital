// TradFi Chile - UF, USD/CLP, IPSA (YTD Base100)
(function() {
  'use strict';

  const SERIES = {
    uf: { name: 'UF', color: '#3b82f6', source: 'mindicador', ticker: 'uf' },
    usd: { name: 'USD/CLP', color: '#f59e0b', source: 'mindicador', ticker: 'dolar' },
    ipsa: { name: 'IPSA', color: '#a855f7', source: 'stooq', ticker: 'ech.us' }
  };

  let chart = null;

  async function init() {
    const container = document.getElementById('c-chile');
    if (!container) return;

    try {
      // Cargar datos
      const data = await loadAllData();
      
      // Crear gráfico
      createChart(container, data);
      
      // Ocultar loading
      hideLoading();
      
    } catch (error) {
      console.error('Error TradFi Chile:', error);
      showError(container, 'Error al cargar datos de Chile');
    }
  }

  async function loadAllData() {
    const results = {};
    
    for (const [id, config] of Object.entries(SERIES)) {
      try {
        const raw = config.source === 'mindicador' 
          ? await fetchMindicador(config.ticker)
          : await fetchStooq(config.ticker);
        
        results[id] = normalizeToBase100(filterYTD(raw));
      } catch (error) {
        console.error(`Error loading ${id}:`, error);
        results[id] = [];
      }
    }
    
    return results;
  }

  async function fetchMindicador(indicator) {
    const url = `https://mindicador.cl/api/${indicator}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const json = await res.json();
    return json.serie
      .map(d => ({
        time: d.fecha.split('T')[0],
        value: parseFloat(d.valor)
      }))
      .reverse()
      .filter(d => !isNaN(d.value));
  }

  async function fetchStooq(ticker) {
    const url = `https://stooq.com/q/d/l/?s=${ticker}&i=d`;
    const res = await fetch(window.__BD_PROXY + encodeURIComponent(url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const csv = await res.text();
    return csv.trim().split('\n').slice(1)
      .map(line => {
        const [date, , , , close] = line.split(',');
        return { time: date, value: parseFloat(close) };
      })
      .filter(d => !isNaN(d.value));
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
      }
    });

    chart.timeScale().fitContent();
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

  // Click handler
  document.getElementById('card-chile')?.addEventListener('click', () => {
    window.location.href = '/detail/tradfi-cl';
  });

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
