(function(){
  const API_BASE = "https://wheelbot-api-1.onrender.com"; // 🔧 Замени на свой адрес Render API
  const ROUND_SECONDS = 30;

  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');
  const R = canvas.width/2;
  let currentAngle = -Math.PI/2;

  // Расклад: 26 x2, 17 x3, 10 x5, 1 x50
  const sectors = [];
  for(let i=0;i<26;i++) sectors.push('x2');
  for(let i=0;i<17;i++) sectors.push('x3');
  for(let i=0;i<10;i++) sectors.push('x5');
  sectors.push('x50');

  function xmur3(str){ for(var i=0,h=1779033703^str.length;i<str.length;i++) h=Math.imul(h^str.charCodeAt(i),3432918353),h=h<<13|h>>>19; return function(){ h=Math.imul(h^h>>>16,2246822507); h=Math.imul(h^h>>>13,3266489909); return (h^h>>>16)>>>0; } }
  function mulberry32(a){ return function(){ var t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15, t|1); t^=t+Math.imul(t^t>>>7, t|61); return ((t^t>>>14)>>>0)/4294967296; } }
  function shuffleDeterministic(arr, seedStr='wheel_v3_54'){
    const seed = xmur3(seedStr)(); const rand = mulberry32(seed);
    for(let i=arr.length-1;i>0;i--){ const j = Math.floor(rand()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  }
  shuffleDeterministic(sectors);

  function draw(angle=currentAngle){
    const COL = {x2:['#1f4fa8','#3ea6ff'], x3:['#0b6b4f','#34d399'], x5:['#8a6b00','#ffd54a'], x50:['#7a1a7f','#e879f9']};
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.beginPath(); ctx.arc(R,R,R-4,0,2*Math.PI); ctx.lineWidth=12; ctx.strokeStyle='#0c183f'; ctx.stroke();
    const A = 2*Math.PI/sectors.length;
    for(let i=0;i<sectors.length;i++){
      const start = angle + i*A, end = start + A, mult = sectors[i];
      const [c1,c2] = COL[mult];
      const grad = ctx.createRadialGradient(R,R,28,R,R,R);
      grad.addColorStop(0,c1); grad.addColorStop(1,c2);
      ctx.beginPath(); ctx.moveTo(R,R); ctx.arc(R,R,R-18,start,end); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill(); ctx.lineWidth=1.4; ctx.strokeStyle='#0d1b4a'; ctx.stroke();
      ctx.save(); ctx.translate(R,R); ctx.rotate(start);
      ctx.beginPath(); ctx.moveTo(R-18,0); ctx.lineTo(R-4,0); ctx.lineWidth=2.2; ctx.strokeStyle='#0b1b45'; ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(R,R,50,0,2*Math.PI); ctx.fillStyle='#0f1a3f'; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle='#2b4ea8'; ctx.stroke();
  }
  draw();

  async function api(path){
    const res = await fetch(API_BASE + path, {credentials:'omit'});
    if(!res.ok) throw new Error('API '+res.status);
    return await res.json();
  }

  const bankVal = document.getElementById('bankVal');
  const playersList = document.getElementById('playersList');
  const historyList = document.getElementById('historyList');
  const secEl = document.getElementById('sec');
  const amountEl = document.getElementById('amount');
  const betBtn = document.getElementById('betBtn');
  const multBtns = Array.from(document.querySelectorAll('.mult'));
  let selectedMult = 'x2';
  function setMult(btn){ multBtns.forEach(b=>b.classList.remove('active')); btn.classList.add('active'); selectedMult = btn.dataset.mult; }
  multBtns.forEach(btn=>btn.addEventListener('click', ()=>setMult(btn))); setMult(multBtns[0]);

  const tg = window.Telegram?.WebApp; if (tg) tg.expand();

  async function refreshRound(){
    try{
      const st = await api('/round');
      bankVal.textContent = Number(st.bank||0).toLocaleString('ru-RU');
      playersList.innerHTML = '';
      for(const p of st.players){
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.name}</span><span>${Number(p.amount).toLocaleString('ru-RU')}</span><b>${p.mult}</b>`;
        playersList.appendChild(li);
      }
      secEl.textContent = st.seconds_left;
    }catch(e){ }
  }

  async function refreshHistory(){
    try{
      const hs = await api('/history?limit=30');
      historyList.innerHTML = '';
      for(const h of hs){
        const li = document.createElement('li');
        const dt = new Date((h.ended_at||h.started_at)*1000).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        li.innerHTML = `<span>${dt}</span><span>банк ${Number(h.bank).toLocaleString('ru-RU')}</span><b class="res-${h.result}">${h.result}</b>`;
        historyList.appendChild(li);
      }
    }catch(e){ }
  }

  betBtn.addEventListener('click', ()=>{
    const amount = parseInt(amountEl.value, 10) || 0;
    if (amount<=0) return alert('Введи сумму > 0');
    const payload = { action:'bet', amount, mult: selectedMult };
    if (tg && tg.sendData){
      tg.sendData(JSON.stringify(payload));
      setTimeout(refreshRound, 600);
    }else{
      alert('Открой через Telegram');
    }
  });

  setInterval(refreshRound, 1000);
  setInterval(refreshHistory, 3000);
  refreshRound(); refreshHistory();
})();
