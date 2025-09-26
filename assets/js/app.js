/* =========================================================
   Bitácora Digital — app.js
   - Gráfico comparativo: TradFi · Chile (UF vs USD/CLP vs IPSA proxy ECH)
   - Base 100, mensual, escala logarítmica, tooltip y navegación on-click
   ========================================================= */

/* 1) CONFIG ------------------------------------------------ */
const COLORS = ["#63b3ed", "#f6ad55", "#97a7ea", "#66e4a6", "#ff6585"];
// Pega aquí la URL de TU Worker (Cloudflare) que hiciste para evitar CORS en Stooq:
const STOOQ_PROXY = "https://tradfi.hugopablo.workers.dev/?url="; // <-- tu worker

// Rutas de detalle
const ROUTES = {
  chile: "/detail/tradfi-cl",
};

/* 2) HELPERS ------------------------------------------------ */

// YYYY-MM-01 en UTC
function isoMonth(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

// Compacta a mensual tomando el ÚLTIMO valor de cada mes
function toMonthlyLast(points) {
  const by = {};
  for (const p of points) by[p.time] = p.value;
  return Object.entries(by)
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

// Normaliza a Base 100 desde el primer valor válido
function base100(arr) {
  if (!arr || !arr.length) return arr;
  const i = arr.findIndex((p) => Number.isFinite(p.value));
  if (i < 0) return arr;
  const b = arr[i].value;
  return arr.map((p) => ({ time: p.time, value: (p.value / b) * 100 }));
}

// Intersección de fechas: devuelve todas las series recortadas al rango común
function intersectDates(seriesArray) {
  if (!seriesArray.length) return seriesArray;
  const sets = seriesArray.map((s) => new Set(s.map((p) => p.time)));
  const common = [...sets[0]].filter((t) => sets.every((S) => S.has(t)));
  common.sort((a, b) => a.localeCompare(b));
  return seriesArray.map((s) => s.filter((p) => common.includes(p.time)));
}

// Formatea números con separador miles (cl) y 2 decimales
const fmt = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/* 3) FETCHERS ---------------------------------------------- */

// mindicador.cl (uf / dolar) — diario → mensual (último de cada mes)
async function fetchMindicador(tipo) {
  // Ej.: https://mindicador.cl/api/uf
  const r = await fetch(`https://mindicador.cl/api/${tipo}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`mindicador ${tipo} ${r.status}`);
  const j = await r.json();
  // j.serie: [{fecha, valor}]
  const pts = j.serie.map((x) => {
    const d = new Date(x.fecha);
    return {
      time: isoMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))),
      value: Number(x.valor),
    };
  });
  return toMonthlyLast(pts);
}

// Stooq mensual CSV (spy.us, ewg.us, ewj.us, ech.us, etc.) SIEMPRE vía Worker
async function fetchStooqMonthly(ticker) {
  const real = `https://stooq.com/q/d/l/?s=${ticker}&i=m`;
  const url = STOOQ_PROXY + encodeURIComponent(real);
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`stooq ${ticker} ${r.status}`);
  const csv = await r.text();
  const lines = csv.trim().split(/\r?\n/).slice(1); // skip header
  const out = [];
  for (const ln of lines) {
    const [date, _o, _h, _l, close] = ln.split(",");
    if (!date || !close) continue;
    out.push({ time: date, value: Number(close) });
  }
  return out;
}

/* 4) CHART FACTORY + TOOLTIP ------------------------------- */

function makeChart(el) {
  // Requiere Lightweight-Charts cargado en el HTML (unpkg)
  // Escala logarítmica y tema oscuro
  const chart = LightweightCharts.createChart(el, {
    layout: {
      background: { type: "solid", color: "transparent" },
      textColor: "#cbd5e0",
    },
    rightPriceScale: {
      borderColor: "#2d3748",
      mode: LightweightCharts.PriceScaleMode.Logarithmic,
    },
    timeScale: { borderColor: "#2d3748" },
    grid: {
      vertLines: { color: "#1a202c" },
      horzLines: { color: "#1a202c" },
    },
    localization: { locale: "es-CL" },
  });
  return chart;
}

function addLine(chart, label, color) {
  return chart.addLineSeries({ title: label, color, lineWidth: 2 });
}

// Tooltip simple (absoluto, sigue el puntero)
function createTooltip(container) {
  // Asegúrate que el contenedor tenga position: relative en CSS si lo usas por fuera
  const tip = document.createElement("div");
  tip.className =
    "bd-tip"; /* usa estilos de tu CSS main.css o agrega inline si prefieres */
  tip.style.position = "absolute";
  tip.style.pointerEvents = "none";
  tip.style.background = "rgba(17,24,39,.92)";
  tip.style.color = "#e2e8f0";
  tip.style.border = "1px solid rgba(255,255,255,.1)";
  tip.style.borderRadius = "10px";
  tip.style.padding = "8px 10px";
  tip.style.fontSize = ".85rem";
  tip.style.boxShadow = "0 6px 20px rgba(0,0,0,.35)";
  tip.style.opacity = "0";
  tip.style.transition = "opacity .08s ease";
  tip.style.zIndex = "5";
  tip.style.whiteSpace = "nowrap";
  container.style.position = "relative";
  container.appendChild(tip);
  return tip;
}

/* 5) DRAW: TRADFI CHILE ------------------------------------ */

async function drawChile() {
  const root = document.getElementById("c-chile");
  const note = document.getElementById("c-chile-note");
  if (!root) return;

  try {
    // 1) Traer UF, USD/CLP y ECH (proxy IPSA) en paralelo
    const [uf, usd, ech] = await Promise.all([
      fetchMindicador("uf"),
      fetchMindicador("dolar"),
      fetchStooqMonthly("ech.us"),
    ]);

    // 2) Alinear por fechas comunes y normalizar base 100
    let [A, B, C] = intersectDates([uf, usd, ech]);
    A = base100(A);
    B = base100(B);
    C = base100(C);

    // 3) Crear chart + series
    const chart = makeChart(root);
    const sUF = addLine(chart, "UF", COLORS[0]); // celeste
    const sUSD = addLine(chart, "USD/CLP", COLORS[1]); // naranjo
    const sIPSA = addLine(chart, "IPSA (ECH)", COLORS[2]); // lila-azul

    sUF.setData(A);
    sUSD.setData(B);
    sIPSA.setData(C);

    // 4) Tooltip (crosshair)
    const tip = createTooltip(root);

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.point) {
        tip.style.opacity = "0";
        return;
      }

      const p = param.point;
      // si el puntero está fuera del canvas, ocultamos tooltip
      const chartEl = root.querySelector("canvas");
      if (!chartEl) return;
      const rect = chartEl.getBoundingClientRect();
      if (
        p.x < 0 ||
        p.y < 0 ||
        p.x > rect.width ||
        p.y > rect.height
      ) {
        tip.style.opacity = "0";
        return;
      }

      const t = param.time; // YYYY-MM-DD
      const rows = [];

      // Busca el valor de cada serie en ese tiempo
      function findAt(seriesData, time) {
        // asume data ordenada por fecha
        const i = seriesData.findIndex((d) => d.time === time);
        if (i >= 0) return seriesData[i].value;
        return null;
      }

      const vUF = findAt(A, t);
      const vUSD = findAt(B, t);
      const vIPSA = findAt(C, t);

      rows.push(`<div class="row"><span class="k">Fecha:</span> ${t}</div>`);
      if (vUF) rows.push(`<div class="row"><span class="k">UF:</span> ${fmt.format(vUF)}</div>`);
      if (vUSD) rows.push(`<div class="row"><span class="k">USD/CLP:</span> ${fmt.format(vUSD)}</div>`);
      if (vIPSA) rows.push(`<div class="row"><span class="k">IPSA (ECH):</span> ${fmt.format(vIPSA)}</div>`);

      tip.innerHTML = rows.join("");
      tip.style.left = Math.min(Math.max(p.x + 12, 8), root.clientWidth - 160) + "px";
      tip.style.top = Math.min(Math.max(p.y + 12, 8), root.clientHeight - 80) + "px";
      tip.style.opacity = "1";
    });

    // 5) Click para navegar a la vista de detalle
    root.style.cursor = "pointer";
    root.addEventListener("click", () => {
      window.location.href = ROUTES.chile;
    });

    if (note) note.style.display = "none";
  } catch (e) {
    console.warn(e);
    root.innerHTML =
      '<div style="padding:1rem;color:#a0aec0">No se pudo cargar (Chile). Revisa el proxy de Stooq y/o mindicador.cl.</div>';
    if (note) note.style.display = "block";
  }
}

/* 6) BOOTSTRAP ---------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  // Pinta solo el primer gráfico (los demás puedes agregarlos igual)
  drawChile();
});
