/* Config */
const STOOQ_PROXY = 'https://tradfi.hugopablo.workers.dev/?url=';

/* Utils */
const COLORS = ["#63b3ed","#f6ad55","#9f7aea"]; // UF, USD/CLP, IPSA(ECH)
const isoMonth = (d) => {
  const y=d.getUTCFullYear(), m=String(d.getUTCMonth()+1).padStart(2,"0");
  return `${y}-${m}-01`;
};
function toMonthlyLast(points){
  const by={}; for(const p of points) by[p.time]=Number(p.value);
  return Object.entries(by).map(([time,value])=>({time,value}))
    .sort((a,b)=> a.time.localeCompare(b.time));
}
function base100(arr){
  if(!arr?.length) return arr;
  const i=arr.findIndex(p=>Number.isFinite(p.value));
  if(i<0) return arr;
  const b=arr[i].value||1;
  return arr.map(p=>({ time:p.time, value:(p.value/b)*100 }));
}
function intersectDates(seriesArray){
  const sets=seriesArray.map(s=> new Set(s.map(p=>p.time)));
  const common=[...sets[0]].filter(t=> sets.every(S => S.has(t))).sort();
  return seriesArray.map(s => s.filter(p=> common.includes(p.time)));
}

/* Fetchers */
async function fetchMindicador(tipo){
  const r=await fetch(`https://mindicador.cl/api/${tipo}`, {cache:'no-store'});
  if(!r.ok) throw new Error(`mindicador ${tipo} ${r.status}`);
  const j=await r.json();
  return toMonthlyLast(j.serie.map(x=>{
    const d=new Date(x.fecha);
    return { time: isoMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), value: Number(x.valor) };
  }));
}
async function fetchStooqMonthly(ticker){
  const real=`https://stooq.com/q/d/l/?s=${ticker}&i=m`;
  const url=STOOQ_PROXY+encodeURIComponent(real);
  const r=await fetch(url,{cache:'no-store'});
  if(!r.ok) throw new Error(`stooq ${ticker} ${r.status}`);
  const csv=await r.text();
  return csv.trim().split(/\r?\n/).slice(1).map(ln=>{
    const [date, , , ,close]=ln.split(',');
    return { time: date, value: Number(close) };
  });
}

/* Chart helpers */
function makeChart(el){
  return LightweightCharts.createChart(el,{
    layout:{ background:{type:'solid', color:'transparent'}, textColor:'#cbd5e0' },
    grid:{ vertLines:{color:'#1a202c'}, horzLines:{color:'#1a202c'} },
    rightPriceScale:{ borderColor:'#2d3748', mode:2 },
    timeScale:{ borderColor:'#2d3748' },
    localization:{ locale:'es-CL' },
    crosshair:{ mode:1 }
  });
}
function addLine(chart,label,color){
  return chart.addLineSeries({ title:label, color, lineWidth:2 });
}

/* TradFi Chile */
async function drawChile(){
  const root=document.getElementById('c-chile');
  if(!root) return;
  try{
    const [uf,usd,ech]=await Promise.all([
      fetchMindicador('uf'),
      fetchMindicador('dolar'),
      fetchStooqMonthly('ech.us')
    ]);
    let [a,b,c]=intersectDates([uf,usd,ech]);
    a=base100(a); b=base100(b); c=base100(c);
    const chart=makeChart(root);
    addLine(chart,'UF',COLORS[0]).setData(a);
    addLine(chart,'USD/CLP',COLORS[1]).setData(b);
    addLine(chart,'IPSA (ECH)',COLORS[2]).setData(c);
    root.onclick=()=>{ window.location.href='/detail/tradfi-cl'; };
  }catch(e){
    console.error(e);
    root.innerHTML='<div style="padding:1rem;color:#a0aec0">No se pudo cargar (Chile).</div>';
  }
}

/* Bootstrap */
window.addEventListener('DOMContentLoaded', drawChile);
