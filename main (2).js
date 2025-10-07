(function(){
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.expand(); }

  const mults = ["x2","x3","x5","x50"]; // как в боте
  const weights = [0.50, 0.30, 0.15, 0.05];

  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');
  const radius = canvas.width/2;

  let currentAngle = -Math.PI/2; // стрелка вверх
  let selectedMult = 'x2';

  // UI refs
  const multBtns = Array.from(document.querySelectorAll('.mult'));
  const spinBtn = document.getElementById('spinBtn');
  const betBtn = document.getElementById('betBtn');
  const amountEl = document.getElementById('amount');
  const statusEl = document.getElementById('status');

  multBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      multBtns.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      selectedMult = btn.dataset.mult;
    });
  });
  multBtns[0].classList.add('active');

  function drawWheel(angle){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const segCount = mults.length;
    const segAngle = 2*Math.PI/segCount;

    for(let i=0;i<segCount;i++){
      const start = angle + i*segAngle;
      const end   = start + segAngle;
      ctx.beginPath();
      ctx.moveTo(radius, radius);
      ctx.arc(radius, radius, radius-4, start, end);
      ctx.closePath();
      ctx.fillStyle = i%2 ? '#1b2b5a' : '#16224b';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0a1338';
      ctx.stroke();
      ctx.save();
      ctx.translate(radius, radius);
      ctx.rotate((start+end)/2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#eaf2ff';
      ctx.font = 'bold 22px system-ui';
      ctx.fillText(mults[i], radius-24, 8);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.moveTo(radius-12, 8);
    ctx.lineTo(radius+12, 8);
    ctx.lineTo(radius, 28);
    ctx.closePath();
    ctx.fillStyle = '#5dd6ff';
    ctx.fill();
  }

  function weightedChoice(items, probs){
    const r = Math.random();
    let acc = 0;
    for(let i=0;i<items.length;i++){
      acc += probs[i];
      if(r<=acc) return items[i];
    }
    return items[items.length-1];
  }

  function spinTo(mult){
    const segCount = mults.length;
    const segAngle = 2*Math.PI/segCount;
    const idx = mults.indexOf(mult);
    const targetAngle = -Math.PI/2 - idx*segAngle - segAngle/2;
    const extraTurns = 4*Math.PI;
    const finalAngle = targetAngle - extraTurns;
    const duration = 2200;
    const start = performance.now();
    const startAngle = currentAngle;
    function easeOutCubic(t){ return 1 - Math.pow(1-t, 3); }
    function frame(now){
      const p = Math.min(1, (now-start)/duration);
      const eased = easeOutCubic(p);
      currentAngle = startAngle + (finalAngle - startAngle)*eased;
      drawWheel(currentAngle);
      if(p<1) requestAnimationFrame(frame);
      else {
        statusEl.textContent = `Выпало: ${mult}`;
      }
    }
    requestAnimationFrame(frame);
  }

  drawWheel(currentAngle);

  spinBtn.addEventListener('click', ()=>{
    const result = weightedChoice(mults, weights);
    statusEl.textContent = 'Крутим…';
    spinTo(result);
  });

  betBtn.addEventListener('click', ()=>{
    const amount = parseInt(amountEl.value, 10) || 0;
    if(amount<=0){ statusEl.textContent = 'Введи сумму > 0'; return; }
    const payload = { action: 'bet', amount, mult: selectedMult };
    if (tg && tg.sendData){
      tg.sendData(JSON.stringify(payload));
      statusEl.textContent = 'Ставка отправлена боту';
    } else {
      console.log('sendData', payload);
      statusEl.textContent = 'Локальный режим: открой через Telegram WebApp';
    }
  });
})();