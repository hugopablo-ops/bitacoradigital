const API_BASE = 'https://bd-finnhub-proxy.hugopablo.workers.dev';
const CARDS_TO_SYMBOL = {
  AAPL: 'AAPL',
  MSFT: 'MSFT',
  NVDA: 'NVDA',
  // agrega más aquí cuando quieras…
};
async function loadQuote(symbol) {
  const url = `${API_BASE}/quote?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json(); // { c, d, dp, ... }
}

function renderCard(cardEl, data) {
  const priceEl = cardEl.querySelector('[data-field="price"]');
  const deltaEl = cardEl.querySelector('[data-field="delta"]');

  // precio actual
  priceEl.textContent = formatMoney(data.c);

  // variación porcentual
  const pct = (data.dp ?? 0);
  deltaEl.textContent = (pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '') + pct.toFixed(2) + '%';
  deltaEl.classList.toggle('up', pct > 0);
  deltaEl.classList.toggle('down', pct < 0);
}

// Formatea con separador de miles y coma decimal como lo ves en tu maqueta
function formatMoney(n) {
  try {
    return n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch { return n; }
}
async function initStocks() {
  for (const [key, symbol] of Object.entries(CARDS_TO_SYMBOL)) {
    const card = document.querySelector(`.card[data-key="${key}"]`);
    if (!card) continue;
    try {
      const q = await loadQuote(symbol);
      renderCard(card, q);
      card.classList.remove('disabled');  // saca el estilo apagado
    } catch (e) {
      console.error('Error cargando', key, e);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initStocks();
  // luego aquí enganchamos índices, FX, commodities y cripto.
});

/* =========================================================
   Bitácora Digital – Dashboards dinámicos
   Fuentes gratis:
   - Crypto: CoinGecko (sin key)
   - UF, USDCLP: mindicador.cl (sin key)
   - Finnhub (stocks/índices): vía proxy (opcional con key)
   ========================================================= */

const cfg = window.BD_CONFIG || {};
const FINNHUB_PROXY = cfg.FINNHUB_PROXY || "";   // ej: "https://bd-finnhub-proxy.hugopablo.workers.dev"
const FINNHUB_KEY   = cfg.FINNHUB_KEY || "";     // si luego tienes key, colócala en tu Worker como header

/* ----------------- Utilidades ----------------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const fmtMoney = (n, c = "USD") =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);

function setCardValue(card, price, delta, currency = "USD") {
  const v = card.querySelector('[data-field="price"]');
  const d = card.querySelector('[data-field="delta"]');
  if (v) v.textContent = fmtMoney(price, currency);
  if (d) {
    const s = (delta ?? 0);
    const sign = s > 0 ? "▲" : (s < 0 ? "▼" : "•");
    d.textContent = `${sign} ${Math.abs(s).toFixed(2)}%`;
    d.classList.toggle("up", s > 0);
    d.classList.toggle("down", s < 0);
  }
}

function setCardDash(card, msg = "—") {
  const v = card.querySelector('[data-field="price"]');
  const d = card.querySelector('[data-field="delta"]');
  if (v) v.textContent = "—";
  if (d) d.textContent = "—";
  if (msg && card.querySelector(".hint")) card.querySelector(".hint").textContent = msg;
}

/* ----------------- Crypto (CoinGecko) ----------------- */
/*
   IDs válidos (coinciden con tu HTML data-coin):
   bitcoin, ethereum, solana, ripple, binancecoin, cardano, chainlink, polkadot
*/
async function loadCrypto() {
  const cards = $$('.card[data-coin]');
  if (!cards.length) return;

  const ids = cards.map(c => c.getAttribute('data-coin')).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("CoinGecko error");
    const data = await res.json();

    cards.forEach(card => {
      const id = card.getAttribute('data-coin');
      const row = data[id];
      if (row) {
        setCardValue(card, row.usd, row.usd_24h_change, "USD");
      } else {
        setCardDash(card);
      }
    });
  } catch (e) {
    console.warn("Crypto fallback:", e);
    cards.forEach(card => setCardDash(card));
  }
}

/* ----------------- Chile (mindicador.cl) ----------------- */
async function fetchIndicador(endpoint) {
  // endpoint: "uf" | "dolar"
  const res = await fetch(`https://mindicador.cl/api/${endpoint}`, { cache: "no-store" });
  if (!res.ok) throw new Error("mindicador error");
  return res.json();
}

function latestChange(serie) {
  // retorna {precio, delta} con comparación día anterior
  if (!Array.isArray(serie) || serie.length < 2) return { precio: null, delta: null };
  const hoy = serie[0]?.valor ?? null;
  const ayer = serie[1]?.valor ?? null;
  const delta = (hoy && ayer) ? ((hoy - ayer) / ayer) * 100 : null;
  return { precio: hoy, delta };
}

async function loadChile() {
  // UF
  const ufCard = $('.card[data-key="UF"]');
  // USD/CLP
  const usdclpCard = $('.card[data-key="USDCLP"]');

  try {
    const uf = await fetchIndicador('uf');
    const { precio: pUF, delta: dUF } = latestChange(uf.serie);
    if (pUF) setCardValue(ufCard, pUF, dUF, "CLP"); else setCardDash(ufCard);
  } catch {
    setCardDash(ufCard);
  }

  try {
    const usd = await fetchIndicador('dolar');
    const { precio: pUSD, delta: dUSD } = latestChange(usd.serie);
    // precio viene en CLP por USD → mostramos en CLP
    if (pUSD) setCardValue(usdclpCard, pUSD, dUSD, "CLP"); else setCardDash(usdclpCard);
  } catch {
    setCardDash(usdclpCard);
  }
}

/* ----------------- Finnhub (opcional con proxy) ----------------- */
/*
   Mapea cada card a un símbolo compatible con tu proxy Finnhub.
   Si no tienes proxy/key, los cards quedan “—”.
*/
const FINNHUB_MAP = {
  // Índices
  "SP500": { symbol: "^GSPC",  currency: "USD", label: "S&P 500" },
  "DAX":   { symbol: "^GDAXI", currency: "EUR", label: "DAX" },
  "NIKKEI":{ symbol: "^N225",  currency: "JPY", label: "Nikkei 225" },

  // Acciones
  "AAPL":  { symbol: "AAPL",   currency: "USD" },
  "MSFT":  { symbol: "MSFT",   currency: "USD" },
  "NVDA":  { symbol: "NVDA",   currency: "USD" },
  "TSM":   { symbol: "TSM",    currency: "USD" }

  // Si luego quieres IPSA: muchos APIs no traen IPSA directo,
  // se puede reemplazar por un ETF local o usar otra fuente.
};

async function fetchFinnhubQuote(symbol) {
  if (!FINNHUB_PROXY) throw new Error("Sin proxy");
  const url = `${FINNHUB_PROXY}/quote?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Finnhub proxy error");
  const data = await res.json();
  // Formato Finnhub: { c: price, dp: cambio_pct, ... }
  return { price: data.c, delta: data.dp };
}

async function loadFinnhubCards() {
  const cards = $$('.card[data-key].disabled, .card[data-key]:not(.disabled)');
  if (!cards.length) return;

  for (const card of cards) {
    const key = card.getAttribute('data-key');
    if (!FINNHUB_MAP[key]) continue;

    try {
      const { symbol, currency } = FINNHUB_MAP[key];
      const { price, delta } = await fetchFinnhubQuote(symbol);
      if (price) {
        setCardValue(card, price, delta, currency);
        card.classList.remove("disabled");
      } else {
        setCardDash(card);
      }
    } catch (e) {
      // si no hay key/proxy o falla, lo dejamos en “—”
      setCardDash(card);
    }
  }
}

/* ----------------- Init ----------------- */
(async function init() {
  // 1) Cargar lo gratis (sin clave)
  await Promise.all([
    loadCrypto(),
    loadChile()
  ]);

  // 2) Si configuraste proxy Finnhub, intenta llenar índices/acciones
  if (FINNHUB_PROXY) {
    loadFinnhubCards();
  }

  // 3) Auto-refresh básico para crypto (cada 60s)
  setInterval(loadCrypto, 60_000);
})();
