// assets/js/app.js
(() => {
  /* ===========================================================
     Bitácora Digital – app.js (Home)
     - TradFi Chile (UF, USD/CLP, IPSA proxy ECH)
     - Log + Base 100 + fechas alineadas + click a detalle
     =========================================================== */

  // === AJUSTA AQUÍ la URL de tu Worker (termina en ?url=) ===
  const STOOQ_PROXY = 'https://tradfi.hugopablo.workers.dev/?url=';

  // ============== Utilidades ==============
  const COLORS = ["#63b3ed", "#f6ad55", "#9f7aea"]; // UF, USD/CLP, IPSA(ECH)

  const isoMonth = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  };

  function toMonthlyLast(points) {
    const by = {};
    for (const p of points) by[p.time] = p.value;
    return Object.entries(by)
      .map(([time, value]) => ({ time, value }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  function base100(arr) {
    if (!arr?.length) return arr;
    const i = arr.findIndex(p => Number.isFinite(p.value));
    if (i < 0) return arr;
    const b = arr[i].value || 1;
    return arr.map(p => ({ time: p.time, value: (p.value / b) * 100 }));
  }

  function intersectDates(seriesArray) {
    if (!seriesArray?.length) return seriesArray;
    const sets = seriesArray.map(s => new Set(s.map(p => p.time)));
    const common = [...sets[0]].filter(t => sets.every(S => S.has(t)));
    common.sort((a, b) => a.localeCompare(b));
    return seriesArray.map(s => s.filter(p => common.includes(p.time)));
  }

  // ============== Fetchers ==============
  // mindicador.cl (uf / dolar) — diario → mensual
  async function fetchMindicador(tipo) {
    const r = await fetch(`https://mindicador.cl/api/${tipo}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`mindicador ${tipo} ${r.status}`);
    const j = await r.json(); // j.serie:[{fecha,valor}]
    const pts = j.serie.map(x => {
      const d = new Date(x.fecha);
      return {
        time: isoMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))),
        value: Number(x.valor)
      };
    });
    return toMonthlyLast(pts);
  }

  // Stooq mensual CSV vía Worker (proxy)
  async function fetchStooqMonthly(ticker) {
    const real = `https://stooq.com/q/d/l/?s=${ticker}&i=m`;
    const url = STOOQ_PROXY + encodeURIComponent(real);

    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`stooq ${ticker} ${r.status}`);
    const csv = await r.text();

    const out = [];
    const lines = csv.trim().split(/\r?\n/).slice(1); // sin header
    for (const ln of lines) {
      const [date, open, high, low, close] = ln.split(',');
      if (!date || !close) continue;
      out.push({ time: date, value: Number(close) });
    }
    return out;
  }

  // ============== Chart helpers ==============
  function makeChart(el) {
    return LightweightCharts.createChart(el, {
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#cfe0ff' },
      rightPriceScale: { borderColor: '#233048', mode: 2 }, // 2 = Logarithmic
      timeScale: { borderColor: '#233048', rightOffset: 2 },
      grid: { vertLines: { color: '#1a2434' }, horzLines: { color: '#1a2434' } },
      localization: { locale: 'es-CL' },
      crosshair: { mode: 1 }
    });
  }

  function addLine(chart, label, color) {
    return chart.addLineSeries({ title: label, color, lineWidth: 2 });
  }

  // ============== TradFi · Chile ==============
  async function drawChile() {
    const root = document.getElementById('c-chile');
    const note = document.getElementById('c-chile-note');
    if (!root) return;

    try {
      // 1) UF + USD/CLP desde mindicador (diario → último del mes)
      const [ufRaw, usdRaw] = await Promise.all([
        fetch('https://mindicador.cl/api/uf', { cache: 'no-store' }).then(r => r.json()),
        fetch('https://mindicador.cl/api/dolar', { cache: 'no-store' }).then(r => r.json())
      ]);

      const uf = toMonthlyLast(ufRaw.serie.map(x => {
        const d = new Date(x.fecha);
        return { time: isoMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), value: Number(x.valor) };
      }));

      const usd = toMonthlyLast(usdRaw.serie.map(x => {
        const d = new Date(x.fecha);
        return { time: isoMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), value: Number(x.valor) };
      }));

      // 2) IPSA (proxy ECH) mensual CSV (vía Worker)
      const ech = await fetchStooqMonthly('ech.us');

      // 3) Alinea por fechas comunes y normaliza a Base 100
      let [a, b, c] = intersectDates([uf, usd, ech]);
      a = base100(a); b = base100(b); c = base100(c);

      // 4) Dibuja
      const chart = makeChart(root);
      addLine(chart, 'UF', COLORS[0]).setData(a);
      addLine(chart, 'USD/CLP', COLORS[1]).setData(b);
      addLine(chart, 'IPSA (ECH)', COLORS[2]).setData(c);

      // 5) Click → detalle (ajústalo cuando tengas la ruta)
      root.onclick = () => { window.location.href = '/detail/tradfi-cl'; };

      if (note) note.style.display = 'none';
    } catch (e) {
      console.warn(e);
      root.innerHTML = '<div style="padding:1rem;color:#a0aec0">No se pudo cargar (Chile).</div>';
      if (note) note.style.display = 'block';
    }
  }

  // Bootstrap
  window.addEventListener('DOMContentLoaded', drawChile);
})();
