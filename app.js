import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ACCOUNTS } from "./firebase-config.js";

const CLASSES = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => '2-' + n);
const MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const FIELDS = ['결석', '조퇴', '결과', '지각'];
const nowM = new Date().getMonth() + 1;
const CUR = nowM < 3 ? 12 : nowM; // 1~2월은 학년 말(12월까지 누적)로 본다
const LIMIT = 6; // 환산 결석 6회 이상(5회 초과)이면 대상

const S = {
  tab: 'input', cls: '2-1', month: CUR, flagMonth: CUR, flagCls: 'all', onlyDanger: false, stMonth: CUR,
  roster: {}, records: {}, locks: {}, ready: false, user: null, isAdmin: false,
  editor: '', draft: {}, base: {}, draftKey: null, baseSavedAt: null, rosterSig: '', pending: null, busy: false,
  unsubs: [], importData: null
};
try { S.editor = localStorage.getItem('att-editor') || '' } catch (e) { }
try { const c = localStorage.getItem('att-class'); if (CLASSES.includes(c)) S.cls = c } catch (e) { }

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const conv = (a, e, m, l) => a + Math.floor((e + m + l) / 2);
const convArr = r => conv(r[0], r[1], r[2], r[3]);
const sum = r => r[0] + r[1] + r[2] + r[3];
// 대상: 환산 6회 이상 / 주의: 미인정 1건 이상 / 정상: 기록 없음
const statOf = t => convArr(t) >= LIMIT ? '대상' : sum(t) > 0 ? '주의' : '정상';
const pillCls = { '정상': 'p-ok', '주의': 'p-warn', '대상': 'p-danger' };
const txtCls = s => s === '대상' ? 't-danger' : s === '주의' ? 't-warn' : '';
const key = (c, m) => c + '_' + m;
// m을 주면 그 달까지 재적했던 전출·자퇴생도 포함, 없으면 재학생만
const students = (c, m) => ((S.roster[c] && S.roster[c].students) || [])
  .filter(s => !s.status || s.status === '재학' || (m && s.leftMonth && m <= s.leftMonth))
  .slice().sort((a, b) => a.no - b.no);
const recRow = (c, m, no) => { const r = S.records[key(c, m)]; return r && r.rows && r.rows[no] ? r.rows[no] : null };
const locked = m => !!(S.locks[m] && S.locks[m].locked);
function totals(c, no, upto, ov) {
  const t = [0, 0, 0, 0];
  for (let m = 3; m <= upto; m++) {
    const row = ov && ov.month === m ? ov.row : recRow(c, m, no);
    if (row) for (let i = 0; i < 4; i++) t[i] += (+row[i] || 0);
  }
  return t;
}
function fmt(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}` }
function fmtDay(iso) { const d = new Date(iso); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}` }
let toastT; function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600) }
function errMsg(e) {
  const c = e && e.code;
  if (c === 'permission-denied') return '저장 권한이 없어요. 마감된 달이거나 로그인이 풀렸어요.';
  if (c === 'resource-exhausted') return '요청이 너무 많아요. 잠시 후 다시 저장해 주세요.';
  if (c === 'unavailable') return '인터넷 연결을 확인해 주세요. 연결되면 자동으로 저장돼요.';
  return '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000);
}
const csvCell = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` };

/* ---------- Firebase ---------- */
const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
let auth = null, db = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

/* ---------- 로그인 ---------- */
$('gateSub').textContent = '공용 비밀번호를 입력하세요.';
$('gateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('gatePw').value;
  if (!pw) { $('gateErr').textContent = '비밀번호를 입력해 주세요.'; return }
  $('gateBtn').disabled = true; $('gateErr').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, ACCOUNTS.admin, pw);
    $('gatePw').value = '';
  } catch (err) {
    const c = err && err.code;
    $('gateErr').textContent =
      c === 'auth/too-many-requests' ? '시도가 너무 많아요. 잠시 후 다시 해 주세요.' :
        c === 'auth/network-request-failed' ? '인터넷 연결을 확인해 주세요.' :
          '비밀번호가 맞지 않아요.';
  } finally { $('gateBtn').disabled = false }
});
$('logoutBtn').addEventListener('click', () => {
  if (dirtyCount() > 0 && !$('logoutBtn').dataset.confirm) {
    $('logoutBtn').dataset.confirm = '1'; $('logoutBtn').textContent = '저장 안 하고 로그아웃';
    setTimeout(() => { delete $('logoutBtn').dataset.confirm; $('logoutBtn').textContent = '로그아웃' }, 4000);
    return;
  }
  signOut(auth);
});

function stopData() { S.unsubs.forEach(u => u()); S.unsubs = []; S.ready = false; S.roster = {}; S.records = {}; S.locks = {}; S.draftKey = null }
function startData() {
  const got = { roster: false, records: false, locks: false };
  const done = () => { if (got.roster && got.records && got.locks && !S.ready) { S.ready = true; S.draftKey = null } render() };
  const fail = e => {
    $('connNote').hidden = false;
    $('connNote').textContent = e && e.code === 'permission-denied'
      ? '데이터를 읽을 권한이 없어요. 로그아웃 후 다시 로그인해 주세요. 계속되면 학년부장에게 알려 주세요.'
      : '서버 연결이 끊겼어요. 페이지를 새로 고침해 주세요.';
  };
  const watch = (name, flag) => S.unsubs.push(onSnapshot(collection(db, name), snap => {
    const o = {}; snap.docs.forEach(d => o[d.id] = d.data()); S[name] = o; got[flag] = true; done();
  }, fail));
  watch('roster', 'roster'); watch('records', 'records'); watch('locks', 'locks');
}

if (!configured) {
  $('gate').hidden = false;
  $('gateForm').hidden = true;
  $('gateSub').textContent = '아직 Firebase 설정이 비어 있어요. firebase-config.js에 프로젝트 값을 넣어 주세요.';
} else {
  onAuthStateChanged(auth, user => {
    stopData();
    S.user = user;
    S.isAdmin = !!(user && user.email === ACCOUNTS.admin);
    $('gate').hidden = !!user;
    $('app').hidden = !user;
    if (user) {
      $('roleBadge').textContent = '관리자';
      startData();
      setTab(S.tab);
    } else {
      $('gateSub').textContent = '공용 비밀번호를 입력하세요.';
      $('gatePw').value = '';
    }
  });
}

/* ---------- 탭 ---------- */
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'));
  document.body.classList.toggle('on-input', t === 'input');
  $('v-input').hidden = t !== 'input'; $('v-flag').hidden = t !== 'flag'; $('v-status').hidden = t !== 'status';
  render(); window.scrollTo(0, 0);
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

/* ---------- 입력자 ---------- */
function showEditor() { const b = $('editorName'); b.textContent = S.editor || '이름 입력'; b.classList.toggle('empty', !S.editor) }
function openName(msg) { $('namePanel').hidden = false; $('nameInput').value = S.editor; $('nameMsg').textContent = msg || ''; $('nameInput').focus() }
$('editorBtn').addEventListener('click', () => { $('namePanel').hidden ? openName('') : ($('namePanel').hidden = true) });
function commitName() {
  const v = $('nameInput').value.trim();
  if (!v) { $('nameMsg').textContent = '이름을 적어 주세요.'; return }
  S.editor = v; try { localStorage.setItem('att-editor', v) } catch (e) { }
  showEditor(); $('namePanel').hidden = true; toast('입력자를 ' + v + '(으)로 정했어요');
}
$('nameOk').addEventListener('click', commitName);
$('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') commitName() });

/* ---------- 칩 ---------- */
function chips(el, items, sel, extra) {
  el.innerHTML = items.map(([v, l]) => {
    const x = extra ? extra(v) : '';
    return `<button type="button" class="chip ${x}" data-v="${esc(v)}" aria-pressed="${String(v) === String(sel)}">${esc(l)}</button>`;
  }).join('');
}
function onChip(el, fn) { el.addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) fn(b.dataset.v) }) }

/* ---------- 월별 입력 ---------- */
function resetDraft() {
  const k = key(S.cls, S.month), r = S.records[k]; S.base = {}; S.draft = {};
  for (const s of students(S.cls, S.month)) {
    const row = r && r.rows && r.rows[s.no];
    S.base[s.no] = row ? row.map(n => +n || 0) : [0, 0, 0, 0];
    S.draft[s.no] = S.base[s.no].slice();
  }
  S.draftKey = k; S.baseSavedAt = r ? r.savedAt : null; $('remoteNote').hidden = true;
}
const same = (a, b) => a && b && a.every((v, i) => v === b[i]);
function dirtyCount() { let n = 0; for (const no in S.draft) if (!same(S.draft[no], S.base[no])) n++; return n }
function inputsLocked() { return (locked(S.month) && !S.isAdmin) || !S.ready || !S.user }

function buildRows() {
  const list = students(S.cls, S.month), dis = inputsLocked() ? 'disabled' : '';
  S.rosterSig = S.cls + '|' + list.map(s => s.no + s.name).join(',');
  if (!S.ready) { $('rows').innerHTML = '<div class="empty">명렬을 불러오는 중입니다…</div>'; return }
  if (!list.length) { $('rows').innerHTML = `<div class="empty">${esc(S.cls)} 명렬이 아직 없어요.${S.isAdmin ? ' 입력 현황판 아래 관리자 도구에서 명렬을 가져오세요.' : ''}</div>`; return }
  $('rows').innerHTML = list.map(s => {
    const d = S.draft[s.no] || [0, 0, 0, 0];
    return `<div class="stu" data-no="${s.no}"><div class="who"><span class="no">${s.no}</span><span class="nm">${esc(s.name)}</span>${s.status && s.status !== '재학' ? `<span class="tag">${fmtDay(s.leftDate)} ${esc(s.status)}</span>` : ''}</div>` +
      FIELDS.map((f, i) => `<div class="fld f${i}"><span class="flabel">미인정 ${f}</span><div class="stp"><button type="button" data-i="${i}" data-d="-1" aria-label="${esc(s.name)} ${f} 1 빼기" ${dis}>−</button><input id="in-${s.no}-${i}" data-i="${i}" inputmode="numeric" maxlength="2" value="${d[i]}" aria-label="${esc(s.name)} 미인정 ${f}" ${dis}><button type="button" data-i="${i}" data-d="1" aria-label="${esc(s.name)} ${f} 1 더하기" ${dis}>+</button></div></div>`).join('') +
      `<div class="mc"><span class="mlabel">이번 달 환산</span><b></b></div><div class="cum"><span class="mlabel">3월~ 누적</span><b></b></div><div class="st"><span class="pill"></span></div></div>`;
  }).join('');
  list.forEach(s => updateRow(s.no));
}
function updateRow(no) {
  const el = $('rows').querySelector(`.stu[data-no="${no}"]`); if (!el) return;
  const d = S.draft[no], b = S.base[no];
  const m = convArr(d), t = totals(S.cls, no, S.month, { month: S.month, row: d }), cum = convArr(t), s = statOf(t);
  const mb = el.querySelector('.mc b'); mb.textContent = m; mb.className = m ? '' : 'zero';
  const cb = el.querySelector('.cum b'); cb.textContent = cum; cb.className = txtCls(s);
  const p = el.querySelector('.pill'); p.textContent = s; p.className = 'pill ' + pillCls[s];
  el.classList.toggle('s-danger', s === '대상');
  el.querySelectorAll('.stp').forEach((st, i) => {
    st.classList.toggle('changed', d[i] !== b[i]);
    const inp = st.querySelector('input'); inp.classList.toggle('nz', d[i] > 0);
    if (document.activeElement !== inp) inp.value = d[i];
  });
}
function updateAllRows() { for (const no in S.draft) updateRow(no) }
function updateSaveBar() {
  const r = S.records[key(S.cls, S.month)], n = dirtyCount(), lk = inputsLocked();
  $('lastSaved').textContent = r ? `최종 저장 ${fmt(r.savedAt)} · ${r.savedBy || '이름 없음'}` : '이 학급·월은 아직 저장하지 않았어요';
  $('dirtyNote').textContent = n ? `저장하지 않은 변경 ${n}명` : '';
  $('btnSave').disabled = lk || S.busy || (!n && !!r); $('btnRevert').disabled = lk || S.busy || !n; $('btnZero').disabled = lk || S.busy;
}
function renderInput() {
  const list = students(S.cls, S.month);
  $('inTitle').textContent = `${S.cls} · ${S.month}월 미인정 출결`;
  const teacher = S.roster[S.cls] && S.roster[S.cls].teacher;
  $('inCount').textContent = [teacher ? '담임 ' + teacher : '', list.length ? list.length + '명' : ''].filter(Boolean).join(' · ');
  chips($('clsChips'), CLASSES.map(c => [c, c]), S.cls);
  chips($('monChips'), MONTHS.map(m => [m, m + '월']), S.month, m => (S.records[key(S.cls, m)] ? 'has ' : '') + (locked(+m) ? 'lock' : ''));
  const lk = locked(S.month); $('lockNote').hidden = !lk;
  if (lk) $('lockNote').innerHTML = S.isAdmin
    ? `<b>${S.month}월은 마감된 달이에요.</b> 학년부장 계정이라 수정할 수 있어요.`
    : `<b>${S.month}월은 마감되었어요.</b> 고쳐야 하면 학년부장에게 마감 해제를 요청하세요.`;
  const k = key(S.cls, S.month), rec = S.records[k];
  const sig = S.cls + '|' + list.map(s => s.no + s.name).join(',');
  if (S.draftKey !== k) { resetDraft(); buildRows() }
  else if (dirtyCount() === 0) {
    if ((rec ? rec.savedAt : null) !== S.baseSavedAt || sig !== S.rosterSig) { resetDraft(); buildRows() } else updateAllRows();
  } else {
    if ((rec ? rec.savedAt : null) !== S.baseSavedAt) $('remoteNote').hidden = false;
    for (const s of list) if (!S.draft[s.no]) { S.base[s.no] = [0, 0, 0, 0]; S.draft[s.no] = [0, 0, 0, 0] }
    if (sig !== S.rosterSig) buildRows(); else updateAllRows();
  }
  if (!S.ready) buildRows();
  updateSaveBar();
}

$('rows').addEventListener('click', e => {
  const b = e.target.closest('button[data-d]'); if (!b || b.disabled) return;
  const no = b.closest('.stu').dataset.no, i = +b.dataset.i, d = S.draft[no];
  d[i] = Math.max(0, Math.min(99, d[i] + (+b.dataset.d))); updateRow(no); updateSaveBar();
});
$('rows').addEventListener('input', e => {
  const inp = e.target.closest('input[data-i]'); if (!inp) return;
  const no = inp.closest('.stu').dataset.no, i = +inp.dataset.i;
  const clean = inp.value.replace(/\D/g, '').slice(0, 2); if (clean !== inp.value) inp.value = clean;
  S.draft[no][i] = clean === '' ? 0 : +clean; updateRow(no); updateSaveBar();
});
$('rows').addEventListener('focusout', e => { const inp = e.target.closest('input[data-i]'); if (inp && inp.value === '') inp.value = '0' });
$('rows').addEventListener('focusin', e => { const inp = e.target.closest('input[data-i]'); if (inp) inp.select() });

async function save(zero) {
  if (inputsLocked() || S.busy) return false;
  if (!S.editor) { openName('저장하려면 입력자 이름을 먼저 적어 주세요.'); window.scrollTo(0, 0); return false }
  if (zero) { for (const no in S.draft) S.draft[no] = [0, 0, 0, 0]; updateAllRows() }
  const rows = {}; for (const s of students(S.cls, S.month)) rows[s.no] = S.draft[s.no].slice();
  const k = key(S.cls, S.month), body = { cls: S.cls, month: S.month, rows, savedBy: S.editor, savedAt: new Date().toISOString() };
  S.busy = true; updateSaveBar();
  try {
    await setDoc(doc(db, 'records', k), body);
    S.records[k] = body; resetDraft(); updateAllRows(); renderInput();
    toast(`${S.cls} ${S.month}월을 저장했어요`); return true;
  } catch (e) { toast(errMsg(e)); return false }
  finally { S.busy = false; updateSaveBar() }
}
$('btnSave').addEventListener('click', () => save(false));
$('btnZero').addEventListener('click', () => save(true));
$('btnRevert').addEventListener('click', () => { for (const no in S.draft) S.draft[no] = S.base[no].slice(); updateAllRows(); updateSaveBar() });

function guard(fn) { if (dirtyCount() > 0) { S.pending = fn; $('leaveAsk').hidden = false; $('leaveSave').focus(); return } fn() }
function runPending() { const fn = S.pending; S.pending = null; $('leaveAsk').hidden = true; if (fn) fn() }
$('leaveSave').addEventListener('click', async () => { if (await save(false)) runPending() });
$('leaveDiscard').addEventListener('click', () => { S.draftKey = null; runPending() });
$('leaveCancel').addEventListener('click', () => { S.pending = null; $('leaveAsk').hidden = true });
onChip($('clsChips'), v => { if (v === S.cls) return; guard(() => { S.cls = v; try { localStorage.setItem('att-class', v) } catch (e) { } renderInput() }) });
onChip($('monChips'), v => { if (+v === S.month) return; guard(() => { S.month = +v; renderInput() }) });
window.addEventListener('beforeunload', e => { if (dirtyCount() > 0) { e.preventDefault(); e.returnValue = '' } });

/* ---------- 누적 대상자 ---------- */
function allStats(upto) {
  const out = [];
  for (const c of CLASSES) for (const s of students(c)) {
    const t = totals(c, s.no, upto), cv = convArr(t);
    const tr = []; for (let m = 3; m <= upto; m++) { const r = recRow(c, m, s.no); tr.push(r ? convArr(r.map(n => +n || 0)) : 0) }
    out.push({ cls: c, no: s.no, name: s.name, t, conv: cv, st: statOf(t), trend: tr });
  }
  return out;
}
function renderFlag() {
  const m = S.flagMonth; $('flagTitle').textContent = `누적 대상자 · 3월 ~ ${m}월`;
  chips($('flagMonChips'), MONTHS.map(x => [x, x + '월']), m);
  chips($('flagClsChips'), [['all', '전체'], ...CLASSES.map(c => [c, c])], S.flagCls);
  $('onlyDanger').checked = S.onlyDanger;
  const all = allStats(m).filter(x => S.flagCls === 'all' || x.cls === S.flagCls);
  const nD = all.filter(x => x.st === '대상').length, nW = all.filter(x => x.st === '주의').length;
  const done = CLASSES.filter(c => S.records[key(c, m)]), miss = CLASSES.filter(c => !S.records[key(c, m)]);
  $('kpis').innerHTML = `<div class="card kpi"><span class="l">대상</span><span class="v t-danger">${nD}<small>명</small></span><span class="n">환산 결석 6회 이상</span></div>` +
    `<div class="card kpi"><span class="l">주의</span><span class="v t-warn">${nW}<small>명</small></span><span class="n">미인정 기록 1건 이상</span></div>` +
    `<div class="card kpi"><span class="l">${m}월 입력</span><span class="v" style="color:var(--accent)">${done.length}<small>/ 9</small></span><span class="n">${miss.length ? esc(miss.join(', ')) + ' 미입력' : '모든 학급 입력 완료'}</span></div>`;
  const rows = all.filter(x => x.st === '대상' || (!S.onlyDanger && x.st === '주의'))
    .sort((a, b) => b.conv - a.conv || sum(b.t) - sum(a.t) || a.cls.localeCompare(b.cls) || a.no - b.no);
  S.flagRowsData = rows;
  if (!S.ready) { $('flagRows').innerHTML = '<div class="empty">불러오는 중입니다…</div>'; return }
  if (!rows.length) { $('flagRows').innerHTML = `<div class="empty">3월~${m}월 기준 ${S.onlyDanger ? '대상' : '미인정 기록이 있는'} 학생이 없어요.</div>`; return }
  $('flagRows').innerHTML = rows.map(x => `<div class="frow"><div class="fwho"><span class="c">${esc(x.cls)} · ${x.no}번</span><span class="nm">${esc(x.name)}</span></div>` +
    `<div class="cnts">${FIELDS.map((f, i) => `<span class="c ${x.t[i] ? '' : 'zero'}"><span class="cl">${f} </span>${x.t[i]}</span>`).join('')}</div>` +
    `<div class="fconv ${txtCls(x.st)}">${x.conv}<small>환산 결석</small></div><div class="fst"><span class="pill ${pillCls[x.st]}">${x.st}</span>${x.st === '주의' ? `<span class="left">대상까지 ${LIMIT - x.conv}회</span>` : ''}</div>` +
    `<div class="ftrend"><div class="trend" aria-label="월별 환산 결석">${x.trend.map((v, i) => `<span class="tcol"><i class="${v ? '' : 'z'}" style="height:${v ? Math.min(v * 9, 34) : 3}px"></i>${i + 3}</span>`).join('')}</div></div></div>`).join('');
}
onChip($('flagMonChips'), v => { S.flagMonth = +v; renderFlag() });
onChip($('flagClsChips'), v => { S.flagCls = v; renderFlag() });
$('onlyDanger').addEventListener('change', e => { S.onlyDanger = e.target.checked; renderFlag() });
$('btnCsv').addEventListener('click', () => {
  const m = S.flagMonth, rows = S.flagRowsData || [];
  const head = ['학급', '번호', '이름', '미인정 결석', '미인정 조퇴', '미인정 결과', '미인정 지각', '환산 결석', '상태', ...MONTHS.filter(x => x <= m).map(x => x + '월 환산')];
  download(`2학년_미인정출결_누적대상자_3-${m}월_${today()}.csv`, csv([head, ...rows.map(x => [x.cls, x.no, x.name, ...x.t, x.conv, x.st, ...x.trend])]), 'text/csv;charset=utf-8');
});

/* ---------- 입력 현황판 ---------- */
function cellState(c, m) {
  const r = S.records[key(c, m)];
  if (r) return locked(m) ? ['b-lock', '마감 ' + fmtDay(r.savedAt)] : ['b-done', '완료 ' + fmtDay(r.savedAt)];
  if (m > CUR) return ['b-future', '예정'];
  return ['b-miss', '미입력'];
}
function classCounts(c, upto) { let d = 0, w = 0; for (const s of students(c)) { const st = statOf(totals(c, s.no, upto)); if (st === '대상') d++; else if (st === '주의') w++ } return [d, w] }
function renderStatus() {
  const m = S.stMonth; chips($('stMonChips'), MONTHS.map(x => [x, x + '월']), m, x => locked(+x) ? 'lock' : '');
  const done = CLASSES.filter(c => S.records[key(c, m)]), miss = CLASSES.filter(c => !S.records[key(c, m)]);
  $('prog').innerHTML = `<div class="r"><b>${m}월 입력</b><span class="big">${done.length}</span><span class="muted">/ 9 학급</span></div><div class="track"><i style="width:${done.length / 9 * 100}%"></i></div>` +
    `<span class="miss ${miss.length ? '' : 'none'}">${miss.length ? '미입력 ' + esc(miss.join(', ')) : '모든 학급이 입력했어요'}${locked(m) ? ' · 마감됨' : ''}</span>`;
  let h = `<thead><tr><th>학급</th>${MONTHS.map(x => `<th class="${x === m ? 'cur' : ''}">${x}월</th>`).join('')}<th>대상 / 주의</th></tr></thead><tbody>`;
  for (const c of CLASSES) {
    const [d, w] = classCounts(c, m);
    h += `<tr><td>${c}</td>${MONTHS.map(x => { const [k, l] = cellState(c, x); return `<td><button type="button" class="box ${k}" data-c="${c}" data-m="${x}" aria-label="${c} ${x}월 ${l}">${l}</button></td>` }).join('')}<td class="counts"><b class="${d ? 't-danger' : 'muted'}">${d}</b> / <b class="${w ? 't-warn' : 'muted'}">${w}</b></td></tr>`;
  }
  $('stTable').innerHTML = h + '</tbody>';
  $('stList').innerHTML = CLASSES.map(c => {
    const [d, w] = classCounts(c, m), [k, l] = cellState(c, m);
    return `<div class="srow"><div class="l"><div class="t"><b>${c}</b><span class="${d ? 'hot' : ''}">대상 ${d} · 주의 ${w}</span></div><div class="strip">${MONTHS.map(x => { const r = S.records[key(c, x)]; return `<i class="${r ? 'done' : x > CUR ? 'future' : 'miss'}"></i>` }).join('')}</div></div><button type="button" class="box ${k}" data-c="${c}" data-m="${m}">${l}</button></div>`;
  }).join('');
  const lb = $('btnLock'); lb.hidden = !S.isAdmin; lb.textContent = locked(m) ? `${m}월 마감 해제` : `${m}월 마감하기`; lb.className = 'btn' + (locked(m) ? '' : ' primary');
  $('adminCard').hidden = !S.isAdmin;
}
onChip($('stMonChips'), v => { S.stMonth = +v; $('copyArea').hidden = true; renderStatus() });
function jump(e) { const b = e.target.closest('.box[data-c]'); if (!b) return; guard(() => { S.cls = b.dataset.c; S.month = +b.dataset.m; setTab('input') }) }
$('stTable').addEventListener('click', jump); $('stList').addEventListener('click', jump);
$('btnCopy').addEventListener('click', () => {
  const m = S.stMonth, miss = CLASSES.filter(c => !S.records[key(c, m)]);
  const text = miss.length
    ? `[${m}월 미인정 출결 입력 안내]\n${miss.join(', ')} 학급은 ${m}월 미인정 결석·조퇴·결과·지각 입력을 완료해 주세요. 해당 사항이 없으면 '이상 없음'을 눌러 주세요.\n${location.href.split('#')[0]}`
    : `[${m}월 미인정 출결 입력 안내]\n모든 학급이 ${m}월 입력을 마쳤습니다. 감사합니다.`;
  const ta = $('copyArea'); ta.value = text;
  const fallback = () => { ta.hidden = false; ta.focus(); ta.select(); toast('문구를 선택해 두었어요. 직접 복사해 주세요.') };
  try { navigator.clipboard.writeText(text).then(() => { ta.hidden = true; toast('알림 문구를 복사했어요') }, fallback) } catch (e) { fallback() }
});
$('btnLock').addEventListener('click', async () => {
  const m = S.stMonth, lk = !locked(m);
  try {
    await setDoc(doc(db, 'locks', String(m)), { locked: lk, by: S.editor || '학년부장', at: new Date().toISOString() });
    toast(lk ? `${m}월을 마감했어요` : `${m}월 마감을 풀었어요`);
  } catch (e) { toast(errMsg(e)) }
});

/* ---------- 관리자 도구 ---------- */
$('btnBackup').addEventListener('click', () => {
  const data = { app: 'bangok-g2-attendance', exportedAt: new Date().toISOString(), roster: S.roster, records: S.records, locks: S.locks };
  download(`2학년_미인정출결_백업_${today()}.json`, JSON.stringify(data, null, 1), 'application/json');
});
$('btnRaw').addEventListener('click', () => {
  const out = [['학급', '번호', '이름', '학적', '월', '미인정 결석', '미인정 조퇴', '미인정 결과', '미인정 지각', '이번 달 환산', '저장자', '저장 시각']];
  for (const c of CLASSES) for (const m of MONTHS) {
    const r = S.records[key(c, m)]; if (!r) continue;
    for (const s of students(c, m)) {
      const row = (r.rows && r.rows[s.no]) || [0, 0, 0, 0];
      out.push([c, s.no, s.name, s.status || '재학', m, ...row, convArr(row.map(n => +n || 0)), r.savedBy || '', fmt(r.savedAt)]);
    }
  }
  download(`2학년_미인정출결_원자료_${today()}.csv`, csv(out), 'text/csv;charset=utf-8');
});
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const pick = o => (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    const data = { roster: pick(d.roster), records: pick(d.records), locks: pick(d.locks) };
    const bad = Object.keys(data.records).filter(id => !/^2-[1-9]_(3|4|5|6|7|8|9|10|11|12)$/.test(id));
    const badR = Object.keys(data.roster).filter(id => !CLASSES.includes(id));
    if (bad.length || badR.length) throw new Error('형식이 맞지 않는 항목: ' + [...badR, ...bad].slice(0, 5).join(', '));
    const n = Object.keys(data.roster).length + Object.keys(data.records).length + Object.keys(data.locks).length;
    if (!n) throw new Error('가져올 항목이 없어요.');
    S.importData = data;
    $('importMsg').textContent = `명렬 ${Object.keys(data.roster).length}개 학급, 기록 ${Object.keys(data.records).length}건, 마감 ${Object.keys(data.locks).length}건을 가져옵니다. 같은 학급·월 자료는 덮어써요.`;
    $('importAsk').hidden = false;
  } catch (err) { toast('파일을 읽지 못했어요. ' + (err.message || '')) }
});
$('importCancel').addEventListener('click', () => { S.importData = null; $('importAsk').hidden = true });
$('importGo').addEventListener('click', async () => {
  const d = S.importData; if (!d) return;
  $('importGo').disabled = true;
  try {
    const entries = [
      ...Object.entries(d.roster).map(([id, v]) => ['roster', id, v]),
      ...Object.entries(d.records).map(([id, v]) => ['records', id, v]),
      ...Object.entries(d.locks).map(([id, v]) => ['locks', id, v])
    ];
    for (let i = 0; i < entries.length; i += 400) {
      const b = writeBatch(db);
      entries.slice(i, i + 400).forEach(([c, id, v]) => b.set(doc(db, c, id), v));
      await b.commit();
    }
    toast(`${entries.length}건을 가져왔어요`);
    S.importData = null; $('importAsk').hidden = true;
  } catch (e) { toast(errMsg(e)) }
  finally { $('importGo').disabled = false }
});

/* ---------- 공통 ---------- */
function render() {
  if (!S.user) return;
  showEditor();
  if (S.tab === 'input') renderInput(); else if (S.tab === 'flag') renderFlag(); else renderStatus();
}
