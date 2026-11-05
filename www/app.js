/* app.js - 하루 5문장 영어 원서 공부 */
(function () {
'use strict';
const C = window.Core;
const KEY = 'estudy_v1';
const PER = 5;
const ROLE = {
  S: { n: '주어', h: '누가·무엇이' }, V: { n: '동사', h: '한다·이다' }, O: { n: '목적어', h: '무엇을' },
  C: { n: '보어', h: '어떤·무엇' }, M: { n: '꾸밈말', h: '언제·어디서·어떻게' }, L: { n: '이음말', h: '그리고·하지만' },
  Q: { n: '말·생각', h: '누가 한 말' }
};

/* ---------- 작은 도구들 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return ymd(new Date()); }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function mdLabel(s) { const d = parseYmd(s); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + '일월화수목금토'[d.getDay()] + ')'; }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600); }

/* ---------- 저장소 ---------- */
const mem = new Map();
let idbP = null;
function idb() {
  if (!idbP) idbP = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('estudy', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return idbP;
}
async function kvGet(k) {
  try { const db = await idb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); }
  catch (e) { return mem.get(k); }
}
async function kvSet(k, v) {
  mem.set(k, v);
  try { const db = await idb(); await new Promise(res => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* 메모리에만 */ }
}
function defaultState() {
  return { v: 1, activeBook: null, books: {}, words: {}, records: {},
    settings: { notifyOn: true, notifyTime: '21:00', apiKey: '', model: 'claude-sonnet-5-5' }, lastNotified: '' };
}
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v) return Object.assign(defaultState(), s); } catch (e) {}
  return defaultState();
}
let S = loadState();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('저장 공간이 부족해요. 설정에서 백업을 받아 주세요.'); }
  syncMeta();
}
let A = {};            // 내가 만든/불러온 분석 (해시 → 분석)
let PACK = {};         // 앱에 들어있는 기본 분석
let saveAT = null;
function saveAnalysis() { clearTimeout(saveAT); saveAT = setTimeout(() => kvSet('analysis', A), 300); }
function getAnalysis(sentence) { const h = C.hashSentence(sentence); return A[h] || PACK[h] || null; }

/* ---------- 책 ---------- */
const PARSED = {};
async function getBookText(id) {
  if (window.BUNDLED_BOOKS && window.BUNDLED_BOOKS[id]) return window.BUNDLED_BOOKS[id].text;
  return await kvGet('book:' + id);
}
async function ensureParsed(id) {
  if (PARSED[id]) return PARSED[id];
  const text = await getBookText(id);
  if (!text) return null;
  PARSED[id] = C.parseBook(text);
  return PARSED[id];
}
function curBook() { return S.books[S.activeBook]; }
function sentencesOf(id) { const p = PARSED[id]; return p ? p.sentences.slice(S.books[id].skip || 0) : []; }
function nextDayOf(b) { let d = 1; while (b.days[d]) d++; return d; }
function doneDates(b) { const m = {}; for (const d in b.days) m[b.days[d].date] = +d; return m; }
function streakOf(b) { const dd = doneDates(b); let cur = dd[today()] ? today() : addDays(today(), -1), n = 0; while (dd[cur]) { n++; cur = addDays(cur, -1); } return n; }
function missedOf(b) { if (!b.startDate) return 0; const dd = doneDates(b), t = today(); let n = 0; for (let d = b.startDate; d < t; d = addDays(d, 1)) if (!dd[d]) n++; return n; }
function totalDays(id) { return Math.ceil(sentencesOf(id).length / PER); }
function lessonSentences(id, day) { return sentencesOf(id).slice((day - 1) * PER, day * PER); }

/* ---------- 단어 ---------- */
function wstate(key) { const w = S.words[key]; return w ? w.state : ''; }
function lookupMeaning(an, tok) {
  if (an && an.words) {
    const low = tok.toLowerCase().replace(/’/g, "'");
    for (const x of an.words) { if (x.w && (x.w.toLowerCase() === low || C.wordKey(x.w) === C.wordKey(tok))) return x; }
  }
  const s = S.words[C.wordKey(tok)];
  return s ? { m: s.meaning || '', p: '' } : null;
}
function setWord(key, display, state, meaning, sentence) {
  if (!state) { delete S.words[key]; return; }
  const w = S.words[key] || { w: display, added: today(), book: S.activeBook };
  w.state = state; if (meaning !== undefined) w.meaning = meaning; if (sentence) w.ex = sentence;
  if (state === 'learned') w.learned = today();
  S.words[key] = w;
}

/* ---------- 화면 상태 ---------- */
let tab = 'today', vocabSeg = 'unknown', vocabQ = '', logQ = '', calMonth = null, busy = {};
let LESSON = null; // {id, day, sents, readonly}

function setSub() {
  const b = curBook();
  $('#sub').textContent = b ? b.title + ' · ' + (b.days && Object.keys(b.days).length) + '일 완료' : '';
}

async function render() {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === tab));
  setSub();
  const v = $('#view');
  const b = curBook();
  if (!b) { v.innerHTML = '<div class="card">책을 불러오는 중…</div>'; return; }
  await ensureParsed(S.activeBook);
  if (tab === 'today') v.innerHTML = viewToday();
  else if (tab === 'log') v.innerHTML = viewLog();
  else if (tab === 'cal') v.innerHTML = viewCal();
  else if (tab === 'vocab') v.innerHTML = viewVocab();
  else v.innerHTML = viewSettings();
  if (tab === 'today') autoGenerate();
}

/* ---------- 문장 카드 ---------- */
function tokensHTML(sentence) {
  return C.tokenize(sentence).map(t => t.type === 'sep' ? esc(t.text)
    : `<span class="w ${wstate(t.key)}" data-act="word" data-k="${esc(t.key)}" data-t="${esc(t.text)}">${esc(t.text)}</span>`).join('');
}
function legendHTML() {
  return '<div class="legend">' + Object.keys(ROLE).map(k => `<span class="r-${k}" style="--c:var(--${k})">${ROLE[k].h} <small>(${ROLE[k].n})</small></span>`).join('') + '</div>';
}
function analysisHTML(an, withTitle) {
  if (!an) return '';
  let h = '';
  if (an.ko) h += `<div class="tr"><b>해석</b><br>${esc(an.ko)}</div>`;
  if (an.chunks && an.chunks.length) {
    h += '<details open><summary>🧩 문장 뜯어보기</summary><div class="chunks">' + an.chunks.map(c => {
      const r = ROLE[c.r] ? c.r : 'M';
      return `<div class="chunk r-${r}"><div class="ct">${esc(c.t)}</div><div class="ck">${esc(c.k || '')}</div><div class="cr">${esc(ROLE[r].h)}</div></div>`;
    }).join('') + '</div></details>';
  }
  if (an.note && an.note.length) h += '<div class="note"><b>💡 쉽게 알아보기</b><ul>' + an.note.map(n => `<li>${esc(n)}</li>`).join('') + '</ul></div>';
  return h;
}
function sentenceCard(s, i, checked, readonly, snap) {
  const an = snap || getAnalysis(s);
  const missing = !an;
  let h = `<section class="card" data-i="${i}">
    <div class="snum"><span>문장 ${i + 1}</span><button data-act="speak" data-i="${i}" aria-label="읽어주기">🔊</button></div>
    <p class="en">${tokensHTML(s)}</p>`;
  if (an) h += analysisHTML(an);
  else h += `<div class="banner warn" style="font-size:14px">이 문장의 분석이 아직 없어요. ${S.settings.apiKey ? (busy.gen ? '<span class="spin">⏳</span> 만드는 중…' : '<button class="btn sm" data-act="gen">분석 만들기</button>') : '설정에서 API 키를 넣거나, 클로드에게 분석 팩을 받아 불러오세요.'}</div>`;
  if (!readonly) {
    h += `<div class="row"><button class="btn sm ghost" data-act="allknown" data-i="${i}">표시 안 한 단어 모두 ‘알아요’</button></div>
    <label class="chk"><input type="checkbox" data-act="check" data-i="${i}" ${checked ? 'checked' : ''}> 이 문장 이해했어요</label>`;
  }
  return h + '</section>';
}

/* ---------- 오늘 탭 ---------- */
function viewToday() {
  const id = S.activeBook, b = curBook();
  const all = sentencesOf(id), nDays = totalDays(id);
  if (!b.startDate) { b.startDate = today(); save(); }
  const dd = doneDates(b), doneToday = dd[today()];
  const day = doneToday || nextDayOf(b);
  const finished = !doneToday && day > nDays;
  let h = '';
  const doneN = Object.keys(b.days).length;
  const pct = Math.min(100, Math.round(doneN * PER / Math.max(1, all.length) * 100));
  h += `<div class="stats"><div class="stat"><b>${streakOf(b)}일</b><span>연속 공부</span></div><div class="stat"><b>${doneN}/${nDays}</b><span>완료한 날</span></div><div class="stat"><b>${missedOf(b)}일</b><span>빠진 날</span></div></div>
  <div class="progress" style="margin-bottom:12px"><i style="width:${pct}%"></i></div>`;
  if (finished) {
    return h + `<div class="banner ok">🎉 이 책을 끝까지 읽었어요! 설정 탭에서 ‘해석 모음 파일’을 받을 수 있어요.</div>`;
  }
  const sents = lessonSentences(id, day);
  const last = b.days[day - 1];
  if (!doneToday && last && last.date < addDays(today(), -1)) {
    h += `<div class="banner warn">공부를 쉰 날이 있어요. 괜찮아요! 진도는 그대로 두었으니 <b>Day ${day}</b>부터 이어서 해요.</div>`;
  }
  if (doneToday) h += `<div class="banner ok">✅ 오늘 공부 완료! 내일 <b>Day ${day + 1}</b>에서 만나요. 아래는 오늘 공부한 내용이에요.</div>`;
  else if (!doneToday && !dd[addDays(today(), -1)] && b.startDate < today() && day > 1) { /* 위 배너로 충분 */ }
  h += `<div class="card"><div class="row"><div class="grow"><b>Day ${day}</b> · ${mdLabel(today())}<div class="muted">${esc(b.title)}</div></div></div>
    <details><summary>🎨 색깔 길잡이 보기</summary>${legendHTML()}<div class="muted">단어를 누르면 뜻이 나와요. 모르면 ‘몰라요’(빨강), 알면 ‘알아요’(초록)를 골라 주세요.</div></details></div>`;
  if (!b.draft || b.draft.day !== day) b.draft = { day, checks: new Array(PER).fill(false) };
  LESSON = { id, day, sents };
  const rec = doneToday ? S.records[id] && S.records[id][day] : null;
  sents.forEach((s, i) => {
    h += sentenceCard(s, i, doneToday ? true : b.draft.checks[i], !!doneToday, rec && rec.items[i] && rec.items[i].a);
  });
  if (!doneToday) {
    const left = b.draft.checks.slice(0, sents.length).filter(x => !x).length;
    h += `<div class="card"><button class="btn" style="width:100%" data-act="complete" ${left ? 'disabled' : ''}>${left ? `문장 ${left}개 더 확인하면 완료할 수 있어요` : '✅ 오늘 공부 완료'}</button>
    <div class="muted" style="margin-top:6px">완료해야 다음 진도가 열려요. 완료하면 오늘 내용이 기록 탭에 자동으로 저장돼요.</div></div>`;
  }
  return h;
}

/* ---------- 기록 / 달력 ---------- */
function recordsOf(id) { return Object.keys(S.records[id] || {}).map(Number).sort((a, b) => b - a).map(d => ({ day: d, ...S.records[id][d] })); }
function viewLog() {
  const id = S.activeBook, recs = recordsOf(id);
  let h = `<input type="search" id="logq" placeholder="기록에서 검색 (영어 문장·한글 해석·단어)" value="${esc(logQ)}">
  <div class="muted" style="margin:6px 2px 10px">공부를 완료하면 그날 내용이 자동으로 저장돼요. 눌러서 다시 볼 수 있어요.</div><div class="loglist">`;
  const q = logQ.trim().toLowerCase();
  let n = 0;
  for (const r of recs) {
    const hay = r.items.map(it => it.en + ' ' + ((it.a && it.a.ko) || '') + ' ' + (it.uw || []).map(u => u.w + ' ' + u.m).join(' ')).join(' ').toLowerCase();
    if (q && !hay.includes(q)) continue;
    n++;
    h += `<button class="item" data-act="openRecord" data-d="${r.day}"><b>Day ${r.day}</b> · ${mdLabel(r.date)}<div class="pv">${esc(r.items[0] ? r.items[0].en.slice(0, 70) : '')}…</div></button>`;
  }
  if (!n) h += `<div class="card muted">${recs.length ? '검색 결과가 없어요.' : '아직 기록이 없어요. 오늘 공부를 완료하면 여기에 쌓여요.'}</div>`;
  return h + '</div>';
}
function recordSheet(day) {
  const id = S.activeBook, r = S.records[id] && S.records[id][day];
  if (!r) return;
  let h = `<div class="bar"><b>Day ${day} · ${mdLabel(r.date)}</b><button class="btn sm ghost" data-act="closeOv">닫기</button></div>`;
  r.items.forEach((it, i) => {
    h += `<section class="card"><div class="snum"><span>문장 ${i + 1}</span></div><p class="en">${esc(it.en)}</p>${analysisHTML(it.a)}`;
    if (it.uw && it.uw.length) h += `<div class="note"><b>🔴 그날 모르던 단어</b><ul>${it.uw.map(u => `<li><b>${esc(u.w)}</b> ${esc(u.m || '')}</li>`).join('')}</ul></div>`;
    h += '</section>';
  });
  openOverlay(`<div class="sheet full">${h}</div>`);
}
function viewCal() {
  const id = S.activeBook, b = curBook();
  const dd = doneDates(b), t = today();
  if (!calMonth) calMonth = t.slice(0, 7);
  const [Y, M] = calMonth.split('-').map(Number);
  const first = new Date(Y, M - 1, 1), lastDay = new Date(Y, M, 0).getDate();
  let h = `<div class="stats"><div class="stat"><b>${streakOf(b)}일</b><span>연속 공부</span></div><div class="stat"><b>${Object.keys(b.days).length}일</b><span>공부 완료</span></div><div class="stat"><b>${missedOf(b)}일</b><span>빠진 날</span></div></div>
  <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><button class="btn sm ghost" data-act="month" data-n="-1">◀</button><b>${Y}년 ${M}월</b><button class="btn sm ghost" data-act="month" data-n="1">▶</button></div><div class="cal">`;
  h += '일월화수목금토'.split('').map(x => `<div class="h">${x}</div>`).join('');
  for (let i = 0; i < first.getDay(); i++) h += '<div class="cell none"></div>';
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${Y}-${pad(M)}-${pad(d)}`;
    let cls = '', mk = '', dl = '';
    if (dd[ds]) { cls = 'done'; mk = '✅'; dl = 'Day ' + dd[ds]; }
    else if (b.startDate && ds >= b.startDate && ds < t) { cls = 'miss'; mk = '❌'; }
    else if (ds === t) { mk = '🕘'; }
    if (ds === t) cls += ' today';
    h += `<div class="cell ${cls}" ${dd[ds] ? `data-act="openRecord" data-d="${dd[ds]}"` : ''}><div class="dn">${d}</div><div class="mk">${mk}</div><div class="dd">${dl}</div></div>`;
  }
  h += `</div><div class="muted" style="margin-top:8px">✅ 공부 완료 · ❌ 못 한 날 · 🕘 오늘 (✅ 칸을 누르면 그날 내용을 다시 볼 수 있어요)</div></div>`;
  const nDays = totalDays(id), cur = nextDayOf(b);
  h += `<div class="card"><h3>Day별 진도</h3><div class="daygrid">`;
  const show = Math.min(nDays, Math.max(60, cur + 20));
  for (let d = 1; d <= show; d++) {
    const done = b.days[d];
    h += `<div class="daybox ${done ? 'done' : d === cur ? 'cur' : ''}" ${done ? `data-act="openRecord" data-d="${d}"` : ''}>${done ? '✅' : d === cur ? '👉' : ''}<br>D${d}${done ? `<br><small>${done.date.slice(5).replace('-', '/')}</small>` : ''}</div>`;
  }
  return h + `</div><div class="muted" style="margin-top:6px">전체 ${nDays}일 중 ${Object.keys(b.days).length}일 완료</div></div>`;
}

/* ---------- 단어장 ---------- */
function viewVocab() {
  const arr = Object.keys(S.words).map(k => ({ k, ...S.words[k] }));
  const unk = arr.filter(x => x.state === 'unknown'), lrn = arr.filter(x => x.state === 'learned');
  const list = (vocabSeg === 'unknown' ? unk : lrn).filter(x => !vocabQ || (x.w + ' ' + (x.meaning || '')).toLowerCase().includes(vocabQ.toLowerCase()))
    .sort((a, b) => (b.added || '').localeCompare(a.added || '') || a.w.localeCompare(b.w));
  let h = `<div class="seg"><button data-act="vseg" data-s="unknown" class="${vocabSeg === 'unknown' ? 'on' : ''}">🔴 모르는 단어 ${unk.length}</button><button data-act="vseg" data-s="learned" class="${vocabSeg === 'learned' ? 'on' : ''}">🎓 졸업한 단어 ${lrn.length}</button></div>
  <input type="search" id="vq" placeholder="단어 검색" value="${esc(vocabQ)}" style="margin-bottom:10px">`;
  if (!list.length) h += `<div class="card muted">${vocabSeg === 'unknown' ? '모르는 단어로 표시한 단어가 여기에 모여요.' : '‘이제 확실히 알아요’를 누른 단어가 여기에 모여요.'}</div>`;
  for (const x of list) {
    h += `<div class="card vitem"><div class="grow"><div class="vw">${esc(x.w)}</div><div class="vm">${esc(x.meaning || '(뜻을 눌러서 적어 보세요)')}</div>${x.ex ? `<div class="ve">${esc(x.ex.length > 110 ? x.ex.slice(0, 110) + '…' : x.ex)}</div>` : ''}</div>
    <div style="display:flex;flex-direction:column;gap:6px">${vocabSeg === 'unknown'
      ? `<button class="btn sm" data-act="vlearn" data-k="${esc(x.k)}">이제 알아요 ✓</button>`
      : `<button class="btn sm ghost" data-act="vrelearn" data-k="${esc(x.k)}">다시 공부</button>`}<button class="btn sm ghost" data-act="vedit" data-k="${esc(x.k)}">뜻 수정</button></div></div>`;
  }
  return h;
}

/* ---------- 설정 ---------- */
function viewSettings() {
  const st = S.settings;
  let h = '<div class="card"><h3>📚 내 책</h3>';
  for (const id in S.books) {
    const b = S.books[id], p = PARSED[id];
    const n = p ? Math.ceil((p.sentences.length - (b.skip || 0)) / PER) : '?';
    h += `<div class="row" style="margin-bottom:8px"><div class="grow"><b>${esc(b.title)}</b>${id === S.activeBook ? ' ✔' : ''}<div class="muted">${Object.keys(b.days).length}일 완료 / 전체 ${n}일</div></div>
    ${id === S.activeBook ? '' : `<button class="btn sm" data-act="pickBook" data-id="${esc(id)}">이 책으로 공부</button>`}</div>`;
  }
  h += `<div class="row"><button class="btn sm ghost" data-act="skipSet">본문 시작 위치 바꾸기</button><label class="btn sm ghost" style="display:inline-block">+ txt 책 추가<input type="file" id="bookfile" accept=".txt,text/plain" hidden></label></div></div>
  <div class="card"><h3>⏰ 공부 알림</h3>
    <label class="row"><input type="checkbox" id="nOn" ${st.notifyOn ? 'checked' : ''} style="width:22px;height:22px"> 매일 알림 받기</label>
    <div class="row" style="margin:10px 0"><div class="grow">알림 시간</div><input type="time" id="nTime" value="${esc(st.notifyTime)}" style="width:140px"></div>
    <div class="row"><button class="btn sm" data-act="notifyAllow">알림 허용·적용</button><button class="btn sm ghost" data-act="notifyTest">테스트 알림</button></div>
    <div class="muted" style="margin-top:6px">${window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications ? '앱 알림이 정해진 시간에 울려요.' : '웹앱에서는 앱이 열려 있거나 최근에 사용했을 때 가장 잘 울려요. 정확한 시간에 꼭 울리려면 안드로이드 앱(APK)으로 만들어야 해요.'}</div></div>
  <div class="card"><h3>🧠 분석 채우기</h3>
    <div class="muted">앱에 들어있지 않은 문장은 아래 둘 중 하나로 분석을 채워요.</div><hr>
    <b>방법 1. 분석 팩 불러오기</b><div class="muted">클로드가 만들어 준 .json 파일을 불러와요. (API 키 필요 없음)</div>
    <label class="btn sm ghost" style="display:inline-block;margin-top:6px">분석 팩 파일 선택<input type="file" id="packfile" accept=".json,application/json" hidden></label>
    <div class="muted" style="margin-top:6px">현재 저장된 분석 ${Object.keys(PACK).length + Object.keys(A).length}문장</div><hr>
    <b>방법 2. 앱이 직접 분석하기</b><div class="muted">Claude API 키를 넣으면 그날 문장을 앱이 바로 분석해요. 키는 이 기기에만 저장돼요. 사용한 만큼 요금이 나가요.</div>
    <input type="password" id="apikey" placeholder="sk-ant-..." value="${esc(st.apiKey)}" style="margin:6px 0"><input type="text" id="model" value="${esc(st.model)}"></div>
  <div class="card"><h3>📄 해석 모음 파일</h3><div class="muted">지금까지 공부한 내용을 한 파일로 모아요. 책을 다 읽으면 책 전체 해석집이 돼요.</div>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="exportHtml">문서(.html)</button><button class="btn sm ghost" data-act="exportTxt">텍스트(.txt)</button></div></div>
  <div class="card"><h3>💾 백업</h3><div class="muted">기록·단어장·진도를 파일로 저장했다가 다른 기기에서 불러올 수 있어요.</div>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="backup">백업 저장</button><label class="btn sm ghost" style="display:inline-block">백업 불러오기<input type="file" id="restorefile" accept=".json" hidden></label></div></div>`;
  return h;
}

/* ---------- 오버레이 ---------- */
function openOverlay(html) { const o = $('#overlay'); o.innerHTML = html; o.hidden = false; }
function closeOverlay() { const o = $('#overlay'); o.hidden = true; o.innerHTML = ''; }
function wordSheet(key, tok) {
  const sIdx = openWord.si; const sent = LESSON && LESSON.sents[sIdx];
  const an = sent ? getAnalysis(sent) : null;
  const found = lookupMeaning(an, tok);
  const ex = S.words[key];
  const meaning = (ex && ex.meaning) || (found && found.m) || '';
  const pos = found && found.p ? ` <span class="muted">(${esc(found.p)})</span>` : '';
  openOverlay(`<div class="sheet"><div class="bar"><b style="font-size:22px;font-family:Georgia,serif">${esc(tok)}${pos}</b><button class="btn sm ghost" data-act="closeOv">닫기</button></div>
    <div class="muted">뜻 (직접 고칠 수 있어요)</div><input type="text" id="wm" value="${esc(meaning)}" placeholder="뜻을 적어 보세요">
    <div class="row" style="margin-top:12px"><button class="btn bad grow" data-act="wset" data-s="unknown">🔴 몰라요</button><button class="btn grow" style="background:var(--good)" data-act="wset" data-s="known">🟢 알아요</button></div>
    <div class="row" style="margin-top:8px"><button class="btn ghost grow" data-act="wset" data-s="">표시 지우기</button><button class="btn ghost" data-act="speakWord">🔊</button></div></div>`);
  openWord.key = key; openWord.tok = tok;
}
const openWord = { key: '', tok: '', si: 0 };

/* ---------- 분석 만들기 (API) ---------- */
async function generate(sents) {
  const st = S.settings;
  const sys = `당신은 영어를 처음 배우는 한국 초등학생에게 영어 문장을 설명하는 다정한 선생님입니다. 반드시 JSON 배열만 출력하세요(설명·코드블록 금지).`;
  const user = `아래 영어 문장 ${sents.length}개를 각각 분석해 주세요. 입력 순서와 같은 길이의 JSON 배열로 답하세요.
각 원소 형식: {"ko":"자연스러운 한국어 해석","chunks":[{"t":"원문 조각","r":"역할코드","k":"그 조각의 쉬운 우리말 뜻"}],"note":["초등학생도 알아듣는 쉬운 설명 1~3줄"],"words":[{"w":"단어(소문자 기본형 아님, 문장에 나온 대로)","m":"이 문장에서의 뜻","p":"품사(명사/동사/형용사/부사/전치사/접속사/대명사 등)"}]}
규칙:
- chunks를 순서대로 이어 붙이면 원문 전체가 되어야 합니다(빠뜨리거나 바꾸지 말 것).
- 역할코드: S=누가·무엇이(주어), V=한다·이다(동사), O=무엇을(목적어), C=어떤·무엇(보어), M=언제·어디서·어떻게(꾸밈말), L=이음말(and, but 등), Q=따옴표 속 말·생각.
- note는 어려운 문법 용어를 피하고 "~라는 뜻이에요"처럼 쉬운 말로, 비유나 예시를 써 주세요.
- words는 문장 속 모든 낱말(중복 제외, 아주 쉬운 a·the·of 같은 말은 제외 가능).
문장들:
${JSON.stringify(sents)}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': st.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: st.model || 'claude-sonnet-5-5', max_tokens: 8000, system: sys, messages: [{ role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error('API 오류 ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  let txt = (data.content || []).map(c => c.text || '').join('').trim();
  txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const arr = JSON.parse(txt);
  if (!Array.isArray(arr) || arr.length !== sents.length) throw new Error('분석 결과 개수가 맞지 않아요');
  return arr;
}
async function autoGenerate() {
  if (!LESSON || busy.gen || !S.settings.apiKey) return;
  const miss = LESSON.sents.filter(s => !getAnalysis(s));
  if (!miss.length) return;
  busy.gen = true; render();
  try {
    const out = await generate(miss);
    miss.forEach((s, i) => { A[C.hashSentence(s)] = Object.assign({ en: s }, out[i]); });
    saveAnalysis();
  } catch (e) { toast('분석 실패: ' + e.message); }
  busy.gen = false; render();
}

/* ---------- 내보내기 ---------- */
function exportData(fmt) {
  const id = S.activeBook, b = curBook();
  const days = Object.keys(b.days).map(Number).sort((a, c) => a - c);
  const total = totalDays(id), done = days.length >= total;
  const lines = [], html = [];
  const title = `${b.title} — 해석 모음`;
  lines.push(title, (done ? '[완독 완료] ' : '[진행 중] ') + days.length + '/' + total + '일', '');
  html.push(`<h1>${esc(title)}</h1><p>${done ? '🎉 완독 완료' : '진행 중'} · ${days.length}/${total}일</p>`);
  for (const d of days) {
    const r = S.records[id] && S.records[id][d];
    const items = r ? r.items : lessonSentences(id, d).map(en => ({ en, a: getAnalysis(en), uw: [] }));
    lines.push(`===== Day ${d} (${b.days[d].date}) =====`);
    html.push(`<h2>Day ${d} <small>${esc(b.days[d].date)}</small></h2>`);
    items.forEach((it, i) => {
      const a = it.a || {};
      lines.push(`[${d}-${i + 1}] ${it.en}`);
      html.push(`<div class="s"><p class="en"><b>${d}-${i + 1}</b> ${esc(it.en)}</p>`);
      if (a.ko) { lines.push('해석: ' + a.ko); html.push(`<p class="ko">해석: ${esc(a.ko)}</p>`); }
      if (a.chunks) {
        lines.push('구조: ' + a.chunks.map(c => `${c.t}(${(ROLE[c.r] || ROLE.M).h}${c.k ? ' · ' + c.k : ''})`).join(' / '));
        html.push('<p>' + a.chunks.map(c => `<span class="ch r${esc(c.r)}">${esc(c.t)}<small>${esc((ROLE[c.r] || ROLE.M).h)}${c.k ? ' · ' + esc(c.k) : ''}</small></span>`).join(' ') + '</p>');
      }
      if (a.note && a.note.length) { a.note.forEach(n => lines.push('설명: ' + n)); html.push('<ul>' + a.note.map(n => `<li>${esc(n)}</li>`).join('') + '</ul>'); }
      if (a.words && a.words.length) { lines.push('단어: ' + a.words.map(w => `${w.w}=${w.m}`).join(', ')); html.push('<p class="wd">단어: ' + a.words.map(w => `<b>${esc(w.w)}</b> ${esc(w.m)}`).join(' · ') + '</p>'); }
      if (it.uw && it.uw.length) { lines.push('모르던 단어: ' + it.uw.map(u => `${u.w}=${u.m || ''}`).join(', ')); html.push('<p class="uw">🔴 모르던 단어: ' + it.uw.map(u => `<b>${esc(u.w)}</b> ${esc(u.m || '')}`).join(' · ') + '</p>'); }
      lines.push(''); html.push('</div>');
    });
  }
  if (fmt === 'txt') return { name: `${b.title}_해석모음.txt`, mime: 'text/plain', data: lines.join('\n') };
  const css = 'body{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;max-width:800px;margin:20px auto;line-height:1.7}.s{border-bottom:1px solid #ddd;padding:8px 0}.en{font-family:Georgia,serif;font-size:18px}.ko{background:#eef4fb;padding:6px 10px;border-radius:6px}.ch{display:inline-block;border:1.5px solid #888;border-radius:6px;padding:1px 6px;margin:2px;font-family:Georgia,serif}.ch small{display:block;font-size:11px;color:#666;font-family:sans-serif}.rS{border-color:#2f6fd6}.rV{border-color:#d64545}.rO{border-color:#2f9e5f}.rC{border-color:#8a4fd6}.rM{border-color:#d98a1a}.rQ{border-color:#d6489a}.wd{color:#444}.uw{color:#b33}';
  return { name: `${b.title}_해석모음.html`, mime: 'text/html', data: `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${html.join('\n')}</body></html>` };
}
function isNative() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
async function download(name, mime, data) {
  if (isNative()) {
    const P = window.Capacitor.Plugins || {};
    if (P.Filesystem && P.Share) {
      try {
        const safe = name.replace(/[^\w가-힣.\-]+/g, '_');
        const r = await P.Filesystem.writeFile({ path: safe, data: data, directory: 'CACHE', encoding: 'utf8' });
        await P.Share.share({ title: safe, url: r.uri, dialogTitle: '파일 저장·공유' });
      } catch (e) { toast('저장하지 못했어요: ' + (e.message || e)); }
      return;
    }
  }
  const blob = new Blob([data], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------- 알림 ---------- */
async function syncMeta() {
  try {
    const b = curBook();
    await kvSet('meta', { on: S.settings.notifyOn, time: S.settings.notifyTime, doneDate: b ? (Object.values(b.days).map(x => x.date).includes(today()) ? today() : '') : '', last: S.lastNotified });
  } catch (e) {}
}
const LN = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
async function applyReminder() {
  const st = S.settings;
  const ln = LN();
  if (ln) {
    try {
      await ln.requestPermissions();
      try {
        if (ln.checkExactNotificationSetting) {
          const ex = await ln.checkExactNotificationSetting();
          if (ex && ex.exact_alarm !== 'granted' && ln.changeExactNotificationSetting) {
            toast('다음 화면에서 ‘알람 및 리마인더’를 허용해 주세요');
            await ln.changeExactNotificationSetting();
          }
        }
      } catch (e) { /* 구버전 안드로이드는 필요 없음 */ }
      await ln.cancel({ notifications: [{ id: 1 }] });
      if (st.notifyOn) {
        const [hh, mm] = st.notifyTime.split(':').map(Number);
        await ln.schedule({ notifications: [{ id: 1, title: '오늘의 5문장', body: '영어 원서 공부할 시간이에요 📖', schedule: { on: { hour: hh, minute: mm }, allowWhileIdle: true } }] });
      }
      toast('알림이 설정됐어요'); return;
    } catch (e) { toast('알림 설정 실패: ' + e.message); return; }
  }
  if (!('Notification' in window)) { toast('이 기기 브라우저는 알림을 지원하지 않아요'); return; }
  let p = Notification.permission;
  if (p === 'default') p = await Notification.requestPermission();
  if (p !== 'granted') { toast('알림이 허용되지 않았어요. 브라우저 설정에서 허용해 주세요'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.periodicSync) await reg.periodicSync.register('daily-check', { minInterval: 6 * 3600 * 1000 });
  } catch (e) {}
  toast('알림이 허용됐어요');
}
async function showNotice(body) {
  try {
    if (navigator.serviceWorker && (await navigator.serviceWorker.getRegistration())) {
      const reg = await navigator.serviceWorker.ready;
      return reg.showNotification('오늘의 5문장 📖', { body, icon: 'icon-192.png', tag: 'daily' });
    }
  } catch (e) {}
  new Notification('오늘의 5문장 📖', { body });
}
function checkReminder() {
  const st = S.settings, b = curBook();
  if (!b || !st.notifyOn || LN()) return;
  const now = new Date(), [hh, mm] = st.notifyTime.split(':').map(Number);
  const due = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
  const dd = doneDates(b);
  if (due && !dd[today()] && S.lastNotified !== today() && 'Notification' in window && Notification.permission === 'granted') {
    S.lastNotified = today(); save(); showNotice('Day ' + nextDayOf(b) + ' 공부할 시간이에요!');
  }
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, b = curBook();
  if (a === 'tab') { tab = el.dataset.t; closeOverlay(); render(); window.scrollTo(0, 0); }
  else if (a === 'word') { openWord.si = +el.closest('.card').dataset.i; wordSheet(el.dataset.k, el.dataset.t); }
  else if (a === 'wset') {
    const key = openWord.key, st = el.dataset.s, m = $('#wm').value.trim();
    const sent = LESSON && LESSON.sents[openWord.si];
    setWord(key, openWord.tok.toLowerCase(), st, st ? m : undefined, sent);
    save(); closeOverlay(); render();
  }
  else if (a === 'closeOv') closeOverlay();
  else if (a === 'speakWord') speak(openWord.tok);
  else if (a === 'speak') speak(LESSON.sents[+el.dataset.i]);
  else if (a === 'allknown') {
    const s = LESSON.sents[+el.dataset.i];
    C.tokenize(s).forEach(t => { if (t.type === 'word' && !wstate(t.key)) setWord(t.key, t.text.toLowerCase(), 'known'); });
    save(); render();
  }
  else if (a === 'gen') autoGenerate();
  else if (a === 'complete') completeToday();
  else if (a === 'openRecord') recordSheet(+el.dataset.d);
  else if (a === 'month') { const [Y, M] = calMonth.split('-').map(Number); const d = new Date(Y, M - 1 + (+el.dataset.n), 1); calMonth = d.getFullYear() + '-' + pad(d.getMonth() + 1); render(); }
  else if (a === 'vseg') { vocabSeg = el.dataset.s; render(); }
  else if (a === 'vlearn') { const w = S.words[el.dataset.k]; w.state = 'learned'; w.learned = today(); save(); render(); toast('졸업! 🎓'); }
  else if (a === 'vrelearn') { S.words[el.dataset.k].state = 'unknown'; save(); render(); }
  else if (a === 'vedit') { const w = S.words[el.dataset.k]; const m = prompt(w.w + ' 의 뜻', w.meaning || ''); if (m !== null) { w.meaning = m.trim(); save(); render(); } }
  else if (a === 'pickBook') { S.activeBook = el.dataset.id; await ensureParsed(S.activeBook); save(); tab = 'today'; render(); }
  else if (a === 'skipSet') skipDialog();
  else if (a === 'skipOk') { const n = Math.max(0, +$('#skipn').value || 0); b.skip = n; b.days = {}; b.draft = null; S.records[S.activeBook] = {}; b.startDate = null; save(); closeOverlay(); render(); toast('시작 위치를 바꿨어요'); }
  else if (a === 'notifyAllow') { readSettings(); save(); applyReminder(); }
  else if (a === 'notifyTest') { readSettings(); if ('Notification' in window && Notification.permission === 'granted') showNotice('이렇게 알림이 와요!'); else toast('먼저 ‘알림 허용·적용’을 눌러 주세요'); }
  else if (a === 'exportHtml' || a === 'exportTxt') { const f = exportData(a === 'exportHtml' ? 'html' : 'txt'); download(f.name, f.mime, f.data); }
  else if (a === 'backup') { download('영어공부_백업_' + today() + '.json', 'application/json', JSON.stringify({ S, A })); }
});
document.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.id === 'check' || (t.dataset && t.dataset.act === 'check')) {
    const b = curBook(); b.draft.checks[+t.dataset.i] = t.checked; save(); render();
  } else if (t.id === 'bookfile' && t.files[0]) addBook(t.files[0]);
  else if (t.id === 'packfile' && t.files[0]) importPack(t.files[0]);
  else if (t.id === 'restorefile' && t.files[0]) restore(t.files[0]);
  else if (['nOn', 'nTime', 'apikey', 'model'].includes(t.id)) { readSettings(); save(); if (t.id === 'nOn' || t.id === 'nTime') applyReminder(); }
});
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'vq') { vocabQ = t.value; const pos = t.selectionStart; render().then(() => { const n = $('#vq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); }
  if (t.id === 'logq') { logQ = t.value; const pos = t.selectionStart; render().then(() => { const n = $('#logq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); }
});
function readSettings() {
  const st = S.settings;
  if ($('#nOn')) st.notifyOn = $('#nOn').checked;
  if ($('#nTime') && $('#nTime').value) st.notifyTime = $('#nTime').value;
  if ($('#apikey')) st.apiKey = $('#apikey').value.trim();
  if ($('#model') && $('#model').value.trim()) st.model = $('#model').value.trim();
}
function speak(text) {
  try { const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.85; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { toast('이 기기는 읽어주기를 지원하지 않아요'); }
}

/* ---------- 완료 ---------- */
function completeToday() {
  const id = S.activeBook, b = curBook();
  if (!LESSON || !b.draft || b.draft.checks.slice(0, LESSON.sents.length).some(x => !x)) return;
  const day = LESSON.day;
  const items = LESSON.sents.map(s => {
    C.tokenize(s).forEach(t => { if (t.type === 'word' && !wstate(t.key)) setWord(t.key, t.text.toLowerCase(), 'known'); });
    const an = getAnalysis(s);
    const seen = {}, uw = [];
    C.tokenize(s).forEach(t => {
      if (t.type === 'word' && wstate(t.key) === 'unknown' && !seen[t.key]) {
        seen[t.key] = 1;
        const lm = lookupMeaning(an, t.text);
        uw.push({ w: t.text.toLowerCase(), m: (S.words[t.key] && S.words[t.key].meaning) || (lm && lm.m) || '' });
      }
    });
    return { en: s, a: an ? JSON.parse(JSON.stringify(an)) : null, uw };
  });
  b.days[day] = { date: today(), at: new Date().toISOString() };
  S.records[id] = S.records[id] || {};
  S.records[id][day] = { date: today(), items };
  b.draft = null;
  // 모르는 단어에 뜻 채우기
  items.forEach(it => it.uw.forEach(u => { const k = C.wordKey(u.w); if (S.words[k] && !S.words[k].meaning && u.m) S.words[k].meaning = u.m; }));
  save();
  toast('오늘 공부 완료! 기록에 저장했어요 🎉');
  render(); window.scrollTo(0, 0);
}

/* ---------- 책/팩/백업 ---------- */
function skipDialog() {
  const b = curBook(), p = PARSED[S.activeBook];
  const locked = Object.keys(b.days).length > 0;
  openOverlay(`<div class="sheet"><div class="bar"><b>본문 시작 위치</b><button class="btn sm ghost" data-act="closeOv">닫기</button></div>
    <div class="muted">책 소개나 목차가 본문으로 섞였다면, 처음 몇 문장을 건너뛸지 정해 주세요.${locked ? '<br><b style="color:var(--bad)">이미 공부한 기록이 있으면 바꿀 때 진도와 기록이 모두 지워져요.</b>' : ''}</div>
    <input type="number" id="skipn" min="0" value="${b.skip || 0}" style="margin:10px 0">
    <div class="card" id="skipprev" style="font-family:Georgia,serif"></div>
    <button class="btn" style="width:100%" data-act="skipOk">적용</button></div>`);
  const upd = () => { const n = Math.max(0, +$('#skipn').value || 0); $('#skipprev').innerHTML = '<div class="muted">공부는 이 문장부터 시작해요</div>' + p.sentences.slice(n, n + 3).map(esc).join('<br><br>'); };
  $('#skipn').addEventListener('input', upd); upd();
}
async function addBook(file) {
  const text = await file.text();
  const parsed = C.parseBook(text);
  if (parsed.sentences.length < 10) { toast('문장을 찾지 못했어요. 영어 txt 파일인지 확인해 주세요'); return; }
  const id = 'u' + Date.now().toString(36);
  await kvSet('book:' + id, text);
  PARSED[id] = parsed;
  S.books[id] = { title: parsed.meta.title || file.name.replace(/\.txt$/i, ''), author: parsed.meta.author || '', skip: 0, startDate: null, days: {}, draft: null };
  S.activeBook = id; save(); tab = 'today'; render();
  toast('책을 추가했어요. 시작 문장이 맞는지 오늘 탭에서 확인해 보세요');
}
async function importPack(file) {
  try {
    const j = JSON.parse(await file.text());
    const items = j.items || {};
    let n = 0;
    for (const k in items) { A[k] = items[k]; n++; }
    saveAnalysis(); toast(n + '문장의 분석을 불러왔어요'); render();
  } catch (e) { toast('팩 파일을 읽지 못했어요: ' + e.message); }
}
async function restore(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!j.S || !j.S.v) throw new Error('백업 파일이 아니에요');
    S = Object.assign(defaultState(), j.S); A = j.A || {};
    save(); saveAnalysis();
    for (const id in S.books) await ensureParsed(id);
    toast('백업을 불러왔어요'); render();
  } catch (e) { toast('불러오기 실패: ' + e.message); }
}

/* ---------- 시작 ---------- */
async function init() {
  const saved = await kvGet('analysis'); if (saved) A = saved;
  (window.BUNDLED_PACKS || []).forEach(p => Object.assign(PACK, p.items));
  const bb = window.BUNDLED_BOOKS || {};
  for (const id in bb) if (!S.books[id]) S.books[id] = { title: bb[id].title, author: bb[id].author, skip: 0, startDate: null, days: {}, draft: null };
  if (!S.activeBook || !S.books[S.activeBook]) S.activeBook = Object.keys(S.books)[0] || null;
  for (const id in S.books) { try { await ensureParsed(id); } catch (e) {} }
  save();
  if (!isNative() && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  await render();
  checkReminder();
  setInterval(checkReminder, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminder(); render(); } });
}
window.__estudy = { get S() { return S; }, C, render, completeToday };
init();
})();
