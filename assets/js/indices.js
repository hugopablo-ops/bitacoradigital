// ============================================
// ÍNDICES - SPY vs EWG vs EWJ (YTD)
// Bitácora Digital - JavaScript Vanilla
// ============================================

console.log("=== CARGANDO ÍNDICES GLOBALES (YTD) ===");

// Configuración de índices
const indicesConfig = {
  SPY: { name: 'S&P 500', color: '#3b82f6', active: true },
  EWG: { name: 'Alemania', color: '#10b981', active: true },
  EWJ: { name: 'Japón', color: '#f59e0b', active: true }
};

// Estado global
let indicesState = {
  activeIndices: ['SPY', 'EWG', 'EWJ'],
  timeRange: 'YTD',
  viewMode: 'Base100',
  data: [],
  chart: null
};

// ============================================
// FUNCIÓN PRINCIPAL DE INICIALIZACIÓN
// ============================================
function initIndicesDashboard() {
  console.log("📊 Inicializando dashboard de índices...");
  
  // Crear estructura HTML
  createIndicesHTML();
  
  // Configurar event listeners
  setupEventListeners();
  
  // Cargar datos iniciales
  loadIndicesData();
}

// ============================================
// CREAR ESTRUCTURA HTML
// ============================================
function createIndicesHTML() {
  const container = document.getElementById('indices-dashboard');
  if (!container) {
    console.error("❌ No se encontró el contenedor #indices-dashboard");
    return;
  }

  container.innerHTML = `
    <div class="dashboard-container">
      
      <!-- Header -->
      <div class="dashboard-header">
        <h1 class="dashboard-title">
          Índices — SPY vs EWG vs EWJ — YTD (valores reales)
        </h1>
        <p class="dashboard-subtitle">
          S&P 500, Alemania, Japón · Formas superpuestas, ejes independientes
        </p>
      </div>

      <!-- Selectores de Índices -->
      <div class="control-group">
        <button class="index-btn active" data-index="SPY">
          <span class="index-dot" style="background: #3b82f6;"></span>
          S&P 500
        </button>
        <button class="index-btn active" data-index="EWG">
          <span class="index-dot" style="background: #10b981;"></span>
          Alemania
        </button>
        <button class="index-btn active" data-index="EWJ">
          <span class="index-dot" style="background: #f59e0b;"></span>
          Japón
        </button>
      </div>

      <!-- Selectores de Tiempo -->
      <div class="control-group">
        <button class="time-btn" data-range="1M">1M</button>
        <button class="time-btn" data-range="3M">3M</button>
        <button class="time-btn" data-range="6M">6M</button>
        <button class="time-btn active" data-range="YTD">YTD</button>
        <button class="time-btn" data-range="1Y">1Y</button>
        <button class="time-btn" data-range="All">All</button>
      </div>

      <!-- Selectores de Vista -->
      <div class="control-group">
        <button class="view-btn" data-view="Real">Real</button>
        <button class="view-btn active" data-view="Base100">Base100</button>
        <button class="view-btn" data-view="%">%</button>
      </div>

      <!-- Gráfico -->
      <div class="chart-container">
        <canvas id="indices-chart"></canvas>
        <div id="loading-indicator" class="loading">
          <div class="spinner"></div>
          <p>Cargando índices YTD...</p>
        </div>
      </div>

      <!-- Métricas -->
      <div id="metrics-container" class="metrics-grid"></div>

    </div>
  `;
}

// ============================================
// CONFIGURAR EVENT LISTENERS
// ============================================
function setupEventListeners() {
  // Botones de índices
  document.querySelectorAll('.index-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = e.currentTarget.dataset.index;
      toggleIndex(index);
      e.currentTarget.classList.toggle('active');
    });
  });

  // Botones de tiempo
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      indicesState.timeRange = e.currentTarget.dataset.range;
      loadIndicesData();
    });
  });

  // Botones de vista
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      indicesState.viewMode = e.currentTarget.dataset.view;
      updateChart();
    });
  });
}

// ============================================
// TOGGLE ÍNDICE
// ============================================
function toggleIndex(indexId) {
  const idx = indicesState.activeIndices.indexOf(indexId);
  if (idx > -1) {
    indicesState.activeIndices.splice(idx, 1);
  } else {
    indicesState.activeIndices.push(indexId);
  }
  updateChart();
}

// ============================================
// CARGAR DATOS DE ÍNDICES
// ============================================
async function loadIndicesData() {
  console.log(`📡 Cargando datos para rango: ${indicesState.timeRange}`);
  showLoading(true);

  try {
    // OPCIÓN 1: Datos simulados (reemplazar con API real)
    const data = generateMockData(indicesState.timeRange);
    
    // OPCIÓN 2: API real (descomentar cuando tengas el endpoint)
    /*
    const response = await fetch(`/api/indices?range=${indicesState.timeRange}`);
    const data = await response.json();
    */

    indicesState.data = data;
    updateChart();
    updateMetrics();
    
  } catch (error) {
    console.error("❌ Error cargando datos:", error);
  } finally {
    showLoading(false);
  }
}

// ============================================
// GENERAR DATOS SIMULADOS
// ============================================
function generateMockData(range) {
  const points = {
    '1M': 20,
    '3M': 60,
    '6M': 120,
    'YTD': 200,
    '1Y': 250,
    'All': 500
  }[range] || 200;

  const data = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - points);

  for (let i = 0; i < points; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    
    const baseValue = 100;
    const volatility = 15;
    
    data.push({
      date: date.toLocaleDateString('es-CL', { month: 'short', day: 'numeric' }),
      timestamp: date.getTime(),
      SPY: baseValue + Math.sin(i / 10) * volatility + (i / 5) + (Math.random() * 5),
      EWG: baseValue + Math.cos(i / 12) * (volatility * 0.8) + (i / 6) + (Math.random() * 4),
      EWJ: baseValue + Math.sin(i / 8) * (volatility * 1.2) + (i / 7) + (Math.random() * 6)
    });
  }

  console.log(`✅ ${points} puntos generados para ${range}`);
  return data;
}

// ============================================
// ACTUALIZAR GRÁFICO (Chart.js)
// ============================================
function updateChart() {
  const canvas = document.getElementById('indices-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Destruir gráfico anterior si existe
  if (indicesState.chart) {
    indicesState.chart.destroy();
  }

  // Preparar datasets
  const datasets = indicesState.activeIndices.map(indexId => {
    const config = indicesConfig[indexId];
    return {
      label: config.name,
      data: indicesState.data.map(d => d[indexId]),
      borderColor: config.color,
      backgroundColor: config.color + '20',
      borderWidth: 2,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false
    };
  });

  // Crear nuevo gráfico
  indicesState.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: indicesState.data.map(d => d.date),
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#9ca3af',
            font: { size: 12 },
            usePointStyle: true,
            padding: 20
          }
        },
        tooltip: {
          backgroundColor: '#1f2937',
          titleColor: '#f3f4f6',
          bodyColor: '#f3f4f6',
          borderColor: '#374151',
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          callbacks: {
            label: function(context) {
              const value = context.parsed.y.toFixed(2);
              return `${context.dataset.label}: ${value}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#374151', drawBorder: false },
          ticks: { color: '#9ca3af', font: { size: 11 } }
        },
        y: {
          grid: { color: '#374151', drawBorder: false },
          ticks: { color: '#9ca3af', font: { size: 11 } }
        }
      },
      animation: {
        duration: 1000,
        easing: 'easeInOutQuart'
      }
    }
  });

  console.log("✅ Gráfico actualizado");
}

// ============================================
// ACTUALIZAR MÉTRICAS
// ============================================
function updateMetrics() {
  const container = document.getElementById('metrics-container');
  if (!container || indicesState.data.length === 0) return;

  const html = indicesState.activeIndices.map(indexId => {
    const config = indicesConfig[indexId];
    const lastValue = indicesState.data[indicesState.data.length - 1][indexId];
    const firstValue = indicesState.data[0][indexId];
    const change = ((lastValue - firstValue) / firstValue * 100).toFixed(2);
    const isPositive = change >= 0;

    return `
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-dot" style="background: ${config.color};"></span>
          <h3>${config.name}</h3>
        </div>
        <p class="metric-value">${lastValue.toFixed(2)}</p>
        <p class="metric-change ${isPositive ? 'positive' : 'negative'}">
          ${isPositive ? '+' : ''}${change}% ${indicesState.timeRange}
        </p>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// ============================================
// MOSTRAR/OCULTAR LOADING
// ============================================
function showLoading(show) {
  const loader = document.getElementById('loading-indicator');
  if (loader) {
    loader.style.display = show ? 'flex' : 'none';
  }
}

// ============================================
// INICIALIZAR AL CARGAR EL DOM
// ============================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIndicesDashboard);
} else {
  initIndicesDashboard();
}

console.log("✅ indices.js cargado correctamente");
