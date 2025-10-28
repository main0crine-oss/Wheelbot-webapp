
(function(){
  const API = window.API_BASE || '';
  const $ = (sel) => document.querySelector(sel);
  const meEl = $('#me'), balEl = $('#balance'), wheelEl = $('#wheel'), spinBtn = $('#spinBtn');
  const betAmount = $('#betAmount'), placeBet = $('#placeBet'), withdrawBtn = $('#withdraw');
  const depAmount = $('#depAmount'), depositBtn = $('#deposit'), depositInfo = $('#depositInfo');
  const betsEl = $('#bets'), spinResult = $('#spinResult');
  const admin = $('#admin'), adminData = $('#adminData');

  const initData = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || '';

  function setWheel(segments){
    if(!segments || !segments.length){ wheelEl.style.background = '#e2e8f0'; return; }
    const colorMap = { blue:'#2563eb', yellow:'#f59e0b', green:'#22c55e', pink:'#ec4899' };
    const step = 100 / segments.length;
    let acc = 0, parts = [];
    for(const s of segments){
      const start = acc, end = acc + step; acc = end;
      const hex = colorMap[s.color] || '#94a3b8';
      parts.push(`${hex} ${start}% ${end}%`);
    }
    wheelEl.style.background = `conic-gradient(${parts.join(',')})`;
    if(!wheelEl.querySelector('.pointer')){
      const p = document.createElement('div');
      p.className = 'pointer';
      p.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);top:-14px;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:20px solid #0f172a;width:0;height:0;';
      wheelEl.appendChild(p);
    }
  }

  async function loadMeta(){
    try{
      const r = await fetch(`${API}/api/meta`);
      const d = await r.json();
      if(r.ok){ setWheel(d.segments); betAmount.min = d.limits.min_ton; betAmount.max = d.limits.max_ton; }
    }catch(e){ console.error(e); }
  }

  async function loadState(){
    try{
      const r = await fetch(`${API}/api/state`);
      const d = await r.json();
      if(r.ok){
        const groups = {blue:[],yellow:[],green:[],pink:[]};
        for(const b of (d.bets || [])){ groups[b.color].push(b); }
        betsEl.textContent =
          `🔵: ${groups.blue.map(x=>`@${x.username||'anon'} ${x.amount_ton}`).join(', ') || '—'}\n` +
          `🟨: ${groups.yellow.map(x=>`@${x.username||'anon'} ${x.amount_ton}`).join(', ') || '—'}\n` +
          `🟩: ${groups.green.map(x=>`@${x.username||'anon'} ${x.amount_ton}`).join(', ') || '—'}\n` +
          `🌸: ${groups.pink.map(x=>`@${x.username||'anon'} ${x.amount_ton}`).join(', ') || '—'}`;
      }
    }catch(e){ console.error(e); }
  }

  async function loadMe(){
    try{
      const r = await fetch(`${API}/api/me`, { headers: { 'X-Telegram-Init-Data': initData }});
      const d = await r.json();
      if(r.ok){
        meEl.textContent = `👤 @${d.username||'anon'}`;
        balEl.textContent = `Баланс: ${(d.balance_ton||0).toFixed(3)} TON`;
        if(d.is_admin) { admin.classList.remove('hidden'); loadAdmin(); }
      }else{
        meEl.textContent = '👤 гость (открой через Telegram WebApp)';
      }
    }catch(e){
      meEl.textContent = '👤 гость (нет initData)';
    }
  }

  async function doSpin(force){
    const body = force ? { force_color: force } : {};
    const r = await fetch(`${API}/api/spin`, { method:'POST',
      headers: { 'Content-Type':'application/json', 'X-Telegram-Init-Data': initData },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if(!r.ok){ alert(JSON.stringify(d)); return; }
    spinResult.textContent = `Раунд #${d.round_id} · Выпал ${d.result_color} ×${d.result_mult} · Банк ${d.total_bet_ton} · Выплаты ${d.total_payout_ton}`;
    await loadState(); await loadMe();
  }

  let selectedColor = 'blue';
  document.querySelectorAll('.colors button').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedColor = btn.dataset.color;
      document.querySelectorAll('.colors button').forEach(b=> b.style.outline = '');
      btn.style.outline = '2px solid #0f172a';
    });
  });

  spinBtn.addEventListener('click', () => doSpin());

  placeBet.addEventListener('click', async () => {
    const amt = parseFloat(betAmount.value);
    if(!initData){ alert('Открой WebApp из Telegram бота, чтобы авторизоваться'); return; }
    const r = await fetch(`${API}/api/bet`, { method:'POST',
      headers: { 'Content-Type':'application/json', 'X-Telegram-Init-Data': initData },
      body: JSON.stringify({ color: selectedColor, amount_ton: amt })
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ alert(JSON.stringify(d)); return; }
    await loadState();
  });

  withdrawBtn.addEventListener('click', async () => {
    if(!initData){ alert('Открой WebApp из Telegram бота, чтобы авторизоваться'); return; }
    const addr = prompt('TON-адрес (EQ...)', '');
    const amt  = parseFloat(prompt('Сумма (мин. 1.5; комиссия 0.05 удержится)', '1.5')||'0');
    if(!addr || !amt) return;
    const r = await fetch(`${API}/api/wallet/withdraw`, { method:'POST',
      headers: { 'Content-Type':'application/json', 'X-Telegram-Init-Data': initData },
      body: JSON.stringify({ to_address: addr, amount_ton: amt })
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ alert(JSON.stringify(d)); return; }
    alert('Заявка принята. Комиссия 0.05 TON');
    await loadMe();
  });

  depositBtn.addEventListener('click', async () => {
    const amt = parseFloat(depAmount.value);
    if(!initData){ alert('Открой WebApp из Telegram бота, чтобы авторизоваться'); return; }
    const r = await fetch(`${API}/api/deposit`, { method:'POST',
      headers: { 'Content-Type':'application/json', 'X-Telegram-Init-Data': initData },
      body: JSON.stringify({ amount_ton: amt })
    });
    const d = await r.json();
    if(!r.ok){ alert(JSON.stringify(d)); return; }
    depositInfo.textContent = `Отправьте ${d.amount_ton} TON на ${d.pay_to} c комментарием ${d.comment}\nDeeplink: ${d.deeplink}`;
  });

  async function loadAdmin(){
    try{
      const r = await fetch(`${API}/api/admin/overview`, { headers: { 'X-Telegram-Init-Data': initData }});
      const d = await r.json();
      if(!r.ok){ return; }
      adminData.textContent =
        'Пользователи:\n' + d.users.map(u=>`#${u.id} @${u.username||'anon'} · {{balance:${u.balance_ton}}}`).join('\n') +
        '\n\nСтавки открытого раунда:\n' + d.open_bets.map(b=>`#${b.id} @${b.username} ${b.color} {{amt:${b.amount_ton}}}`).join('\n') +
        '\n\nПоследние раунды:\n' + d.last_rounds.map(r=>`#${r.id} {{res:${r.result_color}×${r.result_mult}}} bank:${r.total_bet_ton} payout:${r.total_payout_ton}`).join('\n');
      document.querySelectorAll('.force').forEach(btn => {
        btn.onclick = () => doSpin(btn.dataset.c);
      });
    }catch(e){}
  }

  async function boot(){
    await loadMeta();
    await loadState();
    await loadMe();
  }
  boot();
})();
