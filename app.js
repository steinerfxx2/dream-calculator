'use strict';

const $ = (s) => document.querySelector(s);
const fmt = (n) => Math.round(Number(n)).toLocaleString('en-US');
const pct = (x) => {
  const v = x * 100;
  return (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)).replace(/\.?0+$/, '') + '%';
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let D = null, CARS = [], BYID = {};
const st = { slots: [0, 1, 2].map(() => ({ tag: '', act: true, price: '' })), n: '', car: null, q: '' };

/* ---------------------------------------------------------------- storage / share */
function encode() {
  const s = st.slots.map((x) => [x.tag, x.act ? 1 : 0, x.price].join('~')).join('|');
  const p = new URLSearchParams();
  p.set('s', s);
  if (st.n) p.set('n', st.n);
  if (st.car) p.set('c', st.car);
  return p.toString();
}
function decode(str) {
  const p = new URLSearchParams(str);
  if (!p.has('s') && !p.has('c')) return false;
  (p.get('s') || '').split('|').slice(0, 3).forEach((part, i) => {
    const [tag, act, price] = part.split('~');
    st.slots[i] = { tag: D.tags[tag] ? tag : '', act: act !== '0', price: /^\d+$/.test(price || '') ? price : '' };
  });
  const n = p.get('n');
  st.n = /^\d+$/.test(n || '') ? n : '';
  const c = Number(p.get('c'));
  st.car = BYID[c] ? c : null;
  return true;
}
function save() {
  try { localStorage.setItem('dreamcalc', encode()); } catch (e) { /* private mode */ }
}
function load() {
  if (location.hash.length > 1 && decode(location.hash.slice(1))) return;
  try { const v = localStorage.getItem('dreamcalc'); if (v) decode(v); } catch (e) { /* ignore */ }
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------------------------------------------------------------- helpers */
function tagChip(key) {
  const t = D.tags[key];
  if (!t) return '';
  return `<span class="chip" style="color:${t.color || '#c9d1de'}">${esc(t.th)}</span>`;
}
function tagsOf(group) {
  return Object.entries(D.tags).filter(([, t]) => t.group === group);
}
const in3 = (p) => 1 - Math.pow(1 - p, 3);

/* ---------------------------------------------------------------- header */
function renderEvent() {
  const e = D.event;
  $('#event').innerHTML =
    `<span class="pill">ตู้ <b>${esc(e.th)}</b></span>` +
    `<span class="pill">${esc(e.start)} – ${esc(e.end)}</span>` +
    `<span class="pill">รายการความฝัน <b>${e.total}</b> คัน</span>` +
    `<span class="pill">ตำนาน ${e.legendary} · แรร์ ${e.rare} · ทั่วไป ${e.basic}</span>`;
}

/* ---------------------------------------------------------------- slots */
function renderSlots() {
  const used = new Set(st.slots.map((s) => s.tag).filter(Boolean));
  let html = '';
  st.slots.forEach((s, i) => {
    const off = i > 0 && !st.slots[i - 1].tag;
    let opts = '<option value="">— ยังไม่ได้รับ —</option>';
    for (const g of D.groups) {
      opts += `<optgroup label="${esc(g.th)}">`;
      for (const [k, t] of tagsOf(g.key)) {
        const info = [t.prob != null ? t.prob + '%' : null, t.price ? fmt(t.price) : null].filter(Boolean).join(' · ');
        const dis = used.has(k) && s.tag !== k ? ' disabled' : '';
        opts += `<option value="${k}"${s.tag === k ? ' selected' : ''}${dis}>${esc(t.th)}${info ? '  (' + info + ')' : ''}</option>`;
      }
      opts += '</optgroup>';
    }
    const t = D.tags[s.tag];
    html += `<div class="slot${off ? ' off' : ''}">
      <div class="slot-h"><b>แท็ก ${i + 1}</b><span>ค่ารับแท็ก ${fmt(D.rounds[i])} ตั๋ว</span></div>
      <select data-i="${i}" aria-label="แท็ก ${i + 1}"${off ? ' disabled' : ''}>${opts}</select>
      ${s.tag ? `<div class="slot-row">
        <label><input type="checkbox" data-act="${i}"${s.act ? ' checked' : ''}> เป็นผล</label>
        <label>ราคารถของแท็กนี้ <input type="number" min="0" step="50" data-price="${i}" value="${esc(s.price)}" placeholder="—"></label>
      </div>` : ''}
    </div>`;
  });
  $('#slots').innerHTML = html;
  $('#n').value = st.n;
}

function onSlotChange(e) {
  const el = e.target;
  if (el.matches('select[data-i]')) {
    const i = +el.dataset.i;
    const k = el.value;
    st.slots[i].tag = k;
    st.slots[i].price = k && D.tags[k].price ? String(D.tags[k].price) : '';
    st.slots[i].act = true;
    if (!k) for (let j = i + 1; j < 3; j++) st.slots[j] = { tag: '', act: true, price: '' };
    renderSlots();
  } else if (el.matches('[data-act]')) {
    st.slots[+el.dataset.act].act = el.checked;
  } else if (el.matches('[data-price]')) {
    st.slots[+el.dataset.price].price = el.value.replace(/[^\d]/g, '');
  }
  update();
}

/* ---------------------------------------------------------------- result */
function compute() {
  const got = st.slots.filter((s) => s.tag);
  const tagCost = got.reduce((a, _, i) => a + D.rounds[i], 0);
  const act = got.filter((s) => s.act);
  const prices = act.map((s) => Number(s.price) || 0);
  const carPrice = act.length ? Math.max(...prices) : null;
  const priceMissing = act.some((s) => !Number(s.price));
  const total = carPrice != null ? tagCost + carPrice : null;
  const n = Number(st.n) > 0 ? Math.floor(Number(st.n)) : null;
  return { got, act, tagCost, carPrice, priceMissing, total, n };
}

function renderResult() {
  const r = compute();
  const pity = D.expo.fee * D.expo.pity;
  const nextCost = r.got.length < 3 ? D.rounds[r.got.length] : null;
  let h = '<h2>ผลคำนวณ</h2>';

  if (!r.got.length) {
    const minCar = Math.min(...Object.values(D.tags).filter((t) => t.price).map((t) => t.price));
    const maxCar = Math.max(...Object.values(D.tags).filter((t) => t.price).map((t) => t.price));
    h += `<dl class="kv">
        <dt>รับแท็ก 1</dt><dd>${fmt(D.rounds[0])} ตั๋ว</dd>
        <dt>รับรถด้วย 1 แท็ก</dt><dd>${fmt(D.rounds[0] + minCar)} – ${fmt(D.rounds[0] + maxCar)} ตั๋ว</dd>
        <dt>รับครบ 3 แท็กแล้วรับรถ สูงสุด</dt><dd>${fmt(D.rounds.reduce((a, b) => a + b, 0) + maxCar)} ตั๋ว</dd>
        <dt>การันตีรถหน้าตู้ Expo ปกติ</dt><dd>${fmt(pity)} เพชร</dd>
      </dl>`;
    $('#result').innerHTML = h;
    renderBar(null);
    return;
  }

  if (r.total != null) {
    h += `<div class="big"><span class="num">${fmt(r.total)}</span><span class="unit">ตั๋ว = ${fmt(r.total * D.ticket_diamond)} เพชร สำหรับรถคันนี้</span></div>`;
  } else {
    h += `<div class="big"><span class="num">${fmt(r.tagCost)}</span><span class="unit">ตั๋วที่ใช้ไปกับแท็กแล้ว</span></div>`;
  }
  const refMin = r.tagCost * D.refund_min;
  const refMax = r.tagCost * (D.refund_min + D.refund_bonus_max);
  h += `<dl class="kv">
    <dt>ใช้ไปกับแท็ก (${r.got.length} แท็ก)</dt><dd>${fmt(r.tagCost)} ตั๋ว</dd>
    <dt>ราคารับรถตอนนี้</dt><dd>${r.carPrice != null ? fmt(r.carPrice) + ' ตั๋ว' : '—'}</dd>
    ${nextCost ? `<dt>ถ้ารับแท็กถัดไปก่อน</dt><dd>+${fmt(nextCost)} ตั๋ว</dd>` : ''}
    <dt>ถ้ายกเลิกรอบนี้ ได้คืน</dt><dd>${fmt(refMin)}${refMax > refMin ? ' – ' + fmt(refMax) : ''} ตั๋ว</dd>
  </dl>`;

  if (r.n && r.total != null) {
    const chance = 1 / r.n;
    const expect = r.n * r.total;
    const breakEven = Math.floor(pity / r.total);
    const good = expect <= pity;
    h += `<dl class="kv">
      <dt>โอกาสได้รถคันที่อยากได้</dt><dd>1 ใน ${fmt(r.n)} = ${pct(chance)}</dd>
      <dt>ถ้าต้องทำซ้ำจนได้</dt><dd>≈ ${fmt(expect)} ตั๋ว</dd>
    </dl>
    <div class="verdict ${good ? 'good' : 'bad'}">${good
      ? `<b>ถูกกว่า</b>การันตีตู้ Expo ปกติ (${fmt(pity)} เพชร)`
      : `<b>แพงกว่า</b>การันตีตู้ Expo ปกติ (${fmt(pity)} เพชร)`}
      — ที่ราคารถคันละ ${fmt(r.total)} ตั๋ว จะคุ้มกว่าเมื่อรายการเหลือไม่เกิน <b>${fmt(breakEven)} คัน</b></div>`;
  }
  $('#result').innerHTML = h;
  renderBar(r);
}

let resultVisible = false;
function renderBar(r) {
  const bar = $('#mbar');
  if (!r || !r.got.length || resultVisible) { bar.hidden = true; return; }
  const left = r.total != null ? `รวม <b>${fmt(r.total)}</b> ตั๋ว` : `แท็ก <b>${fmt(r.tagCost)}</b> ตั๋ว`;
  const right = r.n && r.total != null ? `โอกาส ${pct(1 / r.n)} ▾` : 'ดูผล ▾';
  bar.innerHTML = `<span>${left}</span><span>${right}</span>`;
  bar.hidden = false;
}
function carImg(c, kind) {
  const has = kind === 'hero' ? c.hero : c.side;
  if (has) return `<img src="img/${kind}/${c.id}.webp" alt="${esc(c.n)}" loading="lazy" width="${kind === 'hero' ? 468 : 392}" height="${kind === 'hero' ? 220 : 160}">`;
  if (kind === 'hero' && c.side) return carImg(c, 'side');
  return '<div class="noimg"></div>';
}

function renderPicked() {
  const c = st.car && BYID[st.car];
  if (!c) { $('#picked').innerHTML = ''; return; }
  const known = c.tags.filter((k) => D.tags[k] && D.tags[k].prob != null);
  const pAny = known.reduce((a, k) => a + D.tags[k].prob / 100, 0);
  const rows = c.tags.map((k) => {
    const t = D.tags[k];
    return `<tr><td>${tagChip(k)}</td><td>${t.prob != null ? t.prob + '%' : '<span class="na">—</span>'}</td>
      <td>${t.price ? fmt(t.price) : '<span class="na">—</span>'}</td>
      <td>${t.prob != null ? pct(in3(t.prob / 100)) : '<span class="na">—</span>'}</td></tr>`;
  }).join('');
  $('#picked').innerHTML = `<div class="picked">
    <div>${carImg(c, 'hero')}</div>
    <div>
      <h3>${esc(c.n)}</h3>
      <div class="meta">${[c.y ? 'ปี ' + c.y : '', c.perf ? 'คะแนนเริ่มต้น ' + c.perf : ''].filter(Boolean).join(' · ')}</div>
      <div class="tablewrap"><table>
        <thead><tr><th>แท็กของรถ</th><th>อัตรา</th><th>ราคารถ</th><th>ใน 3 แท็ก</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${known.length ? `<p class="est">โอกาสได้แท็กของรถคันนี้ใน 3 แท็ก ≈ <b>${pct(in3(Math.min(pAny, 1)))}</b></p>` : ''}
    </div></div>`;
}

function renderGrid() {
  const q = st.q.trim().toLowerCase();
  let list = CARS.filter((c) => c.side || c.hero);
  if (q) list = CARS.filter((c) => c.n.toLowerCase().includes(q));
  list = list.slice().sort((a, b) => (b.perf || 0) - (a.perf || 0));
  $('#grid').innerHTML = list.map((c) =>
    `<button type="button" class="car${st.car === c.id ? ' sel' : ''}" data-car="${c.id}">
      ${carImg(c, 'side')}<span class="nm">${esc(c.n)}</span></button>`).join('') ||
    '<p class="empty">ไม่พบรถ</p>';
}

/* ---------------------------------------------------------------- tag table */
function renderTags() {
  let h = '';
  for (const g of D.groups) {
    const list = tagsOf(g.key);
    const knownAny = list.some(([, t]) => t.prob != null);
    h += `<div class="tg"><h3>${esc(g.th)}</h3>`;
    if (knownAny) {
      h += `<div class="tablewrap"><table><thead><tr><th>แท็ก</th><th>อัตรา</th><th>ราคารถ</th><th>ใน 3 แท็ก</th></tr></thead><tbody>`;
      for (const [k, t] of list) {
        h += `<tr><td>${tagChip(k)}</td><td>${t.prob != null ? t.prob + '%' : '<span class="na">—</span>'}</td>
          <td>${t.price ? fmt(t.price) : '<span class="na">—</span>'}</td>
          <td>${t.prob != null ? pct(in3(t.prob / 100)) : '<span class="na">—</span>'}</td></tr>`;
      }
      h += '</tbody></table></div>';
    } else {
      h += `<div>${list.map(([k]) => tagChip(k)).join('')}</div>`;
    }
    h += '</div>';
  }
  $('#tags').innerHTML = h;
}

/* ---------------------------------------------------------------- wiring */
function update() {
  renderResult();
  save();
}

function bind() {
  $('#slots').addEventListener('change', onSlotChange);
  $('#slots').addEventListener('input', (e) => { if (e.target.matches('[data-price]')) onSlotChange(e); });
  $('#n').addEventListener('input', (e) => { st.n = e.target.value.replace(/[^\d]/g, ''); update(); });
  $('#q').addEventListener('input', (e) => { st.q = e.target.value; renderGrid(); });
  $('#grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-car]');
    if (!b) return;
    const id = +b.dataset.car;
    st.car = st.car === id ? null : id;
    renderPicked(); renderGrid(); update();
    if (st.car) $('#picked').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#mbar').addEventListener('click', () => $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { resultVisible = es[0].isIntersecting; renderBar(compute()); })
      .observe($('#result'));
  }
  $('#reset').addEventListener('click', () => {
    st.slots = [0, 1, 2].map(() => ({ tag: '', act: true, price: '' }));
    st.n = '';
    renderSlots(); update();
  });
  $('#share').addEventListener('click', async () => {
    const url = location.href.split('#')[0] + '#' + encode();
    try { await navigator.clipboard.writeText(url); toast('คัดลอกลิงก์แล้ว'); }
    catch (e) { prompt('คัดลอกลิงก์นี้', url); }
  });
}

async function boot() {
  try {
    const [d, c] = await Promise.all([
      fetch('data/dream.json').then((r) => r.json()),
      fetch('data/cars.json').then((r) => r.json()),
    ]);
    D = d; CARS = c;
    CARS.forEach((x) => { BYID[x.id] = x; });
  } catch (e) {
    $('#result').innerHTML = '<p class="empty">โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้า</p>';
    return;
  }
  load();
  renderEvent(); renderSlots(); renderTags(); renderPicked(); renderGrid();
  bind(); update();
}
boot();
