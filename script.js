const cfg = window.WHEELBOT_CONFIG || {};
const API = cfg.API_BASE;
const WS_URL = API.replace(/^http/, 'ws') + '/ws';

const els = {
  status: document.getElementById('status'),
  bank: document.getElementById('bank'),
  timer: document.getElementById('center-timer'),
  wheel: document.getElementById('wheel'),
  history: document.getElementById('history'),
  bets: document.getElementById('bets'),
  amount: document.getElementById('amount'),
  makeBet: document.getElementById('makeBet'),
};

let selectedColor = 'yellow';
document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedColor = btn.dataset.color;
    document.querySelectorAll('.btn').forEach(b => b.style.outline = '');
    btn.style.outline = '2px solid #fff';
  });
});

// Telegram init
const tg = window.Telegram?.WebApp;
els.status.textContent = tg ? 'Открыто в Telegram WebApp' : 'Демо-режим (вне Телеграма)';

// Bets
els.makeBet.addEventListener('click', async () => {
  const amount = Number(els.amount.value || 0);
  if (!amount || amount <= 0) return alert('Сумма должна быть > 0');
  const userId = tg?.initDataUnsafe?.user?.id?.toString() || 'demo-user';
  try {
    const r = await fetch(`${API}/api/bet`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ bets: [{ user_id: userId, amount, color: selectedColor }] })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({detail:`HTTP ${r.status}`}));
      throw new Error(e.detail);
    }
  } catch (e) {
    alert(`Ошибка ставки: ${e.message}`);
  }
});

// WebSocket
let ws;
let rotor = 0;
const TOTAL = 54;
const ANGLE_PER = 360 / TOTAL;

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => console.log('WS open');
  ws.onmessage = (ev) => handleWS(JSON.parse(ev.data));
  ws.onclose = () => setTimeout(connectWS, 3000);
}
connectWS();

function handleWS(msg) {
  if (msg.type === 'init') {
    els.bank.textContent = (msg.round.bank || 0).toFixed(2);
    els.timer.textContent = msg.round.time_left ?? '—';
    renderHistory(msg.history || []);
  }
  else if (msg.type === 'tick') {
    els.bank.textContent = (msg.bank || 0).toFixed(2);
    els.timer.textContent = msg.time_left ?? '—';
  }
  else if (msg.type === 'bet_placed') {
    // append bets
    (msg.bets || []).forEach(b => appendBet(b));
    els.bank.textContent = (msg.bank || 0).toFixed(2);
  }
  else if (msg.type === 'result') {
    spinToIndex(msg.sector_index);
    prependHistory(msg.result);
  }
}

function appendBet(b) {
  const li = document.createElement('li');
  li.textContent = `${b.user_id} — ${b.amount} на ${b.color}`;
  els.bets.prepend(li);
  // keep last 20
  while (els.bets.children.length > 20) els.bets.removeChild(els.bets.lastChild);
}

// Spin animation: pointer is at 0deg (top). We rotate wheel so target sector sits at top.
// Target angle for sector index i is i*ANGLE_PER + ANGLE_PER/2. To bring it to top, rotate by -(target).
function spinToIndex(idx) {
  const target = idx * ANGLE_PER + ANGLE_PER/2;
  const spins = 6;
  const final = rotor - (spins*360 + target);
  els.wheel.style.transition = 'transform 6s cubic-bezier(.2,.8,.2,1)';
  els.wheel.style.transform = `rotate(${final}deg)`;
  const done = () => {
    rotor = final % 360;
    els.wheel.style.transition = '';
    els.wheel.removeEventListener('transitionend', done);
  };
  els.wheel.addEventListener('transitionend', done);
}

// History bar
function renderHistory(arr) {
  els.history.innerHTML = '';
  arr.forEach(it => {
    const box = document.createElement('div');
    box.className = 'hist-box';
    box.style.background = colorFor(it.result);
    els.history.appendChild(box);
  });
}
function prependHistory(color) {
  const box = document.createElement('div');
  box.className = 'hist-box';
  box.style.background = colorFor(color);
  els.history.prepend(box);
  while (els.history.children.length > 50) els.history.removeChild(els.history.lastChild);
}

function colorFor(c) {
  if (c === 'yellow') return '#ffd66b';
  if (c === 'blue') return '#7fb7ff';
  if (c === 'green') return '#9fffb7';
  if (c === 'red') return '#ff9f9f';
  return '#666';
}
