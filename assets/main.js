
(function(){
  const API = window.API_BASE || '';
  const $ = (s)=>document.querySelector(s);
  const initData = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';

  // Elements
  const wheel = $('#wheel'); const ctx = wheel.getContext('2d');
  const timerEl = $('#timer'); const phaseEl = $('#phase');
  const bankEl = $('#bank'); const resultEl = $('#spinResult');
  const balanceEl = $('#userBalance');
  const betInput = $('#betAmount'); const betBtn = $('#betBtn');
  const chips = document.querySelectorAll('.chip');
  const historyEl = $('#history'); const betsEl = $('#bets');

  const panel = $('#panel'); const dep = $('#dep'); const wd = $('#wd');
  $('#depositToggle').onclick = ()=>{ panel.classList.remove('hidden'); dep.classList.remove('hidden'); wd.classList.add('hidden'); };
  $('#withdrawToggle').onclick = ()=>{ panel.classList.remove('hidden'); wd.classList.remove('hidden'); dep.classList.add('hidden'); };
  panel.addEventListener('click', (e)=>{ if(e.target===panel) panel.classList.add('hidden'); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') panel.classList.add('hidden'); });

  const depAmount = $('#depAmount'), depBtn = $('#depositBtn'), depInfo = $('#depositInfo');
  depBtn.onclick = async ()=>{
    if(!initData){ alert('Открой из Telegram'); return; }
    const amt = parseFloat(depAmount.value||'0');
    const r = await fetch(`${API}/api/deposit`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData}, body: JSON.stringify({amount_ton: amt})});
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ alert(JSON.stringify(d)); return; }
    depInfo.textContent = `Переведите ${d.amount_ton} TON на ${d.pay_to} с комментарием ${d.comment}\nDeeplink: ${d.deeplink}`;
  };

  const wdAddr = $('#wdAddress'), wdAmt = $('#wdAmount'), wdBtn = $('#withdrawBtn');
  wdBtn.onclick = async ()=>{
    if(!initData){ alert('Открой из Telegram'); return; }
    const addr = wdAddr.value.trim(); const amt = parseFloat(wdAmt.value||'0');
    if(!addr || !amt){ alert('Укажите адрес и сумму'); return; }
    const r = await fetch(`${API}/api/wallet/withdraw`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData}, body: JSON.stringify({to_address: addr, amount_ton: amt})});
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ alert(JSON.stringify(d)); return; }
    alert(`Заявка принята (комиссия ${d.fee_ton} TON)`);
  };

  // State
  let segments = [];        // from API
  let displaySegments = []; // shuffled for UI
  let selected = 'blue';
  let countdown = 30; let tId = null;
  let roundHistory = []; // client-side only

  chips.forEach(btn=>{
    btn.onclick = ()=>{
      selected = btn.dataset.color;
      chips.forEach(x=>x.style.outline='none');
      btn.style.outline = '2px solid rgba(255,255,255,.4)';
    };
  });

  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function drawWheel(){
    const W = wheel.width, H = wheel.height, R = W/2;
    ctx.clearRect(0,0,W,H);
    ctx.save(); ctx.translate(R,R);
    const colors = {blue:'#4f86ff', yellow:'#ffc857', green:'#22c55e', pink:'#ff6ea8'};
    const n = (displaySegments && displaySegments.length) ? displaySegments.length : 1;
    let ang = -Math.PI/2; const step = 2*Math.PI/n;
    for(let i=0;i<n;i++){
      const s = displaySegments[i] || {color:'blue'};
      ctx.beginPath(); ctx.arc(0,0,R-12,ang,ang+step,false); ctx.lineWidth=16;
      ctx.strokeStyle = colors[s.color] || '#334155'; ctx.stroke();
      // divider
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo((R-20)*Math.cos(ang), (R-20)*Math.sin(ang));
      ctx.lineWidth = 1; ctx.strokeStyle='rgba(255,255,255,.55)'; ctx.stroke();
      ang += step;
    }
    // outer ring
    ctx.beginPath(); ctx.lineWidth=14; ctx.strokeStyle='#0c152b'; ctx.arc(0,0,R-6,0,2*Math.PI); ctx.stroke();
    ctx.restore();
  }

  function setTimer(v){ timerEl.textContent = String(v).padStart(2,'0'); }

  function startTimer(){
    clearInterval(tId);
    countdown = 30; setTimer(countdown); phaseEl.textContent = 'Before the game starts';
    tId = setInterval(async ()=>{
      countdown -= 1; setTimer(Math.max(0,countdown));
      if(countdown<=0){
        clearInterval(tId);
        try{ await spin(); }catch(e){}
        startTimer();
      }
    }, 1000);
  }

  async function fetchJSON(url, opts={}){
    const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    const r = await fetch(url, Object.assign({}, opts, {headers}));
    const d = await r.json().catch(()=>({}));
    if(!r.ok) throw d;
    return d;
  }

  async function loadMeta(){
    const d = await fetchJSON(`${API}/api/meta`);
    segments = d.segments || [];
    displaySegments = shuffle(segments); // хаотично на UI
    betInput.min = d.limits?.min_ton ?? 0.1;
    betInput.max = d.limits?.max_ton ?? 10;
    drawWheel();
  }

  async function loadMe(){
    try{
      const d = await fetchJSON(`${API}/api/me`, { headers:{'X-Telegram-Init-Data':initData}});
      balanceEl.textContent = `Баланс: ${(d.balance_ton||0).toFixed(3)} TON`;
      if(d.is_admin){
        $('#admin').classList.remove('hidden');
        loadAdmin();
      }
    }catch(e){ balanceEl.textContent = 'Баланс: — (открой через Telegram)'; }
  }

  async function loadState(){
    const d = await fetchJSON(`${API}/api/state`);
    bankEl.textContent = `Банк: ${d.total_bet_ton||0}`;
    const groups = {blue:[],yellow:[],green:[],pink:[]};
    for(const b of (d.bets||[])){ groups[b.color].push(b); }
    const fmt = (arr)=>arr.map(x=>`@${x.username||'anon'} ${x.amount_ton}`).join(', ') || '—';
    betsEl.textContent = `🔵 ${fmt(groups.blue)}\n🟨 ${fmt(groups.yellow)}\n🟩 ${fmt(groups.green)}\n🌸 ${fmt(groups.pink)}`;
  }

  async function placeBet(){
    const amount = parseFloat(betInput.value||'0');
    if(!initData){ alert('Открой из Telegram'); return; }
    try{
      await fetchJSON(`${API}/api/bet`, { method:'POST', headers:{'X-Telegram-Init-Data':initData}, body: JSON.stringify({color:selected, amount_ton:amount})});
      await loadState();
    }catch(e){ alert(JSON.stringify(e)); }
  }
  $('#betBtn').onclick = placeBet;

  async function spin(force){
    const d = await fetchJSON(`${API}/api/spin`, { method:'POST', headers:{'X-Telegram-Init-Data':initData}, body: JSON.stringify(force?{force_color:force}:{}) });
    resultEl.textContent = `Раунд #${d.round_id}: ${d.result_color} ×${d.result_mult} · банк ${d.total_bet_ton} · выплаты ${d.total_payout_ton}`;
    roundHistory.unshift({ id:d.round_id, color:d.result_color, mult:d.result_mult, bank:d.total_bet_ton, payout:d.total_payout_ton });
    if(roundHistory.length>20) roundHistory.pop();
    renderHistory();
    await loadState(); await loadMe();
  }

  function renderHistory(){
    historyEl.innerHTML = '';
    for(const h of roundHistory){
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.innerHTML = `<span>#${h.id} · банк ${h.bank}</span><span class="tag ${h.color}">×${h.mult}</span>`;
      historyEl.appendChild(row);
    }
  }

  async function loadAdmin(){
    try{
      const d = await fetchJSON(`${API}/api/admin/overview`, { headers:{'X-Telegram-Init-Data':initData} });
      $('#adminData').textContent = 'Пользователи:\\n' + d.users.map(u=>`#${u.id} @${u.username||'anon'} · balance:${u.balance_ton}`).join('\\n');
      document.querySelectorAll('[data-force]').forEach(b=> b.onclick = ()=> spin(b.dataset.force));
    }catch(e){}
  }

  async function boot(){
    await loadMeta();
    await loadState();
    await loadMe();
    startTimer();
  }
  boot();
})();
