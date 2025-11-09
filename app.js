/* --------- Utils --------- */

const AI_ENDPOINT = 'http://localhost:5174/api/unit-context';
const el = id => document.getElementById(id);
const treeEl = el('tree'), statusEl = el('status');
function status(msg){ statusEl.textContent = msg; }
function escapeHtml(s){ return (s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function stripBlankLines(s){return String(s||'').split(/\r?\n/).filter(l=>l.trim()!=='').join('\n');}

// ===== [RUNS-UTILS] BEGIN: HTML ↔ Runs 공용 유틸 =====
function escapeHtmlAttr(s){ return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function escapeHtml(s){ const t=document.createElement('div'); t.textContent=String(s); return t.innerHTML; }

/* ==== runs → HTML ==== */
function runsToHtml(text, runs){
  const t = String(text || '');
  const arr = Array.isArray(runs) ? [...runs] : [];
  arr.sort((a,b)=> (a.s||0) - (b.s||0));

  const esc = s => escapeHtml(s);
  let out = '';
  let i = 0;

  for(const r of arr){
    const s = Math.max(0, Math.min(t.length, r.s|0));
    const e = Math.max(s, Math.min(t.length, r.e|0));
    if(s > i) out += esc(t.slice(i, s));
    const raw = t.slice(s, e);
    const seg = esc(raw);

    let open = '', close = '';
    if(r.b) { open += '<strong>'; close = '</strong>'+close; }
    if(r.i) { open += '<em>';     close = '</em>'+close; }
    if(r.u) { open += '<u>';      close = '</u>'+close; }
    if(r.s) { open += '<s>';      close = '</s>'+close; }
    if(r.color){ open += `<span style="color:${r.color}">`; close = '</span>'+close; }
    if(r.mark){  open += `<mark>`;                           close = '</mark>'+close; }

    out += open + seg + close;
    i = e;
  }
  if(i < t.length) out += esc(t.slice(i));
  return out.replace(/\n/g, '<br>');
}

// Run = { s:number, e:number, b?:1, i?:1, u?:1, s?:1, c?:string, hl?:string, a?:string }
function mergeRuns(runs){
  if (!runs || !runs.length) return [];
  const arr = [...runs].sort((a,b)=> a.s - b.s || a.e - b.e);
  const out = [];
  for (const r of arr){
    const last = out[out.length-1];
    const same = last && last.b===r.b && last.i===r.i && last.u===r.u && last.s===r.s && last.c===r.c && last.hl===r.hl && last.a===r.a;
    if (same && last.e >= r.s) last.e = Math.max(last.e, r.e);
    else out.push({...r});
  }
  return out;
}
function htmlToRuns(html){
  const div = document.createElement('div');
  div.innerHTML = html || '';
  const runs = [];
  let text = '';
  let offset = 0;

  function pushRun(s, e, st){
    if (e<=s) return;
    const r = { s, e };
    if (st.bold) r.b = 1;
    if (st.italic) r.i = 1;
    if (st.underline) r.u = 1;
    if (st.strike) r.s = 1;
    if (st.color) r.c = st.color;
    if (st.highlight) r.hl = st.highlight;
    if (st.href) r.a = st.href;
    runs.push(r);
  }
  function styled(el, base){
    const st = {...(base||{})};
    const tag = el.nodeName?.toLowerCase?.() || '';
    if (tag==='b'||tag==='strong') st.bold = true;
    if (tag==='i'||tag==='em') st.italic = true;
    if (tag==='u') st.underline = true;
    if (tag==='s'||tag==='del') st.strike = true;
    if (tag==='a'){ const href = el.getAttribute('href'); if (href) st.href = href; }
    const css = el.getAttribute?.('style')||'';
    const m1 = css.match(/color\s*:\s*([^;]+)/i);
    const m2 = css.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (m1) st.color = m1[1].trim();
    if (m2) st.highlight = m2[1].trim();
    return st;
  }
  function walk(node, st){
    if (node.nodeType===3){
      const raw = node.nodeValue||'';
      if (!raw) return;
      const start = offset;
      text += raw;
      offset += raw.length;
      if (st.bold||st.italic||st.underline||st.strike||st.color||st.highlight||st.href){
        pushRun(start, offset, st);
      }
      return;
    }
    if (node.nodeType!==1) return;
    const tag = node.nodeName.toLowerCase();
    if (tag==='sup' && node.classList.contains('pv')) return; // 절번호 저장 제외

    const st2 = styled(node, st||{});
    node.childNodes.forEach(n=>walk(n, st2));
    if (['p','div','li','blockquote'].includes(tag)){ text+='\n'; offset+=1; }
  }
  walk(div, {});
  text = text.replace(/\n{2,}$/,'\n');
  return { text, runs: mergeRuns(runs) };
}

function runsToHtml(text, runs){
  text = String(text||'');
  const marks = [];
  (runs||[]).forEach(r=>{ marks.push({pos:r.s,open:1,r}); marks.push({pos:r.e,open:0,r}); });
  marks.sort((a,b)=> a.pos - b.pos || (a.open? -1 : 1));
  let html = '', i = 0;
  const stack = [];
  const openTag = (r)=>{
    let s = '';
    const styles = [];
    if (r.c) styles.push(`color:${r.c}`);
    if (r.hl) styles.push(`background-color:${r.hl}`);
    const deco = [];
    if (r.u) deco.push('underline');
    if (r.s) deco.push('line-through');
    if (deco.length) styles.push(`text-decoration:${deco.join(' ')}`);
    if (r.b) s += '<strong>';
    if (r.i) s += '<em>';
    const needSpan = styles.length || r.a;
    if (needSpan){
      const tag = r.a ? 'a' : 'span';
      const attr = [];
      if (styles.length) attr.push(`style="${styles.join(';')}"`);
      if (r.a) attr.push(`href="${escapeHtmlAttr(r.a)}"`);
      s += `<${tag} ${attr.join(' ')}>`;
    }
    return s;
  };
  const closeTag = (r)=>{
    let s = '';
    const needSpan = (r.c||r.hl||r.u||r.s||r.a);
    if (needSpan) s += (r.a?'</a>':'</span>');
    if (r.i) s += '</em>';
    if (r.b) s += '</strong>';
    return s;
  };

  for (const m of marks){
    if (i < m.pos){ html += escapeHtml(text.slice(i, m.pos)); i = m.pos; }
    if (m.open){
      html += openTag(m.r);
      stack.push(m.r);
    } else {
      // 안쪽부터 닫고 나머지 다시 열기
      const bufClose = [];
      while (stack.length){
        const top = stack.pop();
        bufClose.push(closeTag(top));
        if (top === m.r) break;
      }
      // 닫힌 다음 다시 열기
      const toReopen = stack.slice();
      toReopen.forEach(rr=>{ html += openTag(rr); });
      html += bufClose.join('');
    }
  }
  if (i < text.length) html += escapeHtml(text.slice(i));
  return html;
}
// ===== [RUNS-UTILS] END =====

function syncCurrentFromOpen(){
  const openPara = treeEl.querySelector('details.para[open]');
  if(!openPara) return false;
  const t = openPara.querySelector('summary .ptitle');
  if(!t) return false;
  const book = t.dataset.book;
  const chap = parseInt(t.dataset.ch, 10);
  const idx  = parseInt(t.dataset.idx, 10);
  const para = BIBLE?.books?.[book]?.[chap]?.paras?.[idx];
  if(!para) return false;
  CURRENT.book   = book;
  CURRENT.chap   = chap;
  CURRENT.paraIdx= idx;
  CURRENT.paraId = `${book}|${chap}|${para.ref}`;
  return true;
}

// 제목 변경 반영
function updateParaTitle(book, chap, idx, newTitle){
  try{
    const para = BIBLE?.books?.[book]?.[chap]?.paras?.[idx];
    if(!para) return;
    para.title = newTitle;
    const s = document.querySelector(
      `summary .ptitle[data-book="${CSS.escape(String(book))}"][data-ch="${CSS.escape(String(chap))}"][data-idx="${CSS.escape(String(idx))}"]`
    );
    if(s) s.textContent = newTitle;
  }catch(_){}
}

// JSON 다운로드
function downloadBibleJSON(){
  if(!BIBLE){ alert('BIBLE 데이터가 없습니다.'); return; }
  const blob = new Blob([JSON.stringify(BIBLE, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bible-paragraphs.json';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  status('수정된 JSON을 다운로드했습니다.');
}

/* ==== 전체 데이터 백업/복원 ==== */
const STORAGE_SERMON      = 'wbps.sermons.v4';
const STORAGE_UNIT_CTX    = 'wbps.ctx.unit.v1';
const STORAGE_WHOLE_CTX   = 'wbps.ctx.whole.v1';
const STORAGE_COMMENTARY  = 'wbps.ctx.comm.v1';
const STORAGE_SUMMARY     = 'wbps.ctx.summary.v1';
const VOICE_CHOICE_KEY    = 'wbps.tts.choice.v2';

function todayStr(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function exportAllData(){
  const keys = [STORAGE_SERMON, STORAGE_UNIT_CTX, STORAGE_WHOLE_CTX, STORAGE_COMMENTARY, STORAGE_SUMMARY, VOICE_CHOICE_KEY];
  const payload = { __wbps:1, date: todayStr(), items:{} };
  keys.forEach(k=> payload.items[k] = localStorage.getItem(k) ?? null);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  const ts = new Date();
  const tss = `${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}-${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `wbps-backup-${tss}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  status('전체 데이터를 내보냈습니다.');
}
async function importAllData(file){
  try{
    const text = await file.text();
    const json = JSON.parse(text);
    if(!json || json.__wbps!==1 || !json.items){ alert('백업 파일 형식이 아닙니다.'); return; }
    if(!confirm('이 백업으로 현재 기기의 데이터를 덮어쓸까요?')) return;
    Object.entries(json.items).forEach(([k,v])=>{
      if(v===null || v===undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    });
    status('가져오기가 완료되었습니다. 페이지를 새로고침하면 반영됩니다.');
  }catch(e){
    console.error(e);
    alert('가져오기 중 오류가 발생했습니다.');
  }
}

/* --------- Refs / State --------- */
const voiceSelect = el('voiceSelect'), testVoiceBtn = el('testVoice');
const rateCtl = el('rateCtl'), pitchCtl = el('pitchCtl'), voiceHint = el('voiceHint');
const modalWrap = el('modalWrap'), modalRef = el('modalRef');
const sermonList = el('sermonList'), sermonEditor = el('sermonEditor');
const sermonTitle = el('sermonTitle'), sermonBody = el('sermonBody');
const editorSpeakBtn = el('editorSpeak');
const modalFooterNew = el('modalFooterNew');

let BIBLE = null;
let CURRENT = { book:null, chap:null, paraIdx:null, paraId:null };
let READER = { playing:false, q:[], idx:0, synth:window.speechSynthesis||null, scope:null, btn:null, continuous:false };
let EDITOR_READER = { playing:false, u:null, synth:window.speechSynthesis||null };

/* --------- Boot --------- */
(async function boot(){
  try{
    BIBLE = await tryFetchJSON('bible-paragraph.json');
  }catch(_){
    try{ BIBLE = await tryFetchJSON('bible_paragraphs.json'); }
    catch(e){ status('bible-paragraph.json을 찾을 수 없습니다. 같은 폴더에 두고 다시 열어주세요.'); return; }
  }
  buildTree();
  ensureSermonButtons();   // 🔧 설교 버튼 누락 시 보강
  status('불러오기 완료. 66권 트리가 활성화되었습니다.');
  await setupVoices();
})();

(function bindButtons(){
  el('btnSaveJSON')?.addEventListener('click', downloadBibleJSON);
  const btnExport = el('btnExportAll');
  const btnImport = el('btnImportAll');
  const fileInput = el('importFile');
  if (btnExport) btnExport.onclick = exportAllData;
  if (btnImport) btnImport.onclick = ()=> fileInput && fileInput.click();
  if (fileInput) fileInput.addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    importAllData(f).finally(()=>{ e.target.value=''; });
  });
})();

async function tryFetchJSON(path){ const res = await fetch(path, {cache:'no-store'}); if(!res.ok) throw 0; return await res.json(); }

/* --------- Voice --------- */
function waitForVoices(timeout=1500){
  return new Promise(resolve=>{
    const have = speechSynthesis.getVoices?.();
    if (have && have.length) return resolve(have);
    const t = setTimeout(()=> resolve(speechSynthesis.getVoices?.()||[]), timeout);
    speechSynthesis.onvoiceschanged = ()=>{ clearTimeout(t); resolve(speechSynthesis.getVoices?.()||[]); };
  });
}
function getKoreanVoices(all){
  return (all||[]).filter(v=>{
    const n=(v.name||'').toLowerCase(), l=(v.lang||'').toLowerCase();
    return l.startsWith('ko') || n.includes('korean') || n.includes('한국') || n.includes('korea');
  });
}
function presetsForSingleVoice(){
  return [
    {id:'preset-soft-low',  label:'프리셋 · 저음/느림',   rate:0.85, pitch:0.85},
    {id:'preset-soft-high', label:'프리셋 · 고음/느림',   rate:0.90, pitch:1.20},
    {id:'preset-fast',      label:'프리셋 · 빠름',       rate:1.20, pitch:1.05},
    {id:'preset-bright',    label:'프리셋 · 밝게',       rate:1.05, pitch:1.25},
    {id:'preset-radio',     label:'프리셋 · 라디오톤',   rate:1.00, pitch:0.90},
    {id:'preset-reading',   label:'프리셋 · 낭독체',     rate:0.95, pitch:1.00},
  ];
}
async function setupVoices(){
  const all = await waitForVoices();
  const kos = getKoreanVoices(all);

  voiceSelect.innerHTML = '';
  const def = document.createElement('option');
  def.value = JSON.stringify({type:'default'});
  def.textContent = '브라우저 기본(ko-KR)';
  voiceSelect.appendChild(def);

  if(kos.length > 0){
    const og = document.createElement('optgroup'); og.label = '한국어 보이스';
    kos.forEach(v=>{
      const opt = document.createElement('option');
      opt.value = JSON.stringify({type:'voice', uri:v.voiceURI});
      opt.textContent = `${v.name} — ${v.lang}${v.localService ? ' (로컬)' : ''}`;
      og.appendChild(opt);
    });
    voiceSelect.appendChild(og);
  }
  if(kos.length <= 1){
    const pg = document.createElement('optgroup'); pg.label = '스타일 프리셋';
    presetsForSingleVoice().forEach(p=>{
      const opt = document.createElement('option');
      opt.value = JSON.stringify({type:'preset', rate:p.rate, pitch:p.pitch});
      opt.textContent = p.label;
      pg.appendChild(opt);
    });
    voiceHint.style.display = '';
  } else {
    voiceHint.style.display = 'none';
  }

  const saved = localStorage.getItem(VOICE_CHOICE_KEY);
  if(saved){
    const idx = [...voiceSelect.options].findIndex(o=>o.value===saved);
    if(idx>=0) voiceSelect.selectedIndex = idx;
  } else {
    localStorage.setItem(VOICE_CHOICE_KEY, voiceSelect.value);
  }
  voiceSelect.addEventListener('change', ()=> localStorage.setItem(VOICE_CHOICE_KEY, voiceSelect.value));
  testVoiceBtn.onclick = ()=> speakSample('태초에 하나님이 천지를 창조하시니라.');
}
function resolveVoiceChoice(){
  try{ return JSON.parse(localStorage.getItem(VOICE_CHOICE_KEY)||'{"type":"default"}'); }
  catch{ return {type:'default'}; }
}
function pickVoiceByURI(uri){ return (speechSynthesis.getVoices?.()||[]).find(v=>v.voiceURI===uri) || null; }
function applyVoice(u){
  const choice = resolveVoiceChoice();
  const baseRate = parseFloat(rateCtl.value||'0.95');
  const basePitch = parseFloat(pitchCtl.value||'1');
  if(choice.type==='voice'){
    const v = pickVoiceByURI(choice.uri);
    if(v){ u.voice = v; u.lang = v.lang; } else { u.lang = 'ko-KR'; }
    u.rate = baseRate; u.pitch = basePitch;
  } else if(choice.type==='preset'){
    u.lang = 'ko-KR';
    u.rate = clamp((choice.rate ?? 0.95) * baseRate / 0.95, 0.5, 2);
    u.pitch = clamp((choice.pitch ?? 1.0) * basePitch / 1.0, 0, 2);
  } else {
    u.lang = 'ko-KR'; u.rate = baseRate; u.pitch = basePitch;
  }
}
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function speakSample(text){
  const synth = window.speechSynthesis;
  try{ synth.cancel(); }catch(e){}
  const u = new SpeechSynthesisUtterance(text);
  applyVoice(u);
  synth.speak(u);
}

/* --------- Tree --------- */
function buildTree(){
  treeEl.innerHTML = '';
  if(!BIBLE){ treeEl.innerHTML = '<div class="muted">파일을 찾을 수 없습니다.</div>'; return; }

  for(const bookName of Object.keys(BIBLE.books)){
    const detBook = document.createElement('details');
    const sumBook = document.createElement('summary');
    sumBook.innerHTML = `<span class="tw">${escapeHtml(bookName)}</span>`;
    detBook.appendChild(sumBook);

    const chWrap = document.createElement('div'); chWrap.className='chapters';
    const chapters = Object.keys(BIBLE.books[bookName]).map(n=>parseInt(n,10)).sort((a,b)=>a-b);

    for(const chap of chapters){
      const detChap = document.createElement('details');
      const sumChap = document.createElement('summary');
      sumChap.innerHTML = `<span class="chip">${chap}장</span>`;
      detChap.appendChild(sumChap);

      const parWrap = document.createElement('div'); parWrap.className='paras';
      const paras = BIBLE.books[bookName][chap].paras || [];
      paras.forEach((p, idx)=>{
        const detPara = document.createElement('details'); detPara.className='para';

        const m = String(p.ref||'').match(/^(\d+):(\d+)(?:-(\d+))?$/);
        const v1 = m ? m[2] : '?', v2 = m ? (m[3]||m[2]) : '?';
        const titleText = p.title || p.ref;

        const sum = document.createElement('summary');
        sum.innerHTML = `
          <span class="vrange">(${v1}-${v2})</span>
          <span class="ptitle"
                data-book="${bookName}"
                data-ch="${chap}"
                data-idx="${idx}"
                title="제목을 더블클릭하면 편집할 수 있습니다">${escapeHtml(titleText)}</span>
        `;

        const titleEl = sum.querySelector('.ptitle');

        titleEl.addEventListener('dblclick', (e)=>{
          e.preventDefault(); e.stopPropagation();
          detPara.open = true;
          startInlineTitleEdit(titleEl, bookName, chap, idx);
        }, true);

        function guardSummary(ev){
          const isEditing = titleEl.isContentEditable;
          const dblOnTitle = (ev.type === 'dblclick' && ev.target === titleEl);
          if (isEditing || dblOnTitle){
            ev.preventDefault();
            ev.stopPropagation();
          }
        }
        ['pointerdown','mousedown','click','dblclick'].forEach(type=>{
          sum.addEventListener(type, guardSummary, true);
        });

        detPara.appendChild(sum);

        const body = document.createElement('div');
        body.className = 'pbody';
        body.innerHTML = `
          <div class="ptoolbar">
            <button class="primary speakBtn">낭독</button>
            <label class="chip"><input type="checkbox" class="keepReading" style="margin-right:6px">계속 낭독</label>
            <button class="ctxBtn btnSummary">내용흐름</button>
            <button class="ctxBtn btnUnitCtx">단위성경속 맥락</button>
            <button class="ctxBtn btnWholeCtx">전체성경속 맥락</button>
            <button class="ctxBtn btnCommentary">주석</button>
            <button class="sermBtn">설교</button>
            <div class="spacer"></div>
          </div>
          <div class="pcontent"></div>`;

        // [PATCH 1 START] 설교 버튼 생성/가시성만 보강 (클릭 바인딩 없음)
        (function ensureSermonBtn(){
          const tb = body.querySelector('.ptoolbar');
          if (!tb) return;

          if (!tb.querySelector('.spacer')) {
            const sp = document.createElement('div');
            sp.className = 'spacer';
            tb.appendChild(sp);
          }
          let sermBtn = tb.querySelector('.sermBtn');
          if (!sermBtn) {
            sermBtn = document.createElement('button');
            sermBtn.className = 'sermBtn';
            sermBtn.textContent = '설교';
            tb.appendChild(sermBtn);
          }
        })();
        // [PATCH 1 END]

        detPara.appendChild(body);

        const pcontent = body.querySelector('.pcontent');
        (p.verses||[]).forEach(([v,t])=>{
          const line = document.createElement('div');
          line.className = 'pline';
          line.dataset.verse = v;
          line.innerHTML = `<sup class="pv">${v}</sup>${t}`;
          pcontent.appendChild(line);
        });

        detPara.addEventListener('toggle', ()=>{
          if(detPara.open){
            CURRENT.book = bookName; CURRENT.chap = chap; CURRENT.paraIdx = idx;
            const para = BIBLE.books[bookName][chap].paras[idx];
            CURRENT.paraId = `${bookName}|${chap}|${para.ref}`;
            status(`선택됨: ${bookName} ${chap}장 · ${para.title||para.ref}`);
            // 열릴 때 설교 버튼 누락 시 즉시 생성 (클릭 바인딩 없음)
            const tb = detPara.querySelector('.ptoolbar');
            if (tb && !tb.querySelector('.sermBtn')) {
              const btn = document.createElement('button');
              btn.className = 'sermBtn';
              btn.textContent = '설교';
              tb.appendChild(btn);
            }
          }
        });

        body.querySelector('.speakBtn').addEventListener('click', ()=>{
          toggleSpeakInline(bookName, chap, idx, detPara, body.querySelector('.speakBtn'));
        });

        // 컨텍스트 에디터 버튼들
        body.querySelector('.btnUnitCtx').addEventListener('click', ()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('unit'); });
        body.querySelector('.btnWholeCtx').addEventListener('click',()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('whole'); });
        body.querySelector('.btnCommentary').addEventListener('click',()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('commentary'); });
        body.querySelector('.btnSummary').addEventListener('click',   ()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('summary'); });

        parWrap.appendChild(detPara);
      });

      detChap.appendChild(parWrap);
      chWrap.appendChild(detChap);
    }

    detBook.appendChild(chWrap);
    treeEl.appendChild(detBook);
  }
}

// [PATCH 2 START] 렌더 후에도 설교 버튼 누락 시 자동 보정(클릭 바인딩 없음)
(function sermonBtnWatcher(){
  const root = document.getElementById('tree');
  if (!root) return;

  function fix(tb){
    if (!tb.querySelector('.spacer')) {
      const sp = document.createElement('div');
      sp.className = 'spacer';
      tb.insertBefore(sp, tb.firstChild);
    }
    if (!tb.querySelector('.sermBtn')) {
      const b = document.createElement('button');
      b.className = 'sermBtn';
      b.textContent = '설교';
      tb.appendChild(b);
    }
  }

  function sweep(){
    root.querySelectorAll('details.para .ptoolbar').forEach(fix);
  }

  sweep();
  new MutationObserver(sweep).observe(root, {subtree:true, childList:true});
})();
// [PATCH 2 END]

/* ✅ 트리 렌더 후 설교 버튼이 누락됐을 때 자동 보강(클릭 바인딩 없음) */
function ensureSermonButtons(){
  document.querySelectorAll('#tree details.para .ptoolbar').forEach(tb=>{
    if (tb.querySelector('.sermBtn')) return;

    let spacer = tb.querySelector('.spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'spacer';
      tb.appendChild(spacer);
    }

    const btn = document.createElement('button');
    btn.className = 'sermBtn';
    btn.textContent = '설교';
    tb.appendChild(btn);
  });
}

/* 🔧 트리 위임 클릭 공용 처리 (유일한 클릭 바인딩) */
treeEl.addEventListener('click', (e)=>{
  const isCtxBtn = e.target.closest('.btnSummary, .btnUnitCtx, .btnWholeCtx, .btnCommentary, .sermBtn');
  if (!isCtxBtn) return;

  const paraEl = e.target.closest('details.para');
  const t = paraEl?.querySelector('summary .ptitle');
  if (!paraEl || !t) return;

  CURRENT.book   = t.dataset.book;
  CURRENT.chap   = parseInt(t.dataset.ch, 10);
  CURRENT.paraIdx= parseInt(t.dataset.idx, 10);
  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) return;
  CURRENT.paraId = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;

  if (e.target.closest('.btnSummary'))    { openSingleDocEditor('summary');    return; }
  if (e.target.closest('.btnUnitCtx'))    { openSingleDocEditor('unit');       return; }
  if (e.target.closest('.btnWholeCtx'))   { openSingleDocEditor('whole');      return; }
  if (e.target.closest('.btnCommentary')) { openSingleDocEditor('commentary'); return; }
  if (e.target.closest('.sermBtn'))       { openSermonModal();                 return; }
});

/* --------- Inline TTS --------- */
function buildQueueFrom(book, chap, idx){
  const para = BIBLE.books[book][chap].paras[idx];
  return (para.verses||[]).map(([v,t])=>({verse:v, text:t}));
}
function clearReadingHighlight(scope){ [...scope.querySelectorAll('.pline')].forEach(el=> el.classList.remove('reading')); }
function bindKeepReading(scope){
  const cb = scope.querySelector('.keepReading');
  if(!cb) return;
  cb.checked  = READER.continuous;
  cb.disabled = false;
  cb.onchange = ()=>{ READER.continuous = cb.checked; };
}
function speakVerseItemInScope(item, scope, onend){
  if(!READER.synth) return;
  const u = new SpeechSynthesisUtterance(String(item.text));
  applyVoice(u);
  let done = false;
  const safeEnd = ()=>{ if(done) return; done = true; onend(); };
  u.onstart = ()=>{
    clearReadingHighlight(scope);
    const line = scope.querySelector(`.pline[data-verse="${item.verse}"]`);
    if(line){ line.classList.add('reading'); line.scrollIntoView({block:'center', behavior:'smooth'}); }
    if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
    const base = Math.max(800, Math.round(item.text.length * 65));
    const rate = u.rate || 1;
    const estimate = Math.max(600, Math.round(base / rate)) + 1200;
    READER._wd = setTimeout(safeEnd, estimate);
  };
  u.onend   = safeEnd;
  u.onerror = safeEnd;
  READER.synth.speak(u);
}
function toggleSpeakInline(book, chap, idx, paraDetailsEl, btnEl){
  if(!READER.synth) return alert('이 브라우저는 음성합성을 지원하지 않습니다.');
  const sameScope = READER.playing && READER.scope === paraDetailsEl;
  if(READER.playing && sameScope){ stopSpeakInline(); return; }
  READER.continuous = true;
  READER.q = buildQueueFrom(book, chap, idx);
  READER.idx = 0;
  READER.playing = true;
  READER.scope = paraDetailsEl;
  READER.btn = btnEl;
  try{ READER.synth.cancel(); }catch(e){}
  bindKeepReading(READER.scope);
  updateInlineSpeakBtn();
  playNextInQueueInline(book, chap, idx);
}
function playNextInQueueInline(book, chap, idx){
  if(!READER.playing) return;
  if(READER.idx >= READER.q.length){
    if(READER.continuous && goToNextParagraphInline(book, chap, idx)){
      const nextCb = READER.scope?.querySelector?.('.keepReading');
      if(nextCb){ nextCb.checked = READER.continuous; nextCb.disabled = false; }
      READER.q = buildQueueFrom(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      READER.idx = 0;
      bindKeepReading(READER.scope);
      updateInlineSpeakBtn();
      setTimeout(()=>{ try{ READER.synth.cancel(); }catch(e){} playNextInQueueInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx); }, 120);
      return;
    }
    stopSpeakInline();
    return;
  }
  const item = READER.q[READER.idx];
  speakVerseItemInScope(item, READER.scope, ()=>{ READER.idx++; playNextInQueueInline(book, chap, idx); });
}
function stopSpeakInline(){
  READER.playing = false;
  try{ READER.synth && READER.synth.cancel(); }catch(e){}
  if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
  if(READER.scope){
    const cb = READER.scope.querySelector?.('.keepReading');
    if(cb) cb.disabled = false;
    clearReadingHighlight(READER.scope);
  }
  updateInlineSpeakBtn();
  READER.scope = null; READER.btn = null;
}
function updateInlineSpeakBtn(){ if(READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독'; }

function goToNextParagraphInline(book, chap, idx){
  const chObj = BIBLE.books[book][chap];
  const booksEls = [...treeEl.children];

  const bookNames = Object.keys(BIBLE.books);
  const bIdx = bookNames.indexOf(book);
  const bookEl = booksEls[bIdx];
  if(!bookEl) return false;

  const chaptersEls = bookEl.querySelectorAll(':scope > .chapters > details');
  const chapNums = Object.keys(BIBLE.books[book]).map(n=>parseInt(n,10)).sort((a,b)=>a-b);

  const chPos = chapNums.indexOf(chap);
  const chapEl = chaptersEls[chPos];
  if(!chapEl) return false;

  const paraEls = chapEl.querySelectorAll(':scope > .paras > details.para');

  if (READER.btn) READER.btn.textContent = '낭독';

  if (idx < chObj.paras.length - 1){
    const nextEl = paraEls[idx + 1];
    if(nextEl){
      chapEl.open = true;
      nextEl.open = true;
      CURRENT.book = book;
      CURRENT.chap = chap;
      CURRENT.paraIdx = idx + 1;
      READER.scope = nextEl;
      READER.btn = nextEl.querySelector('.speakBtn');
      if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
      return true;
    }
  }

  if (chPos >= 0 && chPos < chapNums.length - 1){
    const nextChap = chapNums[chPos + 1];
    const nextChapEl = chaptersEls[chPos + 1];
    if(nextChapEl){
      const nextParas = (BIBLE.books[book][nextChap].paras || []);
      if(nextParas.length){
        const nextParaEl = nextChapEl.querySelector(':scope > .paras > details.para');
        nextChapEl.open = true;
        if(nextParaEl) nextParaEl.open = true;

        CURRENT.book = book;
        CURRENT.chap = nextChap;
        CURRENT.paraIdx = 0;

        READER.scope = nextParaEl;
        READER.btn = nextParaEl?.querySelector('.speakBtn') || null;
        if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
        return true;
      }
    }
  }

  const bPos = bIdx;
  if (bPos >= 0 && bPos < bookNames.length - 1){
    const nextBook = bookNames[bPos + 1];
    const nextBookEl = booksEls[bPos + 1];
    if(nextBookEl){
      const firstChap = Math.min(...Object.keys(BIBLE.books[nextBook]).map(n=>parseInt(n,10)));
      const nextChapEl = nextBookEl.querySelector(':scope > .chapters > details');
      const nextParaEl = nextChapEl?.querySelector(':scope > .paras > details.para');
      if(nextParaEl){
        nextBookEl.open = true;
        nextChapEl.open = true;
        nextParaEl.open = true;

        CURRENT.book = nextBook;
        CURRENT.chap = firstChap;
        CURRENT.paraIdx = 0;

        READER.scope = nextParaEl;
        READER.btn = nextParaEl.querySelector('.speakBtn');
        if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
        return true;
      }
    }
  }
  return false;
}

/* --------- Sermon / Context Editors --------- */
function getSermonMap(){ try{ return JSON.parse(localStorage.getItem(STORAGE_SERMON)||'{}'); }catch{ return {}; } }
function setSermonMap(o){ localStorage.setItem(STORAGE_SERMON, JSON.stringify(o)); }
function getDocMap(storageKey){ try{ return JSON.parse(localStorage.getItem(storageKey)||'{}'); }catch{ return {}; } }
function setDocMap(storageKey, obj){ localStorage.setItem(storageKey, JSON.stringify(obj)); }

/* ✅ 최초 클릭 시에도 동작하도록 보강 + 중복편집기 제거 전제 */
function openSermonModal(){
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) {
      alert('단락을 먼저 선택해 주세요.');
      return;
    }
  }

  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) {
    alert('선택한 단락을 찾을 수 없습니다.');
    return;
  }
  CURRENT.paraId = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;

  document.getElementById('modalTitle').textContent = '단락 성경';
  sermonEditor.dataset.ctxType = '';
  sermonEditor.dataset.editing = '';
  modalRef.textContent = `${CURRENT.book} ${CURRENT.chap}장 · ${para.title || para.ref} (${para.ref})`;

  sermonList.innerHTML = '';
  sermonEditor.style.display = 'none';
  sermonEditor.classList.add('context-editor');
  modalWrap.style.display = 'flex';
  modalWrap.setAttribute('aria-hidden','false');
  modalFooterNew.style.display = '';

  renderSermonList();
}
el('closeModal').onclick = ()=>{ modalWrap.style.display='none'; modalWrap.setAttribute('aria-hidden','true'); stopEditorSpeak(true); };

function openSingleDocEditor(kind){
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) { alert('단락을 먼저 선택해 주세요.'); return; }
  }
  if (!BIBLE) { alert('성경 데이터가 로드되지 않았습니다.'); return; }

  const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const pid  = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;

  const titlePrefix =
    kind==='unit'       ? '단위성경속 맥락' :
    kind==='whole'      ? '전체성경속 맥락' :
    kind==='commentary' ? '주석' :
                           '내용요약';

  const key =
    kind==='unit'       ? STORAGE_UNIT_CTX :
    kind==='whole'      ? STORAGE_WHOLE_CTX :
    kind==='commentary' ? STORAGE_COMMENTARY :
                           STORAGE_SUMMARY;

  const map = getDocMap(key);
  const doc = map[pid] || {
    body:  (kind==='summary' ? '핵심 내용을 간결하게 요약해 적어주세요.' : ''),
    images: [], date:''
  };

  // ✅ runs → HTML 변환 주입 (덧대기)
  // runsToHtml(text, runs) 유틸이 상단에 있어야 합니다. (없다면 추가하세요)
  let bodyHTML = '';
  if (doc && typeof doc.body === 'object' && doc.body.v === 1 && Array.isArray(doc.body.blocks)) {
    // 새 포맷(doc v1, runs) → 각 블록을 HTML로 변환해 이어 붙임
    bodyHTML = doc.body.blocks
      .map(b => runsToHtml(b.text || '', b.runs || []))
      .join('');
  } else if (typeof doc.body_html === 'string' && doc.body_html.trim()) {
    // 선택: 호환용 HTML 스냅샷이 있으면 그걸 우선 사용
    bodyHTML = doc.body_html;
  } else {
    // 구 포맷(문자열 HTML) 폴백
    bodyHTML = String(doc.body || '');
  }

  sermonTitle.value = doc.title || '';
  setBodyHTML(bodyHTML);


  sermonEditor.dataset.editing = '';
  sermonEditor.dataset.ctxType = kind;

  const aiBtn = document.getElementById('aiFill');
  if (aiBtn) {
    aiBtn.style.display = (kind === 'unit') ? '' : 'none';
    aiBtn.onclick = null;
    if (kind === 'unit') {
      aiBtn.onclick = async ()=>{ /* 선택: AI 핸들러 */ };
    }
  }
}

/* ✅ 설교목록 렌더링 */
/* ✅ 설교목록 렌더링 (제목 → 날짜 → 링크 → 편집 → 삭제 순서) */
function renderSermonList(){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  sermonList.innerHTML = '';

  if(arr.length===0){
    startNewSermon();
    return;
  }

  arr.forEach((it, idx)=>{
    const row = document.createElement('div');
    row.className = 'item'; // 필요시 레이아웃용 CSS를 추가할 수 있어요.

    // 1) 제목
    const colTitle = document.createElement('div');
    colTitle.className = 'col col-title';
    colTitle.textContent = (it.title || '(제목 없음)');

    // 2) 작성날짜
    const colDate = document.createElement('div');
    colDate.className = 'col col-date';
    colDate.textContent = (it.date || '');

    // 3) 링크 (입력 + 미리보기 앵커)
    const colLink = document.createElement('div');
    colLink.className = 'col col-link';

    const linkInput = document.createElement('input');
    linkInput.type = 'url';
    linkInput.placeholder = '링크(URL)';
    linkInput.value = it.link || '';
    linkInput.style.minWidth = '220px';

    const linkAnchor = document.createElement('a');
    linkAnchor.textContent = it.link ? it.link : '';
    if (it.link) {
      linkAnchor.href = it.link;
      linkAnchor.target = '_blank';
      linkAnchor.rel = 'noopener noreferrer';
    } else {
      linkAnchor.style.display = 'none';
    }

    linkInput.addEventListener('change', ()=>{
      const url = linkInput.value.trim();
      const m = getSermonMap();
      const a = m[CURRENT.paraId] || [];
      if (a[idx]) {
        a[idx].link = url;
        setSermonMap(m);
      }
      if (url){
        linkAnchor.href = url;
        linkAnchor.textContent = url;
        linkAnchor.style.display = '';
        linkAnchor.target = '_blank';
        linkAnchor.rel = 'noopener noreferrer';
      } else {
        linkAnchor.removeAttribute('href');
        linkAnchor.textContent = '';
        linkAnchor.style.display = 'none';
      }
    });

    colLink.appendChild(linkInput);
    colLink.appendChild(linkAnchor);

    // 4) 편집 버튼
    const btnEdit = document.createElement('button');
    btnEdit.textContent = '편집';
    btnEdit.addEventListener('click', ()=>{
      modalWrap.style.display = 'none';
      modalWrap.setAttribute('aria-hidden','true');
      openSermonEditorWindow(idx);
    });

    // 5) 삭제 버튼
    const btnDel = document.createElement('button');
    btnDel.textContent = '삭제';
    btnDel.style.borderColor = 'var(--danger)';
    btnDel.addEventListener('click', ()=>{
      if(!confirm('이 설교를 삭제할까요?')) return;
      const m = getSermonMap();
      const a = m[CURRENT.paraId] || [];
      a.splice(idx,1);
      m[CURRENT.paraId] = a;
      setSermonMap(m);
      renderSermonList();
    });

    const colActions = document.createElement('div');
    colActions.className = 'col col-actions';
    colActions.appendChild(btnEdit);
    colActions.appendChild(btnDel);

    // 👉 순서대로 추가: 제목 → 날짜 → 링크 → 편집/삭제
    row.appendChild(colTitle);
    row.appendChild(colDate);
    row.appendChild(colLink);
    row.appendChild(colActions);

    sermonList.appendChild(row);
  });
}

/* 새 설교 */
el('newSermonBtn').onclick = ()=>{
  sermonEditor.dataset.ctxType = '';
  if (!CURRENT.paraId) {
    if (!syncCurrentFromOpen()) { alert('단락을 먼저 선택하세요.'); return; }
    const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
    CURRENT.paraId = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;
  }
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const newId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  arr.unshift({ id: newId, title:'', body:'', images:[], date:'', link:'' });
  map[CURRENT.paraId] = arr;
  setSermonMap(map);

  modalWrap.style.display='none';
  modalWrap.setAttribute('aria-hidden','true');
  openSermonEditorWindow(0);
};

function startNewSermon(){
  sermonList.innerHTML = '<div class="muted" style="padding:0 14px">새 설교를 작성해 저장하면 이 단락에 붙습니다.</div>';
  sermonEditor.classList.add('context-editor');
  sermonEditor.style.display = '';
  sermonTitle.value = '';
  setBodyHTML('');
  sermonEditor.dataset.editing = '';
  stopEditorSpeak(true);
}
function deleteSermon(idx){
  if(!confirm('이 설교를 삭제할까요?')) return;
  const map = getSermonMap(); const arr = map[CURRENT.paraId] || [];
  arr.splice(idx,1); map[CURRENT.paraId] = arr; setSermonMap(map); renderSermonList();
}

el('cancelEdit')?.addEventListener('click', ()=>{
  if(sermonEditor.dataset.ctxType){
    sermonEditor.dataset.ctxType = '';
    modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
  }else{
    sermonEditor.style.display = 'none'; renderSermonList();
  }
  stopEditorSpeak(true);
});

el('saveSermon').onclick = ()=>{
  const title = (sermonTitle.value||'').trim() || '(제목 없음)';
  let body = getBodyHTML() || '';
  body = body.replace(/^\s+|\s+$/g, '');

  const imgs  = [];
  const now   = new Date();
  const date  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const para  = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const pid   = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;
  const ctxType = sermonEditor.dataset.ctxType || '';

  if(ctxType){
    const key = ctxType==='unit'       ? STORAGE_UNIT_CTX
              : ctxType==='whole'      ? STORAGE_WHOLE_CTX
              : ctxType==='commentary' ? STORAGE_COMMENTARY
              :                          STORAGE_SUMMARY;
    const map = getDocMap(key);
    map[pid] = { title, body, images: imgs, date };
    setDocMap(key, map);

    sermonEditor.dataset.ctxType = '';
    sermonEditor.classList.remove('context-editor');
    modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
    status(`저장됨: ${title}`);
    return;
  }

  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const editing = sermonEditor.dataset.editing;
  if(editing!==''){ const i=+editing; if(arr[i]) arr[i] = {...arr[i], title, body, images:imgs, date}; }
  else { arr.unshift({ id: crypto.randomUUID(), title, body, images: imgs, date, link:'' }); }
  map[CURRENT.paraId] = arr; setSermonMap(map);
  sermonEditor.style.display = 'none'; renderSermonList(); status('설교가 저장되었습니다.');
};

/* ===== RTE 유틸 ===== */
function isRTE(){ return sermonBody && sermonBody.getAttribute('contenteditable') === 'true'; }
function getBodyHTML(){ return isRTE() ? sermonBody.innerHTML : (sermonBody.value || ''); }
function setBodyHTML(html){ if(isRTE()) sermonBody.innerHTML = html || ''; else sermonBody.value = html || ''; }

function applyColorImmediateToRTE(hex){
  if(!isRTE()) return;
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0){ sermonBody.focus(); return; }
  const range = sel.getRangeAt(0);
  if(!sermonBody.contains(range.commonAncestorContainer)){ sermonBody.focus(); return; }

  if(range.collapsed){
    const sp = document.createElement('span');
    sp.style.color = hex;
    sp.appendChild(document.createTextNode('\u200B'));
    range.insertNode(sp);
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(sp.firstChild, 1); r.collapse(true);
    sel.addRange(r);
    return;
  }
  document.execCommand('foreColor', false, hex);
}
function execFmt(cmd){
  if(isRTE()){
    sermonBody.focus({preventScroll:true});
    document.execCommand(cmd,false,null);
  }
}

/* --------- Editor TTS --------- */
editorSpeakBtn.onclick = ()=> toggleEditorSpeak();
function toggleEditorSpeak(){
  const tmp = document.createElement('div'); tmp.innerHTML = getBodyHTML();
  tmp.querySelectorAll('sup').forEach(s=> s.textContent='['+s.textContent+'] ');
  const plain = (tmp.textContent||'').replace(/\n{2,}/g,' ').replace(/\s+/g,' ').trim();
  const text = [sermonTitle.value.trim(), plain].filter(Boolean).join('. ');
  if(!EDITOR_READER.synth) return alert('이 브라우저는 음성합성을 지원하지 않습니다.');
  if(EDITOR_READER.playing){ stopEditorSpeak(); return; }

  if(!text){ alert('낭독할 내용이 없습니다.'); return; }
  const u = new SpeechSynthesisUtterance(text.replace(/\n{2,}/g, '. ').replace(/\n/g,' '));
  applyVoice(u); u.onend = ()=> stopEditorSpeak(true);
  EDITOR_READER.u = u; EDITOR_READER.synth.cancel(); EDITOR_READER.synth.speak(u);
  EDITOR_READER.playing = true; editorSpeakBtn.textContent = '중지';
}
function stopEditorSpeak(silent){
  if(EDITOR_READER.synth){ try{ EDITOR_READER.synth.cancel(); }catch(e){} }
  EDITOR_READER.playing = false; EDITOR_READER.u = null;
  if(!silent) status('설교 낭독을 중지했습니다.'); editorSpeakBtn.textContent = '낭독';
}

/* --------- Hotkeys --------- */
window.addEventListener('keydown', (e)=>{
  if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='s'){
    e.preventDefault();
    downloadBibleJSON();
    return;
  }
  if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if(key === 's'){
    e.preventDefault();
    syncCurrentFromOpen();
    const openPara = treeEl.querySelector('details.para[open]');
    if(openPara && CURRENT.book!=null){
      const btn = openPara.querySelector('.speakBtn');
      toggleSpeakInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx, openPara, btn);
    }
    return;
  }
  if(key === 'n'){
    e.preventDefault();
    if(!syncCurrentFromOpen()) return;
    const wasPlaying = !!READER.playing;
    try{ READER.synth && READER.synth.cancel(); }catch(_){}
    if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
    READER.playing = wasPlaying;
    const moved = goToNextParagraphInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
    if(!moved) return;
    if (wasPlaying){
      const cb = READER.scope?.querySelector?.('.keepReading');
      if(cb){ cb.checked = READER.continuous; cb.disabled = false; }
      READER.q   = buildQueueFrom(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      READER.idx = 0;
      bindKeepReading(READER.scope);
      updateInlineSpeakBtn();
      setTimeout(()=>{ try{ READER.synth && READER.synth.cancel(); }catch(_){}
        playNextInQueueInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      }, 120);
    }
  }
});

/* === 팝업 편집기 (스크립트 분리 버전) === */
function openSermonEditorWindow(idx){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const it  = arr[idx];
  if(!it){ alert('편집할 설교를 찾을 수 없습니다.'); return; }

  const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const versesRaw = Array.isArray(para?.verses) ? para.verses : [];

  const meta = {
    paraId: CURRENT.paraId,
    idx,
    ref: `${CURRENT.book} ${CURRENT.chap}장 · ${(para?.title || para?.ref || '')} (${para?.ref || ''})`,
    title: it.title || '',
    body:  it.body  || '',
    date:  it.date || '',
    verses: versesRaw
  };

  const w = window.open('', '_blank', 'width=1100,height=820');
  if(!w){ alert('팝업이 차단되었습니다. 브라우저 팝업을 허용해주세요.'); return; }
  w.__WBPS_META__ = meta;
  if (w.opener && w.opener.firebase) { w.firebase = w.opener.firebase; }

  let popupHTML = String.raw`<!DOCTYPE html><html lang="ko">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>설교 편집</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&family=Nanum+Myeongjo&display=swap" rel="stylesheet">
<style>
:root{--bg:#0f1115;--panel:#161922;--text:#e6e8ef;--muted:#9aa0ab;--border:#252a36;--accent:#6ea8fe;--danger:#ff6b6b}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);display:grid;grid-template-rows:56px 1fr 56px;gap:8px}
header,footer{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--border)}
footer{border-top:1px solid var(--border);border-bottom:none}
.grow{flex:1 1 auto}
main{padding:0 12px 12px}

input[type="text"].title-input{
  width: min(90%, 720px);
  background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;
  padding:10px 12px;font-weight:700;font-size:1.14rem;line-height:1.4;letter-spacing:.01em;
}

button{background:color-mix(in hsl,var(--panel) 65%,black 10%);color:var(--text);
border:1px solid var(--border);border-radius:10px;padding:6px 10px;cursor:pointer;transition:border-color .15s,transform .04s}
button:hover{border-color:color-mix(in hsl,var(--border) 75%,var(--accent) 25%)} button:active{transform:translateY(1px)}
.primary{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 78%,white 10%),color-mix(in srgb,var(--accent) 72%,black 22%));border-color:color-mix(in srgb,var(--accent) 70%,black 10%)}
.muted{color:var(--muted)}

.context-editor{font-family:"Noto Serif KR","Nanum Myeong고",serif;font-size:1.05rem;line-height:1.85;letter-spacing:.02em;word-break:keep-all}

.notion-header{display:flex;align-items:center;gap:8px;margin-top:8px}
.notion-header .title{flex:1 1 auto;background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;padding:10px 12px;font-weight:700}
.notion-header .meta{display:flex;gap:8px;align-items:center}
.notion-badge{font-size:11px;color:#9aa0ab}

#editorRoot{max-width:880px;margin:12px auto 8px;padding:0 6px}
.editor-block{position:relative;display:flex;gap:10px;padding:2px 0}
.editor-block .handle{user-select:none;cursor:grab;opacity:.5;padding:2px 0 0 0}
.editor-block .content{flex:1;outline:none;white-space:pre-wrap}
.editor-block[data-type="h1"] .content{font-size:28px;font-weight:800}
.editor-block[data-type="h2"] .content{font-size:24px;font-weight:800}
.editor-block[data-type="h3"] .content{font-size:20px;font-weight:700}
.editor-block[data-type="quote"]{border-left:3px solid #5a6; padding-left:10px; opacity:.95}
.editor-block[data-type="callout"]{background:#3a3f4e33;border:1px solid #444;border-radius:12px;padding:10px}
.editor-block[data-type="code"] .content{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0b0d13;border:1px solid #252a36;border-radius:12px;padding:10px}
.editor-block[data-type="todo"] .content{display:flex;gap:8px}
.editor-block[data-type="divider"] .content{border-bottom:1px solid #333;height:1px}
.editor-block[data-type="toggle"] .content summary{cursor:pointer}
.editor-block .progress{position:absolute;left:0;bottom:-2px;height:2px;background:#6ea8fe;opacity:.9;transition:width .05s linear}

.bubble{position:absolute;padding:6px;border:1px solid #333;border-radius:12px;background:#1c1f2a;display:flex;gap:6px}
.bubble.hidden{display:none}
.bubble button{border:1px solid #333;background:#222;color:#eee;border-radius:8px;padding:2px 6px}

.slash{position:fixed;inset:auto auto 0 0;max-height:260px;overflow:auto;background:#1c1f2a;border:1px solid #333;border-radius:12px;min-width:260px;padding:6px}
.slash.hidden{display:none}
.slash .item{padding:6px 8px;border-radius:8px;display:flex;gap:8px;align-items:center}
.slash .item.active,.slash .item:hover{background:#2a2f3d}

.notion-footer{padding:6px 12px;border-top:1px solid #252a36;background:#161922;position:sticky;bottom:0}
#traceLog{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;max-height:180px;overflow:auto;white-space:pre-wrap}

#floatingBar{
  position: fixed; right: 16px; bottom: 16px; z-index: 50;
  display:flex; gap:8px; align-items:center;
  background: color-mix(in hsl, var(--panel) 85%, black 6%);
  border:1px solid var(--border); border-radius:999px; padding:8px 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
#floatingBar button{ padding:8px 14px; border-radius:999px }

@media print {
  @page { size: A4; margin: 18mm; }
  body{ background:#fff; color:#000; grid-template-rows:0 1fr 0 }
  header, footer, #floatingBar { display:none !important; }
}

/* === 편집기(main) 스크롤 및 겹침 방지 보정 === */
/* body를 3행 그리드(헤더/메인/푸터)로, 메인은 스크롤 가능 */
body{
  display: grid;
  grid-template-rows: 56px 1fr 56px;
  height: 100vh !important;
  overflow: hidden !important;
}

/* main은 스크롤이 가능해야 함 + footer/floatingBar에 가리지 않도록 하단 여백 */
main{
  position: relative;
  z-index: 1;
  overflow-y: auto !important;
  padding-top: 12px;
  padding-bottom: 140px; /* footer 높이 + 여유 */
  height: calc(100vh - 112px) !important; /* 56(header)+56(footer) */
}

/* 편집 영역 자체 여백 확보(아래쪽 충분히 띄워서 겹침 방지) */
#editorRoot{
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 12px auto 100px;  /* 아래 여유 */
  padding: 0 8px 80px;      /* 아래 여유 */
  overflow: visible;
}

/* 플로팅 버튼과의 겹침도 최소화(필요 시) */
#floatingBar{
  z-index: 50;
}
html, body { height:auto !important; overflow:auto !important; }
main { height:auto !important; overflow:visible !important; }

/* === 문장 낭독 하이라이트용 읽기 패널 === */
#readPane{
  position: fixed;
  right: 16px;
  top: 64px;
  bottom: 64px;
  width: 420px;
  overflow-y: auto;
  background: color-mix(in hsl, var(--panel) 92%, black 4%);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: 0 10px 28px rgba(0,0,0,.35);
  display: none;
}
#readPane .sent{
  display: block;
  line-height: 1.8;
  margin: 4px 0;
  padding: 2px 6px;
  border-radius: 8px;
}
#readPane .sent.reading{
  background: #2b3242;
  outline: 1px solid #3b4b7a;
}
</style>
</head>
<body class="context-editor">
<header>
  <strong>설교 편집</strong><span class="muted" id="ref"></span>
  <div class="grow"></div>
  <button id="x">닫기</button>
</header>

<main>
  <input id="t" class="title-input" type="text" autocomplete="off" placeholder="설교 제목을 입력하세요">
  <div class="notion-header">
    <input id="neTitle" class="title" placeholder="제목을 입력하세요" />
    <div class="meta">
      <button id="nePublish" class="primary">게시</button>
      <button id="neStt">🎙 STT</button>
    </div>
  </div>

  <div id="neBubble" class="bubble hidden">
    <button data-mark="bold"><b>B</b></button>
    <button data-mark="italic"><i>I</i></button>
    <button data-mark="underline"><u>U</u></button>
    <button data-mark="strike"><s>S</s></button>
    <button data-mark="code">` + '\\`code\\`' + `</button>
    <button data-mark="highlight">HL</button>
    <button data-action="link">🔗</button>
    <div class="sep" style="width:1px;height:18px;background:#333;margin:0 4px"></div>
    <div class="chips">
      <button class="chip" data-color="#ffffff" title="#ffffff" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#ffffff"></button>
      <button class="chip" data-color="#ffd166" title="#ffd166" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#ffd166"></button>
      <button class="chip" data-color="#ef476f" title="#ef476f" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#ef476f"></button>
      <button class="chip" data-color="#06d6a0" title="#06d6a0" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#06d6a0"></button>
      <button class="chip" data-color="#118ab2" title="#118ab2" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#118ab2"></button>
      <button class="chip" data-color="#9b59b6" title="#9b59b6" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#9b59b6"></button>
    </div>
  </div>

  <div id="neSlash" class="slash hidden"></div>
  <div id="editorRoot" aria-label="Sermon Editor"></div>

  <div id="readPane" aria-label="Reading Sentences"></div>

  <div class="notion-footer">
    <div class="notion-badge" id="neAutosave">자동저장 대기중…</div>
    <details style="margin-top:6px">
      <summary>🎧 Sermon Tracer 로그/타임라인</summary>
      <div id="traceLog"></div>
    </details>
  </div>
</main>

<div id="floatingBar" aria-label="도구 막대">
  <button id="btnInsertBibleFloating" class="primary">성경구절</button>
</div>

<footer>
  <span class="muted" id="date"></span><div class="grow"></div>
  <button id="print">인쇄(A4)</button>
  <button id="read" class="primary">낭독</button>
  <button id="stop">중지</button>
  <button class="danger" id="d">삭제</button>
  <button class="primary" id="s">저장</button>
</footer>
</body>
</html>`;

  // 템플릿 보간 및 </script> 보호
  popupHTML = popupHTML.replaceAll('${', '\\${');
  popupHTML = popupHTML.replaceAll('</script>', '<\\/script>');

  w.document.open();
  w.document.write(popupHTML);
  w.document.close();

  // 팝업 초기화 실행
  initSermonPopup(w);

  // 부모창 메시지 핸들러 (저장/삭제 반영)
  function onMsg(ev){
    const data = ev.data;
    if (!data || !data.type) return;

    if (data.type === 'sermon-save') {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

      arr2[idx] = {
        ...arr2[idx],
        title: data.title,
        body:  data.body,         // 객체(v1) 또는 문자열(구버전) 허용
        body_html: data.body_html ?? arr2[idx]?.body_html, // 있으면 보관
        images: data.images || [],
        date
      };

      map2[CURRENT.paraId] = arr2;
      setSermonMap(map2);
      status('설교가 저장되었습니다.');
      renderSermonList();
      window.removeEventListener('message', onMsg);
    }

  }

  window.addEventListener('message', onMsg);
}

/* ===== 팝업 내부 스크립트 ===== */
function initSermonPopup(win){
  const w = win, d = w.document;

  (function ensureFloatingBar(){
    const d = win.document;
    let fb = d.getElementById('floatingBar');
    if (!fb) {
      fb = d.createElement('div');
      fb.id = 'floatingBar';
      fb.innerHTML = `<button id="btnInsertBibleFloating" class="primary">성경구절</button>`;
      d.body.appendChild(fb);
    }
    const btn = d.getElementById('btnInsertBibleFloating');
    if (btn) {
      btn.removeEventListener('click', insertBiblePrompt);
      btn.addEventListener('click', insertBiblePrompt);
    }
  })();

    // ===== 중복 제목 입력 숨기기(팝업 한정) =====
  (function removeDuplicateTitle() {
    const d = win.document;
    // 현재 사용 중인 제목 입력칸
    const mainTitle = d.getElementById('neTitle');
    if (!mainTitle) return;

    // 예전 제목 input(#t 등)이 있다면 숨김
    const dupCandidates = [
      ...d.querySelectorAll('input#t, input[type="text"].title-input')
    ].filter(el => el !== mainTitle);

    dupCandidates.forEach(el => {
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
    });
  })();

  const $ = id => d.getElementById(id);
  const meta = w.__WBPS_META__ || {};

  $('ref').textContent  = ' — ' + (meta.ref || '');
  $('date').textContent = meta.date ? ('최근 저장: ' + meta.date) : '';

  $('t').value = meta.title || '';
  $('neTitle').value = meta.title || '';

  const N$$= sel => Array.from(d.querySelectorAll(sel));
  const Nuid= () => Math.random().toString(36).slice(2,10);

  const neRoot    = $('editorRoot');
  const neBubble  = $('neBubble');
  const neSlash   = $('neSlash');
  const neAutosave= $('neAutosave');

  const NSTATE = { blocks: [], history: [], cursor: -1, docId: null };

  // runs 문서 수집 유틸: 현재 NSTATE.blocks → { v:1, blocks:[{id,type,text,runs}] }
  function collectRunsDocument(){
    return {
      v: 1,
      blocks: (NSTATE.blocks || []).map(b => ({
        id: b.id,
        type: b.type || 'p',
        text: b.text || '',
        runs: Array.isArray(b.runs) ? b.runs : []
      }))
    };
  }

  function NwrapToggle(inner){
    const parts = String(inner||'').split(/<br\s*\/?>/);
    const first = parts.shift() || '토글 제목';
    const body  = parts.join('<br>');
    return '<details open><summary>'+first+'</summary><div>'+body+'</div></details>';
  }
  function Nescape(s){ const t=d.createElement('div'); t.textContent=String(s); return t.innerHTML; }
  function NindexById(id){ return NSTATE.blocks.findIndex(b=>b.id===id); }
  function NgetType(block){ return block?.dataset?.type || 'p'; }

  // [RUNS] 렌더: runs → HTML로 변환하여 contenteditable에 넣음
  function Nrender(){
    neRoot.innerHTML = '';
    for (const b of NSTATE.blocks){
      const el = d.createElement('div');
      el.className = 'editor-block';
      el.dataset.id = b.id;
      el.dataset.type = b.type || 'p';

      if (b.type === 'divider'){
        el.innerHTML = `<div class="handle">⋮⋮</div><div class="content"><hr></div><div class="progress" style="width:0"></div>`;
      } else {
        const html = runsToHtml(b.text||'', b.runs||[]);
        el.innerHTML = `
          <div class="handle">⋮⋮</div>
          <div class="content" contenteditable="true">${html}</div>
          <div class="progress" style="width:0"></div>
        `;
      }
      neRoot.appendChild(el);
    }
    NbindBlockEvents();
  }

  function initBlocksFromMeta(meta){
    // ① runs 우선
    if (meta?.body && typeof meta.body === 'object' && meta.body.v === 1 && Array.isArray(meta.body.blocks)) {
      NSTATE.blocks = meta.body.blocks.map(b => ({
        id: b.id || Nuid(),
        type: b.type || 'p',
        text: b.text || '',
        runs: Array.isArray(b.runs) ? b.runs : []
      }));
      return;
    }
    // ② body_html 있으면 그걸 사용
    if (typeof meta?.body_html === 'string' && meta.body_html.trim()) {
      const { blocks } = htmlToRuns(meta.body_html);
      NSTATE.blocks = blocks;
      return;
    }
    // ③ 구 body(문자열) 폴백
    const legacy = (typeof meta?.body === 'string') ? meta.body : '';
    const { blocks } = htmlToRuns(legacy);
    NSTATE.blocks = blocks.length ? blocks : [{ id: Nuid(), type:'p', text:'', runs:[] }];
  }

  function NsaveBlockHTML(block){
    const i = NindexById(block.dataset.id);
    if(i<0) return;
    const content = block.querySelector('.content');
    NSTATE.blocks[i].html = content.innerHTML;
  }

  // 새 runs 저장을 "덧대기"
  function NsaveBlockRuns(block){
    const idx = NindexById(block.dataset.id);
    if (idx < 0) return;
    const html = block.querySelector('.content')?.innerHTML || '';
    const { text, runs } = htmlToRuns(html);
    NSTATE.blocks[idx].text = text;
    NSTATE.blocks[idx].runs = runs;
  }

  // (신규) HTML → Runs로 변환해 저장
  function NsaveBlock(block){
    const idx = NindexById(block.dataset.id);
    if (idx < 0) return;

    // 구분선(divider)은 내용 없음
    const type = block.dataset.type || 'p';
    if (type === 'divider') return;

    const html = block.querySelector('.content')?.innerHTML || '';
    const { text, runs } = htmlToRuns(html); // ← 상단 Runs 유틸 사용
    NSTATE.blocks[idx].type = type;          // type 유지
    NSTATE.blocks[idx].text = text;          // 본문 텍스트
    NSTATE.blocks[idx].runs = runs;          // 서식 Runs
    // ※ 필요 시 과거 'html' 필드는 제거해도 됩니다.
  }


  function NsplitBlock(block){
    const i = NindexById(block.dataset.id); if(i<0) return;
    const sel = w.getSelection(); if(!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const html = block.querySelector('.content')?.innerHTML || '';
    // 현재 블록 전체를 Runs로 파싱한 뒤, caret 기준으로 앞/뒤를 텍스트로 나눕니다.
    const { text, runs } = htmlToRuns(html);

    // 텍스트 기준 오프셋(이미 계산된 off)을 사용해 앞/뒤 텍스트를 자릅니다.
    const preText  = (text || '').slice(0, off);
    const postText = (text || '').slice(off);

    // 주의: runs는 범위 분할이 필요하지만, 간단 구현으로는 "양쪽 모두 서식 제거"로 시작해도 OK.
    // (완벽 split이 필요하면 runs를 앞/뒤로 잘라서 s/e 재계산 로직을 추가하세요.)
    NSTATE.blocks[i].text = preText;
    NSTATE.blocks[i].runs = []; // 간이: 앞쪽 서식 제거

    NSTATE.blocks.splice(i+1, 0, {
      id: Nuid(),
      type: 'p',
      text: postText,
      runs: [] // 간이: 뒤쪽 서식 제거
    });

    Nrender();
    NscheduleAutosave();

    const next = neRoot.querySelector(`.editor-block[data-id="${NSTATE.blocks[i+1].id}"] .content`);
    if(next) { next.focus(); const rr=d.createRange(); rr.selectNodeContents(next); rr.collapse(false); const ss=w.getSelection(); ss.removeAllRanges(); ss.addRange(rr); }
    NpushHistory();
  }

  function NbindBlockEvents(){
    N$$('.editor-block').forEach(block =>{
      const content = block.querySelector('.content');

      content.addEventListener('keydown', e=>{
        if(e.key==='/' && !e.shiftKey){ NshowSlash(block); return; }
        if(e.key==='Enter'){
          if(NgetType(block)==='code') return;
          e.preventDefault(); NsplitBlock(block);
        }
        if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){ e.preventDefault(); Nundo(); }
        if(((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='z')||((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y')){ e.preventDefault(); Nredo(); }
      });

      // 이벤트에는 둘 다 적용 (기존 기능 보존)
      content.addEventListener('input', ()=>{
        NsaveBlockHTML(block);   // 구방식 유지
        NsaveBlockRuns(block);   // 신방식 추가
        NscheduleAutosave();
      });

      content.addEventListener('mouseup', NshowBubbleMaybe);
      content.addEventListener('keyup',   NshowBubbleMaybe);
    });

    N$$('.editor-block .handle').forEach(h=>{
      h.addEventListener('click',()=>{
        const block = h.closest('.editor-block');
        const idx = NindexById(block.dataset.id);
        if(idx<=0) return;
        const t = NSTATE.blocks[idx]; NSTATE.blocks[idx]=NSTATE.blocks[idx-1]; NSTATE.blocks[idx-1]=t;
        Nrender(); NscheduleAutosave();
      });
    });
  }

  function NshowBubbleMaybe(){
    const sel = w.getSelection();
    if(!sel || sel.isCollapsed){ neBubble.classList.add('hidden'); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    neBubble.style.left = (rect.left + w.scrollX) + 'px';
    neBubble.style.top  = (rect.top  + w.scrollY - 42) + 'px';
    neBubble.classList.remove('hidden');
  }
  neBubble.addEventListener('mousedown', e=> e.preventDefault());
  neBubble.addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const mark = btn.dataset.mark; const act = btn.dataset.action;
    const color = btn.dataset.color;
    if(mark){
      d.execCommand(mark==='highlight'?'backColor':mark, false, mark==='highlight'? '#6655007a': null);
    } else if(act==='link'){
      const url = w.prompt('링크 URL'); if(url) d.execCommand('createLink', false, url);
      
나의 말:
/* --------- Utils --------- */
const AI_ENDPOINT = 'http://localhost:5174/api/unit-context';
const el = id => document.getElementById(id);
const treeEl = el('tree'), statusEl = el('status');
function status(msg){ statusEl.textContent = msg; }
function escapeHtml(s){ return (s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function stripBlankLines(s){return String(s||'').split(/\r?\n/).filter(l=>l.trim()!=='').join('\n');}

function syncCurrentFromOpen(){
  const openPara = treeEl.querySelector('details.para[open]');
  if(!openPara) return false;
  const t = openPara.querySelector('summary .ptitle');
  if(!t) return false;
  const book = t.dataset.book;
  const chap = parseInt(t.dataset.ch, 10);
  const idx  = parseInt(t.dataset.idx, 10);
  const para = BIBLE?.books?.[book]?.[chap]?.paras?.[idx];
  if(!para) return false;
  CURRENT.book   = book;
  CURRENT.chap   = chap;
  CURRENT.paraIdx= idx;
  CURRENT.paraId = ${book}|${chap}|${para.ref};
  return true;
}

// 제목 변경 반영
function updateParaTitle(book, chap, idx, newTitle){
  try{
    const para = BIBLE?.books?.[book]?.[chap]?.paras?.[idx];
    if(!para) return;
    para.title = newTitle;
    const s = document.querySelector(
      summary .ptitle[data-book="${CSS.escape(String(book))}"][data-ch="${CSS.escape(String(chap))}"][data-idx="${CSS.escape(String(idx))}"]
    );
    if(s) s.textContent = newTitle;
  }catch(_){}
}

// JSON 다운로드
function downloadBibleJSON(){
  if(!BIBLE){ alert('BIBLE 데이터가 없습니다.'); return; }
  const blob = new Blob([JSON.stringify(BIBLE, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bible-paragraphs.json';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  status('수정된 JSON을 다운로드했습니다.');
}

/* ==== 전체 데이터 백업/복원 ==== */
const STORAGE_SERMON      = 'wbps.sermons.v4';
const STORAGE_UNIT_CTX    = 'wbps.ctx.unit.v1';
const STORAGE_WHOLE_CTX   = 'wbps.ctx.whole.v1';
const STORAGE_COMMENTARY  = 'wbps.ctx.comm.v1';
const STORAGE_SUMMARY     = 'wbps.ctx.summary.v1';
const VOICE_CHOICE_KEY    = 'wbps.tts.choice.v2';

function todayStr(){
  const d=new Date();
  return ${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')};
}
function exportAllData(){
  const keys = [STORAGE_SERMON, STORAGE_UNIT_CTX, STORAGE_WHOLE_CTX, STORAGE_COMMENTARY, STORAGE_SUMMARY, VOICE_CHOICE_KEY];
  const payload = { __wbps:1, date: todayStr(), items:{} };
  keys.forEach(k=> payload.items[k] = localStorage.getItem(k) ?? null);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  const ts = new Date();
  const tss = ${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}-${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')};
  a.href = URL.createObjectURL(blob);
  a.download = wbps-backup-${tss}.json;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  status('전체 데이터를 내보냈습니다.');
}
async function importAllData(file){
  try{
    const text = await file.text();
    const json = JSON.parse(text);
    if(!json || json.__wbps!==1 || !json.items){ alert('백업 파일 형식이 아닙니다.'); return; }
    if(!confirm('이 백업으로 현재 기기의 데이터를 덮어쓸까요?')) return;
    Object.entries(json.items).forEach(([k,v])=>{
      if(v===null || v===undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    });
    status('가져오기가 완료되었습니다. 페이지를 새로고침하면 반영됩니다.');
  }catch(e){
    console.error(e);
    alert('가져오기 중 오류가 발생했습니다.');
  }
}

/* --------- Refs / State --------- */
const voiceSelect = el('voiceSelect'), testVoiceBtn = el('testVoice');
const rateCtl = el('rateCtl'), pitchCtl = el('pitchCtl'), voiceHint = el('voiceHint');
const modalWrap = el('modalWrap'), modalRef = el('modalRef');
const sermonList = el('sermonList'), sermonEditor = el('sermonEditor');
const sermonTitle = el('sermonTitle'), sermonBody = el('sermonBody');
const editorSpeakBtn = el('editorSpeak');
const modalFooterNew = el('modalFooterNew');

let BIBLE = null;
let CURRENT = { book:null, chap:null, paraIdx:null, paraId:null };
let READER = { playing:false, q:[], idx:0, synth:window.speechSynthesis||null, scope:null, btn:null, continuous:false };
let EDITOR_READER = { playing:false, u:null, synth:window.speechSynthesis||null };

/* --------- Boot --------- */
(async function boot(){
  try{
    BIBLE = await tryFetchJSON('bible-paragraph.json');
  }catch(_){
    try{ BIBLE = await tryFetchJSON('bible_paragraphs.json'); }
    catch(e){ status('bible-paragraph.json을 찾을 수 없습니다. 같은 폴더에 두고 다시 열어주세요.'); return; }
  }
  buildTree();
  ensureSermonButtons();   // 🔧 설교 버튼 누락 시 보강
  status('불러오기 완료. 66권 트리가 활성화되었습니다.');
  await setupVoices();
})();

(function bindButtons(){
  el('btnSaveJSON')?.addEventListener('click', downloadBibleJSON);
  const btnExport = el('btnExportAll');
  const btnImport = el('btnImportAll');
  const fileInput = el('importFile');
  if (btnExport) btnExport.onclick = exportAllData;
  if (btnImport) btnImport.onclick = ()=> fileInput && fileInput.click();
  if (fileInput) fileInput.addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    importAllData(f).finally(()=>{ e.target.value=''; });
  });
})();

async function tryFetchJSON(path){ const res = await fetch(path, {cache:'no-store'}); if(!res.ok) throw 0; return await res.json(); }

/* --------- Voice --------- */
function waitForVoices(timeout=1500){
  return new Promise(resolve=>{
    const have = speechSynthesis.getVoices?.();
    if (have && have.length) return resolve(have);
    const t = setTimeout(()=> resolve(speechSynthesis.getVoices?.()||[]), timeout);
    speechSynthesis.onvoiceschanged = ()=>{ clearTimeout(t); resolve(speechSynthesis.getVoices?.()||[]); };
  });
}
function getKoreanVoices(all){
  return (all||[]).filter(v=>{
    const n=(v.name||'').toLowerCase(), l=(v.lang||'').toLowerCase();
    return l.startsWith('ko') || n.includes('korean') || n.includes('한국') || n.includes('korea');
  });
}
function presetsForSingleVoice(){
  return [
    {id:'preset-soft-low',  label:'프리셋 · 저음/느림',   rate:0.85, pitch:0.85},
    {id:'preset-soft-high', label:'프리셋 · 고음/느림',   rate:0.90, pitch:1.20},
    {id:'preset-fast',      label:'프리셋 · 빠름',       rate:1.20, pitch:1.05},
    {id:'preset-bright',    label:'프리셋 · 밝게',       rate:1.05, pitch:1.25},
    {id:'preset-radio',     label:'프리셋 · 라디오톤',   rate:1.00, pitch:0.90},
    {id:'preset-reading',   label:'프리셋 · 낭독체',     rate:0.95, pitch:1.00},
  ];
}
async function setupVoices(){
  const all = await waitForVoices();
  const kos = getKoreanVoices(all);

  voiceSelect.innerHTML = '';
  const def = document.createElement('option');
  def.value = JSON.stringify({type:'default'});
  def.textContent = '브라우저 기본(ko-KR)';
  voiceSelect.appendChild(def);

  if(kos.length > 0){
    const og = document.createElement('optgroup'); og.label = '한국어 보이스';
    kos.forEach(v=>{
      const opt = document.createElement('option');
      opt.value = JSON.stringify({type:'voice', uri:v.voiceURI});
      opt.textContent = ${v.name} — ${v.lang}${v.localService ? ' (로컬)' : ''};
      og.appendChild(opt);
    });
    voiceSelect.appendChild(og);
  }
  if(kos.length <= 1){
    const pg = document.createElement('optgroup'); pg.label = '스타일 프리셋';
    presetsForSingleVoice().forEach(p=>{
      const opt = document.createElement('option');
      opt.value = JSON.stringify({type:'preset', rate:p.rate, pitch:p.pitch});
      opt.textContent = p.label;
      pg.appendChild(opt);
    });
    voiceHint.style.display = '';
  } else {
    voiceHint.style.display = 'none';
  }

  const saved = localStorage.getItem(VOICE_CHOICE_KEY);
  if(saved){
    const idx = [...voiceSelect.options].findIndex(o=>o.value===saved);
    if(idx>=0) voiceSelect.selectedIndex = idx;
  } else {
    localStorage.setItem(VOICE_CHOICE_KEY, voiceSelect.value);
  }
  voiceSelect.addEventListener('change', ()=> localStorage.setItem(VOICE_CHOICE_KEY, voiceSelect.value));
  testVoiceBtn.onclick = ()=> speakSample('태초에 하나님이 천지를 창조하시니라.');
}
function resolveVoiceChoice(){
  try{ return JSON.parse(localStorage.getItem(VOICE_CHOICE_KEY)||'{"type":"default"}'); }
  catch{ return {type:'default'}; }
}
function pickVoiceByURI(uri){ return (speechSynthesis.getVoices?.()||[]).find(v=>v.voiceURI===uri) || null; }
function applyVoice(u){
  const choice = resolveVoiceChoice();
  const baseRate = parseFloat(rateCtl.value||'0.95');
  const basePitch = parseFloat(pitchCtl.value||'1');
  if(choice.type==='voice'){
    const v = pickVoiceByURI(choice.uri);
    if(v){ u.voice = v; u.lang = v.lang; } else { u.lang = 'ko-KR'; }
    u.rate = baseRate; u.pitch = basePitch;
  } else if(choice.type==='preset'){
    u.lang = 'ko-KR';
    u.rate = clamp((choice.rate ?? 0.95) * baseRate / 0.95, 0.5, 2);
    u.pitch = clamp((choice.pitch ?? 1.0) * basePitch / 1.0, 0, 2);
  } else {
    u.lang = 'ko-KR'; u.rate = baseRate; u.pitch = basePitch;
  }
}
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function speakSample(text){
  const synth = window.speechSynthesis;
  try{ synth.cancel(); }catch(e){}
  const u = new SpeechSynthesisUtterance(text);
  applyVoice(u);
  synth.speak(u);
}

/* --------- Tree --------- */
function buildTree(){
  treeEl.innerHTML = '';
  if(!BIBLE){ treeEl.innerHTML = '<div class="muted">파일을 찾을 수 없습니다.</div>'; return; }

  for(const bookName of Object.keys(BIBLE.books)){
    const detBook = document.createElement('details');
    const sumBook = document.createElement('summary');
    sumBook.innerHTML = <span class="tw">${escapeHtml(bookName)}</span>;
    detBook.appendChild(sumBook);

    const chWrap = document.createElement('div'); chWrap.className='chapters';
    const chapters = Object.keys(BIBLE.books[bookName]).map(n=>parseInt(n,10)).sort((a,b)=>a-b);

    for(const chap of chapters){
      const detChap = document.createElement('details');
      const sumChap = document.createElement('summary');
      sumChap.innerHTML = <span class="chip">${chap}장</span>;
      detChap.appendChild(sumChap);

      const parWrap = document.createElement('div'); parWrap.className='paras';
      const paras = BIBLE.books[bookName][chap].paras || [];
      paras.forEach((p, idx)=>{
        const detPara = document.createElement('details'); detPara.className='para';

        const m = String(p.ref||'').match(/^(\d+):(\d+)(?:-(\d+))?$/);
        const v1 = m ? m[2] : '?', v2 = m ? (m[3]||m[2]) : '?';
        const titleText = p.title || p.ref;

        const sum = document.createElement('summary');
        sum.innerHTML = 
          <span class="vrange">(${v1}-${v2})</span>
          <span class="ptitle"
                data-book="${bookName}"
                data-ch="${chap}"
                data-idx="${idx}"
                title="제목을 더블클릭하면 편집할 수 있습니다">${escapeHtml(titleText)}</span>
        ;

        const titleEl = sum.querySelector('.ptitle');

        titleEl.addEventListener('dblclick', (e)=>{
          e.preventDefault(); e.stopPropagation();
          detPara.open = true;
          startInlineTitleEdit(titleEl, bookName, chap, idx);
        }, true);

        function guardSummary(ev){
          const isEditing = titleEl.isContentEditable;
          const dblOnTitle = (ev.type === 'dblclick' && ev.target === titleEl);
          if (isEditing || dblOnTitle){
            ev.preventDefault();
            ev.stopPropagation();
          }
        }
        ['pointerdown','mousedown','click','dblclick'].forEach(type=>{
          sum.addEventListener(type, guardSummary, true);
        });

        detPara.appendChild(sum);

        const body = document.createElement('div');
        body.className = 'pbody';
        body.innerHTML = 
          <div class="ptoolbar">
            <button class="primary speakBtn">낭독</button>
            <label class="chip"><input type="checkbox" class="keepReading" style="margin-right:6px">계속 낭독</label>
            <button class="ctxBtn btnSummary">내용흐름</button>
            <button class="ctxBtn btnUnitCtx">단위성경속 맥락</button>
            <button class="ctxBtn btnWholeCtx">전체성경속 맥락</button>
            <button class="ctxBtn btnCommentary">주석</button>
            <button class="sermBtn">설교</button>
            <div class="spacer"></div>
          </div>
          <div class="pcontent"></div>;

        // [PATCH 1 START] 설교 버튼 생성/가시성만 보강 (클릭 바인딩 없음)
        (function ensureSermonBtn(){
          const tb = body.querySelector('.ptoolbar');
          if (!tb) return;

          if (!tb.querySelector('.spacer')) {
            const sp = document.createElement('div');
            sp.className = 'spacer';
            tb.appendChild(sp);
          }
          let sermBtn = tb.querySelector('.sermBtn');
          if (!sermBtn) {
            sermBtn = document.createElement('button');
            sermBtn.className = 'sermBtn';
            sermBtn.textContent = '설교';
            tb.appendChild(sermBtn);
          }
        })();
        // [PATCH 1 END]

        detPara.appendChild(body);

        const pcontent = body.querySelector('.pcontent');
        (p.verses||[]).forEach(([v,t])=>{
          const line = document.createElement('div');
          line.className = 'pline';
          line.dataset.verse = v;
          line.innerHTML = <sup class="pv">${v}</sup>${t};
          pcontent.appendChild(line);
        });

        detPara.addEventListener('toggle', ()=>{
          if(detPara.open){
            CURRENT.book = bookName; CURRENT.chap = chap; CURRENT.paraIdx = idx;
            const para = BIBLE.books[bookName][chap].paras[idx];
            CURRENT.paraId = ${bookName}|${chap}|${para.ref};
            status(선택됨: ${bookName} ${chap}장 · ${para.title||para.ref});
            // 열릴 때 설교 버튼 누락 시 즉시 생성 (클릭 바인딩 없음)
            const tb = detPara.querySelector('.ptoolbar');
            if (tb && !tb.querySelector('.sermBtn')) {
              const btn = document.createElement('button');
              btn.className = 'sermBtn';
              btn.textContent = '설교';
              tb.appendChild(btn);
            }
          }
        });

        body.querySelector('.speakBtn').addEventListener('click', ()=>{
          toggleSpeakInline(bookName, chap, idx, detPara, body.querySelector('.speakBtn'));
        });

        // 컨텍스트 에디터 버튼들
        body.querySelector('.btnUnitCtx').addEventListener('click', ()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('unit'); });
        body.querySelector('.btnWholeCtx').addEventListener('click',()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('whole'); });
        body.querySelector('.btnCommentary').addEventListener('click',()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('commentary'); });
        body.querySelector('.btnSummary').addEventListener('click',   ()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('summary'); });

        parWrap.appendChild(detPara);
      });

      detChap.appendChild(parWrap);
      chWrap.appendChild(detChap);
    }

    detBook.appendChild(chWrap);
    treeEl.appendChild(detBook);
  }
}

// [PATCH 2 START] 렌더 후에도 설교 버튼 누락 시 자동 보정(클릭 바인딩 없음)
(function sermonBtnWatcher(){
  const root = document.getElementById('tree');
  if (!root) return;

  function fix(tb){
    if (!tb.querySelector('.spacer')) {
      const sp = document.createElement('div');
      sp.className = 'spacer';
      tb.insertBefore(sp, tb.firstChild);
    }
    if (!tb.querySelector('.sermBtn')) {
      const b = document.createElement('button');
      b.className = 'sermBtn';
      b.textContent = '설교';
      tb.appendChild(b);
    }
  }

  function sweep(){
    root.querySelectorAll('details.para .ptoolbar').forEach(fix);
  }

  sweep();
  new MutationObserver(sweep).observe(root, {subtree:true, childList:true});
})();
// [PATCH 2 END]

/* ✅ 트리 렌더 후 설교 버튼이 누락됐을 때 자동 보강(클릭 바인딩 없음) */
function ensureSermonButtons(){
  document.querySelectorAll('#tree details.para .ptoolbar').forEach(tb=>{
    if (tb.querySelector('.sermBtn')) return;

    let spacer = tb.querySelector('.spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'spacer';
      tb.appendChild(spacer);
    }

    const btn = document.createElement('button');
    btn.className = 'sermBtn';
    btn.textContent = '설교';
    tb.appendChild(btn);
  });
}

/* 🔧 트리 위임 클릭 공용 처리 (유일한 클릭 바인딩) */
treeEl.addEventListener('click', (e)=>{
  const isCtxBtn = e.target.closest('.btnSummary, .btnUnitCtx, .btnWholeCtx, .btnCommentary, .sermBtn');
  if (!isCtxBtn) return;

  const paraEl = e.target.closest('details.para');
  const t = paraEl?.querySelector('summary .ptitle');
  if (!paraEl || !t) return;

  CURRENT.book   = t.dataset.book;
  CURRENT.chap   = parseInt(t.dataset.ch, 10);
  CURRENT.paraIdx= parseInt(t.dataset.idx, 10);
  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) return;
  CURRENT.paraId = ${CURRENT.book}|${CURRENT.chap}|${para.ref};

  if (e.target.closest('.btnSummary'))    { openSingleDocEditor('summary');    return; }
  if (e.target.closest('.btnUnitCtx'))    { openSingleDocEditor('unit');       return; }
  if (e.target.closest('.btnWholeCtx'))   { openSingleDocEditor('whole');      return; }
  if (e.target.closest('.btnCommentary')) { openSingleDocEditor('commentary'); return; }
  if (e.target.closest('.sermBtn'))       { openSermonModal();                 return; }
});

/* --------- Inline TTS --------- */
function buildQueueFrom(book, chap, idx){
  const para = BIBLE.books[book][chap].paras[idx];
  return (para.verses||[]).map(([v,t])=>({verse:v, text:t}));
}
function clearReadingHighlight(scope){ [...scope.querySelectorAll('.pline')].forEach(el=> el.classList.remove('reading')); }
function bindKeepReading(scope){
  const cb = scope.querySelector('.keepReading');
  if(!cb) return;
  cb.checked  = READER.continuous;
  cb.disabled = false;
  cb.onchange = ()=>{ READER.continuous = cb.checked; };
}
function speakVerseItemInScope(item, scope, onend){
  if(!READER.synth) return;
  const u = new SpeechSynthesisUtterance(String(item.text));
  applyVoice(u);
  let done = false;
  const safeEnd = ()=>{ if(done) return; done = true; onend(); };
  u.onstart = ()=>{
    clearReadingHighlight(scope);
    const line = scope.querySelector(.pline[data-verse="${item.verse}"]);
    if(line){ line.classList.add('reading'); line.scrollIntoView({block:'center', behavior:'smooth'}); }
    if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
    const base = Math.max(800, Math.round(item.text.length * 65));
    const rate = u.rate || 1;
    const estimate = Math.max(600, Math.round(base / rate)) + 1200;
    READER._wd = setTimeout(safeEnd, estimate);
  };
  u.onend   = safeEnd;
  u.onerror = safeEnd;
  READER.synth.speak(u);
}
function toggleSpeakInline(book, chap, idx, paraDetailsEl, btnEl){
  if(!READER.synth) return alert('이 브라우저는 음성합성을 지원하지 않습니다.');
  const sameScope = READER.playing && READER.scope === paraDetailsEl;
  if(READER.playing && sameScope){ stopSpeakInline(); return; }
  READER.continuous = true;
  READER.q = buildQueueFrom(book, chap, idx);
  READER.idx = 0;
  READER.playing = true;
  READER.scope = paraDetailsEl;
  READER.btn = btnEl;
  try{ READER.synth.cancel(); }catch(e){}
  bindKeepReading(READER.scope);
  updateInlineSpeakBtn();
  playNextInQueueInline(book, chap, idx);
}
function playNextInQueueInline(book, chap, idx){
  if(!READER.playing) return;
  if(READER.idx >= READER.q.length){
    if(READER.continuous && goToNextParagraphInline(book, chap, idx)){
      const nextCb = READER.scope?.querySelector?.('.keepReading');
      if(nextCb){ nextCb.checked = READER.continuous; nextCb.disabled = false; }
      READER.q = buildQueueFrom(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      READER.idx = 0;
      bindKeepReading(READER.scope);
      updateInlineSpeakBtn();
      setTimeout(()=>{ try{ READER.synth.cancel(); }catch(e){} playNextInQueueInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx); }, 120);
      return;
    }
    stopSpeakInline();
    return;
  }
  const item = READER.q[READER.idx];
  speakVerseItemInScope(item, READER.scope, ()=>{ READER.idx++; playNextInQueueInline(book, chap, idx); });
}
function stopSpeakInline(){
  READER.playing = false;
  try{ READER.synth && READER.synth.cancel(); }catch(e){}
  if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
  if(READER.scope){
    const cb = READER.scope.querySelector?.('.keepReading');
    if(cb) cb.disabled = false;
    clearReadingHighlight(READER.scope);
  }
  updateInlineSpeakBtn();
  READER.scope = null; READER.btn = null;
}
function updateInlineSpeakBtn(){ if(READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독'; }

function goToNextParagraphInline(book, chap, idx){
  const chObj = BIBLE.books[book][chap];
  const booksEls = [...treeEl.children];

  const bookNames = Object.keys(BIBLE.books);
  const bIdx = bookNames.indexOf(book);
  const bookEl = booksEls[bIdx];
  if(!bookEl) return false;

  const chaptersEls = bookEl.querySelectorAll(':scope > .chapters > details');
  const chapNums = Object.keys(BIBLE.books[book]).map(n=>parseInt(n,10)).sort((a,b)=>a-b);

  const chPos = chapNums.indexOf(chap);
  const chapEl = chaptersEls[chPos];
  if(!chapEl) return false;

  const paraEls = chapEl.querySelectorAll(':scope > .paras > details.para');

  if (READER.btn) READER.btn.textContent = '낭독';

  if (idx < chObj.paras.length - 1){
    const nextEl = paraEls[idx + 1];
    if(nextEl){
      chapEl.open = true;
      nextEl.open = true;
      CURRENT.book = book;
      CURRENT.chap = chap;
      CURRENT.paraIdx = idx + 1;
      READER.scope = nextEl;
      READER.btn = nextEl.querySelector('.speakBtn');
      if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
      return true;
    }
  }

  if (chPos >= 0 && chPos < chapNums.length - 1){
    const nextChap = chapNums[chPos + 1];
    const nextChapEl = chaptersEls[chPos + 1];
    if(nextChapEl){
      const nextParas = (BIBLE.books[book][nextChap].paras || []);
      if(nextParas.length){
        const nextParaEl = nextChapEl.querySelector(':scope > .paras > details.para');
        nextChapEl.open = true;
        if(nextParaEl) nextParaEl.open = true;

        CURRENT.book = book;
        CURRENT.chap = nextChap;
        CURRENT.paraIdx = 0;

        READER.scope = nextParaEl;
        READER.btn = nextParaEl?.querySelector('.speakBtn') || null;
        if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
        return true;
      }
    }
  }

  const bPos = bIdx;
  if (bPos >= 0 && bPos < bookNames.length - 1){
    const nextBook = bookNames[bPos + 1];
    const nextBookEl = booksEls[bPos + 1];
    if(nextBookEl){
      const firstChap = Math.min(...Object.keys(BIBLE.books[nextBook]).map(n=>parseInt(n,10)));
      const nextChapEl = nextBookEl.querySelector(':scope > .chapters > details');
      const nextParaEl = nextChapEl?.querySelector(':scope > .paras > details.para');
      if(nextParaEl){
        nextBookEl.open = true;
        nextChapEl.open = true;
        nextParaEl.open = true;

        CURRENT.book = nextBook;
        CURRENT.chap = firstChap;
        CURRENT.paraIdx = 0;

        READER.scope = nextParaEl;
        READER.btn = nextParaEl.querySelector('.speakBtn');
        if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
        return true;
      }
    }
  }
  return false;
}

/* --------- Sermon / Context Editors --------- */
function getSermonMap(){ try{ return JSON.parse(localStorage.getItem(STORAGE_SERMON)||'{}'); }catch{ return {}; } }
function setSermonMap(o){ localStorage.setItem(STORAGE_SERMON, JSON.stringify(o)); }
function getDocMap(storageKey){ try{ return JSON.parse(localStorage.getItem(storageKey)||'{}'); }catch{ return {}; } }
function setDocMap(storageKey, obj){ localStorage.setItem(storageKey, JSON.stringify(obj)); }

/* ✅ 최초 클릭 시에도 동작하도록 보강 + 중복편집기 제거 전제 */
function openSermonModal(){
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) {
      alert('단락을 먼저 선택해 주세요.');
      return;
    }
  }

  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) {
    alert('선택한 단락을 찾을 수 없습니다.');
    return;
  }
  CURRENT.paraId = ${CURRENT.book}|${CURRENT.chap}|${para.ref};

  document.getElementById('modalTitle').textContent = '단락 성경';
  sermonEditor.dataset.ctxType = '';
  sermonEditor.dataset.editing = '';
  modalRef.textContent = ${CURRENT.book} ${CURRENT.chap}장 · ${para.title || para.ref} (${para.ref});

  sermonList.innerHTML = '';
  sermonEditor.style.display = 'none';
  sermonEditor.classList.add('context-editor');
  modalWrap.style.display = 'flex';
  modalWrap.setAttribute('aria-hidden','false');
  modalFooterNew.style.display = '';

  renderSermonList();
}
el('closeModal').onclick = ()=>{ modalWrap.style.display='none'; modalWrap.setAttribute('aria-hidden','true'); stopEditorSpeak(true); };

function openSingleDocEditor(kind){
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) { alert('단락을 먼저 선택해 주세요.'); return; }
  }
  if (!BIBLE) { alert('성경 데이터가 로드되지 않았습니다.'); return; }

  const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const pid  = ${CURRENT.book}|${CURRENT.chap}|${para.ref};

  const titlePrefix =
    kind==='unit'       ? '단위성경속 맥락' :
    kind==='whole'      ? '전체성경속 맥락' :
    kind==='commentary' ? '주석' :
                           '내용요약';

  const key =
    kind==='unit'       ? STORAGE_UNIT_CTX :
    kind==='whole'      ? STORAGE_WHOLE_CTX :
    kind==='commentary' ? STORAGE_COMMENTARY :
                           STORAGE_SUMMARY;

  const map = getDocMap(key);
  const doc = map[pid] || {
    body:  (kind==='summary' ? '핵심 내용을 간결하게 요약해 적어주세요.' : ''),
    images: [], date:''
  };
  modalRef.textContent = ${CURRENT.book} ${CURRENT.chap}장 · ${para.title||para.ref} (${para.ref}) — ${titlePrefix};
  sermonList.innerHTML = '';
  sermonEditor.style.display = '';
  sermonEditor.classList.add('context-editor');
  modalWrap.style.display = 'flex';
  modalWrap.setAttribute('aria-hidden','false');
  modalFooterNew.style.display = 'none';

  sermonTitle.value = doc.title || '';
  setBodyHTML(doc.body || '');

  sermonEditor.dataset.editing = '';
  sermonEditor.dataset.ctxType = kind;

  const aiBtn = document.getElementById('aiFill');
  if (aiBtn) {
    aiBtn.style.display = (kind === 'unit') ? '' : 'none';
    aiBtn.onclick = null;
    if (kind === 'unit') {
      aiBtn.onclick = async ()=>{ /* 선택: AI 핸들러 */ };
    }
  }
}

/* ✅ 설교목록 렌더링 */
/* ✅ 설교목록 렌더링 (제목 → 날짜 → 링크 → 편집 → 삭제 순서) */
function renderSermonList(){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  sermonList.innerHTML = '';

  if(arr.length===0){
    startNewSermon();
    return;
  }

  arr.forEach((it, idx)=>{
    const row = document.createElement('div');
    row.className = 'item'; // 필요시 레이아웃용 CSS를 추가할 수 있어요.

    // 1) 제목
    const colTitle = document.createElement('div');
    colTitle.className = 'col col-title';
    colTitle.textContent = (it.title || '(제목 없음)');

    // 2) 작성날짜
    const colDate = document.createElement('div');
    colDate.className = 'col col-date';
    colDate.textContent = (it.date || '');

    // 3) 링크 (입력 + 미리보기 앵커)
    const colLink = document.createElement('div');
    colLink.className = 'col col-link';

    const linkInput = document.createElement('input');
    linkInput.type = 'url';
    linkInput.placeholder = '링크(URL)';
    linkInput.value = it.link || '';
    linkInput.style.minWidth = '220px';

    const linkAnchor = document.createElement('a');
    linkAnchor.textContent = it.link ? it.link : '';
    if (it.link) {
      linkAnchor.href = it.link;
      linkAnchor.target = '_blank';
      linkAnchor.rel = 'noopener noreferrer';
    } else {
      linkAnchor.style.display = 'none';
    }

    linkInput.addEventListener('change', ()=>{
      const url = linkInput.value.trim();
      const m = getSermonMap();
      const a = m[CURRENT.paraId] || [];
      if (a[idx]) {
        a[idx].link = url;
        setSermonMap(m);
      }
      if (url){
        linkAnchor.href = url;
        linkAnchor.textContent = url;
        linkAnchor.style.display = '';
        linkAnchor.target = '_blank';
        linkAnchor.rel = 'noopener noreferrer';
      } else {
        linkAnchor.removeAttribute('href');
        linkAnchor.textContent = '';
        linkAnchor.style.display = 'none';
      }
    });

    colLink.appendChild(linkInput);
    colLink.appendChild(linkAnchor);

    // 4) 편집 버튼
    const btnEdit = document.createElement('button');
    btnEdit.textContent = '편집';
    btnEdit.addEventListener('click', ()=>{
      modalWrap.style.display = 'none';
      modalWrap.setAttribute('aria-hidden','true');
      openSermonEditorWindow(idx);
    });

    // 5) 삭제 버튼
    const btnDel = document.createElement('button');
    btnDel.textContent = '삭제';
    btnDel.style.borderColor = 'var(--danger)';
    btnDel.addEventListener('click', ()=>{
      if(!confirm('이 설교를 삭제할까요?')) return;
      const m = getSermonMap();
      const a = m[CURRENT.paraId] || [];
      a.splice(idx,1);
      m[CURRENT.paraId] = a;
      setSermonMap(m);
      renderSermonList();
    });

    const colActions = document.createElement('div');
    colActions.className = 'col col-actions';
    colActions.appendChild(btnEdit);
    colActions.appendChild(btnDel);

    // 👉 순서대로 추가: 제목 → 날짜 → 링크 → 편집/삭제
    row.appendChild(colTitle);
    row.appendChild(colDate);
    row.appendChild(colLink);
    row.appendChild(colActions);

    sermonList.appendChild(row);
  });
}

/* 새 설교 */
el('newSermonBtn').onclick = ()=>{
  sermonEditor.dataset.ctxType = '';
  if (!CURRENT.paraId) {
    if (!syncCurrentFromOpen()) { alert('단락을 먼저 선택하세요.'); return; }
    const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
    CURRENT.paraId = ${CURRENT.book}|${CURRENT.chap}|${para.ref};
  }
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const newId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  arr.unshift({ id: newId, title:'', body:'', images:[], date:'', link:'' });
  map[CURRENT.paraId] = arr;
  setSermonMap(map);

  modalWrap.style.display='none';
  modalWrap.setAttribute('aria-hidden','true');
  openSermonEditorWindow(0);
};

function startNewSermon(){
  sermonList.innerHTML = '<div class="muted" style="padding:0 14px">새 설교를 작성해 저장하면 이 단락에 붙습니다.</div>';
  sermonEditor.classList.add('context-editor');
  sermonEditor.style.display = '';
  sermonTitle.value = '';
  setBodyHTML('');
  sermonEditor.dataset.editing = '';
  stopEditorSpeak(true);
}
function deleteSermon(idx){
  if(!confirm('이 설교를 삭제할까요?')) return;
  const map = getSermonMap(); const arr = map[CURRENT.paraId] || [];
  arr.splice(idx,1); map[CURRENT.paraId] = arr; setSermonMap(map); renderSermonList();
}

el('cancelEdit')?.addEventListener('click', ()=>{
  if(sermonEditor.dataset.ctxType){
    sermonEditor.dataset.ctxType = '';
    modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
  }else{
    sermonEditor.style.display = 'none'; renderSermonList();
  }
  stopEditorSpeak(true);
});

el('saveSermon').onclick = ()=>{
  const title = (sermonTitle.value||'').trim() || '(제목 없음)';
  let body = getBodyHTML() || '';
  body = body.replace(/^\s+|\s+$/g, '');

  const imgs  = [];
  const now   = new Date();
  const date  = ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')};

  const para  = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const pid   = ${CURRENT.book}|${CURRENT.chap}|${para.ref};
  const ctxType = sermonEditor.dataset.ctxType || '';

  if(ctxType){
    const key = ctxType==='unit'       ? STORAGE_UNIT_CTX
              : ctxType==='whole'      ? STORAGE_WHOLE_CTX
              : ctxType==='commentary' ? STORAGE_COMMENTARY
              :                          STORAGE_SUMMARY;
    const map = getDocMap(key);
    map[pid] = { title, body, images: imgs, date };
    setDocMap(key, map);

    sermonEditor.dataset.ctxType = '';
    sermonEditor.classList.remove('context-editor');
    modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
    status(저장됨: ${title});
    return;
  }

  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const editing = sermonEditor.dataset.editing;
  if(editing!==''){ const i=+editing; if(arr[i]) arr[i] = {...arr[i], title, body, images:imgs, date}; }
  else { arr.unshift({ id: crypto.randomUUID(), title, body, images: imgs, date, link:'' }); }
  map[CURRENT.paraId] = arr; setSermonMap(map);
  sermonEditor.style.display = 'none'; renderSermonList(); status('설교가 저장되었습니다.');
};

/* ===== RTE 유틸 ===== */
function isRTE(){ return sermonBody && sermonBody.getAttribute('contenteditable') === 'true'; }
function getBodyHTML(){ return isRTE() ? sermonBody.innerHTML : (sermonBody.value || ''); }
function setBodyHTML(html){ if(isRTE()) sermonBody.innerHTML = html || ''; else sermonBody.value = html || ''; }

function applyColorImmediateToRTE(hex){
  if(!isRTE()) return;
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0){ sermonBody.focus(); return; }
  const range = sel.getRangeAt(0);
  if(!sermonBody.contains(range.commonAncestorContainer)){ sermonBody.focus(); return; }

  if(range.collapsed){
    const sp = document.createElement('span');
    sp.style.color = hex;
    sp.appendChild(document.createTextNode('\u200B'));
    range.insertNode(sp);
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(sp.firstChild, 1); r.collapse(true);
    sel.addRange(r);
    return;
  }
  document.execCommand('foreColor', false, hex);
}
function execFmt(cmd){
  if(isRTE()){
    sermonBody.focus({preventScroll:true});
    document.execCommand(cmd,false,null);
  }
}

/* --------- Editor TTS --------- */
editorSpeakBtn.onclick = ()=> toggleEditorSpeak();
function toggleEditorSpeak(){
  const tmp = document.createElement('div'); tmp.innerHTML = getBodyHTML();
  tmp.querySelectorAll('sup').forEach(s=> s.textContent='['+s.textContent+'] ');
  const plain = (tmp.textContent||'').replace(/\n{2,}/g,' ').replace(/\s+/g,' ').trim();
  const text = [sermonTitle.value.trim(), plain].filter(Boolean).join('. ');
  if(!EDITOR_READER.synth) return alert('이 브라우저는 음성합성을 지원하지 않습니다.');
  if(EDITOR_READER.playing){ stopEditorSpeak(); return; }

  if(!text){ alert('낭독할 내용이 없습니다.'); return; }
  const u = new SpeechSynthesisUtterance(text.replace(/\n{2,}/g, '. ').replace(/\n/g,' '));
  applyVoice(u); u.onend = ()=> stopEditorSpeak(true);
  EDITOR_READER.u = u; EDITOR_READER.synth.cancel(); EDITOR_READER.synth.speak(u);
  EDITOR_READER.playing = true; editorSpeakBtn.textContent = '중지';
}
function stopEditorSpeak(silent){
  if(EDITOR_READER.synth){ try{ EDITOR_READER.synth.cancel(); }catch(e){} }
  EDITOR_READER.playing = false; EDITOR_READER.u = null;
  if(!silent) status('설교 낭독을 중지했습니다.'); editorSpeakBtn.textContent = '낭독';
}

/* --------- Hotkeys --------- */
window.addEventListener('keydown', (e)=>{
  if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='s'){
    e.preventDefault();
    downloadBibleJSON();
    return;
  }
  if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if(key === 's'){
    e.preventDefault();
    syncCurrentFromOpen();
    const openPara = treeEl.querySelector('details.para[open]');
    if(openPara && CURRENT.book!=null){
      const btn = openPara.querySelector('.speakBtn');
      toggleSpeakInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx, openPara, btn);
    }
    return;
  }
  if(key === 'n'){
    e.preventDefault();
    if(!syncCurrentFromOpen()) return;
    const wasPlaying = !!READER.playing;
    try{ READER.synth && READER.synth.cancel(); }catch(_){}
    if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
    READER.playing = wasPlaying;
    const moved = goToNextParagraphInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
    if(!moved) return;
    if (wasPlaying){
      const cb = READER.scope?.querySelector?.('.keepReading');
      if(cb){ cb.checked = READER.continuous; cb.disabled = false; }
      READER.q   = buildQueueFrom(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      READER.idx = 0;
      bindKeepReading(READER.scope);
      updateInlineSpeakBtn();
      setTimeout(()=>{ try{ READER.synth && READER.synth.cancel(); }catch(_){}
        playNextInQueueInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      }, 120);
    }
  }
});

/* === 팝업 편집기 (스크립트 분리 버전) === */
function openSermonEditorWindow(idx){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const it  = arr[idx];
  if(!it){ alert('편집할 설교를 찾을 수 없습니다.'); return; }

  const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const versesRaw = Array.isArray(para?.verses) ? para.verses : [];

  const meta = {
    paraId: CURRENT.paraId,
    idx,
    ref: ${CURRENT.book} ${CURRENT.chap}장 · ${(para?.title || para?.ref || '')} (${para?.ref || ''}),
    title: it.title || '',
    body:  it.body  || '',
    date:  it.date || '',
    verses: versesRaw
  };

  const w = window.open('', '_blank', 'width=1100,height=820');
  if(!w){ alert('팝업이 차단되었습니다. 브라우저 팝업을 허용해주세요.'); return; }
  w.__WBPS_META__ = meta;
  if (w.opener && w.opener.firebase) { w.firebase = w.opener.firebase; }

  let popupHTML = String.raw<!DOCTYPE html><html lang="ko">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>설교 편집</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&family=Nanum+Myeongjo&display=swap" rel="stylesheet">
<style>
:root{--bg:#0f1115;--panel:#161922;--text:#e6e8ef;--muted:#9aa0ab;--border:#252a36;--accent:#6ea8fe;--danger:#ff6b6b}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);display:grid;grid-template-rows:56px 1fr 56px;gap:8px}
header,footer{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--border)}
footer{border-top:1px solid var(--border);border-bottom:none}
.grow{flex:1 1 auto}
main{padding:0 12px 12px}

input[type="text"].title-input{
  width: min(90%, 720px);
  background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;
  padding:10px 12px;font-weight:700;font-size:1.14rem;line-height:1.4;letter-spacing:.01em;
}

button{background:color-mix(in hsl,var(--panel) 65%,black 10%);color:var(--text);
border:1px solid var(--border);border-radius:10px;padding:6px 10px;cursor:pointer;transition:border-color .15s,transform .04s}
button:hover{border-color:color-mix(in hsl,var(--border) 75%,var(--accent) 25%)} button:active{transform:translateY(1px)}
.primary{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 78%,white 10%),color-mix(in srgb,var(--accent) 72%,black 22%));border-color:color-mix(in srgb,var(--accent) 70%,black 10%)}
.muted{color:var(--muted)}

.context-editor{font-family:"Noto Serif KR","Nanum Myeong고",serif;font-size:1.05rem;line-height:1.85;letter-spacing:.02em;word-break:keep-all}

.notion-header{display:flex;align-items:center;gap:8px;margin-top:8px}
.notion-header .title{flex:1 1 auto;background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;padding:10px 12px;font-weight:700}
.notion-header .meta{display:flex;gap:8px;align-items:center}
.notion-badge{font-size:11px;color:#9aa0ab}

#editorRoot{max-width:880px;margin:12px auto 8px;padding:0 6px}
.editor-block{position:relative;display:flex;gap:10px;padding:2px 0}
.editor-block .handle{user-select:none;cursor:grab;opacity:.5;padding:2px 0 0 0}
.editor-block .content{flex:1;outline:none;white-space:pre-wrap}
.editor-block[data-type="h1"] .content{font-size:28px;font-weight:800}
.editor-block[data-type="h2"] .content{font-size:24px;font-weight:800}
.editor-block[data-type="h3"] .content{font-size:20px;font-weight:700}
.editor-block[data-type="quote"]{border-left:3px solid #5a6; padding-left:10px; opacity:.95}
.editor-block[data-type="callout"]{background:#3a3f4e33;border:1px solid #444;border-radius:12px;padding:10px}
.editor-block[data-type="code"] .content{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0b0d13;border:1px solid #252a36;border-radius:12px;padding:10px}
.editor-block[data-type="todo"] .content{display:flex;gap:8px}
.editor-block[data-type="divider"] .content{border-bottom:1px solid #333;height:1px}
.editor-block[data-type="toggle"] .content summary{cursor:pointer}
.editor-block .progress{position:absolute;left:0;bottom:-2px;height:2px;background:#6ea8fe;opacity:.9;transition:width .05s linear}

.bubble{position:absolute;padding:6px;border:1px solid #333;border-radius:12px;background:#1c1f2a;display:flex;gap:6px}
.bubble.hidden{display:none}
.bubble button{border:1px solid #333;background:#222;color:#eee;border-radius:8px;padding:2px 6px}

.slash{position:fixed;inset:auto auto 0 0;max-height:260px;overflow:auto;background:#1c1f2a;border:1px solid #333;border-radius:12px;min-width:260px;padding:6px}
.slash.hidden{display:none}
.slash .item{padding:6px 8px;border-radius:8px;display:flex;gap:8px;align-items:center}
.slash .item.active,.slash .item:hover{background:#2a2f3d}

.notion-footer{padding:6px 12px;border-top:1px solid #252a36;background:#161922;position:sticky;bottom:0}
#traceLog{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;max-height:180px;overflow:auto;white-space:pre-wrap}

#floatingBar{
  position: fixed; right: 16px; bottom: 16px; z-index: 50;
  display:flex; gap:8px; align-items:center;
  background: color-mix(in hsl, var(--panel) 85%, black 6%);
  border:1px solid var(--border); border-radius:999px; padding:8px 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
#floatingBar button{ padding:8px 14px; border-radius:999px }

@media print {
  @page { size: A4; margin: 18mm; }
  body{ background:#fff; color:#000; grid-template-rows:0 1fr 0 }
  header, footer, #floatingBar { display:none !important; }
}

/* === 편집기(main) 스크롤 및 겹침 방지 보정 === */
/* body를 3행 그리드(헤더/메인/푸터)로, 메인은 스크롤 가능 */
body{
  display: grid;
  grid-template-rows: 56px 1fr 56px;
  height: 100vh !important;
  overflow: hidden !important;
}

/* main은 스크롤이 가능해야 함 + footer/floatingBar에 가리지 않도록 하단 여백 */
main{
  position: relative;
  z-index: 1;
  overflow-y: auto !important;
  padding-top: 12px;
  padding-bottom: 140px; /* footer 높이 + 여유 */
  height: calc(100vh - 112px) !important; /* 56(header)+56(footer) */
}

/* 편집 영역 자체 여백 확보(아래쪽 충분히 띄워서 겹침 방지) */
#editorRoot{
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 12px auto 100px;  /* 아래 여유 */
  padding: 0 8px 80px;      /* 아래 여유 */
  overflow: visible;
}

/* 플로팅 버튼과의 겹침도 최소화(필요 시) */
#floatingBar{
  z-index: 50;
}
html, body { height:auto !important; overflow:auto !important; }
main { height:auto !important; overflow:visible !important; }

/* === 문장 낭독 하이라이트용 읽기 패널 === */
#readPane{
  position: fixed;
  right: 16px;
  top: 64px;
  bottom: 64px;
  width: 420px;
  overflow-y: auto;
  background: color-mix(in hsl, var(--panel) 92%, black 4%);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: 0 10px 28px rgba(0,0,0,.35);
  display: none;
}
#readPane .sent{
  display: block;
  line-height: 1.8;
  margin: 4px 0;
  padding: 2px 6px;
  border-radius: 8px;
}
#readPane .sent.reading{
  background: #2b3242;
  outline: 1px solid #3b4b7a;
}
</style>
</head>
<body class="context-editor">
<header>
  <strong>설교 편집</strong><span class="muted" id="ref"></span>
  <div class="grow"></div>
  <button id="x">닫기</button>
</header>

<main>
  <input id="t" class="title-input" type="text" autocomplete="off" placeholder="설교 제목을 입력하세요">
  <div class="notion-header">
    <input id="neTitle" class="title" placeholder="제목을 입력하세요" />
    <div class="meta">
      <button id="nePublish" class="primary">게시</button>
      <button id="neStt">🎙 STT</button>
    </div>
  </div>

  <div id="neBubble" class="bubble hidden">
    <button data-mark="bold"><b>B</b></button>
    <button data-mark="italic"><i>I</i></button>
    <button data-mark="underline"><u>U</u></button>
    <button data-mark="strike"><s>S</s></button>
    <button data-mark="code"> + '\\code\\' + </button>
    <button data-mark="highlight">HL</button>
    <button data-action="link">🔗</button>
  </div>

  <div id="neSlash" class="slash hidden"></div>
  <div id="editorRoot" aria-label="Sermon Editor"></div>

  <div id="readPane" aria-label="Reading Sentences"></div>

  <div class="notion-footer">
    <div class="notion-badge" id="neAutosave">자동저장 대기중…</div>
    <details style="margin-top:6px">
      <summary>🎧 Sermon Tracer 로그/타임라인</summary>
      <div id="traceLog"></div>
    </details>
  </div>
</main>

<div id="floatingBar" aria-label="도구 막대">
  <button id="btnInsertBibleFloating" class="primary">성경구절</button>
</div>

<footer>
  <span class="muted" id="date"></span><div class="grow"></div>
  <button id="print">인쇄(A4)</button>
  <button id="read" class="primary">낭독</button>
  <button id="stop">중지</button>
  <button class="danger" id="d">삭제</button>
  <button class="primary" id="s">저장</button>
</footer>
</body>
</html>;

  // 템플릿 보간 및 </script> 보호
  popupHTML = popupHTML.replaceAll('${', '\\${');
  popupHTML = popupHTML.replaceAll('</script>', '<\\/script>');

  w.document.open();
  w.document.write(popupHTML);
  w.document.close();

  // 팝업 초기화 실행
  initSermonPopup(w);

  // 부모창 메시지 핸들러 (저장/삭제 반영)
  const onMsg = (ev) => {
    const data = ev?.data || {};
    if (!data.type) return;

    const map2 = getSermonMap();
    const arr2 = map2[CURRENT.paraId] || [];

    if (data.type === 'sermon-save') {
      const now  = new Date();
      const date = ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')};
      if (arr2[idx]) {
        arr2[idx] = { ...arr2[idx], title: data.title, body: data.body, images: [], date };
      }
      map2[CURRENT.paraId] = arr2;
      setSermonMap(map2);
      status('설교가 저장되었습니다.');
      renderSermonList();
      window.removeEventListener('message', onMsg);
    }

    if (data.type === 'sermon-delete') {
      if (arr2[idx]) arr2.splice(idx, 1);
      map2[CURRENT.paraId] = arr2;
      setSermonMap(map2);
      status('설교가 삭제되었습니다.');
      renderSermonList();
      window.removeEventListener('message', onMsg);
    }
  };
  window.addEventListener('message', onMsg);
}

/* ===== 팝업 내부 스크립트 ===== */
function initSermonPopup(win){
  const w = win, d = w.document;

    // ===== 중복 제목 입력 숨기기(팝업 한정) =====
  (function removeDuplicateTitle() {
    const d = win.document;
    // 현재 사용 중인 제목 입력칸
    const mainTitle = d.getElementById('neTitle');
    if (!mainTitle) return;

    // 예전 제목 input(#t 등)이 있다면 숨김
    const dupCandidates = [
      ...d.querySelectorAll('input#t, input[type="text"].title-input')
    ].filter(el => el !== mainTitle);

    dupCandidates.forEach(el => {
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
    });
  })();


  const $ = id => d.getElementById(id);
  const meta = w.__WBPS_META__ || {};

  $('ref').textContent  = ' — ' + (meta.ref || '');
  $('date').textContent = meta.date ? ('최근 저장: ' + meta.date) : '';

  $('t').value = meta.title || '';
  $('neTitle').value = meta.title || '';

  const N$$= sel => Array.from(d.querySelectorAll(sel));
  const Nuid= () => Math.random().toString(36).slice(2,10);

  const neRoot    = $('editorRoot');
  const neBubble  = $('neBubble');
  const neSlash   = $('neSlash');
  const neAutosave= $('neAutosave');

  const NSTATE = { blocks: [], history: [], cursor: -1, docId: null };

  function NwrapToggle(inner){
    const parts = String(inner||'').split(/<br\s*\/?>/);
    const first = parts.shift() || '토글 제목';
    const body  = parts.join('<br>');
    return '<details open><summary>'+first+'</summary><div>'+body+'</div></details>';
  }
  function Nescape(s){ const t=d.createElement('div'); t.textContent=String(s); return t.innerHTML; }
  function NindexById(id){ return NSTATE.blocks.findIndex(b=>b.id===id); }
  function NgetType(block){ return block?.dataset?.type || 'p'; }

  function initBlocksFromHTML(html){
    if(!html || /^\s*$/.test(html)){
      NSTATE.blocks=[{id:Nuid(), type:'p', html:'여기에 설교를 작성하세요.'}];
    }else{
      NSTATE.blocks=[{id:Nuid(), type:'p', html: html}];
    }
  }

  function Nrender(){
    neRoot.innerHTML = '';
    for(const b of NSTATE.blocks){
      const el = d.createElement('div');
      el.className = 'editor-block';
      el.dataset.id = b.id; el.dataset.type = b.type;
      el.innerHTML = 
        <div class="handle">⋮⋮</div>
        <div class="content" contenteditable="true">${b.type==='toggle'? NwrapToggle(b.html) : b.html}</div>
        <div class="progress" style="width:0"></div>
      ;
      neRoot.appendChild(el);
    }
    NbindBlockEvents();
  }

  function NsaveBlockHTML(block){
    const i = NindexById(block.dataset.id);
    if(i<0) return;
    const content = block.querySelector('.content');
    NSTATE.blocks[i].html = content.innerHTML;
  }

  function NsplitBlock(block){
    const i = NindexById(block.dataset.id); if(i<0) return;
    const sel = w.getSelection(); if(!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const text = block.querySelector('.content').textContent || '';
    const off  = range.startOffset;
    const pre  = text.slice(0, off);
    const post = text.slice(off);
    NSTATE.blocks[i].html = Nescape(pre);
    NSTATE.blocks.splice(i+1,0,{id:Nuid(), type:'p', html: Nescape(post||'')});
    Nrender();
    const next = neRoot.querySelector(.editor-block[data-id="${NSTATE.blocks[i+1].id}"] .content);
    if(next) { next.focus(); const rr=d.createRange(); rr.selectNodeContents(next); rr.collapse(false); const ss=w.getSelection(); ss.removeAllRanges(); ss.addRange(rr); }
    NpushHistory();
  }

  function NbindBlockEvents(){
    N$$('.editor-block').forEach(block =>{
      const content = block.querySelector('.content');

      content.addEventListener('keydown', e=>{
        if(e.key==='/' && !e.shiftKey){ NshowSlash(block); return; }
        if(e.key==='Enter'){
          if(NgetType(block)==='code') return;
          e.preventDefault(); NsplitBlock(block);
        }
        if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){ e.preventDefault(); Nundo(); }
        if(((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='z')||((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y')){ e.preventDefault(); Nredo(); }
      });

      content.addEventListener('input', ()=>{ NsaveBlockHTML(block); NscheduleAutosave(); });
      content.addEventListener('mouseup', NshowBubbleMaybe);
      content.addEventListener('keyup',   NshowBubbleMaybe);
    });

    N$$('.editor-block .handle').forEach(h=>{
      h.addEventListener('click',()=>{
        const block = h.closest('.editor-block');
        const idx = NindexById(block.dataset.id);
        if(idx<=0) return;
        const t = NSTATE.blocks[idx]; NSTATE.blocks[idx]=NSTATE.blocks[idx-1]; NSTATE.blocks[idx-1]=t;
        Nrender(); NscheduleAutosave();
      });
    });
  }

  function NshowBubbleMaybe(){
    const sel = w.getSelection();
    if(!sel || sel.isCollapsed){ neBubble.classList.add('hidden'); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    neBubble.style.left = (rect.left + w.scrollX) + 'px';
    neBubble.style.top  = (rect.top  + w.scrollY - 42) + 'px';
    neBubble.classList.remove('hidden');
  }
  neBubble.addEventListener('mousedown', e=> e.preventDefault());
  neBubble.addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const mark = btn.dataset.mark; const act = btn.dataset.action;
    if(mark){
      d.execCommand(mark==='highlight'?'backColor':mark, false, mark==='highlight'? '#6655007a': null);
    } else if(act==='link'){
      const url = w.prompt('링크 URL'); if(url) d.execCommand('createLink', false, url);
    }
    NshowBubbleMaybe(); NscheduleAutosave();
  });

  const N_SLASH = [
    {type:'p', label:'텍스트'},
    {type:'h1', label:'제목 1'},
    {type:'h2', label:'제목 2'},
    {type:'h3', label:'제목 3'},
    {type:'todo', label:'체크리스트'},
    {type:'ul', label:'불릿 리스트'},
    {type:'ol', label:'번호 리스트'},
    {type:'quote', label:'인용'},
    {type:'callout', label:'콜아웃'},
    {type:'divider', label:'구분선'},
    {type:'code', label:'코드 블록'},
    {type:'toggle', label:'토글 블록'},
    {type:'img', label:'이미지(링크)'},
  ];
  let NslashTarget = null;
  function NshowSlash(block){
    NslashTarget = block;
    const rect = block.getBoundingClientRect();
    neSlash.style.left = (rect.left + w.scrollX + 20) + 'px';
    neSlash.style.top  = (rect.top  + w.scrollY + 20) + 'px';
    neSlash.innerHTML = N_SLASH.map((it,i)=><div class="item" data-i="${i}">${it.label}</div>).join('');
    neSlash.classList.remove('hidden');
  }
  neSlash.addEventListener('click', e=>{
    const item = e.target.closest('.item'); if(!item) return;
    const i = +item.dataset.i; NapplySlash(N_SLASH[i]);
    neSlash.classList.add('hidden');
  });
  d.addEventListener('keydown', e=>{ if(e.key==='Escape') neSlash.classList.add('hidden'); });

  function NapplySlash(it){
    if(!NslashTarget) return;
    const id = NslashTarget.dataset.id; const idx = NindexById(id); if(idx<0) return;
    if(it.type==='divider'){
      NSTATE.blocks[idx] = {id, type:'divider', html:''};
    } else if(it.type==='img'){
      const url = w.prompt('이미지 URL'); if(url){ NSTATE.blocks[idx].html = <img src="${url}" style="max-width:100%">; }
    } else if(it.type==='todo'){
      NSTATE.blocks[idx] = {id, type:'todo', html:<input type="checkbox"> 할 일};
    } else if(it.type==='ul' || it.type==='ol'){
      NSTATE.blocks[idx] = {id, type:it.type, html:<${it.type}><li>첫 번째</li></${it.type}>};
    } else if(it.type==='toggle'){
      NSTATE.blocks[idx] = {id, type:'toggle', html:'토글 제목<br>토글 내용'};
    } else {
      NSTATE.blocks[idx].type = it.type;
    }
    Nrender(); NscheduleAutosave();
  }

  function NpushHistory(){ NSTATE.history = NSTATE.history.slice(0, NSTATE.cursor+1); NSTATE.history.push(JSON.stringify(NSTATE.blocks)); NSTATE.cursor = NSTATE.history.length-1; }
  function Nundo(){ if(NSTATE.cursor>0){ NSTATE.cursor--; NSTATE.blocks = JSON.parse(NSTATE.history[NSTATE.cursor]); Nrender(); } }
  function Nredo(){ if(NSTATE.cursor<NSTATE.history.length-1){ NSTATE.cursor++; NSTATE.blocks = JSON.parse(NSTATE.history[NSTATE.cursor]); Nrender(); } }

  function NblocksToHTML(){
    return NSTATE.blocks.map(b=>{
      switch(b.type){
        case 'h1': return <h2>${b.html}</h2>;
        case 'h2': return <h3>${b.html}</h3>;
        case 'h3': return <h4>${b.html}</h4>;
        case 'quote': return <blockquote>${b.html}</blockquote>;
        case 'divider': return '<hr/>';
        default: return <div>${b.html}</div>;
      }
    }).join('');
  }

  let NsaveTimer=null;
  function NscheduleAutosave(){
    clearTimeout(NsaveTimer);
    neAutosave.textContent = '입력 중…';
    NsaveTimer = setTimeout(()=>{
      try{
        const key = wbps.sermon.draft.blocks.${(meta.paraId||'')}.${(meta.idx||0)};
        const payload = { title: ($('neTitle').value||''), blocks:NSTATE.blocks, ts: Date.now() };
        w.localStorage.setItem(key, JSON.stringify(payload));
        neAutosave.textContent = '자동저장됨';
      }catch(_){ neAutosave.textContent = '자동저장 실패(용량)'; }
    }, 500);
  }

  (function Ninit(){
    initBlocksFromHTML(meta.body||'');
    Nrender(); NpushHistory();
    setTimeout(()=>{ const last = d.querySelector('#editorRoot .editor-block:last-child .content'); last && last.focus(); }, 60);
  })();

  // STT
  (function(){
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if(!SR){ console.warn('STT 미지원'); return; }
    const rec = new SR(); rec.lang='ko-KR'; rec.interimResults=true; rec.continuous=true;

    let activeBlock=null, accText='', startedAt=null;
    function getActive(){ const sel=w.getSelection(); const n=sel?.anchorNode; const el=(n?.nodeType===1?n:(n?.parentElement)); return el?.closest?.('.editor-block') || d.querySelector('.editor-block'); }
    function setProgress(block, ratio){ const bar=block?.querySelector('.progress'); if(bar) bar.style.width = Math.max(0,Math.min(100,ratio*100)) + '%'; }
    function plain(html){ const t=d.createElement('div'); t.innerHTML=html||''; return t.textContent||''; }
    function sim(a,b){ a=a.replace(/\s+/g,''); b=b.replace(/\s+/g,''); const L=Math.max(a.length,1); let m=0; for(let i=0;i<Math.min(a.length,b.length);i++){ if(a[i]===b[i]) m++; } return m/L; }
    function nextBlock(block){ const nx = block?.nextElementSibling?.classList.contains('editor-block')? block.nextElementSibling : null; return nx; }

    const neSttBtn = d.getElementById('neStt');
    neSttBtn?.addEventListener('click', ()=>{
      if(neSttBtn.dataset.on==='1'){ rec.stop(); neSttBtn.dataset.on='0'; neSttBtn.textContent='🎙 STT'; return; }
      activeBlock = getActive(); if(!activeBlock){ w.alert('블록을 선택하세요'); return; }
      accText=''; startedAt=Date.now(); rec.start(); neSttBtn.dataset.on='1'; neSttBtn.textContent='⏸ 중지';
    });

    rec.onresult = (ev)=>{
      if(!activeBlock) return;
      const r = ev.results[ev.results.length-1]; const txt=r[0].transcript; const isFinal=r.isFinal;
      accText += (isFinal? txt+' ' : txt);
      const base = plain(activeBlock.querySelector('.content').innerHTML);
      const s = sim(base, accText); setProgress(activeBlock, s);

      const t = ((Date.now()-startedAt)/1000).toFixed(1);
      const neTrace = d.getElementById('traceLog');
      neTrace.textContent += t=${t}s s=${(s*100).toFixed(0)}% : ${txt}\n;
      neTrace.scrollTop = neTrace.scrollHeight;

      if(isFinal && s>0.95){
        const nb = nextBlock(activeBlock);
        if(nb){ activeBlock = nb; accText=''; startedAt=Date.now(); setProgress(nb, 0); }
      }
    };
    rec.onend   = ()=>{ if(neSttBtn.dataset.on==='1'){ rec.start(); } };
    rec.onerror = (e)=> console.warn('STT 오류', e.error);
  })();

  // 게시(Firebase 옵션)
  const nePubBtn = d.getElementById('nePublish');
  nePubBtn?.addEventListener('click', async ()=>{
    try{
      if(typeof w.firebase === 'undefined'){ w.alert('Firebase 미탑재: 게시 기능을 사용하려면 SDK/초기화가 필요합니다.'); return; }
      const user = w.firebase.auth().currentUser;
      if(!user){ w.alert('로그인 후 게시 가능합니다.'); return; }

      const db = w.firebase.firestore();
      const docRef = NSTATE.docId ? db.collection('sermons').doc(NSTATE.docId) : db.collection('sermons').doc();
      const payload = {
        title: (d.getElementById('neTitle').value||'무제'),
        blocks: NSTATE.blocks,
        owner: user.uid,
        updatedAt: w.firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: w.firebase.firestore.FieldValue.serverTimestamp(),
        status: 'published'
      };
      await docRef.set(payload, {merge:true});
      NSTATE.docId = docRef.id;
      const url = w.location.origin + '/viewer.html?id=' + docRef.id;
      w.alert('게시 완료!\n' + url);
    }catch(err){ console.error(err); w.alert('게시 실패: '+err.message); }
  });

  // 성경구절 삽입
  d.getElementById('btnInsertBibleFloating')?.addEventListener('click', insertBiblePrompt);
  async function insertBiblePrompt(){
    const raw = w.prompt('삽입할 성경구절 (예: 요 3:16, 창세기 1:1-3)');
    if(!raw) return;
    const norm=String(raw).replace(/\s+/g,' ').replace(/[–—－]/g,'-').replace(/[：]/g,':').trim();
    const m=norm.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?$/);
    if(!m){ w.alert('형식: 성경이름 장:절 또는 장:절-절'); return; }
    const bookRaw=m[1], chap=parseInt(m[2],10), vFrom=parseInt(m[3],10), vTo=m[4]?parseInt(m[4],10):parseInt(m[3],10);

    let BOOKS;
    try{ BOOKS = await getBooksInPopup(); }
    catch(e){ w.alert(e.message || '성경 데이터를 불러올 수 없습니다.'); return; }

    const bookKey=resolveBookKey(bookRaw,BOOKS);
    if(!bookKey){ w.alert(해당 성경을 찾을 수 없습니다: "${bookRaw}"); return; }

    const ch=BOOKS[bookKey]?.[chap];
    if(!ch){ w.alert("${bookKey}" ${chap}장을 찾을 수 없습니다.); return; }

    const verses=(ch.paras||[]).flatMap(p=>p.verses||[]).filter(([v])=>v>=vFrom&&v<=vTo);
    if(!verses.length){ w.alert('해당 구절을 찾을 수 없습니다.'); return; }

    const header = <div class="verse-header">&lt;${bookKey} ${chap}:${vFrom}${vTo!==vFrom?'-'+vTo:''}&gt;</div>;
    const html = verses.map(([v,t])=><span class="verse-line"><sup>${v}</sup>${t}</span>).join('');
    const blockHTML = header + html;

    NSTATE.blocks.push({ id:Nuid(), type:'p', html: blockHTML });
    Nrender(); NpushHistory(); NscheduleAutosave();
    const last = d.querySelector('#editorRoot .editor-block:last-child .content');
    last && last.focus();
  }

  // 저장/삭제/닫기/인쇄
  d.getElementById('s').onclick = ()=>{
    const html = NblocksToHTML();
    const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';
    const images = [];
    w.opener?.postMessage?.({ type:'sermon-save', title, body: html, images }, '*');
    w.close();
  };
  d.getElementById('d').onclick = ()=>{ if(w.confirm('삭제할까요?')){ w.opener?.postMessage?.({ type:'sermon-delete' }, '*'); w.close(); } };
  d.getElementById('x').onclick = ()=> w.close();
  d.getElementById('print').onclick = ()=> w.print();

  /* ========= 문장 단위 낭독 + 하이라이트 + 화면 중앙 정렬 ========= */
  const readBtn = d.getElementById('read');
  const stopBtn = d.getElementById('stop');
  const readPane = d.getElementById('readPane');

  const TTS = {
    sents: [],
    idx: 0,
    playing: false,
    synth: w.speechSynthesis || window.speechSynthesis,
    utter: null
  };

  function htmlToPlain(html){
    const tmp=d.createElement('div'); tmp.innerHTML=html||'';
    tmp.querySelectorAll('sup').forEach(s=> s.textContent='['+s.textContent+'] ');
    return (tmp.textContent||'').replace(/\s+\n/g,'\n').replace(/\n{2,}/g,'\n').replace(/\s+/g,' ').trim();
  }

  // 한국어/영문 종결부호 기준 문장 분할
  function splitToSentences(text){
    const t = String(text||'').trim();
    if(!t) return [];
    // 마침표, 물음표, 느낌표, 말줄임표, 한국어 종결(다.)도 일반 마침표로 처리됨
    const parts = t.split(/(?<=[\.!\?…]|[。！？])\s+/u).filter(s=>s && s.trim().length>0);
    return parts;
  }

  function renderReadPane(){
    readPane.innerHTML = TTS.sents.map((s,i)=><span class="sent" data-i="${i}">${escapeHtml(s)}</span>).join('');
    readPane.style.display = '';
  }

  function clearPaneHighlight(){
    readPane.querySelectorAll('.sent.reading').forEach(el=> el.classList.remove('reading'));
  }

  function highlightIndex(i){
    clearPaneHighlight();
    const span = readPane.querySelector(.sent[data-i="${i}"]);
    if(span){
      span.classList.add('reading');
      span.scrollIntoView({block:'center', behavior:'smooth'});
    }
  }

  function speakIdx(i){
    if(!TTS.synth) return;
    if(i<0 || i>=TTS.sents.length){ stopReading(); return; }
    TTS.idx = i;
    try{ TTS.synth.cancel(); }catch(_){}
    const u = new w.SpeechSynthesisUtterance(TTS.sents[i]);
    // 부모창 음성 설정을 그대로 이용하지 못하므로 기본 ko-KR로 설정
    u.lang = 'ko-KR';
    u.onstart = ()=>{
      highlightIndex(i);
    };
    u.onend = ()=>{
      if(!TTS.playing) return;
      const next = i+1;
      if(next < TTS.sents.length){
        speakIdx(next);
      }else{
        stopReading();
      }
    };
    u.onerror = ()=>{ // 오류 시 다음 문장으로 넘어가되 무한루프 방지
      if(!TTS.playing) return;
      const next = i+1;
      if(next < TTS.sents.length) speakIdx(next); else stopReading();
    };
    TTS.utter = u;
    TTS.synth.speak(u);
  }

  function startReading(){
    const html = NblocksToHTML();
    const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim();
    const plain = [title, htmlToPlain(html)].filter(Boolean).join('. ');
    const sents = splitToSentences(plain);
    if(!sents.length){ w.alert('낭독할 내용이 없습니다.'); return; }
    TTS.sents = sents;
    TTS.idx = 0;
    TTS.playing = true;
    renderReadPane();
    readBtn.textContent = '일시정지';
    speakIdx(0);
  }

  function stopReading(){
    TTS.playing = false;
    try{ TTS.synth && TTS.synth.cancel(); }catch(_){}
    clearPaneHighlight();
    readPane.style.display = 'none';
    readBtn.textContent = '낭독';
  }

  readBtn.onclick = ()=>{
    if(!TTS.synth){ w.alert('이 브라우저는 음성합성을 지원하지 않습니다.'); return; }
    if(!TTS.playing){
      startReading();
    }else{
      // 일시정지 토글: 일시정지 -> 재개
      if(TTS.synth.speaking && !TTS.synth.paused){
        TTS.synth.pause();
        readBtn.textContent = '재개';
      }else if(TTS.synth.paused){
        TTS.synth.resume();
        readBtn.textContent = '일시정지';
      }else{
        startReading();
      }
    }
  };

  stopBtn.onclick = ()=> stopReading();

  // 문장 클릭 시 해당 문장부터 재생
  readPane.addEventListener('click', (e)=>{
    const span = e.target.closest('.sent');
    if(!span) return;
    const i = +span.dataset.i;
    if(!Number.isFinite(i)) return;
    if(!TTS.sents.length) return;
    TTS.playing = true;
    readBtn.textContent = '일시정지';
    speakIdx(i);
  });

  // 저장/삭제/닫기/낭독 끝
  /* ========= 문장 단위 낭독 섹션 끝 ========= */

  // 기존 중지 버튼 핸들러는 위에서 대체( stopReading )로 처리됨
  // 기존 단일-문장 전체 낭독 로직은 요구사항에 맞춰 문장 단위로 치환됨

  // 성경 데이터 로드 유틸
  let __BOOKS_CACHE = null;
  async function getBooksInPopup(){
    if (__BOOKS_CACHE) return __BOOKS_CACHE;
    try{
      const P = w.opener || window.opener;
      if (P && P.BIBLE && P.BIBLE.books){
        __BOOKS_CACHE = P.BIBLE.books;
        return __BOOKS_CACHE;
      }
    }catch(_){}
    async function tryLoad(path){
      try{
        const res = await fetch(path, {cache:'no-store'});
        if(!res.ok) return null;
        const j = await res.json();
        return j && j.books ? j.books : null;
      }catch(_){ return null; }
    }
    __BOOKS_CACHE = await tryLoad('bible_paragraphs.json') || await tryLoad('bible-paragraph.json');
    if(!__BOOKS_CACHE) throw new Error('성경 데이터(BIBLE)를 불러올 수 없습니다.');
    return __BOOKS_CACHE;
  }

  function resolveBookKey(input,BOOKS){
    const s=normalizeBookName(input); const keys=Object.keys(BOOKS||{});
    const byNorm=new Map(keys.map(k=>[normalizeBookName(k),k])); if(byNorm.has(s)) return byNorm.get(s);
    const alias=BOOK_ALIAS_MAP(); if(alias[s] && BOOKS[alias[s]]) return alias[s];
    const startHit=keys.find(k=>normalizeBookName(k).startsWith(s)); if(startHit) return startHit;
    const inclHit=keys.find(k=>normalizeBookName(k).includes(s)); if(inclHit) return inclHit;
    return null;
  }
  function normalizeBookName(x){
    return String(x||'').toLowerCase().replace(/\s+/g,'').replace(/[.\u00B7]/g,'').replace(/서$/,'').replace(/복음서?$/,'복음')
    .replace(/첫째|둘째|셋째/g, m=>({'첫째':'1','둘째':'2','셋째':'3'}[m])).replace(/[일이삼]/g,m=>({'일':'1','이':'2','삼':'3'}[m]))
    .replace(/롬서?$/,'롬').replace(/고린도전서?$/,'고전').replace(/고린도후서?$/,'고후')
    .replace(/데살로니가전서?$/,'살전').replace(/데살로니가후서?$/,'살후')
    .replace(/디모데전서?$/,'딤전').replace(/디모데후서?$/,'딤후')
    .replace(/베드로전서?$/,'벧전').replace(/베드로후서?$/,'벧후')
    .replace(/요한일서?$/,'요1').replace(/요한이서?$/,'요2').replace(/요한삼서?$/,'요3');
  }
  function BOOK_ALIAS_MAP(){
    return {
      // 구약
      '창':'창세기','창세기':'창세기','창세':'창세기','출':'출애굽기','출애굽기':'출애굽기','출애':'출애굽기','레':'레위기','레위기':'레위기','민':'민수기','민수기':'민수기','신':'신명기','신명기':'신명기',
      '수':'여호수아','여호수아':'여호수아','삿':'사사기','사사기':'사사기','룻':'룻기','룻기':'룻기','삼상':'사무엘상','사무엘상':'사무엘상','삼하':'사무엘하','사무엘하':'사무엘하',
      '왕상':'열왕기상','열왕기상':'열왕기상','왕하':'열왕기하','열왕기하':'열왕기하','대상':'역대상','역대상':'역대상','대하':'역대하','역대하':'역대하',
      '스':'에스라','에스라':'에스라','느':'느헤미야','느헤미야':'느헤미야','에':'에스더','에스더':'에스더','욥':'욥기','욥기':'욥기','시':'시편','시편':'시편','잠':'잠언','잠언':'잠언',
      '전':'전도서','전도서':'전도서','아':'아가','아가':'아가','사':'이사야','이사야':'이사야','렘':'예레미야','예레미야':'예레미야','애':'예레미야애가','예레미야애가':'예레미야애가',
      '겔':'에스겔','에스겔':'에스겔','단':'다니엘','다니엘':'다니엘','호':'호세아','호세아':'호세아','욜':'요엘','요엘':'요엘','암':'아모스','아모스':'아모스','옵':'오바댜','오바댜':'오바댜',
      '욘':'요나','요나':'요나','미':'미가','미가':'미가','나':'나훔','나훔':'나훔','합':'하박국','하박국':'하박국','습':'스바냐','스바냐':'스바냐','학':'학개','학개':'학개','슥':'스가랴','스가랴':'스가랴','말':'말라기','말라기':'말라기',
      // 신약
      '마':'마태복음','마태':'마태복음','마태복음':'마태복음','막':'마가복음','마가':'마가복음','마가복음':'마가복음','눅':'누가복음','누가':'누가복음','누가복음':'누가복음',
      '요':'요한복음','요한복음':'요한복음','행':'사도행전','사도행전':'사도행전','롬':'로마서','로마서':'로마서','고전':'고린도전서','고린도전서':'고린도전서','고후':'고린도후서','고린도후서':'고린도후서',
      '갈':'갈라디아서','갈라디아서':'갈라디아서','엡':'에베소서','에베소서':'에베소서','빌':'빌립보서','빌립보서':'빌립보서','골':'골로새서','골로새서':'골로새서',
      '살전':'데살로니가전서','데살로니가전서':'데살로니가전서','살후':'데살로니가후서','데살로니가후서':'데살로니가후서','딤전':'디모데전서','디모데전서':'디모데전서','딤후':'디모데후서','디모데후서':'디모데후서',
      '딛':'디도서','디도서':'디도서','몬':'빌레몬서','빌레몬서':'빌레몬서','히':'히브리서','히브리서':'히브리서','약':'야고보서','야고보서':'야고보서',
      '벧전':'베드로전서','베드로전서':'베드로전서','벧후':'베드로후서','베드로후서':'베드로후서',
      '요1':'요한일서','요일1':'요한일서','요한일':'요한일서','요한일서':'요한일서','요2':'요한이서','요일2':'요한이서','요한이':'요한이서','요한이서':'요한이서',
      '요3':'요한삼서','요일3':'요한삼서','요한삼':'요한삼서','요한삼서':'요한삼서','유':'유다서','유다서':'유다서','계':'요한계시록','계시록':'요한계시록','요한계시록':'요한계시록'
    }
  }
}

/* ===== 모달 RTE 상단 패딩 자동 보정 ===== */
function adjustModalEditorPadding() {
  const wrap = document.getElementById('rteToolbar');
  const body = document.querySelector('#sermonEditor .rte');
  if (!body) return;
  const h = wrap ? (wrap.offsetHeight || 0) : 0;
  body.style.setProperty('--editor-pad-top', (h + 0) + 'px');
}
window.addEventListener('resize', adjustModalEditorPadding);
document.getElementById('sermonTitle')?.addEventListener('input', adjustModalEditorPadding);
window.addEventListener('load', adjustModalEditorPadding);

/* ===== 인라인 제목 편집 더미 ===== */
function startInlineTitleEdit(){ /* 필요 시 실제 구현으로 교체 */ }

<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Web Bible Paragraph Sermon</title>
  <style>
    :root{
      --bg:#0f1115; --panel:#161922; --text:#e6e8ef; --muted:#9aa0ab;
      --accent:#6ea8fe; --border:#252a36; --danger:#ff6b6b; --titleBlue:#9fd0ff;
    }
    *{ box-sizing:border-box } html,body{ height:100% }
    body{
      margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans KR",sans-serif;
      background:var(--bg); color:var(--text);
      display:grid; grid-template-rows:64px 1fr; gap:10px;
    }
    header{
      display:flex; align-items:center; gap:10px; padding:8px 10px;
      background:var(--panel); border-bottom:1px solid var(--border);
      position:sticky; top:0; z-index:5;
    }
    header h1{ font-size:16px; margin:0; font-weight:700 }
    .muted{ color:var(--muted) }
    .pill{
      display:flex; gap:8px; align-items:center; border:1px solid var(--border);
      background:color-mix(in hsl, var(--panel) 80%, black 8%); padding:6px 8px; border-radius:10px;
    }
    select, input[type="range"]{ background:transparent; color:var(--text); border:1px solid var(--border); border-radius:8px; padding:4px 6px }
    option{ color:#000 }
    button{
      background:color-mix(in hsl, var(--panel) 65%, black 10%); color:var(--text);
      border:1px solid var(--border); border-radius:10px; padding:6px 10px; cursor:pointer;
      transition:border-color .15s, transform .04s;
    }
    button:hover{ border-color:color-mix(in hsl, var(--border) 80%, var(--accent) 20%) }
    button:active{ transform:translateY(1px) }
    .primary{
      background:linear-gradient(180deg,color-mix(in srgb, var(--accent) 75%, white 10%), color-mix(in srgb, var(--accent) 75%, black 20%));
      border-color:color-mix(in srgb, var(--accent) 70%, black 10%);
    }

    .layout{ display:grid; grid-template-columns:1fr; gap:10px; padding:0 10px 12px }
    .card{ background:var(--panel); border:1px solid var(--border); border-radius:14px; overflow:hidden; display:flex; flex-direction:column; min-width:0 }
    .scroller{ overflow:auto; padding:12px }
    .footer{ padding:8px 12px; border-top:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap }

    #tree{ padding:8px }
    details{
      border:1px solid var(--border); border-radius:10px; padding:6px 8px; margin-bottom:8px;
      background:color-mix(in hsl, var(--panel) 80%, black 8%);
    }
    summary{ cursor:pointer; list-style:none; display:flex; align-items:center; gap:8px }
    summary::-webkit-details-marker{ display:none }
    .tw{ font-weight:700 }
    .chapters{ display:grid; gap:6px; margin-top:6px }
    .paras{ display:grid; gap:6px; margin:8px 0 2px }
    .chip{
      font-size:.92em; padding:6px 10px; border:1px solid var(--border); border-radius:999px;
      display:inline-flex; align-items:center; gap:6px; background:color-mix(in hsl, var(--panel) 88%, black 4%); white-space:nowrap;
    }
    .chip:hover{ border-color:var(--accent) }
    .ptitle{ font-weight:800; color:var(--titleBlue) }
    .vrange{ color:var(--muted); font-weight:700 }

    .pbody{ margin-top:8px; border-top:1px dashed var(--border); padding-top:8px }
    .ptoolbar{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px }

    /* ✅ 설교 버튼이 가려지거나 사라지는 것 방지 */
    .ptoolbar .spacer { flex: 1 1 auto; }
    .ptoolbar .sermBtn { display: inline-flex; }

    .pline{ padding:4px 6px; border-left:3px solid transparent; border-radius:8px; transition: background .15s, border-color .15s }
    .pline:hover{ background:color-mix(in hsl, var(--panel) 80%, black 12%) }
    .pline.reading{ background:color-mix(in hsl, var(--accent) 15%, black 0%); border-left-color:var(--accent) }
    .pv{ color:var(--muted); font-size:.88em; vertical-align:super; margin-right:4px }

    .modal-backdrop{ position:fixed; inset:0; background:rgba(0,0,0,.45); display:none; align-items:center; justify-content:center; z-index:50 }
    .modal{ width:min(1200px, 96vw); max-height:94vh; overflow:auto; background:var(--panel); border:1px solid var(--border); border-radius:14px }
    .modal .head{
      position:sticky; top:0; background:var(--panel); padding:12px 14px;
      display:flex; gap:10px; align-items:center; border-bottom:1px solid var(--border)
    }
    .list{ padding:12px 14px; display:grid; gap:8px }
    .item{ border:1px solid var(--border); border-radius:10px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap }
    .item-title{ font-weight:700; color:var(--titleBlue); line-height:1.15; display:flex; align-items:center; gap:8px; flex-wrap:wrap }
    .item-title .date{ margin-left:8px; color:var(--muted); font-weight:400; font-size:.92em }

    .editor{ padding:14px; display:grid; gap:12px; background:var(--panel) }
    .editor input[type="text"], .editor textarea{ width:100%; background:#161922; color:#e6e8ef; border:1px solid #2a3040; border-radius:8px; padding:10px 12px }
    .editor textarea{ min-height:360px; resize:vertical }
    .editor-bar{ display:flex; gap:8px; align-items:center; flex-wrap:wrap }
    .editor-bar .grow{ flex:1 1 auto }

    /* [맥락 편집기 전용] 보기 좋은 타이포/레이아웃 */
    .context-editor {
      font-family: "Noto Serif KR", "Nanum Myeongjo", serif;
      font-size: 1.05rem;
      line-height: 1.85;
      letter-spacing: 0.02em;
      word-break: keep-all;
      background: var(--panel);
      color: var(--text);
      border-radius: 12px;
      box-shadow: 0 6px 16px rgba(0,0,0,0.25);
    }
    .context-editor input[type="text"]{
      font-family: "Noto Serif KR", "Nanum Myeongjo", serif;
      font-weight: 600;
      font-size: 1.12rem;
      letter-spacing: 0.01em;
    }
    .context-editor .rte{
      min-height:360px;resize:vertical;padding:14px;background:#161922;border:1px solid #2a3040;border-radius:10px;line-height:1.85;letter-spacing:.015em;caret-color:var(--accent);outline:none
    }
    .context-editor em,.context-editor strong,.context-editor b{
      color:#ffd66e;font-weight:600;font-style:normal
    }
    .context-editor blockquote{
      margin:12px 0;padding:10px 14px;border-left:3px solid var(--accent);
      color:#c0cad6;font-style:italic;background:rgba(255,255,255,.04);border-radius:8px
    }
    .context-editor ::selection{background:rgba(110,168,254,.25)}
    @media (max-width:640px){.context-editor{font-size:1rem}}
    @media (prefers-color-scheme:light){
      .context-editor{color:#1b2533;background:#fff;box-shadow:0 6px 16px rgba(0,0,0,.08)}
      .context-editor blockquote{color:#445066;background:#f7f9fc}
    }

    /* ==== 모달 편집기(sermonEditor) 줄 간격 타이트 모드 ==== */
    #sermonEditor.context-editor .rte{
      line-height: 1.55 !important;
      letter-spacing: 0.01em !important;
    }
    #sermonEditor.context-editor .rte p{ margin: 6px 0; }
    #sermonEditor.context-editor .rte .verse-line{ line-height: 1.5; }
    #sermonEditor.context-editor .rte .verse-line sup{ margin-right:4px; }
    #sermonEditor.context-editor .rte br{ line-height: 1.0; }

    /* ===== 모달 편집기: 본문만 스크롤 ===== */
    #sermonEditor{
      display:flex; flex-direction:column;
      height: calc(94vh - 56px); min-height: calc(94vh - 56px); max-height: calc(94vh - 56px);
      overflow: hidden;
    }
    #sermonEditor .rte {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding-top: var(--editor-pad-top, 0px);
      margin-top: 0 !important;
      scroll-padding-top: var(--editor-pad-top, 0px);
    }

    /* RTE 툴바 고정 */
    #rteToolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
    }

    /* ===== 삽입된 성경구절 스타일 ===== */
    .inserted-verse { font-style: italic; color: #ff8080; }
    .verse-header { margin-bottom:2px; }
    .verse-line { font-style: italic; color:#ff8080; }

    /* 설교목록 링크 필드 */
    .link-box{
      display:flex; align-items:center; gap:6px; min-width:260px; flex:1 1 320px;
    }
    .link-box input{
      flex:1 1 auto; min-width:200px;
      background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;padding:6px 8px
    }
    .link-box a{
      text-decoration:underline; color:#9fd0ff; word-break:break-all;
      max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .ptoolbar .sermBtn{ margin-left:auto }
    
    /* 응급: 설교 버튼 가시성 강제 */
    .ptoolbar .sermBtn { display:inline-flex !important; visibility:visible !important; opacity:1 !important; }

  </style>

  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&family=Nanum+Myeongjo&display=swap" rel="stylesheet">
</head>
<body>
  <header>
    <h1>Web Bible Paragraph 3.0</h1>

    <div class="pill"><button id="btnSaveJSON">JSON 저장</button></div>

    <div class="pill">
      <button id="btnExportAll">내보내기</button>
      <input id="importFile" type="file" accept="application/json" style="display:none">
      <button id="btnImportAll">가져오기</button>
    </div>

    <div class="pill">
      <span class="muted">음성</span>
      <select id="voiceSelect" title="한국어 보이스 선택">
        <option value="">브라우저 기본(ko-KR)</option>
      </select>
      <button id="testVoice">시험</button>
    </div>

    <div class="pill">
      <span class="muted">속도</span>
      <input id="rateCtl" type="range" min="0.6" max="1.4" step="0.02" value="0.95" />
      <span class="muted">톤</span>
      <input id="pitchCtl" type="range" min="0.6" max="1.4" step="0.02" value="1.00" />
    </div>

    <div class="pill" id="voiceHint" style="display:none">
      <span class="muted">한국어 보이스가 1개뿐이라 스타일 프리셋을 추가했습니다.</span>
    </div>

    <div style="flex:1"></div>
    <div class="pill"><span class="muted">단축키:</span> <span> S</span> 재생/중지 <span> · N</span> 다음 단락</div>
  </header>

  <div class="layout">
    <section class="card">
      <div class="scroller"><div id="tree"></div></div>
      <div class="footer"><div class="muted" id="status">bible-paragraph.json을 불러오는 중…</div></div>
    </section>
  </div>

  <div id="modalWrap" class="modal-backdrop" aria-hidden="true">
    <div class="modal">
      <div class="head">
        <strong id="modalTitle">단락 성경</strong>
        <span class="muted" id="modalRef">—</span>
        <div class="grow"></div>
        <button id="closeModal">닫기</button>
      </div>

      <div class="list" id="sermonList"></div>

      <!-- 단일 편집기 (중복 제거) -->
      <div class="editor context-editor" id="sermonEditor" style="display:none">
        <div id="rteToolbar" class="editor-bar">
          <button type="button" onclick="execFmt('bold')"><b>B</b></button>
          <button type="button" onclick="execFmt('italic')"><i>I</i></button>
          <button type="button" onclick="execFmt('underline')"><u>U</u></button>
          <button type="button" onclick="execFmt('strikeThrough')"><s>S</s></button>
          <div class="grow"></div>
        </div>

        <input id="sermonTitle" type="text" placeholder="제목" style="display:none" />
        <div id="sermonBody" class="rte" contenteditable="true" spellcheck="false"></div>

        <div class="editor-bar">
          <div class="grow"></div>
          <button id="editorSpeak" class="primary">낭독</button>
          <button id="saveSermon" class="primary">저장</button>
        </div>
      </div>

      <div id="modalFooterNew" class="footer" style="padding:10px 14px; border-top:1px solid var(--border)">
        <button id="newSermonBtn" class="primary">새 설교</button>
      </div>
    </div>
  </div>

  <script src="app.js" defer></script>
</body>
</html>
이 코드들 부터 시작하자
절문장 글자들의 서식이 JSON 파일에 어떤 구조로 어떻게 저장되어 내보내지고, 파일을 가져오기 해서 다시 서식을 적용할 수 있는지 정확하게 해줘
ChatGPT의 말:
좋아요. 지금 코드 베이스(단락 트리 + 모달 RTE + 팝업 편집기 “blocks” 구조)를 그대로 살리면서 “절·문장 글자 서식”을 JSON으로 저장/내보내기/가져오기/재적용하는 방법을 _정확한 스키마 + 적용 코드 위치_까지 깔끔히 정리해드릴게요. 핵심은 Runs 모델(문자 범위 + 속성)로 통일하는 것입니다.

1) 저장 포맷(스키마)
A. 성경 본문(단락) — BIBLE.books[book][chap].paras[i].verses
기존: verses: [[verseNumber, "plain text"], ...]
확장: 호환 유지 + 선택적으로 runs 추가

{
  "verses": [
    [
      3,
      {
        "text": "하나님이 가라사대 빛이 있으라 하시매 빛이 있었고",
        "runs": [
          { "s": 0,  "e": 4,  "b": true },                        // 굵게
          { "s": 5,  "e": 9,  "i": true },                        // 이탤릭
          { "s": 10, "e": 12, "u": true },                        // 밑줄
          { "s": 13, "e": 16, "hl": "#6655007a" },                // 배경 강조(하이라이트)
          { "s": 17, "e": 20, "c": "#ff8080" },                   // 글자색
          { "s": 21, "e": 23, "a": "https://example.org/page" }  // 링크
        ],
        "meta": {
          "ver": "개역개정",
          "sentences": [ [0, 14], [14, 28] ]                      // 문장 경계(선택)
        }
      }
    ]
  ]
}
text: 서식이 없는 순수 문자열

runs: 범위 기반 서식 배열 (start s, end e 는 [s, e) 절반열린 구간, JS 문자열 인덱스/UTF-16 기준)

b(bold), i(italic), u(underline), s(strike), c(color), hl(highlight), a(anchor href)

meta.sentences(옵션): 문장 하이라이트/낭독 싱크에 쓰는 문장 범위들

호환성: 만약 verses 항목이 문자열이면 예전 데이터. 객체라면 runs 포함 신형.

B. 설교/맥락 문서(모달/팝업 RTE)
팝업 편집기는 이미 blocks 배열을 사용하고 있어 runs 전환이 쉽습니다.

{
  "title": "설교 제목",
  "doc": {
    "v": 1,
    "blocks": [
      { "id": "abcd1234", "type": "h2", "text": "서론", "runs": [] },
      {
        "id": "efg456",
        "type": "p",
        "text": "이 문장은 굵고, 이것은 링크입니다.",
        "runs": [
          { "s": 0, "e": 3, "b": true },
          { "s": 12, "e": 16, "a": "https://example.org" }
        ]
      },
      { "id": "xyz999", "type": "quote", "text": "인용문", "runs": [] },
      { "id": "div1", "type": "divider" }
    ]
  },
  "date": "2025-11-09",
  "images": [],
  "link": ""
}
blocks[].type: p|h1|h2|h3|quote|callout|code|todo|ul|ol|toggle|divider|img

텍스트 기반 블록은 반드시 text+runs 보유

HTML 렌더는 가공 결과일 뿐, 저장 원본은 text+runs

현행 drafts 키 wbps.sermon.draft.blocks.<paraId>.<idx> 도 위 구조로 맞추세요.

2) HTML ↔ Runs 상호 변환 규칙
공통 원칙
저장 시: 에디터의 HTML → text(plain) + runs(범위)

표시 시: text + runs → HTML(스팬/태그로 감싸기)

A. HTML → Runs (저장)
HTML을 DOM 파싱

인라인 마크업(b,strong,i,em,u,s,span[style],a)를 재귀 탐색하며 현재 스타일 스택을 유지

텍스트 노드에 도달 시, 현재 누적 길이 offset을 기준으로 runs 추가

\u00A0 등 공백 정규화(필요시)

최종적으로 { text, runs } 산출

속성 매핑

<b>, <strong> → b:true

<i>, <em> → i:true

<u> → u:true

<s>, <del> → s:true

<span style="color:#abc"> → c:"#abc"

<span style="background-color:#xyz"> → hl:"#xyz"

<a href="..."> → a:"..."

주의: sup(절번호)은 저장 텍스트에는 제외하거나 별 meta로 관리하세요. (지금 코드처럼 낭독시 [절]로 치환은 렌더 단계에서 수행)

B. Runs → HTML (표시)
text를 문자 단위로 훑으면서 겹치는 runs를 병합하여 최소 스팬 세그먼트로 쪼갠 뒤, 스타일에 따라 태그/스타일 적용

속성 조합의 예:

b+i → <strong><em> ... </em></strong> (또는 <span style="font-weight:700;font-style:italic">)

c+hl+u → <span style="color:#...;background-color:#...;text-decoration:underline">

3) 코드 적용 위치(당신 코드 기준 정확 지점)
아래 함수들을 app.js(모달 RTE 공용)와 팝업 창 스크립트(initSermonPopup 내부) 양쪽에 동일하게 추가/사용하세요.

(1) 공용 유틸 — 스타일 태그 ↔ runs
// === Runs 구조 ===
// Run = { s:number, e:number, b?:1, i?:1, u?:1, s?:1, c?:string, hl?:string, a?:string }
// text 인덱스는 [s, e) 절반열린 구간, JS 문자열(UTF-16) 기준

function htmlToRuns(html){
  const div = document.createElement('div');
  div.innerHTML = html || '';
  const runs = [];
  let text = '';
  let offset = 0;

  function pushRun(s, e, style){
    if (e <= s) return;
    const r = { s, e };
    if (style.bold) r.b = true;
    if (style.italic) r.i = true;
    if (style.underline) r.u = true;
    if (style.strike) r.s = true;
    if (style.color) r.c = style.color;
    if (style.highlight) r.hl = style.highlight;
    if (style.href) r.a = style.href;
    runs.push(r);
  }

  function getInlineStyle(el, base){
    const st = { ...base };
    const tag = el.nodeName.toLowerCase();
    if (tag === 'b' || tag === 'strong') st.bold = true;
    if (tag === 'i' || tag === 'em') st.italic = true;
    if (tag === 'u') st.underline = true;
    if (tag === 's' || tag === 'del') st.strike = true;
    if (tag === 'a' && el.getAttribute('href')) st.href = el.getAttribute('href');
    const cs = el.getAttribute && el.getAttribute('style') || '';
    const mColor = cs.match(/color\s*:\s*([^;]+)/i);
    const mBg = cs.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (mColor) st.color = normalizeColor(mColor[1].trim());
    if (mBg) st.highlight = normalizeColor(mBg[1].trim());
    return st;
  }

  function normalizeColor(v){
    // rgb() → hex 등 필요시 확장. 일단 원문 그대로 저장.
    return v;
  }

  function walk(node, style){
    if (node.nodeType === 3) { // text
      const raw = node.nodeValue || '';
      if (!raw) return;
      const start = offset;
      const val = raw.replace(/\s+/g, match => match); // 공백 원형 유지
      text += val;
      offset += val.length;
      if (style.bold || style.italic || style.underline || style.strike || style.color || style.highlight || style.href) {
        pushRun(start, offset, style);
      }
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.nodeName.toLowerCase();
    // 절번호 등 불필요한 태그 제거 규칙(옵션)
    if (tag === 'sup' && node.classList.contains('pv')) {
      // 저장 텍스트에서 제외하려면 return;
      return;
    }

    // 블록 간 개행을 넣고 싶다면: (선택)
    const before = offset;
    const styled = getInlineStyle(node, style || {});

    for (const child of node.childNodes) walk(child, styled);

    // 블록 경계 처리(선택): p, div, li 등 끝에 \n 삽입
    if (['p','div','li','blockquote'].includes(tag)) {
      text += '\n'; offset += 1;
    }
  }

  walk(div, {});
  // 말미 개행 정리
  text = text.replace(/\n{2,}$/,'\n');

  // runs 정리: 동일 속성/인접 범위 병합(간단 버전)
  const merged = mergeRuns(runs);
  return { text, runs: merged };
}

function mergeRuns(runs){
  if (!runs.length) return [];
  runs.sort((a,b)=> a.s - b.s || a.e - b.e);
  const out = [];
  for (const r of runs){
    const last = out[out.length-1];
    if (last && canMerge(last, r)){
      last.e = Math.max(last.e, r.e);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}
function canMerge(a,b){
  const same = (a.b===b.b)&&(a.i===b.i)&&(a.u===b.u)&&(a.s===b.s)&&(a.c===b.c)&&(a.hl===b.hl)&&(a.a===b.a);
  return same && a.e >= b.s; // 겹치거나 인접
}

function runsToHtml(text, runs){
  if (!text) return '';
  const marks = [];
  (runs||[]).forEach((r,i)=>{
    marks.push({ pos:r.s, open:true, r });
    marks.push({ pos:r.e, open:false, r });
  });
  marks.sort((a,b)=> a.pos - b.pos || (a.open? -1 : 1));

  let html = '';
  let idx = 0;
  const stack = [];

  function open(r){
    let s = '';
    const styles = [];
    if (r.c) styles.push(`color:${r.c}`);
    if (r.hl) styles.push(`background-color:${r.hl}`);
    const deco = [];
    if (r.u) deco.push('underline');
    if (r.s) deco.push('line-through');
    if (deco.length) styles.push(`text-decoration:${deco.join(' ')}`);

    // b/i는 태그, 나머지는 span 스타일
    if (r.b) s += '<strong>';
    if (r.i) s += '<em>';
    const needSpan = styles.length || r.a;
    if (needSpan) {
      const attr = [];
      if (styles.length) attr.push(`style="${styles.join(';')}"`);
      if (r.a) attr.push(`href="${escapeHtmlAttr(r.a)}"`);
      const tag = r.a ? 'a' : 'span';
      s += `<${tag} ${attr.join(' ')}>`;
    }
    return s;
  }
  function close(r){
    let s = '';
    const needSpan = (r.c||r.hl||r.u||r.s||r.a);
    if (needSpan) s += (r.a?'</a>':'</span>');
    if (r.i) s += '</em>';
    if (r.b) s += '</strong>';
    return s;
  }

  marks.forEach(m=>{
    if (idx < m.pos){
      html += escapeHtml(text.slice(idx, m.pos));
      idx = m.pos;
    }
    if (m.open){
      html += open(m.r);
      stack.push(m.r);
    } else {
      // 가장 안쪽부터 닫히게 역으로 pop
      let out = [];
      while (stack.length){
        const top = stack.pop();
        out.push(close(top));
        if (top === m.r) break;
      }
      // 닫힌 것들 다시 여는 처리(교차 범위 방지)
      const reopen = stack.slice();
      reopen.forEach(rr=>{ html += open(rr); });
      // 이미 닫힌 것들 닫기 문자열을 뒤에 붙임
      html += out.join('');
    }
  });
  if (idx < text.length) html += escapeHtml(text.slice(idx));
  // 문단 감싸기(필요 시)
  return html;
}

function escapeHtmlAttr(s){ return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function escapeHtml(s){ const t=document.createElement('div'); t.textContent=String(s); return t.innerHTML; }
(2) 팝업 편집기 — 저장 시 runs로 전환
initSermonPopup의 저장 버튼 핸들러에서 현재는 NblocksToHTML()로 HTML 저장 → runs 저장으로 교체:

// 기존
// const html = NblocksToHTML();
// w.opener?.postMessage({ type:'sermon-save', title, body: html, images }, '*');

// 교체
function collectRunsDoc(){
  const blocks = [];
  d.querySelectorAll('#editorRoot .editor-block').forEach(block=>{
    const id = block.dataset.id;
    const type = block.dataset.type || 'p';
    if (type === 'divider') { blocks.push({ id, type }); return; }
    const content = block.querySelector('.content');
    const html = content ? content.innerHTML : '';
    const { text, runs } = htmlToRuns(html);
    blocks.push({ id, type, text, runs });
  });
  return { v:1, blocks };
}
d.getElementById('s').onclick = ()=>{
  const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';
  const doc = collectRunsDoc();
  w.opener?.postMessage({ type:'sermon-save', title, body: doc, images: [] }, '*');
  w.close();
};
부모창 수신부(openSermonEditorWindow의 onMsg)도 body가 문자열(구버전 HTML) or 객체(doc) 둘 다 수용:

if (data.type === 'sermon-save') {
  const payloadBody = data.body; // string(구형) or {v,blocks}(신형)
  arr2[idx] = { ...arr2[idx], title: data.title, body: payloadBody, images: [], date };
  ...
}
(3) 팝업 편집기 — 로딩 시 runs를 HTML로 렌더
초기 로딩(initBlocksFromHTML)을 runs 우선으로:

function initBlocksFromMeta(meta){
  const b = meta.body;
  if (b && typeof b === 'object' && b.v === 1 && Array.isArray(b.blocks)) {
    // runs 기반
    NSTATE.blocks = b.blocks.map(x => ({ ...x })); // 그대로
  } else {
    // 구버전 HTML 한 덩어리 → p 블록 하나로
    const html = typeof b === 'string' ? b : (meta.body || '');
    NSTATE.blocks = [{ id:Nuid(), type:'p', text:'', runs:[] }];
    const { text, runs } = htmlToRuns(html);
    NSTATE.blocks[0].text = text;
    NSTATE.blocks[0].runs = runs;
  }
}

function Nrender(){
  neRoot.innerHTML = '';
  for(const b of NSTATE.blocks){
    const el = d.createElement('div');
    el.className = 'editor-block';
    el.dataset.id = b.id; el.dataset.type = b.type;

    if (b.type === 'divider') {
      el.innerHTML = `<div class="handle">⋮⋮</div><div class="content"><hr></div><div class="progress"></div>`;
    } else {
      const html = runsToHtml(b.text || '', b.runs || []);
      el.innerHTML = `
        <div class="handle">⋮⋮</div>
        <div class="content" contenteditable="true">${html}</div>
        <div class="progress" style="width:0"></div>
      `;
    }
    neRoot.appendChild(el);
  }
  NbindBlockEvents();
}
입력 변경 시에도 HTML→runs 갱신:

function NsaveBlock(block){
  const i = NindexById(block.dataset.id); if(i<0) return;
  const content = block.querySelector('.content');
  if (NgetType(block) === 'divider') return;
  const { text, runs } = htmlToRuns(content.innerHTML);
  NSTATE.blocks[i].text = text;
  NSTATE.blocks[i].runs = runs;
}
(4) 모달 RTE(요약/맥락 편집기)에도 동일 원리
getBodyHTML() / setBodyHTML() 대신

저장 시 htmlToRuns(sermonBody.innerHTML) 결과를 doc으로 저장

열 때 runsToHtml(doc.blocks[*])로 채움

저장소 키(STORAGE_UNIT_CTX, STORAGE_WHOLE_CTX, …)의 value 구조를 기존 {title, body: "<html>"} → {title, body: {v:1,blocks:[]}}로 점진 전환
(구형 값이 오면 htmlToRuns로 변환해 한 번 저장)

4) 내보내기/가져오기(export/import) 동작
exportAllData(): 지금처럼 localStorage 통째로 묶되, 설교/맥락 항목의 body가 객체이면 그대로 JSON 직렬화됩니다. (추가 작업 불필요)

importAllData(file): 기존 로직 유지. 가져온 뒤 표시/편집 시점에 typeof body로 분기하여 렌더.

5) 문장 하이라이트/낭독과 runs의 관계
낭독 텍스트는 **항상 text**에서 생성 → runs와 독립

문장 경계는 meta.sentences를 쓰면 더 안정적으로 하이라이트 가능
(없으면 현재처럼 정규식 분할 사용)

에디터에서 문장을 클릭해 재생: sentences[i] = [s,e] 범위를 이용해 해당 substring을 TTS

6) 마이그레이션 전략(안전)
읽기(열기) 시점 변환

typeof body === "string" 이면 한 번만 htmlToRuns 변환 후 즉시 v:1 도큐먼트로 다시 저장(백그라운드 저장 가능).

쓰기(저장) 시점 고정

이제부터는 항상 runs로 저장.

성경 본문

verses[i][1]이 문자열 → 표시만 plain

편집 시(예: 본문 병기/강조) UI가 runs를 만들면 verses[i][1]를 객체로 바꿔 저장.

7) 빠른 체크리스트
 htmlToRuns, runsToHtml, mergeRuns 유틸 추가(팝업/모달 양쪽)

 팝업 저장 핸들러를 runs 저장으로 교체

 팝업 로드/렌더를 runs 우선으로

 모달 RTE(요약/맥락)도 동일 원리 적용

 openSermonEditorWindow의 부모창 메시지 수신부에서 body 타입 분기

 (옵션) meta.sentences 지원 추가

 BIBLE.verses는 문자열/객체 혼용 허용(표시/저장 측 분기)

필요하시면 위 유틸 함수들을 당장 붙여 넣을 수 있는 패치 블록으로 정리해서 드릴게요. (팝업 스크립트/모달 RTE 각각 어디에 넣을지 줄 번호 기준으로 맞춰드릴 수도 있습니다.)

나의 말:
어떤 코드를 어디에
ChatGPT의 말:

9s 동안 생각함
좋습니다. 지금 붙여주신 코드 기준으로 **정확히 어디(파일·함수 위치)**에 무엇을 넣고/바꾸면 되는지 “패치 가이드”로 드릴게요. 복붙하면 바로 동작 하도록 표시 마커를 넣었습니다.

0) 무엇을 하려는가
RTE/팝업 에디터의 서식을 HTML이 아니라 Runs(JSON) 모델로 저장

열 때는 Runs → HTML로 재적용

(옵션) 성경 본문 verses도 문자열/신형 runs 혼용 렌더

1) app.js 최상단(유틸 영역)에 Runs 유틸 추가
위치: /* --------- Utils --------- */ 블록 아래 임의 위치
액션: 아래 블록을 그대로 추가

// ===== [RUNS-UTILS] BEGIN: HTML ↔ Runs 공용 유틸 =====
function escapeHtmlAttr(s){ return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function escapeHtml(s){ const t=document.createElement('div'); t.textContent=String(s); return t.innerHTML; }

// Run = { s:number, e:number, b?:1, i?:1, u?:1, s?:1, c?:string, hl?:string, a?:string }
function mergeRuns(runs){
  if (!runs || !runs.length) return [];
  const arr = [...runs].sort((a,b)=> a.s - b.s || a.e - b.e);
  const out = [];
  for (const r of arr){
    const last = out[out.length-1];
    const same = last && last.b===r.b && last.i===r.i && last.u===r.u && last.s===r.s && last.c===r.c && last.hl===r.hl && last.a===r.a;
    if (same && last.e >= r.s) last.e = Math.max(last.e, r.e);
    else out.push({...r});
  }
  return out;
}
function htmlToRuns(html){
  const div = document.createElement('div');
  div.innerHTML = html || '';
  const runs = [];
  let text = '';
  let offset = 0;

  function pushRun(s, e, st){
    if (e<=s) return;
    const r = { s, e };
    if (st.bold) r.b = 1;
    if (st.italic) r.i = 1;
    if (st.underline) r.u = 1;
    if (st.strike) r.s = 1;
    if (st.color) r.c = st.color;
    if (st.highlight) r.hl = st.highlight;
    if (st.href) r.a = st.href;
    runs.push(r);
  }
  function styled(el, base){
    const st = {...(base||{})};
    const tag = el.nodeName?.toLowerCase?.() || '';
    if (tag==='b'||tag==='strong') st.bold = true;
    if (tag==='i'||tag==='em') st.italic = true;
    if (tag==='u') st.underline = true;
    if (tag==='s'||tag==='del') st.strike = true;
    if (tag==='a'){ const href = el.getAttribute('href'); if (href) st.href = href; }
    const css = el.getAttribute?.('style')||'';
    const m1 = css.match(/color\s*:\s*([^;]+)/i);
    const m2 = css.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (m1) st.color = m1[1].trim();
    if (m2) st.highlight = m2[1].trim();
    return st;
  }
  function walk(node, st){
    if (node.nodeType===3){
      const raw = node.nodeValue||'';
      if (!raw) return;
      const start = offset;
      text += raw;
      offset += raw.length;
      if (st.bold||st.italic||st.underline||st.strike||st.color||st.highlight||st.href){
        pushRun(start, offset, st);
      }
      return;
    }
    if (node.nodeType!==1) return;
    const tag = node.nodeName.toLowerCase();
    if (tag==='sup' && node.classList.contains('pv')) return; // 절번호 저장 제외

    const st2 = styled(node, st||{});
    node.childNodes.forEach(n=>walk(n, st2));
    if (['p','div','li','blockquote'].includes(tag)){ text+='\n'; offset+=1; }
  }
  walk(div, {});
  text = text.replace(/\n{2,}$/,'\n');
  return { text, runs: mergeRuns(runs) };
}

function runsToHtml(text, runs){
  text = String(text||'');
  const marks = [];
  (runs||[]).forEach(r=>{ marks.push({pos:r.s,open:1,r}); marks.push({pos:r.e,open:0,r}); });
  marks.sort((a,b)=> a.pos - b.pos || (a.open? -1 : 1));
  let html = '', i = 0;
  const stack = [];
  const openTag = (r)=>{
    let s = '';
    const styles = [];
    if (r.c) styles.push(`color:${r.c}`);
    if (r.hl) styles.push(`background-color:${r.hl}`);
    const deco = [];
    if (r.u) deco.push('underline');
    if (r.s) deco.push('line-through');
    if (deco.length) styles.push(`text-decoration:${deco.join(' ')}`);
    if (r.b) s += '<strong>';
    if (r.i) s += '<em>';
    const needSpan = styles.length || r.a;
    if (needSpan){
      const tag = r.a ? 'a' : 'span';
      const attr = [];
      if (styles.length) attr.push(`style="${styles.join(';')}"`);
      if (r.a) attr.push(`href="${escapeHtmlAttr(r.a)}"`);
      s += `<${tag} ${attr.join(' ')}>`;
    }
    return s;
  };
  const closeTag = (r)=>{
    let s = '';
    const needSpan = (r.c||r.hl||r.u||r.s||r.a);
    if (needSpan) s += (r.a?'</a>':'</span>');
    if (r.i) s += '</em>';
    if (r.b) s += '</strong>';
    return s;
  };

  for (const m of marks){
    if (i < m.pos){ html += escapeHtml(text.slice(i, m.pos)); i = m.pos; }
    if (m.open){
      html += openTag(m.r);
      stack.push(m.r);
    } else {
      // 안쪽부터 닫고 나머지 다시 열기
      const bufClose = [];
      while (stack.length){
        const top = stack.pop();
        bufClose.push(closeTag(top));
        if (top === m.r) break;
      }
      // 닫힌 다음 다시 열기
      const toReopen = stack.slice();
      toReopen.forEach(rr=>{ html += openTag(rr); });
      html += bufClose.join('');
    }
  }
  if (i < text.length) html += escapeHtml(text.slice(i));
  return html;
}
// ===== [RUNS-UTILS] END =====
2) 팝업 편집기(함수 initSermonPopup(win)) 패치
2-1) 초깃값 로딩을 runs 우선으로
위치: initSermonPopup 내부, 현재 Ninit() 근처의 “초기화” 부분
액션: 아래 두 함수로 교체/추가하고, Ninit()에서 사용

// [RUNS] 기존 initBlocksFromHTML 대체
function initBlocksFromMeta(meta){
  const b = meta.body;
  if (b && typeof b === 'object' && b.v === 1 && Array.isArray(b.blocks)) {
    NSTATE.blocks = b.blocks.map(x => ({ ...x }));
  } else {
    const legacyHtml = (typeof b === 'string') ? b : (meta.body || '');
    const { text, runs } = htmlToRuns(legacyHtml || '');
    NSTATE.blocks = [{ id:Nuid(), type:'p', text, runs }];
  }
}

// [RUNS] 렌더 함수에서 runs → HTML 적용
function Nrender(){
  neRoot.innerHTML = '';
  for (const b of NSTATE.blocks){
    const el = d.createElement('div');
    el.className = 'editor-block';
    el.dataset.id = b.id;
    el.dataset.type = b.type || 'p';

    if (b.type === 'divider'){
      el.innerHTML = `<div class="handle">⋮⋮</div><div class="content"><hr></div><div class="progress" style="width:0"></div>`;
    } else {
      const html = runsToHtml(b.text||'', b.runs||[]);
      el.innerHTML = `
        <div class="handle">⋮⋮</div>
        <div class="content" contenteditable="true">${html}</div>
        <div class="progress" style="width:0"></div>
      `;
    }
    neRoot.appendChild(el);
  }
  NbindBlockEvents();
}
Ninit()에서 기존의 initBlocksFromHTML(meta.body||'') 호출을 아래처럼 변경:

(function Ninit(){
  initBlocksFromMeta(meta);
  Nrender();
  NpushHistory();
  setTimeout(()=>{ const last = d.querySelector('#editorRoot .editor-block:last-child .content'); last && last.focus(); }, 60);
})();
2-2) 입력 변화 시 HTML→Runs 갱신
위치: NbindBlockEvents() 내부, content.addEventListener('input', ...)
액션: 내용 저장 함수를 runs 기반으로

function NsaveBlock(block){
  const idx = NindexById(block.dataset.id); if (idx<0) return;
  if ((block.dataset.type||'p') === 'divider') return;
  const html = block.querySelector('.content')?.innerHTML || '';
  const { text, runs } = htmlToRuns(html);
  NSTATE.blocks[idx].text = text;
  NSTATE.blocks[idx].runs = runs;
}
content.addEventListener('input', ()=>{ NsaveBlock(block); NscheduleAutosave(); });
2-3) 저장 버튼 핸들러: Runs 문서로 저장
위치: 팝업 하단 버튼 d.getElementById('s').onclick = ...
액션: 기존 NblocksToHTML() 사용부를 아래로 교체

function collectRunsDoc(){
  return { v:1, blocks: NSTATE.blocks.map(b=> ({ ...b })) };
}

d.getElementById('s').onclick = ()=>{
  const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';
  const doc = collectRunsDoc();
  w.opener?.postMessage?.({ type:'sermon-save', title, body: doc, images: [] }, '*');
  w.close();
};
(참고) 게시/자동저장 파트에서도 draft 저장을 blocks 그대로 저장하면 됩니다(이미 NSTATE.blocks가 runs 구조).

3) 부모창(app.js)의 메시지 수신부 수정
위치: openSermonEditorWindow(idx) 안의 onMsg 이벤트 핸들러
액션: data.body가 문자열(구버전) 또는 객체(doc v1) 둘 다 수용

if (data.type === 'sermon-save') {
  const now  = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const payloadBody = data.body; // string or {v:1,blocks:[]}
  if (arr2[idx]) {
    arr2[idx] = { ...arr2[idx], title: data.title, body: payloadBody, images: [], date };
  }
  map2[CURRENT.paraId] = arr2;
  setSermonMap(map2);
  status('설교가 저장되었습니다.');
  renderSermonList();
  window.removeEventListener('message', onMsg);
}
4) 모달 RTE(요약/단위/전체/주석)도 Runs로 저장/로드
4-1) 열 때: Runs → HTML
위치: openSingleDocEditor(kind)
액션: doc.body 타입 분기. RTE에 runsToHtml로 그려 넣기

// 기존: setBodyHTML(doc.body || '');
let bodyHtml = '';
if (doc.body && typeof doc.body === 'object' && doc.body.v === 1){
  // 합쳐서 하나의 HTML로 (단순 join)
  bodyHtml = (doc.body.blocks||[])
    .map(b => (b.type==='divider') ? '<hr/>' : runsToHtml(b.text||'', b.runs||[]))
    .join('');
} else {
  bodyHtml = String(doc.body||''); // 구버전 HTML
}
setBodyHTML(bodyHtml);
4-2) 저장 시: HTML → Runs
위치: el('saveSermon').onclick = ()=>{ ... }
액션: ctxType(요약/맥락 편집기)일 때 sermonBody.innerHTML을 htmlToRuns로 변환해 저장

if(ctxType){
  const key = ctxType==='unit' ? STORAGE_UNIT_CTX
           : ctxType==='whole' ? STORAGE_WHOLE_CTX
           : ctxType==='commentary' ? STORAGE_COMMENTARY
           : STORAGE_SUMMARY;

  // 기존: const body = getBodyHTML()
  const html = getBodyHTML() || '';
  // 단일 큰 문단으로 저장(필요하면 블록 파서로 확장)
  const { text, runs } = htmlToRuns(html);
  const blocks = [{ id: (crypto.randomUUID?.()||String(Date.now())), type:'p', text, runs }];
  const map = getDocMap(key);
  map[pid] = { title, body: { v:1, blocks }, images: imgs, date };
  setDocMap(key, map);

  sermonEditor.dataset.ctxType = '';
  sermonEditor.classList.remove('context-editor');
  modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
  status(`저장됨: ${title}`);
  return;
}
원하시면 여기서도 본문을 문단단위 블록으로 쪼개는 파서를 넣어드릴 수 있습니다(지금은 간단히 p 1블록).

5) 성경 본문 verses 렌더도 runs 지원(옵션)
위치: buildTree() 안의 // (p.verses||[]).forEach(([v,t])=>{ ... })
액션: t가 문자열이면 기존처럼, 객체 {text,runs}면 runsToHtml로 렌더

function renderVerseText(vt){
  if (typeof vt === 'string') return vt; // 기존 호환
  if (vt && typeof vt === 'object' && 'text' in vt){
    return runsToHtml(vt.text || '', vt.runs || []);
  }
  return '';
}

(p.verses||[]).forEach(([v,t])=>{
  const line = document.createElement('div');
  line.className = 'pline';
  line.dataset.verse = v;
  line.innerHTML = `<sup class="pv">${v}</sup>${renderVerseText(t)}`;
  pcontent.appendChild(line);
});
6) 마이그레이션 전략(자동 변환)
열 때 변환: 모달/팝업에서 typeof body === 'string'이면 htmlToRuns()로 바꿔 저장 시 새 포맷으로 고정.

저장 시 고정: 이제부터는 항상 { v:1, blocks:[...] } 저장.

한 줄 요약
Runs 유틸(HTML↔Runs)을 app.js와 팝업에 추가

팝업 저장/렌더를 runs로 전환(2-1~2-3)

부모 메시지 수신부는 body 타입 분기(3)

모달 RTE도 열 때 runs→HTML, 저장 시 HTML→runs(4)

(옵션) 성경 본문 verses도 runs 렌더 지원(5)

필요하시면, 위 패치를 제가 직접 머지한 app.js 완성본으로 묶어 드릴게요.

나의 말:
위치: initSermonPopup 내부, 현재 Ninit() 근처의 “초기화” 부분
액션: 아래 두 함수로 교체/추가하고, Ninit()에서 사용 
"교체/추가하고" 가 무슨 말인가? 교체면 교체고 추가면 추가지, 좀더 명확하게 해줘
ChatGPT의 말:
좋은 지적이에요. “교체/추가”를 딱 잘라 정리하면 이렇게 됩니다.

결론 요약
교체(Replace): initSermonPopup() 안에 이미 있던

initBlocksFromHTML(...) 함수 정의

Nrender() 함수 정의
이 둘을 통째로 새 버전으로 갈아끼웁니다.

추가(Add): 새로 initBlocksFromMeta(meta) 함수를 추가합니다. (기존에 없던 함수)

호출 변경(Modify call site): Ninit() 내부에서 기존 initBlocksFromHTML(meta.body||'') 호출을
새로 추가된 initBlocksFromMeta(meta) 호출로 바꿉니다.

아주 구체적으로(복붙 가이드)
1) 교체할 것 A — 기존 initBlocksFromHTML 삭제(교체)
initSermonPopup(win) 내부에 있는 아래 같은 함수(이름 동일/내용 유사)를 찾아 지우고(또는 주석 처리) 아래 새 버전 흐름에 맞춰 교체합니다.

// [기존 버전 예시]
// function initBlocksFromHTML(html){
//   if(!html || /^\s*$/.test(html)){
//     NSTATE.blocks=[{id:Nuid(), type:'p', html:'여기에 설교를 작성하세요.'}];
//   }else{
//     NSTATE.blocks=[{id:Nuid(), type:'p', html: html}];
//   }
// }
2) 교체할 것 B — 기존 Nrender() 삭제(교체)
initSermonPopup(win) 내부에 있는 Nrender() 함수(현재는 b.html을 그대로 그려주는 형태)를 지우고, 아래 4번에서 주는 **새 버전 Nrender()**로 교체합니다.

// [기존 버전 예시]
// function Nrender(){
//   neRoot.innerHTML = '';
//   for(const b of NSTATE.blocks){
//     const el = d.createElement('div');
//     el.className = 'editor-block';
//     el.dataset.id = b.id; el.dataset.type = b.type;
//     el.innerHTML = `
//       <div class="handle">⋮⋮</div>
//       <div class="content" contenteditable="true">${b.type==='toggle'? NwrapToggle(b.html) : b.html}</div>
//       <div class="progress" style="width:0"></div>
//     `;
//     neRoot.appendChild(el);
//   }
//   NbindBlockEvents();
// }
3) 추가할 것 — 새 함수 initBlocksFromMeta(meta) 추가
바로 위에서 지운 initBlocksFromHTML 자리 **근처(같은 범위)**에 다음 함수를 새로 추가합니다.

// [RUNS] 기존 initBlocksFromHTML 대체: meta.body가 runs이면 그대로, 문자열이면 변환
function initBlocksFromMeta(meta){
  const b = meta.body;
  if (b && typeof b === 'object' && b.v === 1 && Array.isArray(b.blocks)) {
    // 이미 runs 문서(v:1)
    NSTATE.blocks = b.blocks.map(x => ({ ...x }));
  } else {
    // 구버전(문자열 HTML) → runs 변환
    const legacyHtml = (typeof b === 'string') ? b : (meta.body || '');
    const { text, runs } = htmlToRuns(legacyHtml || '');
    NSTATE.blocks = [{ id:Nuid(), type:'p', text, runs }];
  }
}
참고: htmlToRuns/runsToHtml 유틸은 이미 상단 유틸 섹션에 넣었다는 전제입니다.

4) 교체할 것 — 새 버전 Nrender()로 교체
기존 Nrender()를 삭제한 자리에 아래 새 버전을 넣습니다.

// [RUNS] 렌더: runs → HTML로 변환하여 contenteditable에 넣음
function Nrender(){
  neRoot.innerHTML = '';
  for (const b of NSTATE.blocks){
    const el = d.createElement('div');
    el.className = 'editor-block';
    el.dataset.id = b.id;
    el.dataset.type = b.type || 'p';

    if (b.type === 'divider'){
      el.innerHTML = `<div class="handle">⋮⋮</div><div class="content"><hr></div><div class="progress" style="width:0"></div>`;
    } else {
      const html = runsToHtml(b.text||'', b.runs||[]);
      el.innerHTML = `
        <div class="handle">⋮⋮</div>
        <div class="content" contenteditable="true">${html}</div>
        <div class="progress" style="width:0"></div>
      `;
    }
    neRoot.appendChild(el);
  }
  NbindBlockEvents();
}
5) 호출 변경 — Ninit() 안의 한 줄 바꾸기
initSermonPopup(win) 안의 Ninit() 함수에서 이 줄을:

initBlocksFromHTML(meta.body||'');
아래로 바꿉니다:

initBlocksFromMeta(meta);
나머지 줄(Nrender(); NpushHistory(); ...)은 그대로 둡니다.

왜 이렇게 나눴나?
교체 두 개(initBlocksFromHTML, Nrender)는 기존 “HTML-문자열” 기반 로직을 완전히 runs 기반으로 바꿔야 해서 **덮어쓰기(Replace)**가 맞습니다.

추가 하나(initBlocksFromMeta)는 기존에 존재하지 않는 새 진입점(문서 초기화 로직)이므로 **추가(Add)**가 맞습니다.

Ninit()의 호출은 “무엇을 호출하느냐”만 바꾸는 호출부 수정이라 별도로 명시했습니다.

필요하시면 이 변경분을 반영한 initSermonPopup 완성 함수 본문을 통째로 만들어 드릴게요.

나의 말:
위치: NbindBlockEvents() 내부, content.addEventListener('input', ...)
액션: 내용 저장 함수를 runs 기반으로
무슨 말인가? 정확하게
ChatGPT의 말:
좋아요. 딱 잘라 어느 함수의 어떤 줄을 무엇으로 바꾸는지를 말해볼게요.

목적
initSermonPopup() 안의 NbindBlockEvents()에서
content.addEventListener('input', …)가 HTML 문자열을 그대로 저장하던 것을
“Runs 모델(text+runs)”로 저장하게 바꾸는 것입니다.

1) 기존 “HTML 저장” 함수 제거(또는 주석 처리)
위치: initSermonPopup(win) 내부, NbindBlockEvents() 근처에 있던 아래 함수

// (기존) HTML을 그대로 저장하던 함수
function NsaveBlockHTML(block){
  const i = NindexById(block.dataset.id);
  if(i<0) return;
  const content = block.querySelector('.content');
  NSTATE.blocks[i].html = content.innerHTML;
}
이 함수는 더 이상 쓰지 않으므로 삭제하거나 주석 처리하세요.

2) 새 “Runs 저장” 함수 추가
위치: 방금 제거한 자리 근처(같은 스코프 — initSermonPopup 내부, NbindBlockEvents와 같은 레벨)

// (신규) HTML → Runs로 변환해 저장
function NsaveBlock(block){
  const idx = NindexById(block.dataset.id);
  if (idx < 0) return;

  // 구분선(divider)은 내용 없음
  const type = block.dataset.type || 'p';
  if (type === 'divider') return;

  const html = block.querySelector('.content')?.innerHTML || '';
  const { text, runs } = htmlToRuns(html); // ← 상단 Runs 유틸 사용
  NSTATE.blocks[idx].type = type;          // type 유지
  NSTATE.blocks[idx].text = text;          // 본문 텍스트
  NSTATE.blocks[idx].runs = runs;          // 서식 Runs
  // ※ 필요 시 과거 'html' 필드는 제거해도 됩니다.
}
3) content.addEventListener('input', …)를 Runs 저장으로 변경
위치: NbindBlockEvents() 함수 내부, 블록 바인딩 루프에서 각 content에 이벤트 붙이는 부분

바꾸기 전(예시)
content.addEventListener('input', ()=>{
  NsaveBlockHTML(block);  // (구) HTML 저장
  NscheduleAutosave();
});
바꾼 후(정답)
content.addEventListener('input', ()=>{
  NsaveBlock(block);      // (신) Runs 저장
  NscheduleAutosave();
});
4) 함께 손볼 것(권장)
4-1) 선택 툴팁(볼드/이탤릭/하이라이트/링크) 클릭 후에도 Runs 저장
위치: neBubble.addEventListener('click', …) 맨 끝에 추가

// 서식 적용 후 현재 블록을 Runs로 저장
const curBlock = d.getSelection()?.anchorNode?.parentElement?.closest('.editor-block');
if (curBlock) {
  NsaveBlock(curBlock);
  NscheduleAutosave();
}
4-2) 슬래시 메뉴로 블록 타입 바꾼 뒤 즉시 저장
위치: NapplySlash(it) 마지막에 추가

const cur = neRoot.querySelector(`.editor-block[data-id="${id}"]`);
if (cur) {
  NsaveBlock(cur);
  NscheduleAutosave();
}
4-3) 줄바꿈으로 블록을 쪼갤 때 새 블록도 Runs 초기화
위치: NsplitBlock(block) 함수

바꾸기 전(예시)
const text = block.querySelector('.content').textContent || '';
const off  = range.startOffset;
const pre  = text.slice(0, off);
const post = text.slice(off);
NSTATE.blocks[i].html = Nescape(pre);
NSTATE.blocks.splice(i+1,0,{id:Nuid(), type:'p', html: Nescape(post||'')});
Nrender();
바꾼 후(정답)
const html = block.querySelector('.content')?.innerHTML || '';
// 현재 블록 전체를 Runs로 파싱한 뒤, caret 기준으로 앞/뒤를 텍스트로 나눕니다.
const { text, runs } = htmlToRuns(html);

// 텍스트 기준 오프셋(이미 계산된 off)을 사용해 앞/뒤 텍스트를 자릅니다.
const preText  = (text || '').slice(0, off);
const postText = (text || '').slice(off);

// 주의: runs는 범위 분할이 필요하지만, 간단 구현으로는 "양쪽 모두 서식 제거"로 시작해도 OK.
// (완벽 split이 필요하면 runs를 앞/뒤로 잘라서 s/e 재계산 로직을 추가하세요.)
NSTATE.blocks[i].text = preText;
NSTATE.blocks[i].runs = []; // 간이: 앞쪽 서식 제거

NSTATE.blocks.splice(i+1, 0, {
  id: Nuid(),
  type: 'p',
  text: postText,
  runs: [] // 간이: 뒤쪽 서식 제거
});

Nrender();
NscheduleAutosave();
주의: “서식을 보전한 채” 정확히 앞/뒤 runs를 나누고 싶으면, runs의 각 구간을 off 기준으로 잘라 앞쪽 run(s<=off), 뒤쪽 run(s>=off), 걸친 run은 두 개로 분할하는 추가 로직이 필요합니다. 우선은 간이 동작(텍스트만 나누고 서식은 초기화)으로도 충분히 사용할 수 있어, 이렇게 제시합니다.

5) 요약 — 바뀐 라인만 기억하세요
NsaveBlockHTML → 삭제

NsaveBlock(block) → 신규 추가

content.addEventListener('input', …)에서
NsaveBlockHTML(block) → NsaveBlock(block)로 교체

(권장) 서식 버튼/슬래시 변경/스플릿 후에도 NsaveBlock 호출해 항상 Runs 최신화

이렇게 적용하면, 입력·서식 변경이 일어날 때마다 블록 상태가 **{ text, runs }**로 저장되고, 저장 버튼/자동저장에서 그대로 Runs 문서를 내보낼 수 있어요.

나의 말:
위치: 팝업 하단 버튼 d.getElementById('s').onclick = ...
액션: 기존 NblocksToHTML() 사용부를 아래로 교체
무엇을 어떻게 하나는 거야?
ChatGPT의 말:

8s 동안 생각함
좋아요—정확히 어디를 무엇으로 바꾸는지 딱 집어서 안내할게요.

바꾸려는 위치
파일/영역: initSermonPopup(win) 내부

구체 위치: 팝업 하단 저장 버튼 핸들러

d.getElementById('s').onclick = () => { ... }
현재(교체 전)는 대략 이렇게 되어 있어요:

d.getElementById('s').onclick = ()=>{
  const html = NblocksToHTML();
  const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';
  const images = [];
  w.opener?.postMessage?.({ type:'sermon-save', title, body: html, images }, '*');
  w.close();
};
여기서 NblocksToHTML()로 HTML 문자열을 만들어 body로 넘기는 구조죠.

무엇을 어떻게 바꾸나? (정답 코드)
1) runs 문서 수집 함수 추가
동일 스코프(initSermonPopup 내부, 다른 보조함수들 옆)에 아래 함수를 추가하세요.

// runs 문서 수집 유틸: 현재 NSTATE.blocks → { v:1, blocks:[{id,type,text,runs}] }
function collectRunsDocument(){
  return {
    v: 1,
    blocks: (NSTATE.blocks || []).map(b => ({
      id: b.id,
      type: b.type || 'p',
      text: b.text || '',
      runs: Array.isArray(b.runs) ? b.runs : []
    }))
  };
}
주의: 이 함수는 NSTATE.blocks가 이미 runs 기반(text+runs)으로 유지되고 있다는 전제입니다. (앞선 단계에서 NbindBlockEvents()의 저장을 NsaveBlock으로 바꿔둔 상태)

2) 저장 버튼 핸들러 교체
위의 기존 코드를 아래 코드로 통째로 교체하세요.

d.getElementById('s').onclick = ()=>{
  // ① runs 문서로 본문 수집
  const body = collectRunsDocument();

  // ② 제목 수집 (neTitle 우선, 없으면 t)
  const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';

  // ③ 이미지(필요 시 확장), 현재는 빈 배열 유지
  const images = [];

  // ④ 부모창으로 runs 문서 전달
  w.opener?.postMessage?.({ type:'sermon-save', title, body, images }, '*');

  // ⑤ 팝업 종료
  w.close();
};
이렇게 하면 HTML 대신 runs(JSON) 구조가 body로 넘어갑니다.

왜 이 변경이 안전한가?
부모창의 저장 로직은 현재

arr2[idx] = { ...arr2[idx], title: data.title, body: data.body, ... }
처럼 그대로 body를 저장합니다. 즉, 문자열이든 객체든 저장 가능해요.

팝업을 다시 열 때는 meta.body를 initBlocksFromMeta(meta)가 처리하도록 앞서 바꿨죠. 그 함수는

meta.body가 runs 객체({v:1, blocks:[...]})면 바로 사용,

문자열(구버전 HTML)이면 htmlToRuns()로 변환
하므로, 신/구 포맷 모두 호환됩니다.

선택 사항(겸용 저장을 원할 때)
만약 “runs도 저장하고, 동시에 HTML 스냅샷도 갖고 싶다”고 하면 다음처럼 둘 다 보내도 됩니다:

const runsDoc = collectRunsDocument();
const html = NblocksToHTML();
w.opener?.postMessage?.({
  type: 'sermon-save',
  title,
  body: runsDoc,      // 표준: runs
  body_html: html,    // 옵션: 미리보기/검색용 스냅샷
  images
}, '*');
부모창에서는 body_html을 있으면 사용하는 식으로 처리하면 돼요(필수 아님).

최종 체크리스트
 collectRunsDocument() 추가

 d.getElementById('s').onclick = ... 교체

 앞서 NbindBlockEvents가 **runs 저장(NsaveBlock)**으로 이미 전환되어 있어야 함

 initBlocksFromMeta(meta)가 runs/HTML 자동 판별하도록 되어 있어야 함

이대로 바꾸면 “저장”이 항상 runs 기반 JSON으로 나가고, “가져오기/다시열기”는 자동으로 runs를 복원합니다.

나의 말:
위치: openSermonEditorWindow(idx) 안의 onMsg 이벤트 핸들러
액션: data.body가 문자열(구버전) 또는 객체(doc v1) 둘 다 수용 ?
ChatGPT의 말:
좋아요. 이번 부분도 아주 명확하게 정리해드릴게요.
이건 부모창(app.js) 쪽 코드 중, 팝업 창이 닫히면서 설교 데이터를 돌려줄 때 실행되는 부분입니다.

🔍 교체할 정확한 위치
함수 이름: openSermonEditorWindow(idx)

그 안의: window.addEventListener('message', onMsg) 또는 w.addEventListener('message', onMsg)
→ 그 안에 정의된 onMsg(ev) 핸들러

즉, 다음과 같은 구조를 찾으세요 👇

function openSermonEditorWindow(idx){
  ...
  function onMsg(ev){
    const data = ev.data;
    if (!data || !data.type) return;
    if (data.type === 'sermon-save') {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

      const html = data.body; // ← ❌ 구버전: HTML만 처리
      arr2[idx] = { ...arr2[idx], title: data.title, body: html, images: [], date };
      map2[CURRENT.paraId] = arr2;
      setSermonMap(map2);
      status('설교가 저장되었습니다.');
      renderSermonList();
      window.removeEventListener('message', onMsg);
    }
  }
  ...
}
✅ 교체할 코드 (정답)
이 부분 전체를 아래 코드로 교체하세요.

function onMsg(ev){
  const data = ev.data;
  if (!data || !data.type) return;

  if (data.type === 'sermon-save') {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    // 🔹 구버전(문자열 HTML)과 신버전(runs 문서) 모두 허용
    const payloadBody = data.body;

    // 🔸 body가 문자열이면 구버전으로 저장
    // 🔸 body가 객체(v:1)면 runs 문서로 저장
    arr2[idx] = {
      ...arr2[idx],
      title: data.title,
      body: payloadBody,  // 문자열 또는 객체 그대로 저장
      images: data.images || [],
      date
    };

    // 🔹 저장 반영
    map2[CURRENT.paraId] = arr2;
    setSermonMap(map2);
    status('설교가 저장되었습니다.');

    // 🔹 설교 목록 갱신 및 이벤트 해제
    renderSermonList();
    window.removeEventListener('message', onMsg);
  }
}
💡 이렇게 작동합니다
상황	data.body 내용	동작
⬜ 과거 HTML 저장 버전	"html 텍스트"	그대로 문자열로 저장
🟩 새 runs 저장 버전	{ v:1, blocks:[{text, runs}, ...] }	그대로 객체로 저장
→ 즉, 둘 다 한 코드로 자동 처리됩니다.
열 때(initBlocksFromMeta)에서 자동으로 판별하므로 추가 분기 필요 없습니다.

⚙️ 체크리스트
✅ openSermonEditorWindow(idx) 함수 안에 위 코드 반영
✅ 기존 const html = data.body; 부분 삭제
✅ arr2[idx] = ... 줄을 위 코드처럼 교체
✅ setSermonMap(map2) 그대로 유지
✅ 나머지 로직(status, renderSermonList) 그대로 두기

🧩 정리 요약
작업 항목	설명
수정 위치	openSermonEditorWindow() 내부의 onMsg() 함수
수정 이유	data.body가 HTML 문자열일 수도 있고 runs 객체일 수도 있음
수정 내용	const html = data.body; → const payloadBody = data.body; 로 바꾸고, 그대로 저장
결과	두 형식 모두 안전하게 저장됨 (자동 호환)
원하시면 openSermonEditorWindow() 함수 전체를 최종 완성본 형태로 정리한 버전으로도 드릴 수 있습니다.
그렇게 할까요?

나의 말:
위치: openSingleDocEditor(kind)
액션: doc.body 타입 분기. RTE에 runsToHtml로 그려 넣기 ?
ChatGPT의 말:
좋아요. “정확히 어디를 무엇으로 바꾸는지”만 딱 집어서 안내할게요.

1) (한 번만) runsToHtml 유틸 추가
위치: app.js 상단 유틸 섹션(이미 escapeHtml가 있는 곳) 아래에 붙여 넣기

/* ==== runs → HTML ==== */
function runsToHtml(text, runs){
  const t = String(text || '');
  const arr = Array.isArray(runs) ? [...runs] : [];
  arr.sort((a,b)=> (a.s||0) - (b.s||0));

  const esc = s => escapeHtml(s);
  let out = '';
  let i = 0;

  for(const r of arr){
    const s = Math.max(0, Math.min(t.length, r.s|0));
    const e = Math.max(s, Math.min(t.length, r.e|0));
    if(s > i) out += esc(t.slice(i, s));
    const raw = t.slice(s, e);
    const seg = esc(raw);

    let open = '', close = '';
    if(r.b) { open += '<strong>'; close = '</strong>'+close; }
    if(r.i) { open += '<em>';     close = '</em>'+close; }
    if(r.u) { open += '<u>';      close = '</u>'+close; }
    if(r.s) { open += '<s>';      close = '</s>'+close; }
    if(r.color){ open += `<span style="color:${r.color}">`; close = '</span>'+close; }
    if(r.mark){  open += `<mark>`;                           close = '</mark>'+close; }

    out += open + seg + close;
    i = e;
  }
  if(i < t.length) out += esc(t.slice(i));
  return out.replace(/\n/g, '<br>');
}
이미 팝업(editor) 쪽에 비슷한 유틸이 있더라도, 메인 모달 RTE에서도 필요하므로 메인 app.js에 한 번 더 둡니다.

2) openSingleDocEditor(kind) 내부의 본문 주입 로직 교체
위치: openSingleDocEditor(kind) 함수 안에서 doc을 만든 다음 본문을 RTE에 넣는 부분을 아래처럼 바꿉니다.

교체 전(요지)
const map = getDocMap(key);
const doc = map[pid] || {
  body:  (kind==='summary' ? '핵심 내용을 간결하게 요약해 적어주세요.' : ''),
  images: [], date:''
};
...
sermonTitle.value = doc.title || '';
setBodyHTML(doc.body || '');
교체 후(정답)
const map = getDocMap(key);
const doc = map[pid] || {
  body:  (kind==='summary' ? '핵심 내용을 간결하게 요약해 적어주세요.' : ''),
  images: [], date:''
};

let bodyHTML = '';
if (doc && typeof doc.body === 'object' && doc.body.v === 1 && Array.isArray(doc.body.blocks)) {
  // ✅ 새 포맷(doc v1, runs) → 블록들을 HTML로 변환해 합치기
  bodyHTML = doc.body.blocks.map(b => runsToHtml(b.text || '', b.runs || [])).join('');
} else {
  // ✅ 구 포맷(문자열 HTML) 그대로 사용
  bodyHTML = String(doc.body || '');
}

sermonTitle.value = doc.title || '';
setBodyHTML(bodyHTML);
이렇게 하면 doc.body가 문자열(구버전)이어도 OK, 객체(doc v1: runs)여도 OK — RTE에는 항상 HTML로 그려 들어갑니다.

참고(저장 로직은 그대로 둬도 됨)
질문이 “불러와서 그려 넣기”였으므로 저장 부분은 변경하지 않아도 동작합니다.
나중에 맥락 문서도 runs로 저장하고 싶으시면, saveSermon에서 getBodyHTML() 대신 htmlToRuns()로 {v:1, blocks:[...]}를 만들어 저장하도록 추가 패치를 하면 됩니다. (필요하시면 그 부분도 딱 맞게 패치 코드 드릴게요!)

나의 말:
플로팅 툴바가 사라졌네. 복구해줘
ChatGPT의 말:

21s 동안 생각함
오케이. “플로팅 툴바”가 안 보이는 원인은 보통 ① DOM에서 빠짐, ② CSS로 가려짐(z-index/overflow), ③ 이벤트 바인딩 손실 셋 중 하나예요. 아래 패치로 팝업 편집기의 두 가지 플로팅 UI를 확실히 복구합니다.

하단 오른쪽 고정 바: #floatingBar (성경구절 버튼)

선택 시 떠오르는 서식 버블: #neBubble (B/I/U 등)

A) #floatingBar (오른쪽 아래) 복구
1) CSS 보강 (겹침/가림 방지)
위치: initSermonPopup가 만드는 팝업 HTML의 <style> 블록 맨 아래쪽에 추가(또는 있는 규칙 교체)

/* === Floating Bar (복구용) === */
#floatingBar{
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;           /* 최상단으로 */
  display: flex;
  gap: 8px;
  align-items: center;
  background: color-mix(in hsl, var(--panel) 85%, black 6%);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 8px 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
#floatingBar button{ padding:8px 14px; border-radius:999px }
팁: 기존에 있던 #floatingBar{ ... } 규칙이 있으면 위 값으로 교체하세요(특히 position: fixed; z-index: 9999;).

2) DOM 보강(없으면 자동 생성)
위치: initSermonPopup(win) 내부, const w = win, d = w.document; 바로 아래에 추가

// 없으면 자동 재생성 + 클릭 바인딩 복구
(function ensureFloatingBar(){
  let fb = d.getElementById('floatingBar');
  if (!fb) {
    fb = d.createElement('div');
    fb.id = 'floatingBar';
    fb.setAttribute('aria-label','도구 막대');
    fb.innerHTML = `<button id="btnInsertBibleFloating" class="primary">성경구절</button>`;
    d.body.appendChild(fb);
  }
  // 클릭 핸들러 보강(중복 바인딩 방지)
  const btn = d.getElementById('btnInsertBibleFloating');
  if (btn) {
    btn.onclick = null;
    btn.addEventListener('click', insertBiblePrompt);
  }
})();
이미 insertBiblePrompt 함수가 아래쪽에 정의되어 있으므로 그대로 재사용됩니다.

B) 선택 서식 버블 #neBubble 복구
1) CSS 고정 포지션/우선순위 올리기
위치: 팝업 HTML <style>에서 .bubble 규칙을 교체

.bubble{
  position: fixed;          /* ← absolute → fixed */
  padding: 6px;
  border: 1px solid #333;
  border-radius: 12px;
  background: #1c1f2a;
  display: flex;
  gap: 6px;
  z-index: 10000;           /* 최상단으로 */
}
.bubble.hidden{ display:none }
기존에는 position:absolute라 부모/스크롤 영향으로 사라지거나 잘려 보일 수 있어요. fixed로 바꾸면 항상 화면 상단에 떠요.

2) 좌표 산정 코드 수정(스크롤 보정 제거)
위치: initSermonPopup(win) 내부, function NshowBubbleMaybe(){ ... } 교체

function NshowBubbleMaybe(){
  const sel = w.getSelection();
  if (!sel || sel.isCollapsed){ neBubble.classList.add('hidden'); return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  // fixed 기준이므로 scrollX/Y 더하지 않음
  const left = Math.max(8, Math.min(w.innerWidth - 240, rect.left));
  const top  = Math.max(8, rect.top - 42);
  neBubble.style.left = left + 'px';
  neBubble.style.top  = top  + 'px';
  neBubble.classList.remove('hidden');
}
이전 코드의 + w.scrollX / + w.scrollY 보정이 fixed와 충돌해 화면 밖으로 튈 수 있었어요.

3) 선택 해제/포커스 이동 시 숨기기(안 떠있게)
위치: 같은 파일 아무 곳(버블 이벤트 근처)에 추가

d.addEventListener('selectionchange', ()=>{
  const sel = w.getSelection();
  if (!sel || sel.isCollapsed) neBubble.classList.add('hidden');
});
C) overflow로 가려지는 경우(안전 패치)
메인 영역에 과하게 준 overflow: hidden / height: auto !important가 고정 요소를 가릴 때가 있어요.
다음 두 줄로 최상위 요소는 항상 보이게 보정합니다.

위치: 팝업 <style> 맨 아래 추가

html, body{
  overflow: visible !important;  /* fixed 요소 가려짐 방지 */
}
이미 동일한 규칙이 있으면 이 값이 우선되도록 맨 아래 배치하세요.

마지막 체크리스트
 #floatingBar CSS에 position:fixed; z-index:9999; 적용

 ensureFloatingBar()로 DOM/이벤트 자동 복구

 .bubble를 position:fixed; z-index:10000;로

 NshowBubbleMaybe()에서 좌표 계산 시 scrollX/Y 제거

 selectionchange로 자동 숨김

 html, body { overflow: visible !important; } (충돌 시)

이대로 넣으면 두 플로팅 UI가 다시 항상 위에, 항상 보이게 돌아옵니다.

나의 말:
코드를 수정할 때, 기존의 기능이 사라지게 하지 말아
ChatGPT의 말:

4초 동안 생각함
맞아요. 기존 기능이 사라지지 않게 하려면 “교체”보다 “덧대기(보강)” 전략으로 가야 합니다. 아래 원칙 + 바로 쓸 수 있는 안전 패치 패턴을 드릴게요. 전부 기존 코드와 공존하도록 설계했습니다.

수정 원칙 (핵심 6가지)
추가 우선: 기존 함수를 지우지 말고, “보강 함수”를 만들어 내부에서 호출하거나, 기존 함수 끝에 옵션처럼 붙입니다.

하위호환 유지: 데이터는 둘 다 저장/로딩 (구 HTML ✚ 신 runs).

이벤트는 addEventListener: onclick= 대입으로 갈아끼우지 말고, 새 리스너를 추가합니다.

CSS는 덮어쓰기 금지: 기존 규칙 아래쪽에 “특정성 높은 보강 규칙”을 추가합니다(필요시 !important).

idempotent 보장: 보강 함수는 여러 번 불러도 상태를 망가뜨리지 않게 작성합니다(ensure* 패턴).

Feature-flag/폴백: 새 포맷이나 기능이 실패해도 자동으로 구방식으로 폴백.

바로 적용하는 안전 패턴들
A. HTML→runs 전환: “교체” 대신 “겸용”
1) 저장: HTML과 runs를 둘 다 보냅니다
위치: initSermonPopup(win) 하단 저장 버튼

d.getElementById('s').onclick = ()=>{
  const runsDoc = collectRunsDocument();  // 새 포맷
  const html    = NblocksToHTML();        // 기존 포맷

  const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';
  const images = [];

  w.opener?.postMessage?.({
    type: 'sermon-save',
    title,
    body: runsDoc,     // 표준 저장: runs
    body_html: html,   // 호환 스냅샷: HTML (기존 기능 유지)
    images
  }, '*');

  w.close();
};
부모창은 data.body(runs) 저장, data.body_html은 미리보기/검색 등 선택적 활용. 기존에 HTML만 쓰던 코드가 있어도 깨지지 않습니다.

2) 부모창 onMsg: 두 필드 모두 수용
위치: openSermonEditorWindow(idx)의 onMsg(ev)

if (data.type === 'sermon-save') {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  arr2[idx] = {
    ...arr2[idx],
    title: data.title,
    body:  data.body,         // 객체(v1) 또는 문자열(구버전) 허용
    body_html: data.body_html ?? arr2[idx]?.body_html, // 있으면 보관
    images: data.images || [],
    date
  };

  map2[CURRENT.paraId] = arr2;
  setSermonMap(map2);
  status('설교가 저장되었습니다.');
  renderSermonList();
  window.removeEventListener('message', onMsg);
}
이렇게 하면 신/구 저장물 모두 잃지 않고 쌓입니다.

3) 열기: 우선순위 runs → HTML 폴백
위치: 팝업 초기화(initSermonPopup)에서 meta 복원하는 지점

function initBlocksFromMeta(meta){
  // ① runs 우선
  if (meta?.body && typeof meta.body === 'object' && meta.body.v === 1 && Array.isArray(meta.body.blocks)) {
    NSTATE.blocks = meta.body.blocks.map(b => ({
      id: b.id || Nuid(),
      type: b.type || 'p',
      text: b.text || '',
      runs: Array.isArray(b.runs) ? b.runs : []
    }));
    return;
  }
  // ② body_html 있으면 그걸 사용
  if (typeof meta?.body_html === 'string' && meta.body_html.trim()) {
    const { blocks } = htmlToRuns(meta.body_html);
    NSTATE.blocks = blocks;
    return;
  }
  // ③ 구 body(문자열) 폴백
  const legacy = (typeof meta?.body === 'string') ? meta.body : '';
  const { blocks } = htmlToRuns(legacy);
  NSTATE.blocks = blocks.length ? blocks : [{ id: Nuid(), type:'p', text:'', runs:[] }];
}
이 함수는 기존 초기화를 대체하지 않고 교체/추가로 삽입하세요(기존 함수를 남겨두고 새 곳에서 이 함수를 호출해도 됨).

B. NbindBlockEvents는 기존 동작 유지 + runs 동시 저장
위치: initSermonPopup(win) 내부

// 기존 함수를 남겨둔다 (혹시 다른 곳에서 참조할 수도 있으니)
function NsaveBlockHTML(block){
  const i = NindexById(block.dataset.id);
  if(i<0) return;
  const content = block.querySelector('.content');
  NSTATE.blocks[i].html = content.innerHTML;
}

// 새 runs 저장을 "덧대기"
function NsaveBlockRuns(block){
  const idx = NindexById(block.dataset.id);
  if (idx < 0) return;
  const html = block.querySelector('.content')?.innerHTML || '';
  const { text, runs } = htmlToRuns(html);
  NSTATE.blocks[idx].text = text;
  NSTATE.blocks[idx].runs = runs;
}

// 이벤트에는 둘 다 적용 (기존 기능 보존)
content.addEventListener('input', ()=>{
  NsaveBlockHTML(block);   // 구방식 유지
  NsaveBlockRuns(block);   // 신방식 추가
  NscheduleAutosave();
});
덧대기라서 예전 기능(HTML 저장)을 건드리지 않습니다.

C. 플로팅 UI는 “ensure 패턴”으로 복구(덧대기)
위치: initSermonPopup(win) 내부 가장 위 근처

(function ensureFloatingBar(){
  const d = win.document;
  let fb = d.getElementById('floatingBar');
  if (!fb) {
    fb = d.createElement('div');
    fb.id = 'floatingBar';
    fb.innerHTML = `<button id="btnInsertBibleFloating" class="primary">성경구절</button>`;
    d.body.appendChild(fb);
  }
  const btn = d.getElementById('btnInsertBibleFloating');
  if (btn) {
    btn.removeEventListener('click', insertBiblePrompt);
    btn.addEventListener('click', insertBiblePrompt);
  }
})();
CSS는 추가만 (파일 맨 아래에 붙이기)

#floatingBar{ position:fixed; right:16px; bottom:16px; z-index:9999; }
html, body{ overflow:visible !important; }
기존 규칙과 충돌하지 않고, 사라져도 다시 만들어 줍니다.

D. 모달 RTE: runsToHtml로 그리기만 추가 (저장은 기존대로 유지)
위치: openSingleDocEditor(kind)
주입부만 runs → HTML 변환을 덧대기:

let bodyHTML = '';
if (doc && typeof doc.body === 'object' && doc.body.v === 1 && Array.isArray(doc.body.blocks)) {
  bodyHTML = doc.body.blocks.map(b => runsToHtml(b.text || '', b.runs || [])).join('');
} else if (typeof doc.body_html === 'string' && doc.body_html.trim()) {
  bodyHTML = doc.body_html;
} else {
  bodyHTML = String(doc.body || '');
}
setBodyHTML(bodyHTML);
저장(saveSermon)은 당장 바꾸지 않아도 기능 유지. 나중에 runs 저장으로 전환할 땐 위 B 패턴처럼 덧대기로 추가하세요.

최종 점검 체크리스트
 기존 함수/이벤트/스타일 삭제하지 않음

 저장: body(runs) + body_html(HTML) 동시 전달

 로딩: runs → body_html → body(문자열) 우선순위 폴백

 이벤트: addEventListener 사용, 기존 리스너 유지

 CSS: 아래쪽에 추가하여 우선순위로만 제어

 ensure* 유틸로 DOM/핸들러 중복 안전

원하시면, 위 패턴을 당신 코드 베이스에 바로 붙일 수 있는 최소 diff로 정리해 드릴게요.

나의 말:
파일 맨 아래에 붙이기 ?
ChatGPT의 말:
좋아요 😊
제가 말한 “파일 맨 아래에 붙이기”는 아주 구체적으로 다음을 뜻합니다.

✅ 의미 설명
대상:
index.html 파일의 <style> 블록 또는 별도 style.css 파일

위치:
파일의 가장 마지막 부분, 즉

닫는 </style> 태그 바로 위쪽
또는

CSS 파일이면 마지막 줄(맨 아래)에

새로 추가하거나 보강하는 CSS를 붙이는 걸 말합니다.

🔧 예시 ① — index.html 내부 <style> 방식
<style>
  :root {
    --bg: #0f1115;
    --panel: #161922;
    --text: #e6e8ef;
    /* ... 기존 CSS ... */
  }

  /* 기존 스타일 다 끝난 뒤 */

  /* === [추가] floating bar 복구용 보강 === */
  #floatingBar {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 9999;
  }

  html, body {
    overflow: visible !important;
  }
</style>
즉, 기존 스타일 끝난 직후
→ </style> 태그 바로 위에 넣으시면 됩니다.

🔧 예시 ② — style.css 파일일 경우
/* ... 기존 모든 CSS ... */

/* === [추가] floating bar 복구용 보강 === */
#floatingBar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;
}

html, body {
  overflow: visible !important;
}
맨 마지막 줄에 붙이면 됩니다.
(CSS는 아래쪽 규칙이 우선 적용되므로, 이렇게 하면 기존 규칙이 덮이지 않고 “보강”됩니다.)

📌 요약
항목	설명
파일	index.html의 <style> 블록 또는 style.css
위치	파일 제일 끝 (기존 CSS 끝난 후)
이유	CSS는 “아래에 있을수록 우선 적용”되므로, 기존 기능 유지하면서 시각적 오류만 보강 가능
원하시면 제가 현재 쓰고 있는 CSS 끝부분을 보고,
정확히 어느 줄 뒤에 붙여야 안전한지 짚어서 드릴 수도 있어요.
원하신다면 style.css 혹은 <style> 부분 코드 마지막 20줄 정도만 보여주시겠어요?

나의 말:
위치: openSingleDocEditor(kind)
주입부만 runs → HTML 변환을 덧대기:
ChatGPT의 말:
좋아요. 요청대로 openSingleDocEditor(kind)의 “본문 주입부”만 runs → HTML 변환을 “덧대기”로 넣는 정확한 패치입니다. 기존 기능은 유지됩니다.

바꿀 위치
openSingleDocEditor(kind) 안에서 doc을 만든 뒤 RTE에 본문을 넣는 부분(지금은 sermonTitle.value = ...; setBodyHTML(doc.body || '');로 되어 있는 구간)만 교체합니다.

교체 전(요지)
sermonTitle.value = doc.title || '';
setBodyHTML(doc.body || '');
교체 후(정답)
// ✅ runs → HTML 변환 주입 (덧대기)
// runsToHtml(text, runs) 유틸이 상단에 있어야 합니다. (없다면 추가하세요)
let bodyHTML = '';
if (doc && typeof doc.body === 'object' && doc.body.v === 1 && Array.isArray(doc.body.blocks)) {
  // 새 포맷(doc v1, runs) → 각 블록을 HTML로 변환해 이어 붙임
  bodyHTML = doc.body.blocks
    .map(b => runsToHtml(b.text || '', b.runs || []))
    .join('');
} else if (typeof doc.body_html === 'string' && doc.body_html.trim()) {
  // 선택: 호환용 HTML 스냅샷이 있으면 그걸 우선 사용
  bodyHTML = doc.body_html;
} else {
  // 구 포맷(문자열 HTML) 폴백
  bodyHTML = String(doc.body || '');
}

sermonTitle.value = doc.title || '';
setBodyHTML(bodyHTML);
🔸 이건 “덧대기” 방식이라 저장 로직이나 다른 기능은 건드리지 않습니다.
🔸 doc.body가 runs 문서이든, 기존 HTML 문자열이든, 혹은 doc.body_html(호환 스냅샷)이든 자동으로 맞춰서 RTE에 HTML로 그려집니다.

runsToHtml 유틸 (없으면 한 번만 추가)
app.js 상단 유틸 섹션(예: escapeHtml 아래)에 한 번만 넣어두세요:

function runsToHtml(text, runs){
  const t = String(text || '');
  const arr = Array.isArray(runs) ? [...runs] : [];
  arr.sort((a,b)=> (a.s||0) - (b.s||0));

  const esc = s => escapeHtml(s);
  let out = '';
  let i = 0;

  for (const r of arr) {
    const s = Math.max(0, Math.min(t.length, r.s|0));
    const e = Math.max(s, Math.min(t.length, r.e|0));
    if (s > i) out += esc(t.slice(i, s));
    const raw = t.slice(s, e);
    const seg = esc(raw);

    let open = '', close = '';
    if (r.b)      { open += '<strong>'; close = '</strong>' + close; }
    if (r.i)      { open += '<em>';     close = '</em>'     + close; }
    if (r.u)      { open += '<u>';      close = '</u>'      + close; }
    if (r.s)      { open += '<s>';      close = '</s>'      + close; }
    if (r.color)  { open += `<span style="color:${r.color}">`; close = '</span>' + close; }
    if (r.mark)   { open += `<mark>`;   close = '</mark>'   + close; }

    out += open + seg + close;
    i = e;
  }
  if (i < t.length) out += esc(t.slice(i));
  return out.replace(/\n/g, '<br>');
}
요약
수정 위치: openSingleDocEditor(kind) 내부, RTE에 본문 넣는 곳만

수정 방식: 기존 setBodyHTML(doc.body || '') → runs 지원을 덧대기
(우선순위: doc.body(v1 runs) → doc.body_html → doc.body(문자열))

기존 기능은 전혀 지우지 않고, 새 포맷 지원만 추가한 형태입니다.

나의 말:
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Web Bible Paragraph Sermon</title>
  <style>
    :root{
      --bg:#0f1115; --panel:#161922; --text:#e6e8ef; --muted:#9aa0ab;
      --accent:#6ea8fe; --border:#252a36; --danger:#ff6b6b; --titleBlue:#9fd0ff;
    }
    *{ box-sizing:border-box } html,body{ height:100% }
    body{
      margin:0; font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans KR",sans-serif;
      background:var(--bg); color:var(--text);
      display:grid; grid-template-rows:64px 1fr; gap:10px;
    }
    header{
      display:flex; align-items:center; gap:10px; padding:8px 10px;
      background:var(--panel); border-bottom:1px solid var(--border);
      position:sticky; top:0; z-index:5;
    }
    header h1{ font-size:16px; margin:0; font-weight:700 }
    .muted{ color:var(--muted) }
    .pill{
      display:flex; gap:8px; align-items:center; border:1px solid var(--border);
      background:color-mix(in hsl, var(--panel) 80%, black 8%); padding:6px 8px; border-radius:10px;
    }
    select, input[type="range"]{ background:transparent; color:var(--text); border:1px solid var(--border); border-radius:8px; padding:4px 6px }
    option{ color:#000 }
    button{
      background:color-mix(in hsl, var(--panel) 65%, black 10%); color:var(--text);
      border:1px solid var(--border); border-radius:10px; padding:6px 10px; cursor:pointer;
      transition:border-color .15s, transform .04s;
    }
    button:hover{ border-color:color-mix(in hsl, var(--border) 80%, var(--accent) 20%) }
    button:active{ transform:translateY(1px) }
    .primary{
      background:linear-gradient(180deg,color-mix(in srgb, var(--accent) 75%, white 10%), color-mix(in srgb, var(--accent) 75%, black 20%));
      border-color:color-mix(in srgb, var(--accent) 70%, black 10%);
    }

    .layout{ display:grid; grid-template-columns:1fr; gap:10px; padding:0 10px 12px }
    .card{ background:var(--panel); border:1px solid var(--border); border-radius:14px; overflow:hidden; display:flex; flex-direction:column; min-width:0 }
    .scroller{ overflow:auto; padding:12px }
    .footer{ padding:8px 12px; border-top:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap }

    #tree{ padding:8px }
    details{
      border:1px solid var(--border); border-radius:10px; padding:6px 8px; margin-bottom:8px;
      background:color-mix(in hsl, var(--panel) 80%, black 8%);
    }
    summary{ cursor:pointer; list-style:none; display:flex; align-items:center; gap:8px }
    summary::-webkit-details-marker{ display:none }
    .tw{ font-weight:700 }
    .chapters{ display:grid; gap:6px; margin-top:6px }
    .paras{ display:grid; gap:6px; margin:8px 0 2px }
    .chip{
      font-size:.92em; padding:6px 10px; border:1px solid var(--border); border-radius:999px;
      display:inline-flex; align-items:center; gap:6px; background:color-mix(in hsl, var(--panel) 88%, black 4%); white-space:nowrap;
    }
    .chip:hover{ border-color:var(--accent) }
    .ptitle{ font-weight:800; color:var(--titleBlue) }
    .vrange{ color:var(--muted); font-weight:700 }

    .pbody{ margin-top:8px; border-top:1px dashed var(--border); padding-top:8px }
    .ptoolbar{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px }

    /* ✅ 설교 버튼이 가려지거나 사라지는 것 방지 */
    .ptoolbar .spacer { flex: 1 1 auto; }
    .ptoolbar .sermBtn { display: inline-flex; }

    .pline{ padding:4px 6px; border-left:3px solid transparent; border-radius:8px; transition: background .15s, border-color .15s }
    .pline:hover{ background:color-mix(in hsl, var(--panel) 80%, black 12%) }
    .pline.reading{ background:color-mix(in hsl, var(--accent) 15%, black 0%); border-left-color:var(--accent) }
    .pv{ color:var(--muted); font-size:.88em; vertical-align:super; margin-right:4px }

    .modal-backdrop{ position:fixed; inset:0; background:rgba(0,0,0,.45); display:none; align-items:center; justify-content:center; z-index:50 }
    .modal{ width:min(1200px, 96vw); max-height:94vh; overflow:auto; background:var(--panel); border:1px solid var(--border); border-radius:14px }
    .modal .head{
      position:sticky; top:0; background:var(--panel); padding:12px 14px;
      display:flex; gap:10px; align-items:center; border-bottom:1px solid var(--border)
    }
    .list{ padding:12px 14px; display:grid; gap:8px }
    .item{ border:1px solid var(--border); border-radius:10px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap }
    .item-title{ font-weight:700; color:var(--titleBlue); line-height:1.15; display:flex; align-items:center; gap:8px; flex-wrap:wrap }
    .item-title .date{ margin-left:8px; color:var(--muted); font-weight:400; font-size:.92em }

    .editor{ padding:14px; display:grid; gap:12px; background:var(--panel) }
    .editor input[type="text"], .editor textarea{ width:100%; background:#161922; color:#e6e8ef; border:1px solid #2a3040; border-radius:8px; padding:10px 12px }
    .editor textarea{ min-height:360px; resize:vertical }
    .editor-bar{ display:flex; gap:8px; align-items:center; flex-wrap:wrap }
    .editor-bar .grow{ flex:1 1 auto }

    /* [맥락 편집기 전용] 보기 좋은 타이포/레이아웃 */
    .context-editor {
      font-family: "Noto Serif KR", "Nanum Myeongjo", serif;
      font-size: 1.05rem;
      line-height: 1.85;
      letter-spacing: 0.02em;
      word-break: keep-all;
      background: var(--panel);
      color: var(--text);
      border-radius: 12px;
      box-shadow: 0 6px 16px rgba(0,0,0,0.25);
    }
    .context-editor input[type="text"]{
      font-family: "Noto Serif KR", "Nanum Myeongjo", serif;
      font-weight: 600;
      font-size: 1.12rem;
      letter-spacing: 0.01em;
    }
    .context-editor .rte{
      min-height:360px;resize:vertical;padding:14px;background:#161922;border:1px solid #2a3040;border-radius:10px;line-height:1.85;letter-spacing:.015em;caret-color:var(--accent);outline:none
    }
    .context-editor em,.context-editor strong,.context-editor b{
      color:#ffd66e;font-weight:600;font-style:normal
    }
    .context-editor blockquote{
      margin:12px 0;padding:10px 14px;border-left:3px solid var(--accent);
      color:#c0cad6;font-style:italic;background:rgba(255,255,255,.04);border-radius:8px
    }
    .context-editor ::selection{background:rgba(110,168,254,.25)}
    @media (max-width:640px){.context-editor{font-size:1rem}}
    @media (prefers-color-scheme:light){
      .context-editor{color:#1b2533;background:#fff;box-shadow:0 6px 16px rgba(0,0,0,.08)}
      .context-editor blockquote{color:#445066;background:#f7f9fc}
    }

    /* ==== 모달 편집기(sermonEditor) 줄 간격 타이트 모드 ==== */
    #sermonEditor.context-editor .rte{
      line-height: 1.55 !important;
      letter-spacing: 0.01em !important;
    }
    #sermonEditor.context-editor .rte p{ margin: 6px 0; }
    #sermonEditor.context-editor .rte .verse-line{ line-height: 1.5; }
    #sermonEditor.context-editor .rte .verse-line sup{ margin-right:4px; }
    #sermonEditor.context-editor .rte br{ line-height: 1.0; }

    /* ===== 모달 편집기: 본문만 스크롤 ===== */
    #sermonEditor{
      display:flex; flex-direction:column;
      height: calc(94vh - 56px); min-height: calc(94vh - 56px); max-height: calc(94vh - 56px);
      overflow: hidden;
    }
    #sermonEditor .rte {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding-top: var(--editor-pad-top, 0px);
      margin-top: 0 !important;
      scroll-padding-top: var(--editor-pad-top, 0px);
    }

    /* RTE 툴바 고정 */
    #rteToolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
    }

    /* ===== 삽입된 성경구절 스타일 ===== */
    .inserted-verse { font-style: italic; color: #ff8080; }
    .verse-header { margin-bottom:2px; }
    .verse-line { font-style: italic; color:#ff8080; }

    /* 설교목록 링크 필드 */
    .link-box{
      display:flex; align-items:center; gap:6px; min-width:260px; flex:1 1 320px;
    }
    .link-box input{
      flex:1 1 auto; min-width:200px;
      background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;padding:6px 8px
    }
    .link-box a{
      text-decoration:underline; color:#9fd0ff; word-break:break-all;
      max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .ptoolbar .sermBtn{ margin-left:auto }
    
    /* 응급: 설교 버튼 가시성 강제 */
    .ptoolbar .sermBtn { display:inline-flex !important; visibility:visible !important; opacity:1 !important; }

    #floatingBar{ position:fixed; right:16px; bottom:16px; z-index:9999; }
    html, body{ overflow:visible !important; }

  </style>

  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&family=Nanum+Myeongjo&display=swap" rel="stylesheet">
</head>
<body>
  <header>
    <h1>Web Bible Paragraph 3.0</h1>

    <div class="pill"><button id="btnSaveJSON">JSON 저장</button></div>

    <div class="pill">
      <button id="btnExportAll">내보내기</button>
      <input id="importFile" type="file" accept="application/json" style="display:none">
      <button id="btnImportAll">가져오기</button>
    </div>

    <div class="pill">
      <span class="muted">음성</span>
      <select id="voiceSelect" title="한국어 보이스 선택">
        <option value="">브라우저 기본(ko-KR)</option>
      </select>
      <button id="testVoice">시험</button>
    </div>

    <div class="pill">
      <span class="muted">속도</span>
      <input id="rateCtl" type="range" min="0.6" max="1.4" step="0.02" value="0.95" />
      <span class="muted">톤</span>
      <input id="pitchCtl" type="range" min="0.6" max="1.4" step="0.02" value="1.00" />
    </div>

    <div class="pill" id="voiceHint" style="display:none">
      <span class="muted">한국어 보이스가 1개뿐이라 스타일 프리셋을 추가했습니다.</span>
    </div>

    <div style="flex:1"></div>
    <div class="pill"><span class="muted">단축키:</span> <span> S</span> 재생/중지 <span> · N</span> 다음 단락</div>
  </header>

  <div class="layout">
    <section class="card">
      <div class="scroller"><div id="tree"></div></div>
      <div class="footer"><div class="muted" id="status">bible-paragraph.json을 불러오는 중…</div></div>
    </section>
  </div>

  <div id="modalWrap" class="modal-backdrop" aria-hidden="true">
    <div class="modal">
      <div class="head">
        <strong id="modalTitle">단락 성경</strong>
        <span class="muted" id="modalRef">—</span>
        <div class="grow"></div>
        <button id="closeModal">닫기</button>
      </div>

      <div class="list" id="sermonList"></div>

      <!-- 단일 편집기 (중복 제거) -->
      <div class="editor context-editor" id="sermonEditor" style="display:none">
        <div id="rteToolbar" class="editor-bar">
          <button type="button" onclick="execFmt('bold')"><b>B</b></button>
          <button type="button" onclick="execFmt('italic')"><i>I</i></button>
          <button type="button" onclick="execFmt('underline')"><u>U</u></button>
          <button type="button" onclick="execFmt('strikeThrough')"><s>S</s></button>
          <div class="grow"></div>
        </div>

        <input id="sermonTitle" type="text" placeholder="제목" style="display:none" />
        <div id="sermonBody" class="rte" contenteditable="true" spellcheck="false"></div>

        <div class="editor-bar">
          <div class="grow"></div>
          <button id="editorSpeak" class="primary">낭독</button>
          <button id="saveSermon" class="primary">저장</button>
        </div>
      </div>

      <div id="modalFooterNew" class="footer" style="padding:10px 14px; border-top:1px solid var(--border)">
        <button id="newSermonBtn" class="primary">새 설교</button>
      </div>
    </div>
  </div>

  <script src="app.js" defer></script>
</body>
</html>

/* --------- Utils --------- */

const AI_ENDPOINT = 'http://localhost:5174/api/unit-context';
const el = id => document.getElementById(id);
const treeEl = el('tree'), statusEl = el('status');
function status(msg){ statusEl.textContent = msg; }
function escapeHtml(s){ return (s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function stripBlankLines(s){return String(s||'').split(/\r?\n/).filter(l=>l.trim()!=='').join('\n');}

// ===== [RUNS-UTILS] BEGIN: HTML ↔ Runs 공용 유틸 =====
function escapeHtmlAttr(s){ return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function escapeHtml(s){ const t=document.createElement('div'); t.textContent=String(s); return t.innerHTML; }

/* ==== runs → HTML ==== */
function runsToHtml(text, runs){
  const t = String(text || '');
  const arr = Array.isArray(runs) ? [...runs] : [];
  arr.sort((a,b)=> (a.s||0) - (b.s||0));

  const esc = s => escapeHtml(s);
  let out = '';
  let i = 0;

  for(const r of arr){
    const s = Math.max(0, Math.min(t.length, r.s|0));
    const e = Math.max(s, Math.min(t.length, r.e|0));
    if(s > i) out += esc(t.slice(i, s));
    const raw = t.slice(s, e);
    const seg = esc(raw);

    let open = '', close = '';
    if(r.b) { open += '<strong>'; close = '</strong>'+close; }
    if(r.i) { open += '<em>';     close = '</em>'+close; }
    if(r.u) { open += '<u>';      close = '</u>'+close; }
    if(r.s) { open += '<s>';      close = '</s>'+close; }
    if(r.color){ open += <span style="color:${r.color}">; close = '</span>'+close; }
    if(r.mark){  open += <mark>;                           close = '</mark>'+close; }

    out += open + seg + close;
    i = e;
  }
  if(i < t.length) out += esc(t.slice(i));
  return out.replace(/\n/g, '<br>');
}

// Run = { s:number, e:number, b?:1, i?:1, u?:1, s?:1, c?:string, hl?:string, a?:string }
function mergeRuns(runs){
  if (!runs || !runs.length) return [];
  const arr = [...runs].sort((a,b)=> a.s - b.s || a.e - b.e);
  const out = [];
  for (const r of arr){
    const last = out[out.length-1];
    const same = last && last.b===r.b && last.i===r.i && last.u===r.u && last.s===r.s && last.c===r.c && last.hl===r.hl && last.a===r.a;
    if (same && last.e >= r.s) last.e = Math.max(last.e, r.e);
    else out.push({...r});
  }
  return out;
}
function htmlToRuns(html){
  const div = document.createElement('div');
  div.innerHTML = html || '';
  const runs = [];
  let text = '';
  let offset = 0;

  function pushRun(s, e, st){
    if (e<=s) return;
    const r = { s, e };
    if (st.bold) r.b = 1;
    if (st.italic) r.i = 1;
    if (st.underline) r.u = 1;
    if (st.strike) r.s = 1;
    if (st.color) r.c = st.color;
    if (st.highlight) r.hl = st.highlight;
    if (st.href) r.a = st.href;
    runs.push(r);
  }
  function styled(el, base){
    const st = {...(base||{})};
    const tag = el.nodeName?.toLowerCase?.() || '';
    if (tag==='b'||tag==='strong') st.bold = true;
    if (tag==='i'||tag==='em') st.italic = true;
    if (tag==='u') st.underline = true;
    if (tag==='s'||tag==='del') st.strike = true;
    if (tag==='a'){ const href = el.getAttribute('href'); if (href) st.href = href; }
    const css = el.getAttribute?.('style')||'';
    const m1 = css.match(/color\s*:\s*([^;]+)/i);
    const m2 = css.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (m1) st.color = m1[1].trim();
    if (m2) st.highlight = m2[1].trim();
    return st;
  }
  function walk(node, st){
    if (node.nodeType===3){
      const raw = node.nodeValue||'';
      if (!raw) return;
      const start = offset;
      text += raw;
      offset += raw.length;
      if (st.bold||st.italic||st.underline||st.strike||st.color||st.highlight||st.href){
        pushRun(start, offset, st);
      }
      return;
    }
    if (node.nodeType!==1) return;
    const tag = node.nodeName.toLowerCase();
    if (tag==='sup' && node.classList.contains('pv')) return; // 절번호 저장 제외

    const st2 = styled(node, st||{});
    node.childNodes.forEach(n=>walk(n, st2));
    if (['p','div','li','blockquote'].includes(tag)){ text+='\n'; offset+=1; }
  }
  walk(div, {});
  text = text.replace(/\n{2,}$/,'\n');
  return { text, runs: mergeRuns(runs) };
}

function runsToHtml(text, runs){
  text = String(text||'');
  const marks = [];
  (runs||[]).forEach(r=>{ marks.push({pos:r.s,open:1,r}); marks.push({pos:r.e,open:0,r}); });
  marks.sort((a,b)=> a.pos - b.pos || (a.open? -1 : 1));
  let html = '', i = 0;
  const stack = [];
  const openTag = (r)=>{
    let s = '';
    const styles = [];
    if (r.c) styles.push(color:${r.c});
    if (r.hl) styles.push(background-color:${r.hl});
    const deco = [];
    if (r.u) deco.push('underline');
    if (r.s) deco.push('line-through');
    if (deco.length) styles.push(text-decoration:${deco.join(' ')});
    if (r.b) s += '<strong>';
    if (r.i) s += '<em>';
    const needSpan = styles.length || r.a;
    if (needSpan){
      const tag = r.a ? 'a' : 'span';
      const attr = [];
      if (styles.length) attr.push(style="${styles.join(';')}");
      if (r.a) attr.push(href="${escapeHtmlAttr(r.a)}");
      s += <${tag} ${attr.join(' ')}>;
    }
    return s;
  };
  const closeTag = (r)=>{
    let s = '';
    const needSpan = (r.c||r.hl||r.u||r.s||r.a);
    if (needSpan) s += (r.a?'</a>':'</span>');
    if (r.i) s += '</em>';
    if (r.b) s += '</strong>';
    return s;
  };

  for (const m of marks){
    if (i < m.pos){ html += escapeHtml(text.slice(i, m.pos)); i = m.pos; }
    if (m.open){
      html += openTag(m.r);
      stack.push(m.r);
    } else {
      // 안쪽부터 닫고 나머지 다시 열기
      const bufClose = [];
      while (stack.length){
        const top = stack.pop();
        bufClose.push(closeTag(top));
        if (top === m.r) break;
      }
      // 닫힌 다음 다시 열기
      const toReopen = stack.slice();
      toReopen.forEach(rr=>{ html += openTag(rr); });
      html += bufClose.join('');
    }
  }
  if (i < text.length) html += escapeHtml(text.slice(i));
  return html;
}
// ===== [RUNS-UTILS] END =====

function syncCurrentFromOpen(){
  const openPara = treeEl.querySelector('details.para[open]');
  if(!openPara) return false;
  const t = openPara.querySelector('summary .ptitle');
  if(!t) return false;
  const book = t.dataset.book;
  const chap = parseInt(t.dataset.ch, 10);
  const idx  = parseInt(t.dataset.idx, 10);
  const para = BIBLE?.books?.[book]?.[chap]?.paras?.[idx];
  if(!para) return false;
  CURRENT.book   = book;
  CURRENT.chap   = chap;
  CURRENT.paraIdx= idx;
  CURRENT.paraId = ${book}|${chap}|${para.ref};
  return true;
}

// 제목 변경 반영
function updateParaTitle(book, chap, idx, newTitle){
  try{
    const para = BIBLE?.books?.[book]?.[chap]?.paras?.[idx];
    if(!para) return;
    para.title = newTitle;
    const s = document.querySelector(
      summary .ptitle[data-book="${CSS.escape(String(book))}"][data-ch="${CSS.escape(String(chap))}"][data-idx="${CSS.escape(String(idx))}"]
    );
    if(s) s.textContent = newTitle;
  }catch(_){}
}

// JSON 다운로드
function downloadBibleJSON(){
  if(!BIBLE){ alert('BIBLE 데이터가 없습니다.'); return; }
  const blob = new Blob([JSON.stringify(BIBLE, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bible-paragraphs.json';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  status('수정된 JSON을 다운로드했습니다.');
}

/* ==== 전체 데이터 백업/복원 ==== */
const STORAGE_SERMON      = 'wbps.sermons.v4';
const STORAGE_UNIT_CTX    = 'wbps.ctx.unit.v1';
const STORAGE_WHOLE_CTX   = 'wbps.ctx.whole.v1';
const STORAGE_COMMENTARY  = 'wbps.ctx.comm.v1';
const STORAGE_SUMMARY     = 'wbps.ctx.summary.v1';
const VOICE_CHOICE_KEY    = 'wbps.tts.choice.v2';

function todayStr(){
  const d=new Date();
  return ${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')};
}
function exportAllData(){
  const keys = [STORAGE_SERMON, STORAGE_UNIT_CTX, STORAGE_WHOLE_CTX, STORAGE_COMMENTARY, STORAGE_SUMMARY, VOICE_CHOICE_KEY];
  const payload = { __wbps:1, date: todayStr(), items:{} };
  keys.forEach(k=> payload.items[k] = localStorage.getItem(k) ?? null);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  const ts = new Date();
  const tss = ${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}-${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')};
  a.href = URL.createObjectURL(blob);
  a.download = wbps-backup-${tss}.json;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  status('전체 데이터를 내보냈습니다.');
}
async function importAllData(file){
  try{
    const text = await file.text();
    const json = JSON.parse(text);
    if(!json || json.__wbps!==1 || !json.items){ alert('백업 파일 형식이 아닙니다.'); return; }
    if(!confirm('이 백업으로 현재 기기의 데이터를 덮어쓸까요?')) return;
    Object.entries(json.items).forEach(([k,v])=>{
      if(v===null || v===undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    });
    status('가져오기가 완료되었습니다. 페이지를 새로고침하면 반영됩니다.');
  }catch(e){
    console.error(e);
    alert('가져오기 중 오류가 발생했습니다.');
  }
}

/* --------- Refs / State --------- */
const voiceSelect = el('voiceSelect'), testVoiceBtn = el('testVoice');
const rateCtl = el('rateCtl'), pitchCtl = el('pitchCtl'), voiceHint = el('voiceHint');
const modalWrap = el('modalWrap'), modalRef = el('modalRef');
const sermonList = el('sermonList'), sermonEditor = el('sermonEditor');
const sermonTitle = el('sermonTitle'), sermonBody = el('sermonBody');
const editorSpeakBtn = el('editorSpeak');
const modalFooterNew = el('modalFooterNew');

let BIBLE = null;
let CURRENT = { book:null, chap:null, paraIdx:null, paraId:null };
let READER = { playing:false, q:[], idx:0, synth:window.speechSynthesis||null, scope:null, btn:null, continuous:false };
let EDITOR_READER = { playing:false, u:null, synth:window.speechSynthesis||null };

/* --------- Boot --------- */
(async function boot(){
  try{
    BIBLE = await tryFetchJSON('bible-paragraph.json');
  }catch(_){
    try{ BIBLE = await tryFetchJSON('bible_paragraphs.json'); }
    catch(e){ status('bible-paragraph.json을 찾을 수 없습니다. 같은 폴더에 두고 다시 열어주세요.'); return; }
  }
  buildTree();
  ensureSermonButtons();   // 🔧 설교 버튼 누락 시 보강
  status('불러오기 완료. 66권 트리가 활성화되었습니다.');
  await setupVoices();
})();

(function bindButtons(){
  el('btnSaveJSON')?.addEventListener('click', downloadBibleJSON);
  const btnExport = el('btnExportAll');
  const btnImport = el('btnImportAll');
  const fileInput = el('importFile');
  if (btnExport) btnExport.onclick = exportAllData;
  if (btnImport) btnImport.onclick = ()=> fileInput && fileInput.click();
  if (fileInput) fileInput.addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    importAllData(f).finally(()=>{ e.target.value=''; });
  });
})();

async function tryFetchJSON(path){ const res = await fetch(path, {cache:'no-store'}); if(!res.ok) throw 0; return await res.json(); }

/* --------- Voice --------- */
function waitForVoices(timeout=1500){
  return new Promise(resolve=>{
    const have = speechSynthesis.getVoices?.();
    if (have && have.length) return resolve(have);
    const t = setTimeout(()=> resolve(speechSynthesis.getVoices?.()||[]), timeout);
    speechSynthesis.onvoiceschanged = ()=>{ clearTimeout(t); resolve(speechSynthesis.getVoices?.()||[]); };
  });
}
function getKoreanVoices(all){
  return (all||[]).filter(v=>{
    const n=(v.name||'').toLowerCase(), l=(v.lang||'').toLowerCase();
    return l.startsWith('ko') || n.includes('korean') || n.includes('한국') || n.includes('korea');
  });
}
function presetsForSingleVoice(){
  return [
    {id:'preset-soft-low',  label:'프리셋 · 저음/느림',   rate:0.85, pitch:0.85},
    {id:'preset-soft-high', label:'프리셋 · 고음/느림',   rate:0.90, pitch:1.20},
    {id:'preset-fast',      label:'프리셋 · 빠름',       rate:1.20, pitch:1.05},
    {id:'preset-bright',    label:'프리셋 · 밝게',       rate:1.05, pitch:1.25},
    {id:'preset-radio',     label:'프리셋 · 라디오톤',   rate:1.00, pitch:0.90},
    {id:'preset-reading',   label:'프리셋 · 낭독체',     rate:0.95, pitch:1.00},
  ];
}
async function setupVoices(){
  const all = await waitForVoices();
  const kos = getKoreanVoices(all);

  voiceSelect.innerHTML = '';
  const def = document.createElement('option');
  def.value = JSON.stringify({type:'default'});
  def.textContent = '브라우저 기본(ko-KR)';
  voiceSelect.appendChild(def);

  if(kos.length > 0){
    const og = document.createElement('optgroup'); og.label = '한국어 보이스';
    kos.forEach(v=>{
      const opt = document.createElement('option');
      opt.value = JSON.stringify({type:'voice', uri:v.voiceURI});
      opt.textContent = ${v.name} — ${v.lang}${v.localService ? ' (로컬)' : ''};
      og.appendChild(opt);
    });
    voiceSelect.appendChild(og);
  }
  if(kos.length <= 1){
    const pg = document.createElement('optgroup'); pg.label = '스타일 프리셋';
    presetsForSingleVoice().forEach(p=>{
      const opt = document.createElement('option');
      opt.value = JSON.stringify({type:'preset', rate:p.rate, pitch:p.pitch});
      opt.textContent = p.label;
      pg.appendChild(opt);
    });
    voiceHint.style.display = '';
  } else {
    voiceHint.style.display = 'none';
  }

  const saved = localStorage.getItem(VOICE_CHOICE_KEY);
  if(saved){
    const idx = [...voiceSelect.options].findIndex(o=>o.value===saved);
    if(idx>=0) voiceSelect.selectedIndex = idx;
  } else {
    localStorage.setItem(VOICE_CHOICE_KEY, voiceSelect.value);
  }
  voiceSelect.addEventListener('change', ()=> localStorage.setItem(VOICE_CHOICE_KEY, voiceSelect.value));
  testVoiceBtn.onclick = ()=> speakSample('태초에 하나님이 천지를 창조하시니라.');
}
function resolveVoiceChoice(){
  try{ return JSON.parse(localStorage.getItem(VOICE_CHOICE_KEY)||'{"type":"default"}'); }
  catch{ return {type:'default'}; }
}
function pickVoiceByURI(uri){ return (speechSynthesis.getVoices?.()||[]).find(v=>v.voiceURI===uri) || null; }
function applyVoice(u){
  const choice = resolveVoiceChoice();
  const baseRate = parseFloat(rateCtl.value||'0.95');
  const basePitch = parseFloat(pitchCtl.value||'1');
  if(choice.type==='voice'){
    const v = pickVoiceByURI(choice.uri);
    if(v){ u.voice = v; u.lang = v.lang; } else { u.lang = 'ko-KR'; }
    u.rate = baseRate; u.pitch = basePitch;
  } else if(choice.type==='preset'){
    u.lang = 'ko-KR';
    u.rate = clamp((choice.rate ?? 0.95) * baseRate / 0.95, 0.5, 2);
    u.pitch = clamp((choice.pitch ?? 1.0) * basePitch / 1.0, 0, 2);
  } else {
    u.lang = 'ko-KR'; u.rate = baseRate; u.pitch = basePitch;
  }
}
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function speakSample(text){
  const synth = window.speechSynthesis;
  try{ synth.cancel(); }catch(e){}
  const u = new SpeechSynthesisUtterance(text);
  applyVoice(u);
  synth.speak(u);
}

/* --------- Tree --------- */
function buildTree(){
  treeEl.innerHTML = '';
  if(!BIBLE){ treeEl.innerHTML = '<div class="muted">파일을 찾을 수 없습니다.</div>'; return; }

  for(const bookName of Object.keys(BIBLE.books)){
    const detBook = document.createElement('details');
    const sumBook = document.createElement('summary');
    sumBook.innerHTML = <span class="tw">${escapeHtml(bookName)}</span>;
    detBook.appendChild(sumBook);

    const chWrap = document.createElement('div'); chWrap.className='chapters';
    const chapters = Object.keys(BIBLE.books[bookName]).map(n=>parseInt(n,10)).sort((a,b)=>a-b);

    for(const chap of chapters){
      const detChap = document.createElement('details');
      const sumChap = document.createElement('summary');
      sumChap.innerHTML = <span class="chip">${chap}장</span>;
      detChap.appendChild(sumChap);

      const parWrap = document.createElement('div'); parWrap.className='paras';
      const paras = BIBLE.books[bookName][chap].paras || [];
      paras.forEach((p, idx)=>{
        const detPara = document.createElement('details'); detPara.className='para';

        const m = String(p.ref||'').match(/^(\d+):(\d+)(?:-(\d+))?$/);
        const v1 = m ? m[2] : '?', v2 = m ? (m[3]||m[2]) : '?';
        const titleText = p.title || p.ref;

        const sum = document.createElement('summary');
        sum.innerHTML = 
          <span class="vrange">(${v1}-${v2})</span>
          <span class="ptitle"
                data-book="${bookName}"
                data-ch="${chap}"
                data-idx="${idx}"
                title="제목을 더블클릭하면 편집할 수 있습니다">${escapeHtml(titleText)}</span>
        ;

        const titleEl = sum.querySelector('.ptitle');

        titleEl.addEventListener('dblclick', (e)=>{
          e.preventDefault(); e.stopPropagation();
          detPara.open = true;
          startInlineTitleEdit(titleEl, bookName, chap, idx);
        }, true);

        function guardSummary(ev){
          const isEditing = titleEl.isContentEditable;
          const dblOnTitle = (ev.type === 'dblclick' && ev.target === titleEl);
          if (isEditing || dblOnTitle){
            ev.preventDefault();
            ev.stopPropagation();
          }
        }
        ['pointerdown','mousedown','click','dblclick'].forEach(type=>{
          sum.addEventListener(type, guardSummary, true);
        });

        detPara.appendChild(sum);

        const body = document.createElement('div');
        body.className = 'pbody';
        body.innerHTML = 
          <div class="ptoolbar">
            <button class="primary speakBtn">낭독</button>
            <label class="chip"><input type="checkbox" class="keepReading" style="margin-right:6px">계속 낭독</label>
            <button class="ctxBtn btnSummary">내용흐름</button>
            <button class="ctxBtn btnUnitCtx">단위성경속 맥락</button>
            <button class="ctxBtn btnWholeCtx">전체성경속 맥락</button>
            <button class="ctxBtn btnCommentary">주석</button>
            <button class="sermBtn">설교</button>
            <div class="spacer"></div>
          </div>
          <div class="pcontent"></div>;

        // [PATCH 1 START] 설교 버튼 생성/가시성만 보강 (클릭 바인딩 없음)
        (function ensureSermonBtn(){
          const tb = body.querySelector('.ptoolbar');
          if (!tb) return;

          if (!tb.querySelector('.spacer')) {
            const sp = document.createElement('div');
            sp.className = 'spacer';
            tb.appendChild(sp);
          }
          let sermBtn = tb.querySelector('.sermBtn');
          if (!sermBtn) {
            sermBtn = document.createElement('button');
            sermBtn.className = 'sermBtn';
            sermBtn.textContent = '설교';
            tb.appendChild(sermBtn);
          }
        })();
        // [PATCH 1 END]

        detPara.appendChild(body);

        const pcontent = body.querySelector('.pcontent');
        (p.verses||[]).forEach(([v,t])=>{
          const line = document.createElement('div');
          line.className = 'pline';
          line.dataset.verse = v;
          line.innerHTML = <sup class="pv">${v}</sup>${t};
          pcontent.appendChild(line);
        });

        detPara.addEventListener('toggle', ()=>{
          if(detPara.open){
            CURRENT.book = bookName; CURRENT.chap = chap; CURRENT.paraIdx = idx;
            const para = BIBLE.books[bookName][chap].paras[idx];
            CURRENT.paraId = ${bookName}|${chap}|${para.ref};
            status(선택됨: ${bookName} ${chap}장 · ${para.title||para.ref});
            // 열릴 때 설교 버튼 누락 시 즉시 생성 (클릭 바인딩 없음)
            const tb = detPara.querySelector('.ptoolbar');
            if (tb && !tb.querySelector('.sermBtn')) {
              const btn = document.createElement('button');
              btn.className = 'sermBtn';
              btn.textContent = '설교';
              tb.appendChild(btn);
            }
          }
        });

        body.querySelector('.speakBtn').addEventListener('click', ()=>{
          toggleSpeakInline(bookName, chap, idx, detPara, body.querySelector('.speakBtn'));
        });

        // 컨텍스트 에디터 버튼들
        body.querySelector('.btnUnitCtx').addEventListener('click', ()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('unit'); });
        body.querySelector('.btnWholeCtx').addEventListener('click',()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('whole'); });
        body.querySelector('.btnCommentary').addEventListener('click',()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('commentary'); });
        body.querySelector('.btnSummary').addEventListener('click',   ()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('summary'); });

        parWrap.appendChild(detPara);
      });

      detChap.appendChild(parWrap);
      chWrap.appendChild(detChap);
    }

    detBook.appendChild(chWrap);
    treeEl.appendChild(detBook);
  }
}

// [PATCH 2 START] 렌더 후에도 설교 버튼 누락 시 자동 보정(클릭 바인딩 없음)
(function sermonBtnWatcher(){
  const root = document.getElementById('tree');
  if (!root) return;

  function fix(tb){
    if (!tb.querySelector('.spacer')) {
      const sp = document.createElement('div');
      sp.className = 'spacer';
      tb.insertBefore(sp, tb.firstChild);
    }
    if (!tb.querySelector('.sermBtn')) {
      const b = document.createElement('button');
      b.className = 'sermBtn';
      b.textContent = '설교';
      tb.appendChild(b);
    }
  }

  function sweep(){
    root.querySelectorAll('details.para .ptoolbar').forEach(fix);
  }

  sweep();
  new MutationObserver(sweep).observe(root, {subtree:true, childList:true});
})();
// [PATCH 2 END]

/* ✅ 트리 렌더 후 설교 버튼이 누락됐을 때 자동 보강(클릭 바인딩 없음) */
function ensureSermonButtons(){
  document.querySelectorAll('#tree details.para .ptoolbar').forEach(tb=>{
    if (tb.querySelector('.sermBtn')) return;

    let spacer = tb.querySelector('.spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'spacer';
      tb.appendChild(spacer);
    }

    const btn = document.createElement('button');
    btn.className = 'sermBtn';
    btn.textContent = '설교';
    tb.appendChild(btn);
  });
}

/* 🔧 트리 위임 클릭 공용 처리 (유일한 클릭 바인딩) */
treeEl.addEventListener('click', (e)=>{
  const isCtxBtn = e.target.closest('.btnSummary, .btnUnitCtx, .btnWholeCtx, .btnCommentary, .sermBtn');
  if (!isCtxBtn) return;

  const paraEl = e.target.closest('details.para');
  const t = paraEl?.querySelector('summary .ptitle');
  if (!paraEl || !t) return;

  CURRENT.book   = t.dataset.book;
  CURRENT.chap   = parseInt(t.dataset.ch, 10);
  CURRENT.paraIdx= parseInt(t.dataset.idx, 10);
  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) return;
  CURRENT.paraId = ${CURRENT.book}|${CURRENT.chap}|${para.ref};

  if (e.target.closest('.btnSummary'))    { openSingleDocEditor('summary');    return; }
  if (e.target.closest('.btnUnitCtx'))    { openSingleDocEditor('unit');       return; }
  if (e.target.closest('.btnWholeCtx'))   { openSingleDocEditor('whole');      return; }
  if (e.target.closest('.btnCommentary')) { openSingleDocEditor('commentary'); return; }
  if (e.target.closest('.sermBtn'))       { openSermonModal();                 return; }
});

/* --------- Inline TTS --------- */
function buildQueueFrom(book, chap, idx){
  const para = BIBLE.books[book][chap].paras[idx];
  return (para.verses||[]).map(([v,t])=>({verse:v, text:t}));
}
function clearReadingHighlight(scope){ [...scope.querySelectorAll('.pline')].forEach(el=> el.classList.remove('reading')); }
function bindKeepReading(scope){
  const cb = scope.querySelector('.keepReading');
  if(!cb) return;
  cb.checked  = READER.continuous;
  cb.disabled = false;
  cb.onchange = ()=>{ READER.continuous = cb.checked; };
}
function speakVerseItemInScope(item, scope, onend){
  if(!READER.synth) return;
  const u = new SpeechSynthesisUtterance(String(item.text));
  applyVoice(u);
  let done = false;
  const safeEnd = ()=>{ if(done) return; done = true; onend(); };
  u.onstart = ()=>{
    clearReadingHighlight(scope);
    const line = scope.querySelector(.pline[data-verse="${item.verse}"]);
    if(line){ line.classList.add('reading'); line.scrollIntoView({block:'center', behavior:'smooth'}); }
    if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
    const base = Math.max(800, Math.round(item.text.length * 65));
    const rate = u.rate || 1;
    const estimate = Math.max(600, Math.round(base / rate)) + 1200;
    READER._wd = setTimeout(safeEnd, estimate);
  };
  u.onend   = safeEnd;
  u.onerror = safeEnd;
  READER.synth.speak(u);
}
function toggleSpeakInline(book, chap, idx, paraDetailsEl, btnEl){
  if(!READER.synth) return alert('이 브라우저는 음성합성을 지원하지 않습니다.');
  const sameScope = READER.playing && READER.scope === paraDetailsEl;
  if(READER.playing && sameScope){ stopSpeakInline(); return; }
  READER.continuous = true;
  READER.q = buildQueueFrom(book, chap, idx);
  READER.idx = 0;
  READER.playing = true;
  READER.scope = paraDetailsEl;
  READER.btn = btnEl;
  try{ READER.synth.cancel(); }catch(e){}
  bindKeepReading(READER.scope);
  updateInlineSpeakBtn();
  playNextInQueueInline(book, chap, idx);
}
function playNextInQueueInline(book, chap, idx){
  if(!READER.playing) return;
  if(READER.idx >= READER.q.length){
    if(READER.continuous && goToNextParagraphInline(book, chap, idx)){
      const nextCb = READER.scope?.querySelector?.('.keepReading');
      if(nextCb){ nextCb.checked = READER.continuous; nextCb.disabled = false; }
      READER.q = buildQueueFrom(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      READER.idx = 0;
      bindKeepReading(READER.scope);
      updateInlineSpeakBtn();
      setTimeout(()=>{ try{ READER.synth.cancel(); }catch(e){} playNextInQueueInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx); }, 120);
      return;
    }
    stopSpeakInline();
    return;
  }
  const item = READER.q[READER.idx];
  speakVerseItemInScope(item, READER.scope, ()=>{ READER.idx++; playNextInQueueInline(book, chap, idx); });
}
function stopSpeakInline(){
  READER.playing = false;
  try{ READER.synth && READER.synth.cancel(); }catch(e){}
  if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
  if(READER.scope){
    const cb = READER.scope.querySelector?.('.keepReading');
    if(cb) cb.disabled = false;
    clearReadingHighlight(READER.scope);
  }
  updateInlineSpeakBtn();
  READER.scope = null; READER.btn = null;
}
function updateInlineSpeakBtn(){ if(READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독'; }

function goToNextParagraphInline(book, chap, idx){
  const chObj = BIBLE.books[book][chap];
  const booksEls = [...treeEl.children];

  const bookNames = Object.keys(BIBLE.books);
  const bIdx = bookNames.indexOf(book);
  const bookEl = booksEls[bIdx];
  if(!bookEl) return false;

  const chaptersEls = bookEl.querySelectorAll(':scope > .chapters > details');
  const chapNums = Object.keys(BIBLE.books[book]).map(n=>parseInt(n,10)).sort((a,b)=>a-b);

  const chPos = chapNums.indexOf(chap);
  const chapEl = chaptersEls[chPos];
  if(!chapEl) return false;

  const paraEls = chapEl.querySelectorAll(':scope > .paras > details.para');

  if (READER.btn) READER.btn.textContent = '낭독';

  if (idx < chObj.paras.length - 1){
    const nextEl = paraEls[idx + 1];
    if(nextEl){
      chapEl.open = true;
      nextEl.open = true;
      CURRENT.book = book;
      CURRENT.chap = chap;
      CURRENT.paraIdx = idx + 1;
      READER.scope = nextEl;
      READER.btn = nextEl.querySelector('.speakBtn');
      if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
      return true;
    }
  }

  if (chPos >= 0 && chPos < chapNums.length - 1){
    const nextChap = chapNums[chPos + 1];
    const nextChapEl = chaptersEls[chPos + 1];
    if(nextChapEl){
      const nextParas = (BIBLE.books[book][nextChap].paras || []);
      if(nextParas.length){
        const nextParaEl = nextChapEl.querySelector(':scope > .paras > details.para');
        nextChapEl.open = true;
        if(nextParaEl) nextParaEl.open = true;

        CURRENT.book = book;
        CURRENT.chap = nextChap;
        CURRENT.paraIdx = 0;

        READER.scope = nextParaEl;
        READER.btn = nextParaEl?.querySelector('.speakBtn') || null;
        if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
        return true;
      }
    }
  }

  const bPos = bIdx;
  if (bPos >= 0 && bPos < bookNames.length - 1){
    const nextBook = bookNames[bPos + 1];
    const nextBookEl = booksEls[bPos + 1];
    if(nextBookEl){
      const firstChap = Math.min(...Object.keys(BIBLE.books[nextBook]).map(n=>parseInt(n,10)));
      const nextChapEl = nextBookEl.querySelector(':scope > .chapters > details');
      const nextParaEl = nextChapEl?.querySelector(':scope > .paras > details.para');
      if(nextParaEl){
        nextBookEl.open = true;
        nextChapEl.open = true;
        nextParaEl.open = true;

        CURRENT.book = nextBook;
        CURRENT.chap = firstChap;
        CURRENT.paraIdx = 0;

        READER.scope = nextParaEl;
        READER.btn = nextParaEl.querySelector('.speakBtn');
        if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
        return true;
      }
    }
  }
  return false;
}

/* --------- Sermon / Context Editors --------- */
function getSermonMap(){ try{ return JSON.parse(localStorage.getItem(STORAGE_SERMON)||'{}'); }catch{ return {}; } }
function setSermonMap(o){ localStorage.setItem(STORAGE_SERMON, JSON.stringify(o)); }
function getDocMap(storageKey){ try{ return JSON.parse(localStorage.getItem(storageKey)||'{}'); }catch{ return {}; } }
function setDocMap(storageKey, obj){ localStorage.setItem(storageKey, JSON.stringify(obj)); }

/* ✅ 최초 클릭 시에도 동작하도록 보강 + 중복편집기 제거 전제 */
function openSermonModal(){
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) {
      alert('단락을 먼저 선택해 주세요.');
      return;
    }
  }

  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) {
    alert('선택한 단락을 찾을 수 없습니다.');
    return;
  }
  CURRENT.paraId = ${CURRENT.book}|${CURRENT.chap}|${para.ref};

  document.getElementById('modalTitle').textContent = '단락 성경';
  sermonEditor.dataset.ctxType = '';
  sermonEditor.dataset.editing = '';
  modalRef.textContent = ${CURRENT.book} ${CURRENT.chap}장 · ${para.title || para.ref} (${para.ref});

  sermonList.innerHTML = '';
  sermonEditor.style.display = 'none';
  sermonEditor.classList.add('context-editor');
  modalWrap.style.display = 'flex';
  modalWrap.setAttribute('aria-hidden','false');
  modalFooterNew.style.display = '';

  renderSermonList();
}
el('closeModal').onclick = ()=>{ modalWrap.style.display='none'; modalWrap.setAttribute('aria-hidden','true'); stopEditorSpeak(true); };

function openSingleDocEditor(kind){
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) { alert('단락을 먼저 선택해 주세요.'); return; }
  }
  if (!BIBLE) { alert('성경 데이터가 로드되지 않았습니다.'); return; }

  const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const pid  = ${CURRENT.book}|${CURRENT.chap}|${para.ref};

  const titlePrefix =
    kind==='unit'       ? '단위성경속 맥락' :
    kind==='whole'      ? '전체성경속 맥락' :
    kind==='commentary' ? '주석' :
                           '내용요약';

  const key =
    kind==='unit'       ? STORAGE_UNIT_CTX :
    kind==='whole'      ? STORAGE_WHOLE_CTX :
    kind==='commentary' ? STORAGE_COMMENTARY :
                           STORAGE_SUMMARY;

  const map = getDocMap(key);
  const doc = map[pid] || {
    body:  (kind==='summary' ? '핵심 내용을 간결하게 요약해 적어주세요.' : ''),
    images: [], date:''
  };

  // ✅ runs → HTML 변환 주입 (덧대기)
  // runsToHtml(text, runs) 유틸이 상단에 있어야 합니다. (없다면 추가하세요)
  let bodyHTML = '';
  if (doc && typeof doc.body === 'object' && doc.body.v === 1 && Array.isArray(doc.body.blocks)) {
    // 새 포맷(doc v1, runs) → 각 블록을 HTML로 변환해 이어 붙임
    bodyHTML = doc.body.blocks
      .map(b => runsToHtml(b.text || '', b.runs || []))
      .join('');
  } else if (typeof doc.body_html === 'string' && doc.body_html.trim()) {
    // 선택: 호환용 HTML 스냅샷이 있으면 그걸 우선 사용
    bodyHTML = doc.body_html;
  } else {
    // 구 포맷(문자열 HTML) 폴백
    bodyHTML = String(doc.body || '');
  }

  sermonTitle.value = doc.title || '';
  setBodyHTML(bodyHTML);


  sermonEditor.dataset.editing = '';
  sermonEditor.dataset.ctxType = kind;

  const aiBtn = document.getElementById('aiFill');
  if (aiBtn) {
    aiBtn.style.display = (kind === 'unit') ? '' : 'none';
    aiBtn.onclick = null;
    if (kind === 'unit') {
      aiBtn.onclick = async ()=>{ /* 선택: AI 핸들러 */ };
    }
  }
}

/* ✅ 설교목록 렌더링 */
/* ✅ 설교목록 렌더링 (제목 → 날짜 → 링크 → 편집 → 삭제 순서) */
function renderSermonList(){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  sermonList.innerHTML = '';

  if(arr.length===0){
    startNewSermon();
    return;
  }

  arr.forEach((it, idx)=>{
    const row = document.createElement('div');
    row.className = 'item'; // 필요시 레이아웃용 CSS를 추가할 수 있어요.

    // 1) 제목
    const colTitle = document.createElement('div');
    colTitle.className = 'col col-title';
    colTitle.textContent = (it.title || '(제목 없음)');

    // 2) 작성날짜
    const colDate = document.createElement('div');
    colDate.className = 'col col-date';
    colDate.textContent = (it.date || '');

    // 3) 링크 (입력 + 미리보기 앵커)
    const colLink = document.createElement('div');
    colLink.className = 'col col-link';

    const linkInput = document.createElement('input');
    linkInput.type = 'url';
    linkInput.placeholder = '링크(URL)';
    linkInput.value = it.link || '';
    linkInput.style.minWidth = '220px';

    const linkAnchor = document.createElement('a');
    linkAnchor.textContent = it.link ? it.link : '';
    if (it.link) {
      linkAnchor.href = it.link;
      linkAnchor.target = '_blank';
      linkAnchor.rel = 'noopener noreferrer';
    } else {
      linkAnchor.style.display = 'none';
    }

    linkInput.addEventListener('change', ()=>{
      const url = linkInput.value.trim();
      const m = getSermonMap();
      const a = m[CURRENT.paraId] || [];
      if (a[idx]) {
        a[idx].link = url;
        setSermonMap(m);
      }
      if (url){
        linkAnchor.href = url;
        linkAnchor.textContent = url;
        linkAnchor.style.display = '';
        linkAnchor.target = '_blank';
        linkAnchor.rel = 'noopener noreferrer';
      } else {
        linkAnchor.removeAttribute('href');
        linkAnchor.textContent = '';
        linkAnchor.style.display = 'none';
      }
    });

    colLink.appendChild(linkInput);
    colLink.appendChild(linkAnchor);

    // 4) 편집 버튼
    const btnEdit = document.createElement('button');
    btnEdit.textContent = '편집';
    btnEdit.addEventListener('click', ()=>{
      modalWrap.style.display = 'none';
      modalWrap.setAttribute('aria-hidden','true');
      openSermonEditorWindow(idx);
    });

    // 5) 삭제 버튼
    const btnDel = document.createElement('button');
    btnDel.textContent = '삭제';
    btnDel.style.borderColor = 'var(--danger)';
    btnDel.addEventListener('click', ()=>{
      if(!confirm('이 설교를 삭제할까요?')) return;
      const m = getSermonMap();
      const a = m[CURRENT.paraId] || [];
      a.splice(idx,1);
      m[CURRENT.paraId] = a;
      setSermonMap(m);
      renderSermonList();
    });

    const colActions = document.createElement('div');
    colActions.className = 'col col-actions';
    colActions.appendChild(btnEdit);
    colActions.appendChild(btnDel);

    // 👉 순서대로 추가: 제목 → 날짜 → 링크 → 편집/삭제
    row.appendChild(colTitle);
    row.appendChild(colDate);
    row.appendChild(colLink);
    row.appendChild(colActions);

    sermonList.appendChild(row);
  });
}

/* 새 설교 */
el('newSermonBtn').onclick = ()=>{
  sermonEditor.dataset.ctxType = '';
  if (!CURRENT.paraId) {
    if (!syncCurrentFromOpen()) { alert('단락을 먼저 선택하세요.'); return; }
    const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
    CURRENT.paraId = ${CURRENT.book}|${CURRENT.chap}|${para.ref};
  }
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const newId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  arr.unshift({ id: newId, title:'', body:'', images:[], date:'', link:'' });
  map[CURRENT.paraId] = arr;
  setSermonMap(map);

  modalWrap.style.display='none';
  modalWrap.setAttribute('aria-hidden','true');
  openSermonEditorWindow(0);
};

function startNewSermon(){
  sermonList.innerHTML = '<div class="muted" style="padding:0 14px">새 설교를 작성해 저장하면 이 단락에 붙습니다.</div>';
  sermonEditor.classList.add('context-editor');
  sermonEditor.style.display = '';
  sermonTitle.value = '';
  setBodyHTML('');
  sermonEditor.dataset.editing = '';
  stopEditorSpeak(true);
}
function deleteSermon(idx){
  if(!confirm('이 설교를 삭제할까요?')) return;
  const map = getSermonMap(); const arr = map[CURRENT.paraId] || [];
  arr.splice(idx,1); map[CURRENT.paraId] = arr; setSermonMap(map); renderSermonList();
}

el('cancelEdit')?.addEventListener('click', ()=>{
  if(sermonEditor.dataset.ctxType){
    sermonEditor.dataset.ctxType = '';
    modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
  }else{
    sermonEditor.style.display = 'none'; renderSermonList();
  }
  stopEditorSpeak(true);
});

el('saveSermon').onclick = ()=>{
  const title = (sermonTitle.value||'').trim() || '(제목 없음)';
  let body = getBodyHTML() || '';
  body = body.replace(/^\s+|\s+$/g, '');

  const imgs  = [];
  const now   = new Date();
  const date  = ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')};

  const para  = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const pid   = ${CURRENT.book}|${CURRENT.chap}|${para.ref};
  const ctxType = sermonEditor.dataset.ctxType || '';

  if(ctxType){
    const key = ctxType==='unit'       ? STORAGE_UNIT_CTX
              : ctxType==='whole'      ? STORAGE_WHOLE_CTX
              : ctxType==='commentary' ? STORAGE_COMMENTARY
              :                          STORAGE_SUMMARY;
    const map = getDocMap(key);
    map[pid] = { title, body, images: imgs, date };
    setDocMap(key, map);

    sermonEditor.dataset.ctxType = '';
    sermonEditor.classList.remove('context-editor');
    modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
    status(저장됨: ${title});
    return;
  }

  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const editing = sermonEditor.dataset.editing;
  if(editing!==''){ const i=+editing; if(arr[i]) arr[i] = {...arr[i], title, body, images:imgs, date}; }
  else { arr.unshift({ id: crypto.randomUUID(), title, body, images: imgs, date, link:'' }); }
  map[CURRENT.paraId] = arr; setSermonMap(map);
  sermonEditor.style.display = 'none'; renderSermonList(); status('설교가 저장되었습니다.');
};

/* ===== RTE 유틸 ===== */
function isRTE(){ return sermonBody && sermonBody.getAttribute('contenteditable') === 'true'; }
function getBodyHTML(){ return isRTE() ? sermonBody.innerHTML : (sermonBody.value || ''); }
function setBodyHTML(html){ if(isRTE()) sermonBody.innerHTML = html || ''; else sermonBody.value = html || ''; }

function applyColorImmediateToRTE(hex){
  if(!isRTE()) return;
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0){ sermonBody.focus(); return; }
  const range = sel.getRangeAt(0);
  if(!sermonBody.contains(range.commonAncestorContainer)){ sermonBody.focus(); return; }

  if(range.collapsed){
    const sp = document.createElement('span');
    sp.style.color = hex;
    sp.appendChild(document.createTextNode('\u200B'));
    range.insertNode(sp);
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(sp.firstChild, 1); r.collapse(true);
    sel.addRange(r);
    return;
  }
  document.execCommand('foreColor', false, hex);
}
function execFmt(cmd){
  if(isRTE()){
    sermonBody.focus({preventScroll:true});
    document.execCommand(cmd,false,null);
  }
}

/* --------- Editor TTS --------- */
editorSpeakBtn.onclick = ()=> toggleEditorSpeak();
function toggleEditorSpeak(){
  const tmp = document.createElement('div'); tmp.innerHTML = getBodyHTML();
  tmp.querySelectorAll('sup').forEach(s=> s.textContent='['+s.textContent+'] ');
  const plain = (tmp.textContent||'').replace(/\n{2,}/g,' ').replace(/\s+/g,' ').trim();
  const text = [sermonTitle.value.trim(), plain].filter(Boolean).join('. ');
  if(!EDITOR_READER.synth) return alert('이 브라우저는 음성합성을 지원하지 않습니다.');
  if(EDITOR_READER.playing){ stopEditorSpeak(); return; }

  if(!text){ alert('낭독할 내용이 없습니다.'); return; }
  const u = new SpeechSynthesisUtterance(text.replace(/\n{2,}/g, '. ').replace(/\n/g,' '));
  applyVoice(u); u.onend = ()=> stopEditorSpeak(true);
  EDITOR_READER.u = u; EDITOR_READER.synth.cancel(); EDITOR_READER.synth.speak(u);
  EDITOR_READER.playing = true; editorSpeakBtn.textContent = '중지';
}
function stopEditorSpeak(silent){
  if(EDITOR_READER.synth){ try{ EDITOR_READER.synth.cancel(); }catch(e){} }
  EDITOR_READER.playing = false; EDITOR_READER.u = null;
  if(!silent) status('설교 낭독을 중지했습니다.'); editorSpeakBtn.textContent = '낭독';
}

/* --------- Hotkeys --------- */
window.addEventListener('keydown', (e)=>{
  if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='s'){
    e.preventDefault();
    downloadBibleJSON();
    return;
  }
  if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if(key === 's'){
    e.preventDefault();
    syncCurrentFromOpen();
    const openPara = treeEl.querySelector('details.para[open]');
    if(openPara && CURRENT.book!=null){
      const btn = openPara.querySelector('.speakBtn');
      toggleSpeakInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx, openPara, btn);
    }
    return;
  }
  if(key === 'n'){
    e.preventDefault();
    if(!syncCurrentFromOpen()) return;
    const wasPlaying = !!READER.playing;
    try{ READER.synth && READER.synth.cancel(); }catch(_){}
    if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
    READER.playing = wasPlaying;
    const moved = goToNextParagraphInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
    if(!moved) return;
    if (wasPlaying){
      const cb = READER.scope?.querySelector?.('.keepReading');
      if(cb){ cb.checked = READER.continuous; cb.disabled = false; }
      READER.q   = buildQueueFrom(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      READER.idx = 0;
      bindKeepReading(READER.scope);
      updateInlineSpeakBtn();
      setTimeout(()=>{ try{ READER.synth && READER.synth.cancel(); }catch(_){}
        playNextInQueueInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      }, 120);
    }
  }
});

/* === 팝업 편집기 (스크립트 분리 버전) === */
function openSermonEditorWindow(idx){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const it  = arr[idx];
  if(!it){ alert('편집할 설교를 찾을 수 없습니다.'); return; }

  const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const versesRaw = Array.isArray(para?.verses) ? para.verses : [];

  const meta = {
    paraId: CURRENT.paraId,
    idx,
    ref: ${CURRENT.book} ${CURRENT.chap}장 · ${(para?.title || para?.ref || '')} (${para?.ref || ''}),
    title: it.title || '',
    body:  it.body  || '',
    date:  it.date || '',
    verses: versesRaw
  };

  const w = window.open('', '_blank', 'width=1100,height=820');
  if(!w){ alert('팝업이 차단되었습니다. 브라우저 팝업을 허용해주세요.'); return; }
  w.__WBPS_META__ = meta;
  if (w.opener && w.opener.firebase) { w.firebase = w.opener.firebase; }

  let popupHTML = String.raw<!DOCTYPE html><html lang="ko">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>설교 편집</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&family=Nanum+Myeongjo&display=swap" rel="stylesheet">
<style>
:root{--bg:#0f1115;--panel:#161922;--text:#e6e8ef;--muted:#9aa0ab;--border:#252a36;--accent:#6ea8fe;--danger:#ff6b6b}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);display:grid;grid-template-rows:56px 1fr 56px;gap:8px}
header,footer{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--border)}
footer{border-top:1px solid var(--border);border-bottom:none}
.grow{flex:1 1 auto}
main{padding:0 12px 12px}

input[type="text"].title-input{
  width: min(90%, 720px);
  background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;
  padding:10px 12px;font-weight:700;font-size:1.14rem;line-height:1.4;letter-spacing:.01em;
}

button{background:color-mix(in hsl,var(--panel) 65%,black 10%);color:var(--text);
border:1px solid var(--border);border-radius:10px;padding:6px 10px;cursor:pointer;transition:border-color .15s,transform .04s}
button:hover{border-color:color-mix(in hsl,var(--border) 75%,var(--accent) 25%)} button:active{transform:translateY(1px)}
.primary{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 78%,white 10%),color-mix(in srgb,var(--accent) 72%,black 22%));border-color:color-mix(in srgb,var(--accent) 70%,black 10%)}
.muted{color:var(--muted)}

.context-editor{font-family:"Noto Serif KR","Nanum Myeong고",serif;font-size:1.05rem;line-height:1.85;letter-spacing:.02em;word-break:keep-all}

.notion-header{display:flex;align-items:center;gap:8px;margin-top:8px}
.notion-header .title{flex:1 1 auto;background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;padding:10px 12px;font-weight:700}
.notion-header .meta{display:flex;gap:8px;align-items:center}
.notion-badge{font-size:11px;color:#9aa0ab}

#editorRoot{max-width:880px;margin:12px auto 8px;padding:0 6px}
.editor-block{position:relative;display:flex;gap:10px;padding:2px 0}
.editor-block .handle{user-select:none;cursor:grab;opacity:.5;padding:2px 0 0 0}
.editor-block .content{flex:1;outline:none;white-space:pre-wrap}
.editor-block[data-type="h1"] .content{font-size:28px;font-weight:800}
.editor-block[data-type="h2"] .content{font-size:24px;font-weight:800}
.editor-block[data-type="h3"] .content{font-size:20px;font-weight:700}
.editor-block[data-type="quote"]{border-left:3px solid #5a6; padding-left:10px; opacity:.95}
.editor-block[data-type="callout"]{background:#3a3f4e33;border:1px solid #444;border-radius:12px;padding:10px}
.editor-block[data-type="code"] .content{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0b0d13;border:1px solid #252a36;border-radius:12px;padding:10px}
.editor-block[data-type="todo"] .content{display:flex;gap:8px}
.editor-block[data-type="divider"] .content{border-bottom:1px solid #333;height:1px}
.editor-block[data-type="toggle"] .content summary{cursor:pointer}
.editor-block .progress{position:absolute;left:0;bottom:-2px;height:2px;background:#6ea8fe;opacity:.9;transition:width .05s linear}

.bubble{position:absolute;padding:6px;border:1px solid #333;border-radius:12px;background:#1c1f2a;display:flex;gap:6px}
.bubble.hidden{display:none}
.bubble button{border:1px solid #333;background:#222;color:#eee;border-radius:8px;padding:2px 6px}

.slash{position:fixed;inset:auto auto 0 0;max-height:260px;overflow:auto;background:#1c1f2a;border:1px solid #333;border-radius:12px;min-width:260px;padding:6px}
.slash.hidden{display:none}
.slash .item{padding:6px 8px;border-radius:8px;display:flex;gap:8px;align-items:center}
.slash .item.active,.slash .item:hover{background:#2a2f3d}

.notion-footer{padding:6px 12px;border-top:1px solid #252a36;background:#161922;position:sticky;bottom:0}
#traceLog{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;max-height:180px;overflow:auto;white-space:pre-wrap}

#floatingBar{
  position: fixed; right: 16px; bottom: 16px; z-index: 50;
  display:flex; gap:8px; align-items:center;
  background: color-mix(in hsl, var(--panel) 85%, black 6%);
  border:1px solid var(--border); border-radius:999px; padding:8px 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
#floatingBar button{ padding:8px 14px; border-radius:999px }

@media print {
  @page { size: A4; margin: 18mm; }
  body{ background:#fff; color:#000; grid-template-rows:0 1fr 0 }
  header, footer, #floatingBar { display:none !important; }
}

/* === 편집기(main) 스크롤 및 겹침 방지 보정 === */
/* body를 3행 그리드(헤더/메인/푸터)로, 메인은 스크롤 가능 */
body{
  display: grid;
  grid-template-rows: 56px 1fr 56px;
  height: 100vh !important;
  overflow: hidden !important;
}

/* main은 스크롤이 가능해야 함 + footer/floatingBar에 가리지 않도록 하단 여백 */
main{
  position: relative;
  z-index: 1;
  overflow-y: auto !important;
  padding-top: 12px;
  padding-bottom: 140px; /* footer 높이 + 여유 */
  height: calc(100vh - 112px) !important; /* 56(header)+56(footer) */
}

/* 편집 영역 자체 여백 확보(아래쪽 충분히 띄워서 겹침 방지) */
#editorRoot{
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 12px auto 100px;  /* 아래 여유 */
  padding: 0 8px 80px;      /* 아래 여유 */
  overflow: visible;
}

/* 플로팅 버튼과의 겹침도 최소화(필요 시) */
#floatingBar{
  z-index: 50;
}
html, body { height:auto !important; overflow:auto !important; }
main { height:auto !important; overflow:visible !important; }

/* === 문장 낭독 하이라이트용 읽기 패널 === */
#readPane{
  position: fixed;
  right: 16px;
  top: 64px;
  bottom: 64px;
  width: 420px;
  overflow-y: auto;
  background: color-mix(in hsl, var(--panel) 92%, black 4%);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: 0 10px 28px rgba(0,0,0,.35);
  display: none;
}
#readPane .sent{
  display: block;
  line-height: 1.8;
  margin: 4px 0;
  padding: 2px 6px;
  border-radius: 8px;
}
#readPane .sent.reading{
  background: #2b3242;
  outline: 1px solid #3b4b7a;
}
</style>
</head>
<body class="context-editor">
<header>
  <strong>설교 편집</strong><span class="muted" id="ref"></span>
  <div class="grow"></div>
  <button id="x">닫기</button>
</header>

<main>
  <input id="t" class="title-input" type="text" autocomplete="off" placeholder="설교 제목을 입력하세요">
  <div class="notion-header">
    <input id="neTitle" class="title" placeholder="제목을 입력하세요" />
    <div class="meta">
      <button id="nePublish" class="primary">게시</button>
      <button id="neStt">🎙 STT</button>
    </div>
  </div>

  <div id="neBubble" class="bubble hidden">
    <button data-mark="bold"><b>B</b></button>
    <button data-mark="italic"><i>I</i></button>
    <button data-mark="underline"><u>U</u></button>
    <button data-mark="strike"><s>S</s></button>
    <button data-mark="code"> + '\\code\\' + </button>
    <button data-mark="highlight">HL</button>
    <button data-action="link">🔗</button>
  </div>

  <div id="neSlash" class="slash hidden"></div>
  <div id="editorRoot" aria-label="Sermon Editor"></div>

  <div id="readPane" aria-label="Reading Sentences"></div>

  <div class="notion-footer">
    <div class="notion-badge" id="neAutosave">자동저장 대기중…</div>
    <details style="margin-top:6px">
      <summary>🎧 Sermon Tracer 로그/타임라인</summary>
      <div id="traceLog"></div>
    </details>
  </div>
</main>

<div id="floatingBar" aria-label="도구 막대">
  <button id="btnInsertBibleFloating" class="primary">성경구절</button>
</div>

<footer>
  <span class="muted" id="date"></span><div class="grow"></div>
  <button id="print">인쇄(A4)</button>
  <button id="read" class="primary">낭독</button>
  <button id="stop">중지</button>
  <button class="danger" id="d">삭제</button>
  <button class="primary" id="s">저장</button>
</footer>
</body>
</html>;

  // 템플릿 보간 및 </script> 보호
  popupHTML = popupHTML.replaceAll('${', '\\${');
  popupHTML = popupHTML.replaceAll('</script>', '<\\/script>');

  w.document.open();
  w.document.write(popupHTML);
  w.document.close();

  // 팝업 초기화 실행
  initSermonPopup(w);

  // 부모창 메시지 핸들러 (저장/삭제 반영)
  function onMsg(ev){
    const data = ev.data;
    if (!data || !data.type) return;

    if (data.type === 'sermon-save') {
      const now = new Date();
      const date = ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')};

      arr2[idx] = {
        ...arr2[idx],
        title: data.title,
        body:  data.body,         // 객체(v1) 또는 문자열(구버전) 허용
        body_html: data.body_html ?? arr2[idx]?.body_html, // 있으면 보관
        images: data.images || [],
        date
      };

      map2[CURRENT.paraId] = arr2;
      setSermonMap(map2);
      status('설교가 저장되었습니다.');
      renderSermonList();
      window.removeEventListener('message', onMsg);
    }

  }

  window.addEventListener('message', onMsg);
}

/* ===== 팝업 내부 스크립트 ===== */
function initSermonPopup(win){
  const w = win, d = w.document;

  (function ensureFloatingBar(){
    const d = win.document;
    let fb = d.getElementById('floatingBar');
    if (!fb) {
      fb = d.createElement('div');
      fb.id = 'floatingBar';
      fb.innerHTML = <button id="btnInsertBibleFloating" class="primary">성경구절</button>;
      d.body.appendChild(fb);
    }
    const btn = d.getElementById('btnInsertBibleFloating');
    if (btn) {
      btn.removeEventListener('click', insertBiblePrompt);
      btn.addEventListener('click', insertBiblePrompt);
    }
  })();

    // ===== 중복 제목 입력 숨기기(팝업 한정) =====
  (function removeDuplicateTitle() {
    const d = win.document;
    // 현재 사용 중인 제목 입력칸
    const mainTitle = d.getElementById('neTitle');
    if (!mainTitle) return;

    // 예전 제목 input(#t 등)이 있다면 숨김
    const dupCandidates = [
      ...d.querySelectorAll('input#t, input[type="text"].title-input')
    ].filter(el => el !== mainTitle);

    dupCandidates.forEach(el => {
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
    });
  })();

  const $ = id => d.getElementById(id);
  const meta = w.__WBPS_META__ || {};

  $('ref').textContent  = ' — ' + (meta.ref || '');
  $('date').textContent = meta.date ? ('최근 저장: ' + meta.date) : '';

  $('t').value = meta.title || '';
  $('neTitle').value = meta.title || '';

  const N$$= sel => Array.from(d.querySelectorAll(sel));
  const Nuid= () => Math.random().toString(36).slice(2,10);

  const neRoot    = $('editorRoot');
  const neBubble  = $('neBubble');
  const neSlash   = $('neSlash');
  const neAutosave= $('neAutosave');

  const NSTATE = { blocks: [], history: [], cursor: -1, docId: null };

  // runs 문서 수집 유틸: 현재 NSTATE.blocks → { v:1, blocks:[{id,type,text,runs}] }
  function collectRunsDocument(){
    return {
      v: 1,
      blocks: (NSTATE.blocks || []).map(b => ({
        id: b.id,
        type: b.type || 'p',
        text: b.text || '',
        runs: Array.isArray(b.runs) ? b.runs : []
      }))
    };
  }

  function NwrapToggle(inner){
    const parts = String(inner||'').split(/<br\s*\/?>/);
    const first = parts.shift() || '토글 제목';
    const body  = parts.join('<br>');
    return '<details open><summary>'+first+'</summary><div>'+body+'</div></details>';
  }
  function Nescape(s){ const t=d.createElement('div'); t.textContent=String(s); return t.innerHTML; }
  function NindexById(id){ return NSTATE.blocks.findIndex(b=>b.id===id); }
  function NgetType(block){ return block?.dataset?.type || 'p'; }

  // [RUNS] 렌더: runs → HTML로 변환하여 contenteditable에 넣음
  function Nrender(){
    neRoot.innerHTML = '';
    for (const b of NSTATE.blocks){
      const el = d.createElement('div');
      el.className = 'editor-block';
      el.dataset.id = b.id;
      el.dataset.type = b.type || 'p';

      if (b.type === 'divider'){
        el.innerHTML = <div class="handle">⋮⋮</div><div class="content"><hr></div><div class="progress" style="width:0"></div>;
      } else {
        const html = runsToHtml(b.text||'', b.runs||[]);
        el.innerHTML = 
          <div class="handle">⋮⋮</div>
          <div class="content" contenteditable="true">${html}</div>
          <div class="progress" style="width:0"></div>
        ;
      }
      neRoot.appendChild(el);
    }
    NbindBlockEvents();
  }

  function initBlocksFromMeta(meta){
    // ① runs 우선
    if (meta?.body && typeof meta.body === 'object' && meta.body.v === 1 && Array.isArray(meta.body.blocks)) {
      NSTATE.blocks = meta.body.blocks.map(b => ({
        id: b.id || Nuid(),
        type: b.type || 'p',
        text: b.text || '',
        runs: Array.isArray(b.runs) ? b.runs : []
      }));
      return;
    }
    // ② body_html 있으면 그걸 사용
    if (typeof meta?.body_html === 'string' && meta.body_html.trim()) {
      const { blocks } = htmlToRuns(meta.body_html);
      NSTATE.blocks = blocks;
      return;
    }
    // ③ 구 body(문자열) 폴백
    const legacy = (typeof meta?.body === 'string') ? meta.body : '';
    const { blocks } = htmlToRuns(legacy);
    NSTATE.blocks = blocks.length ? blocks : [{ id: Nuid(), type:'p', text:'', runs:[] }];
  }

  function NsaveBlockHTML(block){
    const i = NindexById(block.dataset.id);
    if(i<0) return;
    const content = block.querySelector('.content');
    NSTATE.blocks[i].html = content.innerHTML;
  }

  // 새 runs 저장을 "덧대기"
  function NsaveBlockRuns(block){
    const idx = NindexById(block.dataset.id);
    if (idx < 0) return;
    const html = block.querySelector('.content')?.innerHTML || '';
    const { text, runs } = htmlToRuns(html);
    NSTATE.blocks[idx].text = text;
    NSTATE.blocks[idx].runs = runs;
  }

  // (신규) HTML → Runs로 변환해 저장
  function NsaveBlock(block){
    const idx = NindexById(block.dataset.id);
    if (idx < 0) return;

    // 구분선(divider)은 내용 없음
    const type = block.dataset.type || 'p';
    if (type === 'divider') return;

    const html = block.querySelector('.content')?.innerHTML || '';
    const { text, runs } = htmlToRuns(html); // ← 상단 Runs 유틸 사용
    NSTATE.blocks[idx].type = type;          // type 유지
    NSTATE.blocks[idx].text = text;          // 본문 텍스트
    NSTATE.blocks[idx].runs = runs;          // 서식 Runs
    // ※ 필요 시 과거 'html' 필드는 제거해도 됩니다.
  }


  function NsplitBlock(block){
    const i = NindexById(block.dataset.id); if(i<0) return;
    const sel = w.getSelection(); if(!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const html = block.querySelector('.content')?.innerHTML || '';
    // 현재 블록 전체를 Runs로 파싱한 뒤, caret 기준으로 앞/뒤를 텍스트로 나눕니다.
    const { text, runs } = htmlToRuns(html);

    // 텍스트 기준 오프셋(이미 계산된 off)을 사용해 앞/뒤 텍스트를 자릅니다.
    const preText  = (text || '').slice(0, off);
    const postText = (text || '').slice(off);

    // 주의: runs는 범위 분할이 필요하지만, 간단 구현으로는 "양쪽 모두 서식 제거"로 시작해도 OK.
    // (완벽 split이 필요하면 runs를 앞/뒤로 잘라서 s/e 재계산 로직을 추가하세요.)
    NSTATE.blocks[i].text = preText;
    NSTATE.blocks[i].runs = []; // 간이: 앞쪽 서식 제거

    NSTATE.blocks.splice(i+1, 0, {
      id: Nuid(),
      type: 'p',
      text: postText,
      runs: [] // 간이: 뒤쪽 서식 제거
    });

    Nrender();
    NscheduleAutosave();

    const next = neRoot.querySelector(.editor-block[data-id="${NSTATE.blocks[i+1].id}"] .content);
    if(next) { next.focus(); const rr=d.createRange(); rr.selectNodeContents(next); rr.collapse(false); const ss=w.getSelection(); ss.removeAllRanges(); ss.addRange(rr); }
    NpushHistory();
  }

  function NbindBlockEvents(){
    N$$('.editor-block').forEach(block =>{
      const content = block.querySelector('.content');

      content.addEventListener('keydown', e=>{
        if(e.key==='/' && !e.shiftKey){ NshowSlash(block); return; }
        if(e.key==='Enter'){
          if(NgetType(block)==='code') return;
          e.preventDefault(); NsplitBlock(block);
        }
        if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){ e.preventDefault(); Nundo(); }
        if(((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='z')||((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y')){ e.preventDefault(); Nredo(); }
      });

      // 이벤트에는 둘 다 적용 (기존 기능 보존)
      content.addEventListener('input', ()=>{
        NsaveBlockHTML(block);   // 구방식 유지
        NsaveBlockRuns(block);   // 신방식 추가
        NscheduleAutosave();
      });

      content.addEventListener('mouseup', NshowBubbleMaybe);
      content.addEventListener('keyup',   NshowBubbleMaybe);
    });

    N$$('.editor-block .handle').forEach(h=>{
      h.addEventListener('click',()=>{
        const block = h.closest('.editor-block');
        const idx = NindexById(block.dataset.id);
        if(idx<=0) return;
        const t = NSTATE.blocks[idx]; NSTATE.blocks[idx]=NSTATE.blocks[idx-1]; NSTATE.blocks[idx-1]=t;
        Nrender(); NscheduleAutosave();
      });
    });
  }

  function NshowBubbleMaybe(){
    const sel = w.getSelection();
    if(!sel || sel.isCollapsed){ neBubble.classList.add('hidden'); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    neBubble.style.left = (rect.left + w.scrollX) + 'px';
    neBubble.style.top  = (rect.top  + w.scrollY - 42) + 'px';
    neBubble.classList.remove('hidden');
  }
  neBubble.addEventListener('mousedown', e=> e.preventDefault());
  neBubble.addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const mark = btn.dataset.mark; const act = btn.dataset.action;
    if(mark){
      d.execCommand(mark==='highlight'?'backColor':mark, false, mark==='highlight'? '#6655007a': null);
    } else if(act==='link'){
      const url = w.prompt('링크 URL'); if(url) d.execCommand('createLink', false, url);
    }
    NshowBubbleMaybe(); NscheduleAutosave();

    // 서식 적용 후 현재 블록을 Runs로 저장
    const curBlock = d.getSelection()?.anchorNode?.parentElement?.closest('.editor-block');
    if (curBlock) {
      NsaveBlock(curBlock);
      NscheduleAutosave();
    }
  });

  const N_SLASH = [
    {type:'p', label:'텍스트'},
    {type:'h1', label:'제목 1'},
    {type:'h2', label:'제목 2'},
    {type:'h3', label:'제목 3'},
    {type:'todo', label:'체크리스트'},
    {type:'ul', label:'불릿 리스트'},
    {type:'ol', label:'번호 리스트'},
    {type:'quote', label:'인용'},
    {type:'callout', label:'콜아웃'},
    {type:'divider', label:'구분선'},
    {type:'code', label:'코드 블록'},
    {type:'toggle', label:'토글 블록'},
    {type:'img', label:'이미지(링크)'},
  ];
  let NslashTarget = null;
  function NshowSlash(block){
    NslashTarget = block;
    const rect = block.getBoundingClientRect();
    neSlash.style.left = (rect.left + w.scrollX + 20) + 'px';
    neSlash.style.top  = (rect.top  + w.scrollY + 20) + 'px';
    neSlash.innerHTML = N_SLASH.map((it,i)=><div class="item" data-i="${i}">${it.label}</div>).join('');
    neSlash.classList.remove('hidden');
  }
  neSlash.addEventListener('click', e=>{
    const item = e.target.closest('.item'); if(!item) return;
    const i = +item.dataset.i; NapplySlash(N_SLASH[i]);
    neSlash.classList.add('hidden');
  });
  d.addEventListener('keydown', e=>{ if(e.key==='Escape') neSlash.classList.add('hidden'); });

  function NapplySlash(it){
    if(!NslashTarget) return;
    const id = NslashTarget.dataset.id; const idx = NindexById(id); if(idx<0) return;
    if(it.type==='divider'){
      NSTATE.blocks[idx] = {id, type:'divider', html:''};
    } else if(it.type==='img'){
      const url = w.prompt('이미지 URL'); if(url){ NSTATE.blocks[idx].html = <img src="${url}" style="max-width:100%">; }
    } else if(it.type==='todo'){
      NSTATE.blocks[idx] = {id, type:'todo', html:<input type="checkbox"> 할 일};
    } else if(it.type==='ul' || it.type==='ol'){
      NSTATE.blocks[idx] = {id, type:it.type, html:<${it.type}><li>첫 번째</li></${it.type}>};
    } else if(it.type==='toggle'){
      NSTATE.blocks[idx] = {id, type:'toggle', html:'토글 제목<br>토글 내용'};
    } else {
      NSTATE.blocks[idx].type = it.type;
    }
    Nrender(); NscheduleAutosave();

    const cur = neRoot.querySelector(.editor-block[data-id="${id}"]);
    if (cur) {
      NsaveBlock(cur);
      NscheduleAutosave();
    }
  
  }

  function NpushHistory(){ NSTATE.history = NSTATE.history.slice(0, NSTATE.cursor+1); NSTATE.history.push(JSON.stringify(NSTATE.blocks)); NSTATE.cursor = NSTATE.history.length-1; }
  function Nundo(){ if(NSTATE.cursor>0){ NSTATE.cursor--; NSTATE.blocks = JSON.parse(NSTATE.history[NSTATE.cursor]); Nrender(); } }
  function Nredo(){ if(NSTATE.cursor<NSTATE.history.length-1){ NSTATE.cursor++; NSTATE.blocks = JSON.parse(NSTATE.history[NSTATE.cursor]); Nrender(); } }

  function NblocksToHTML(){
    return NSTATE.blocks.map(b=>{
      switch(b.type){
        case 'h1': return <h2>${b.html}</h2>;
        case 'h2': return <h3>${b.html}</h3>;
        case 'h3': return <h4>${b.html}</h4>;
        case 'quote': return <blockquote>${b.html}</blockquote>;
        case 'divider': return '<hr/>';
        default: return <div>${b.html}</div>;
      }
    }).join('');
  }

  let NsaveTimer=null;
  function NscheduleAutosave(){
    clearTimeout(NsaveTimer);
    neAutosave.textContent = '입력 중…';
    NsaveTimer = setTimeout(()=>{
      try{
        const key = wbps.sermon.draft.blocks.${(meta.paraId||'')}.${(meta.idx||0)};
        const payload = { title: ($('neTitle').value||''), blocks:NSTATE.blocks, ts: Date.now() };
        w.localStorage.setItem(key, JSON.stringify(payload));
        neAutosave.textContent = '자동저장됨';
      }catch(_){ neAutosave.textContent = '자동저장 실패(용량)'; }
    }, 500);
  }

  (function Ninit(){
    initBlocksFromMeta(meta);
    Nrender();
    NpushHistory();
    setTimeout(()=>{ const last = d.querySelector('#editorRoot .editor-block:last-child .content'); last && last.focus(); }, 60);
  })();

  // STT
  (function(){
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if(!SR){ console.warn('STT 미지원'); return; }
    const rec = new SR(); rec.lang='ko-KR'; rec.interimResults=true; rec.continuous=true;

    let activeBlock=null, accText='', startedAt=null;
    function getActive(){ const sel=w.getSelection(); const n=sel?.anchorNode; const el=(n?.nodeType===1?n:(n?.parentElement)); return el?.closest?.('.editor-block') || d.querySelector('.editor-block'); }
    function setProgress(block, ratio){ const bar=block?.querySelector('.progress'); if(bar) bar.style.width = Math.max(0,Math.min(100,ratio*100)) + '%'; }
    function plain(html){ const t=d.createElement('div'); t.innerHTML=html||''; return t.textContent||''; }
    function sim(a,b){ a=a.replace(/\s+/g,''); b=b.replace(/\s+/g,''); const L=Math.max(a.length,1); let m=0; for(let i=0;i<Math.min(a.length,b.length);i++){ if(a[i]===b[i]) m++; } return m/L; }
    function nextBlock(block){ const nx = block?.nextElementSibling?.classList.contains('editor-block')? block.nextElementSibling : null; return nx; }

    const neSttBtn = d.getElementById('neStt');
    neSttBtn?.addEventListener('click', ()=>{
      if(neSttBtn.dataset.on==='1'){ rec.stop(); neSttBtn.dataset.on='0'; neSttBtn.textContent='🎙 STT'; return; }
      activeBlock = getActive(); if(!activeBlock){ w.alert('블록을 선택하세요'); return; }
      accText=''; startedAt=Date.now(); rec.start(); neSttBtn.dataset.on='1'; neSttBtn.textContent='⏸ 중지';
    });

    rec.onresult = (ev)=>{
      if(!activeBlock) return;
      const r = ev.results[ev.results.length-1]; const txt=r[0].transcript; const isFinal=r.isFinal;
      accText += (isFinal? txt+' ' : txt);
      const base = plain(activeBlock.querySelector('.content').innerHTML);
      const s = sim(base, accText); setProgress(activeBlock, s);

      const t = ((Date.now()-startedAt)/1000).toFixed(1);
      const neTrace = d.getElementById('traceLog');
      neTrace.textContent += t=${t}s s=${(s*100).toFixed(0)}% : ${txt}\n;
      neTrace.scrollTop = neTrace.scrollHeight;

      if(isFinal && s>0.95){
        const nb = nextBlock(activeBlock);
        if(nb){ activeBlock = nb; accText=''; startedAt=Date.now(); setProgress(nb, 0); }
      }
    };
    rec.onend   = ()=>{ if(neSttBtn.dataset.on==='1'){ rec.start(); } };
    rec.onerror = (e)=> console.warn('STT 오류', e.error);
  })();

  // 게시(Firebase 옵션)
  const nePubBtn = d.getElementById('nePublish');
  nePubBtn?.addEventListener('click', async ()=>{
    try{
      if(typeof w.firebase === 'undefined'){ w.alert('Firebase 미탑재: 게시 기능을 사용하려면 SDK/초기화가 필요합니다.'); return; }
      const user = w.firebase.auth().currentUser;
      if(!user){ w.alert('로그인 후 게시 가능합니다.'); return; }

      const db = w.firebase.firestore();
      const docRef = NSTATE.docId ? db.collection('sermons').doc(NSTATE.docId) : db.collection('sermons').doc();
      const payload = {
        title: (d.getElementById('neTitle').value||'무제'),
        blocks: NSTATE.blocks,
        owner: user.uid,
        updatedAt: w.firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: w.firebase.firestore.FieldValue.serverTimestamp(),
        status: 'published'
      };
      await docRef.set(payload, {merge:true});
      NSTATE.docId = docRef.id;
      const url = w.location.origin + '/viewer.html?id=' + docRef.id;
      w.alert('게시 완료!\n' + url);
    }catch(err){ console.error(err); w.alert('게시 실패: '+err.message); }
  });

  // 성경구절 삽입
  d.getElementById('btnInsertBibleFloating')?.addEventListener('click', insertBiblePrompt);
  async function insertBiblePrompt(){
    const raw = w.prompt('삽입할 성경구절 (예: 요 3:16, 창세기 1:1-3)');
    if(!raw) return;
    const norm=String(raw).replace(/\s+/g,' ').replace(/[–—－]/g,'-').replace(/[：]/g,':').trim();
    const m=norm.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?$/);
    if(!m){ w.alert('형식: 성경이름 장:절 또는 장:절-절'); return; }
    const bookRaw=m[1], chap=parseInt(m[2],10), vFrom=parseInt(m[3],10), vTo=m[4]?parseInt(m[4],10):parseInt(m[3],10);

    let BOOKS;
    try{ BOOKS = await getBooksInPopup(); }
    catch(e){ w.alert(e.message || '성경 데이터를 불러올 수 없습니다.'); return; }

    const bookKey=resolveBookKey(bookRaw,BOOKS);
    if(!bookKey){ w.alert(해당 성경을 찾을 수 없습니다: "${bookRaw}"); return; }

    const ch=BOOKS[bookKey]?.[chap];
    if(!ch){ w.alert("${bookKey}" ${chap}장을 찾을 수 없습니다.); return; }

    const verses=(ch.paras||[]).flatMap(p=>p.verses||[]).filter(([v])=>v>=vFrom&&v<=vTo);
    if(!verses.length){ w.alert('해당 구절을 찾을 수 없습니다.'); return; }

    const header = <div class="verse-header">&lt;${bookKey} ${chap}:${vFrom}${vTo!==vFrom?'-'+vTo:''}&gt;</div>;
    const html = verses.map(([v,t])=><span class="verse-line"><sup>${v}</sup>${t}</span>).join('');
    const blockHTML = header + html;

    NSTATE.blocks.push({ id:Nuid(), type:'p', html: blockHTML });
    Nrender(); NpushHistory(); NscheduleAutosave();
    const last = d.querySelector('#editorRoot .editor-block:last-child .content');
    last && last.focus();
  }

  // 저장/삭제/닫기/인쇄
  d.getElementById('s').onclick = ()=>{
    const runsDoc = collectRunsDocument();  // 새 포맷
    const html    = NblocksToHTML();        // 기존 포맷

    const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';
    const images = [];

    w.opener?.postMessage?.({
      type: 'sermon-save',
      title,
      body: runsDoc,     // 표준 저장: runs
      body_html: html,   // 호환 스냅샷: HTML (기존 기능 유지)
      images
    }, '*');

    w.close();
  };

  d.getElementById('d').onclick = ()=>{ if(w.confirm('삭제할까요?')){ w.opener?.postMessage?.({ type:'sermon-delete' }, '*'); w.close(); } };
  d.getElementById('x').onclick = ()=> w.close();
  d.getElementById('print').onclick = ()=> w.print();

  /* ========= 문장 단위 낭독 + 하이라이트 + 화면 중앙 정렬 ========= */
  const readBtn = d.getElementById('read');
  const stopBtn = d.getElementById('stop');
  const readPane = d.getElementById('readPane');

  const TTS = {
    sents: [],
    idx: 0,
    playing: false,
    synth: w.speechSynthesis || window.speechSynthesis,
    utter: null
  };

  function htmlToPlain(html){
    const tmp=d.createElement('div'); tmp.innerHTML=html||'';
    tmp.querySelectorAll('sup').forEach(s=> s.textContent='['+s.textContent+'] ');
    return (tmp.textContent||'').replace(/\s+\n/g,'\n').replace(/\n{2,}/g,'\n').replace(/\s+/g,' ').trim();
  }

  // 한국어/영문 종결부호 기준 문장 분할
  function splitToSentences(text){
    const t = String(text||'').trim();
    if(!t) return [];
    // 마침표, 물음표, 느낌표, 말줄임표, 한국어 종결(다.)도 일반 마침표로 처리됨
    const parts = t.split(/(?<=[\.!\?…]|[。！？])\s+/u).filter(s=>s && s.trim().length>0);
    return parts;
  }

  function renderReadPane(){
    readPane.innerHTML = TTS.sents.map((s,i)=><span class="sent" data-i="${i}">${escapeHtml(s)}</span>).join('');
    readPane.style.display = '';
  }

  function clearPaneHighlight(){
    readPane.querySelectorAll('.sent.reading').forEach(el=> el.classList.remove('reading'));
  }

  function highlightIndex(i){
    clearPaneHighlight();
    const span = readPane.querySelector(.sent[data-i="${i}"]);
    if(span){
      span.classList.add('reading');
      span.scrollIntoView({block:'center', behavior:'smooth'});
    }
  }

  function speakIdx(i){
    if(!TTS.synth) return;
    if(i<0 || i>=TTS.sents.length){ stopReading(); return; }
    TTS.idx = i;
    try{ TTS.synth.cancel(); }catch(_){}
    const u = new w.SpeechSynthesisUtterance(TTS.sents[i]);
    // 부모창 음성 설정을 그대로 이용하지 못하므로 기본 ko-KR로 설정
    u.lang = 'ko-KR';
    u.onstart = ()=>{
      highlightIndex(i);
    };
    u.onend = ()=>{
      if(!TTS.playing) return;
      const next = i+1;
      if(next < TTS.sents.length){
        speakIdx(next);
      }else{
        stopReading();
      }
    };
    u.onerror = ()=>{ // 오류 시 다음 문장으로 넘어가되 무한루프 방지
      if(!TTS.playing) return;
      const next = i+1;
      if(next < TTS.sents.length) speakIdx(next); else stopReading();
    };
    TTS.utter = u;
    TTS.synth.speak(u);
  }

  function startReading(){
    const html = NblocksToHTML();
    const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim();
    const plain = [title, htmlToPlain(html)].filter(Boolean).join('. ');
    const sents = splitToSentences(plain);
    if(!sents.length){ w.alert('낭독할 내용이 없습니다.'); return; }
    TTS.sents = sents;
    TTS.idx = 0;
    TTS.playing = true;
    renderReadPane();
    readBtn.textContent = '일시정지';
    speakIdx(0);
  }

  function stopReading(){
    TTS.playing = false;
    try{ TTS.synth && TTS.synth.cancel(); }catch(_){}
    clearPaneHighlight();
    readPane.style.display = 'none';
    readBtn.textContent = '낭독';
  }

  readBtn.onclick = ()=>{
    if(!TTS.synth){ w.alert('이 브라우저는 음성합성을 지원하지 않습니다.'); return; }
    if(!TTS.playing){
      startReading();
    }else{
      // 일시정지 토글: 일시정지 -> 재개
      if(TTS.synth.speaking && !TTS.synth.paused){
        TTS.synth.pause();
        readBtn.textContent = '재개';
      }else if(TTS.synth.paused){
        TTS.synth.resume();
        readBtn.textContent = '일시정지';
      }else{
        startReading();
      }
    }
  };

  stopBtn.onclick = ()=> stopReading();

  // 문장 클릭 시 해당 문장부터 재생
  readPane.addEventListener('click', (e)=>{
    const span = e.target.closest('.sent');
    if(!span) return;
    const i = +span.dataset.i;
    if(!Number.isFinite(i)) return;
    if(!TTS.sents.length) return;
    TTS.playing = true;
    readBtn.textContent = '일시정지';
    speakIdx(i);
  });

  // 저장/삭제/닫기/낭독 끝
  /* ========= 문장 단위 낭독 섹션 끝 ========= */

  // 기존 중지 버튼 핸들러는 위에서 대체( stopReading )로 처리됨
  // 기존 단일-문장 전체 낭독 로직은 요구사항에 맞춰 문장 단위로 치환됨

  // 성경 데이터 로드 유틸
  let __BOOKS_CACHE = null;
  async function getBooksInPopup(){
    if (__BOOKS_CACHE) return __BOOKS_CACHE;
    try{
      const P = w.opener || window.opener;
      if (P && P.BIBLE && P.BIBLE.books){
        __BOOKS_CACHE = P.BIBLE.books;
        return __BOOKS_CACHE;
      }
    }catch(_){}
    async function tryLoad(path){
      try{
        const res = await fetch(path, {cache:'no-store'});
        if(!res.ok) return null;
        const j = await res.json();
        return j && j.books ? j.books : null;
      }catch(_){ return null; }
    }
    __BOOKS_CACHE = await tryLoad('bible_paragraphs.json') || await tryLoad('bible-paragraph.json');
    if(!__BOOKS_CACHE) throw new Error('성경 데이터(BIBLE)를 불러올 수 없습니다.');
    return __BOOKS_CACHE;
  }

  function resolveBookKey(input,BOOKS){
    const s=normalizeBookName(input); const keys=Object.keys(BOOKS||{});
    const byNorm=new Map(keys.map(k=>[normalizeBookName(k),k])); if(byNorm.has(s)) return byNorm.get(s);
    const alias=BOOK_ALIAS_MAP(); if(alias[s] && BOOKS[alias[s]]) return alias[s];
    const startHit=keys.find(k=>normalizeBookName(k).startsWith(s)); if(startHit) return startHit;
    const inclHit=keys.find(k=>normalizeBookName(k).includes(s)); if(inclHit) return inclHit;
    return null;
  }
  function normalizeBookName(x){
    return String(x||'').toLowerCase().replace(/\s+/g,'').replace(/[.\u00B7]/g,'').replace(/서$/,'').replace(/복음서?$/,'복음')
    .replace(/첫째|둘째|셋째/g, m=>({'첫째':'1','둘째':'2','셋째':'3'}[m])).replace(/[일이삼]/g,m=>({'일':'1','이':'2','삼':'3'}[m]))
    .replace(/롬서?$/,'롬').replace(/고린도전서?$/,'고전').replace(/고린도후서?$/,'고후')
    .replace(/데살로니가전서?$/,'살전').replace(/데살로니가후서?$/,'살후')
    .replace(/디모데전서?$/,'딤전').replace(/디모데후서?$/,'딤후')
    .replace(/베드로전서?$/,'벧전').replace(/베드로후서?$/,'벧후')
    .replace(/요한일서?$/,'요1').replace(/요한이서?$/,'요2').replace(/요한삼서?$/,'요3');
  }
  function BOOK_ALIAS_MAP(){
    return {
      // 구약
      '창':'창세기','창세기':'창세기','창세':'창세기','출':'출애굽기','출애굽기':'출애굽기','출애':'출애굽기','레':'레위기','레위기':'레위기','민':'민수기','민수기':'민수기','신':'신명기','신명기':'신명기',
      '수':'여호수아','여호수아':'여호수아','삿':'사사기','사사기':'사사기','룻':'룻기','룻기':'룻기','삼상':'사무엘상','사무엘상':'사무엘상','삼하':'사무엘하','사무엘하':'사무엘하',
      '왕상':'열왕기상','열왕기상':'열왕기상','왕하':'열왕기하','열왕기하':'열왕기하','대상':'역대상','역대상':'역대상','대하':'역대하','역대하':'역대하',
      '스':'에스라','에스라':'에스라','느':'느헤미야','느헤미야':'느헤미야','에':'에스더','에스더':'에스더','욥':'욥기','욥기':'욥기','시':'시편','시편':'시편','잠':'잠언','잠언':'잠언',
      '전':'전도서','전도서':'전도서','아':'아가','아가':'아가','사':'이사야','이사야':'이사야','렘':'예레미야','예레미야':'예레미야','애':'예레미야애가','예레미야애가':'예레미야애가',
      '겔':'에스겔','에스겔':'에스겔','단':'다니엘','다니엘':'다니엘','호':'호세아','호세아':'호세아','욜':'요엘','요엘':'요엘','암':'아모스','아모스':'아모스','옵':'오바댜','오바댜':'오바댜',
      '욘':'요나','요나':'요나','미':'미가','미가':'미가','나':'나훔','나훔':'나훔','합':'하박국','하박국':'하박국','습':'스바냐','스바냐':'스바냐','학':'학개','학개':'학개','슥':'스가랴','스가랴':'스가랴','말':'말라기','말라기':'말라기',
      // 신약
      '마':'마태복음','마태':'마태복음','마태복음':'마태복음','막':'마가복음','마가':'마가복음','마가복음':'마가복음','눅':'누가복음','누가':'누가복음','누가복음':'누가복음',
      '요':'요한복음','요한복음':'요한복음','행':'사도행전','사도행전':'사도행전','롬':'로마서','로마서':'로마서','고전':'고린도전서','고린도전서':'고린도전서','고후':'고린도후서','고린도후서':'고린도후서',
      '갈':'갈라디아서','갈라디아서':'갈라디아서','엡':'에베소서','에베소서':'에베소서','빌':'빌립보서','빌립보서':'빌립보서','골':'골로새서','골로새서':'골로새서',
      '살전':'데살로니가전서','데살로니가전서':'데살로니가전서','살후':'데살로니가후서','데살로니가후서':'데살로니가후서','딤전':'디모데전서','디모데전서':'디모데전서','딤후':'디모데후서','디모데후서':'디모데후서',
      '딛':'디도서','디도서':'디도서','몬':'빌레몬서','빌레몬서':'빌레몬서','히':'히브리서','히브리서':'히브리서','약':'야고보서','야고보서':'야고보서',
      '벧전':'베드로전서','베드로전서':'베드로전서','벧후':'베드로후서','베드로후서':'베드로후서',
      '요1':'요한일서','요일1':'요한일서','요한일':'요한일서','요한일서':'요한일서','요2':'요한이서','요일2':'요한이서','요한이':'요한이서','요한이서':'요한이서',
      '요3':'요한삼서','요일3':'요한삼서','요한삼':'요한삼서','요한삼서':'요한삼서','유':'유다서','유다서':'유다서','계':'요한계시록','계시록':'요한계시록','요한계시록':'요한계시록'
    }
  }
}

/* ===== 모달 RTE 상단 패딩 자동 보정 ===== */
function adjustModalEditorPadding() {
  const wrap = document.getElementById('rteToolbar');
  const body = document.querySelector('#sermonEditor .rte');
  if (!body) return;
  const h = wrap ? (wrap.offsetHeight || 0) : 0;
  body.style.setProperty('--editor-pad-top', (h + 0) + 'px');
}
window.addEventListener('resize', adjustModalEditorPadding);
document.getElementById('sermonTitle')?.addEventListener('input', adjustModalEditorPadding);
window.addEventListener('load', adjustModalEditorPadding);

/* ===== 인라인 제목 편집 더미 ===== */
function startInlineTitleEdit(){ /* 필요 시 실제 구현으로 교체 */ }
ChatGPT의 말:

19s 동안 생각함
좋아요. 올려주신 코드 기준으로 “주입부 덧대기”는 잘 들어갔습니다.
다만 실행 중 바로 터질 만한 구체 버그 6개가 보여서, “기능은 그대로 두고” 필요한 최소 패치만 딱 집어서 드립니다. 그대로 붙여넣으면 됩니다.

꼭 필요한 최소 패치
1) escapeHtml/runsToHtml 중복 정의 제거
지금 파일 상단에도 있고 [RUNS-UTILS]에도 또 있습니다. 하나만 남기세요.
아래 [RUNS-UTILS] 블록의 버전만 남기고, 맨 위의 escapeHtml 정의 한 개는 지우세요.

삭제 대상(맨 윗부분):

function escapeHtml(s){ return (s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
남길 버전([RUNS-UTILS] 안쪽, DOM 기반 버전):

function escapeHtml(s){ const t=document.createElement('div'); t.textContent=String(s); return t.innerHTML; }
또한 [RUNS-UTILS] 안에 runsToHtml이 두 번 있습니다. 아래쪽(마크 오픈/클로즈 스택 처리하는 정교한 버전)만 남기고, 위쪽 간단 버전은 삭제하세요.

2) htmlToRuns(meta.body_html) 사용부 – 반환값 착오 수정
htmlToRuns()는 { text, runs }를 반환하는데, 현재 initBlocksFromMeta()에서 { blocks }를 구조분해하고 있어 **무조건 undefined**가 됩니다.

교체 (두 군데)
A) initBlocksFromMeta(meta) 안
- if (typeof meta?.body_html === 'string' && meta.body_html.trim()) {
-   const { blocks } = htmlToRuns(meta.body_html);
-   NSTATE.blocks = blocks;
-   return;
- }
+ if (typeof meta?.body_html === 'string' && meta.body_html.trim()) {
+   const { text, runs } = htmlToRuns(meta.body_html);
+   NSTATE.blocks = [{ id: Nuid(), type:'p', text, runs }];
+   return;
+ }
B) const legacy = ... 폴백 구간
- const { blocks } = htmlToRuns(legacy);
- NSTATE.blocks = blocks.length ? blocks : [{ id: Nuid(), type:'p', text:'', runs:[] }];
+ const { text, runs } = htmlToRuns(legacy);
+ NSTATE.blocks = (text && text.length) ? [{ id: Nuid(), type:'p', text, runs }] : [{ id: Nuid(), type:'p', text:'', runs:[] }];
3) NsplitBlock()의 미정의 변수 off 보정
현재 커서 위치 분할용 off가 정의되어 있지 않음 → 즉시 에러.
아래 보조 유틸 1개 추가하고, NsplitBlock()에서 호출하도록 바꿉니다.

(신규) 유틸 추가 – content 내 텍스트 기준 커서 오프셋
function caretTextOffsetInContent(contentEl){
  const sel = w.getSelection();
  if(!sel || sel.rangeCount===0) return 0;
  const range = sel.getRangeAt(0);
  if(!contentEl.contains(range.commonAncestorContainer)) return 0;

  // content 시작부터 커서까지의 Range를 만들어 text 길이로 변환
  const pre = d.createRange();
  pre.selectNodeContents(contentEl);
  pre.setEnd(range.endContainer, range.endOffset);
  const tmp = d.createElement('div');
  tmp.appendChild(pre.cloneContents());
  // sup, br 등은 htmlToRuns가 \n로 친다고 가정 → 간략화 버전
  tmp.querySelectorAll('sup').forEach(s=> s.remove());
  return (tmp.textContent || '').length;
}
NsplitBlock() 교체
- const html = block.querySelector('.content')?.innerHTML || '';
- // 현재 블록 전체를 Runs로 파싱한 뒤, caret 기준으로 앞/뒤를 텍스트로 나눕니다.
- const { text, runs } = htmlToRuns(html);
-
- // 텍스트 기준 오프셋(이미 계산된 off)을 사용해 앞/뒤 텍스트를 자릅니다.
- const preText  = (text || '').slice(0, off);
- const postText = (text || '').slice(off);
+ const html  = block.querySelector('.content')?.innerHTML || '';
+ const { text } = htmlToRuns(html);
+ const off = caretTextOffsetInContent(block.querySelector('.content'));
+ const preText  = (text || '').slice(0, off);
+ const postText = (text || '').slice(off);
간단 구현: **분할 시 runs는 초기화(서식 제거)**로 두었습니다.
(정교한 분할이 필요하면 runs를 s/e 기준으로 앞/뒤로 재계산하는 로직을 추후 추가하세요.)

4) 팝업 저장 메시지 수신부의 map2/arr2 누락 보정
openSermonEditorWindow()의 onMsg에서 map2, arr2를 쓰는데 정의가 없음 → 즉시 에러.

onMsg 내부에 상단 두 줄 추가
function onMsg(ev){
  const data = ev.data;
  if (!data || !data.type) return;

+ const map2 = getSermonMap();
+ const arr2 = map2[CURRENT.paraId] || [];

  if (data.type === 'sermon-save') {
    ...
그리고 실제 저장 시 v1 객체/문자열 모두 수용은 잘 하셨습니다(아래처럼 그대로 두면 됨).

arr2[idx] = {
  ...arr2[idx],
  title: data.title,
  body:  data.body,                    // 객체(v1) 또는 문자열
  body_html: data.body_html ?? arr2[idx]?.body_html,
  images: data.images || [],
  date
};
5) NblocksToHTML()이 runs 무시 → 낭독/인쇄 내용에 서식 반영하려면
지금은 b.html만 쓰는 이전 방식을 유지하고 있습니다. 새 포맷으로 입력된 블록은 b.text + b.runs만 있고 b.html이 비어 있을 수 있어요.
아래처럼 html이 없으면 runs를 렌더링하도록 안전하게 보강하세요.

function NblocksToHTML(){
  return NSTATE.blocks.map(b=>{
+   const html = (typeof b.html === 'string' && b.html.length)
+     ? b.html
+     : runsToHtml(b.text || '', b.runs || []);

    switch(b.type){
-     case 'h1': return `<h2>${b.html}</h2>`;
-     case 'h2': return `<h3>${b.html}</h3>`;
-     case 'h3': return `<h4>${b.html}</h4>`;
-     case 'quote': return `<blockquote>${b.html}</blockquote>`;
+     case 'h1': return `<h2>${html}</h2>`;
+     case 'h2': return `<h3>${html}</h3>`;
+     case 'h3': return `<h4>${html}</h4>`;
+     case 'quote': return `<blockquote>${html}</blockquote>`;
      case 'divider': return '<hr/>';
-     default: return `<div>${b.html}</div>`;
+     default: return `<div>${html}</div>`;
    }
  }).join('');
}
6) openSingleDocEditor(kind) 주입부 – 이미 잘 덧대셨습니다 (확인 포인트 2개)
우선순위: doc.body(v1 runs) → doc.body_html → doc.body(문자열) 👍

setBodyHTML(bodyHTML); 호출 전 **sermonTitle.value = doc.title || ''**도 유지되어 있어 👍

덧붙여 runsToHtml/htmlToRuns가 중복 없이 한 벌만 남아 있으면 여기서 추가 조치는 없습니다.

적용 순서 (권장)
(중복 제거) escapeHtml, runsToHtml 한 벌만 남기기

(반환값 보정) initBlocksFromMeta()의 { blocks } → { text, runs }

(커서 분할) caretTextOffsetInContent() 추가 + NsplitBlock()의 off 오류 해결

(저장 수신부) onMsg에 map2/arr2 정의 2줄 추가

(출력 보강) NblocksToHTML()이 runs 기반도 처리

(확인) openSingleDocEditor(kind)의 runs→HTML 주입부는 유지

이렇게만 바꾸면, 기존 기능 그대로 + runs 기반 저장/주입이 동시에 안정 작동합니다.

나의 말:
플로팅 툴바(굵게, 기울임, 밑줄, 글자색(6색)) 나오게 해줘
ChatGPT의 말:

17s 동안 생각함
좋아요. 기존 기능은 건드리지 않고 “플로팅 툴바(굵게/기울임/밑줄/글자색 6색)”만 얹는 최소 패치를 드릴게요.
아래 두 부분을 그대로 붙이면 됩니다.

A) 메인 모달 RTE(sermonEditor → #sermonBody)에 플로팅 툴바 추가
붙이는 위치: 파일 맨 아래 (기존 스크립트 끝난 뒤)

<script>
/* ========= Floating Toolbar for #sermonBody ========= */
(function installFloatingToolbarForModalRTE(){
  const target = document.getElementById('sermonBody');
  if(!target || target.getAttribute('contenteditable')!=='true') return;

  // 1) 스타일 주입
  const css = `
  .flt-toolbar{
    position:fixed; z-index:99999; display:flex; gap:6px; align-items:center;
    background: color-mix(in hsl, var(--panel, #161922) 88%, black 6%);
    border:1px solid var(--border, #252a36); border-radius:10px; padding:6px 8px;
    box-shadow:0 10px 24px rgba(0,0,0,.35); backdrop-filter:saturate(1.2) blur(4px);
  }
  .flt-toolbar button{
    border:1px solid var(--border, #252a36); background:#1b1f2a; color:#e6e8ef;
    padding:4px 8px; border-radius:8px; cursor:pointer
  }
  .flt-toolbar button:hover{ border-color: color-mix(in hsl, var(--border, #252a36) 70%, var(--accent, #6ea8fe) 30%); }
  .flt-toolbar .sep{ width:1px; height:18px; background:var(--border, #252a36); margin:0 2px; }
  .flt-toolbar .chips{ display:flex; gap:6px; }
  .flt-toolbar .chip{
    width:18px; height:18px; border-radius:999px; border:1px solid #333; cursor:pointer;
    outline:none; padding:0;
  }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // 2) 툴바 DOM
  const colors = ['#ffffff','#ffd166','#ef476f','#06d6a0','#118ab2','#9b59b6']; // 6색(흰/노/핑/초/파/보)
  const bar = document.createElement('div');
  bar.className = 'flt-toolbar';
  bar.style.display = 'none';
  bar.innerHTML = `
    <button data-cmd="bold"><b>B</b></button>
    <button data-cmd="italic"><i>I</i></button>
    <button data-cmd="underline"><u>U</u></button>
    <span class="sep"></span>
    <div class="chips">
      ${colors.map(c=>`<button class="chip" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('')}
    </div>
  `;
  document.body.appendChild(bar);

  // 3) 유틸
  function selectionInTarget(){
    const sel = window.getSelection(); if(!sel || sel.rangeCount===0) return false;
    const r = sel.getRangeAt(0);
    return target.contains(r.commonAncestorContainer) && !sel.isCollapsed;
  }
  function positionBar(){
    const sel = window.getSelection(); if(!sel || sel.rangeCount===0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const pad = 8;
    let x = rect.left + (rect.width/2) - (bar.offsetWidth/2) + window.scrollX;
    let y = rect.top - bar.offsetHeight - 8 + window.scrollY;
    if(y < 8 + window.scrollY) y = rect.bottom + 8 + window.scrollY;
    if(x < 8 + window.scrollX) x = 8 + window.scrollX;
    bar.style.left = `${x}px`;
    bar.style.top  = `${y}px`;
  }
  function showBar(){ bar.style.display = 'flex'; positionBar(); }
  function hideBar(){ bar.style.display = 'none'; }

  // 4) 포맷 핸들러
  bar.addEventListener('mousedown', e=> e.preventDefault()); // 선택 사라지지 않게
  bar.addEventListener('click', (e)=>{
    const b = e.target.closest('button'); if(!b) return;
    const cmd = b.dataset.cmd;
    const color = b.dataset.color;
    target.focus({preventScroll:true});
    if(cmd) document.execCommand(cmd, false, null);
    if(color) document.execCommand('foreColor', false, color);
    // 다시 위치 보정
    setTimeout(()=>{ if(selectionInTarget()) positionBar(); }, 0);
  });

  // 5) 이벤트 바인딩
  function maybeToggle(){
    if(selectionInTarget()) showBar(); else hideBar();
  }
  ['mouseup','keyup'].forEach(ev=>{
    target.addEventListener(ev, ()=> setTimeout(maybeToggle, 0));
  });
  document.addEventListener('scroll', ()=>{ if(bar.style.display!=='none') positionBar(); }, true);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hideBar(); }, true);
  document.addEventListener('mousedown', (e)=>{ if(!bar.contains(e.target) && !target.contains(e.target)) hideBar(); }, true);
})();
</script>
선택 영역이 #sermonBody 안에 있고 비어있지 않으면 툴바가 자동 표시됩니다.

버튼: B/I/U + 6색 칩 (색상은 필요 시 배열만 바꾸면 됩니다).

B) 팝업 편집기(initSermonPopup)의 버블(neBubble)에 “글자색 6색” 추가
붙이는 위치: 이미 있는 neBubble 관련 코드 바로 아래 (이벤트 바인딩 이어서)

버블 HTML 확장 – 색상 칩 줄 추가
popupHTML 템플릿 안의 #neBubble 생성부를 아래처럼 바꿔주세요.

-  <div id="neBubble" class="bubble hidden">
+  <div id="neBubble" class="bubble hidden">
     <button data-mark="bold"><b>B</b></button>
     <button data-mark="italic"><i>I</i></button>
     <button data-mark="underline"><u>U</u></button>
     <button data-mark="strike"><s>S</s></button>
     <button data-mark="code">` + '\\`code\\`' + `</button>
     <button data-mark="highlight">HL</button>
     <button data-action="link">🔗</button>
+    <div class="sep" style="width:1px;height:18px;background:#333;margin:0 4px"></div>
+    <div class="chips">
+      <button class="chip" data-color="#ffffff" title="#ffffff" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#ffffff"></button>
+      <button class="chip" data-color="#ffd166" title="#ffd166" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#ffd166"></button>
+      <button class="chip" data-color="#ef476f" title="#ef476f" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#ef476f"></button>
+      <button class="chip" data-color="#06d6a0" title="#06d6a0" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#06d6a0"></button>
+      <button class="chip" data-color="#118ab2" title="#118ab2" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#118ab2"></button>
+      <button class="chip" data-color="#9b59b6" title="#9b59b6" style="width:18px;height:18px;border-radius:999px;border:1px solid #333;background:#9b59b6"></button>
+    </div>
   </div>
버블 이벤트 보강 – 색상 클릭 처리
neBubble.addEventListener('click', …) 핸들러를 아래처럼 확장합니다.

  neBubble.addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const mark = btn.dataset.mark; const act = btn.dataset.action;
+   const color = btn.dataset.color;

    if(mark){
      d.execCommand(mark==='highlight'?'backColor':mark, false, mark==='highlight'? '#6655007a': null);
    } else if(act==='link'){
      const url = w.prompt('링크 URL'); if(url) d.execCommand('createLink', false, url);
      } else if(color){
        d.execCommand('foreColor', false, color);
    }
    NshowBubbleMaybe(); NscheduleAutosave();

    // 서식 적용 후 현재 블록을 Runs로 저장
    const curBlock = d.getSelection()?.anchorNode?.parentElement?.closest('.editor-block');
    if (curBlock) {
      NsaveBlock(curBlock);
      NscheduleAutosave();
    }
  });

  const N_SLASH = [
    {type:'p', label:'텍스트'},
    {type:'h1', label:'제목 1'},
    {type:'h2', label:'제목 2'},
    {type:'h3', label:'제목 3'},
    {type:'todo', label:'체크리스트'},
    {type:'ul', label:'불릿 리스트'},
    {type:'ol', label:'번호 리스트'},
    {type:'quote', label:'인용'},
    {type:'callout', label:'콜아웃'},
    {type:'divider', label:'구분선'},
    {type:'code', label:'코드 블록'},
    {type:'toggle', label:'토글 블록'},
    {type:'img', label:'이미지(링크)'},
  ];
  let NslashTarget = null;
  function NshowSlash(block){
    NslashTarget = block;
    const rect = block.getBoundingClientRect();
    neSlash.style.left = (rect.left + w.scrollX + 20) + 'px';
    neSlash.style.top  = (rect.top  + w.scrollY + 20) + 'px';
    neSlash.innerHTML = N_SLASH.map((it,i)=>`<div class="item" data-i="${i}">${it.label}</div>`).join('');
    neSlash.classList.remove('hidden');
  }
  neSlash.addEventListener('click', e=>{
    const item = e.target.closest('.item'); if(!item) return;
    const i = +item.dataset.i; NapplySlash(N_SLASH[i]);
    neSlash.classList.add('hidden');
  });
  d.addEventListener('keydown', e=>{ if(e.key==='Escape') neSlash.classList.add('hidden'); });

  function NapplySlash(it){
    if(!NslashTarget) return;
    const id = NslashTarget.dataset.id; const idx = NindexById(id); if(idx<0) return;
    if(it.type==='divider'){
      NSTATE.blocks[idx] = {id, type:'divider', html:''};
    } else if(it.type==='img'){
      const url = w.prompt('이미지 URL'); if(url){ NSTATE.blocks[idx].html = `<img src="${url}" style="max-width:100%">`; }
    } else if(it.type==='todo'){
      NSTATE.blocks[idx] = {id, type:'todo', html:`<input type="checkbox"> 할 일`};
    } else if(it.type==='ul' || it.type==='ol'){
      NSTATE.blocks[idx] = {id, type:it.type, html:`<${it.type}><li>첫 번째</li></${it.type}>`};
    } else if(it.type==='toggle'){
      NSTATE.blocks[idx] = {id, type:'toggle', html:'토글 제목<br>토글 내용'};
    } else {
      NSTATE.blocks[idx].type = it.type;
    }
    Nrender(); NscheduleAutosave();

    const cur = neRoot.querySelector(`.editor-block[data-id="${id}"]`);
    if (cur) {
      NsaveBlock(cur);
      NscheduleAutosave();
    }
  
  }

  function NpushHistory(){ NSTATE.history = NSTATE.history.slice(0, NSTATE.cursor+1); NSTATE.history.push(JSON.stringify(NSTATE.blocks)); NSTATE.cursor = NSTATE.history.length-1; }
  function Nundo(){ if(NSTATE.cursor>0){ NSTATE.cursor--; NSTATE.blocks = JSON.parse(NSTATE.history[NSTATE.cursor]); Nrender(); } }
  function Nredo(){ if(NSTATE.cursor<NSTATE.history.length-1){ NSTATE.cursor++; NSTATE.blocks = JSON.parse(NSTATE.history[NSTATE.cursor]); Nrender(); } }

  function NblocksToHTML(){
    return NSTATE.blocks.map(b=>{
      switch(b.type){
        case 'h1': return `<h2>${b.html}</h2>`;
        case 'h2': return `<h3>${b.html}</h3>`;
        case 'h3': return `<h4>${b.html}</h4>`;
        case 'quote': return `<blockquote>${b.html}</blockquote>`;
        case 'divider': return '<hr/>';
        default: return `<div>${b.html}</div>`;
      }
    }).join('');
  }

  let NsaveTimer=null;
  function NscheduleAutosave(){
    clearTimeout(NsaveTimer);
    neAutosave.textContent = '입력 중…';
    NsaveTimer = setTimeout(()=>{
      try{
        const key = `wbps.sermon.draft.blocks.${(meta.paraId||'')}.${(meta.idx||0)}`;
        const payload = { title: ($('neTitle').value||''), blocks:NSTATE.blocks, ts: Date.now() };
        w.localStorage.setItem(key, JSON.stringify(payload));
        neAutosave.textContent = '자동저장됨';
      }catch(_){ neAutosave.textContent = '자동저장 실패(용량)'; }
    }, 500);
  }

  (function Ninit(){
    initBlocksFromMeta(meta);
    Nrender();
    NpushHistory();
    setTimeout(()=>{ const last = d.querySelector('#editorRoot .editor-block:last-child .content'); last && last.focus(); }, 60);
  })();

  // STT
  (function(){
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if(!SR){ console.warn('STT 미지원'); return; }
    const rec = new SR(); rec.lang='ko-KR'; rec.interimResults=true; rec.continuous=true;

    let activeBlock=null, accText='', startedAt=null;
    function getActive(){ const sel=w.getSelection(); const n=sel?.anchorNode; const el=(n?.nodeType===1?n:(n?.parentElement)); return el?.closest?.('.editor-block') || d.querySelector('.editor-block'); }
    function setProgress(block, ratio){ const bar=block?.querySelector('.progress'); if(bar) bar.style.width = Math.max(0,Math.min(100,ratio*100)) + '%'; }
    function plain(html){ const t=d.createElement('div'); t.innerHTML=html||''; return t.textContent||''; }
    function sim(a,b){ a=a.replace(/\s+/g,''); b=b.replace(/\s+/g,''); const L=Math.max(a.length,1); let m=0; for(let i=0;i<Math.min(a.length,b.length);i++){ if(a[i]===b[i]) m++; } return m/L; }
    function nextBlock(block){ const nx = block?.nextElementSibling?.classList.contains('editor-block')? block.nextElementSibling : null; return nx; }

    const neSttBtn = d.getElementById('neStt');
    neSttBtn?.addEventListener('click', ()=>{
      if(neSttBtn.dataset.on==='1'){ rec.stop(); neSttBtn.dataset.on='0'; neSttBtn.textContent='🎙 STT'; return; }
      activeBlock = getActive(); if(!activeBlock){ w.alert('블록을 선택하세요'); return; }
      accText=''; startedAt=Date.now(); rec.start(); neSttBtn.dataset.on='1'; neSttBtn.textContent='⏸ 중지';
    });

    rec.onresult = (ev)=>{
      if(!activeBlock) return;
      const r = ev.results[ev.results.length-1]; const txt=r[0].transcript; const isFinal=r.isFinal;
      accText += (isFinal? txt+' ' : txt);
      const base = plain(activeBlock.querySelector('.content').innerHTML);
      const s = sim(base, accText); setProgress(activeBlock, s);

      const t = ((Date.now()-startedAt)/1000).toFixed(1);
      const neTrace = d.getElementById('traceLog');
      neTrace.textContent += `t=${t}s s=${(s*100).toFixed(0)}% : ${txt}\n`;
      neTrace.scrollTop = neTrace.scrollHeight;

      if(isFinal && s>0.95){
        const nb = nextBlock(activeBlock);
        if(nb){ activeBlock = nb; accText=''; startedAt=Date.now(); setProgress(nb, 0); }
      }
    };
    rec.onend   = ()=>{ if(neSttBtn.dataset.on==='1'){ rec.start(); } };
    rec.onerror = (e)=> console.warn('STT 오류', e.error);
  })();

  // 게시(Firebase 옵션)
  const nePubBtn = d.getElementById('nePublish');
  nePubBtn?.addEventListener('click', async ()=>{
    try{
      if(typeof w.firebase === 'undefined'){ w.alert('Firebase 미탑재: 게시 기능을 사용하려면 SDK/초기화가 필요합니다.'); return; }
      const user = w.firebase.auth().currentUser;
      if(!user){ w.alert('로그인 후 게시 가능합니다.'); return; }

      const db = w.firebase.firestore();
      const docRef = NSTATE.docId ? db.collection('sermons').doc(NSTATE.docId) : db.collection('sermons').doc();
      const payload = {
        title: (d.getElementById('neTitle').value||'무제'),
        blocks: NSTATE.blocks,
        owner: user.uid,
        updatedAt: w.firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: w.firebase.firestore.FieldValue.serverTimestamp(),
        status: 'published'
      };
      await docRef.set(payload, {merge:true});
      NSTATE.docId = docRef.id;
      const url = w.location.origin + '/viewer.html?id=' + docRef.id;
      w.alert('게시 완료!\n' + url);
    }catch(err){ console.error(err); w.alert('게시 실패: '+err.message); }
  });

  // 성경구절 삽입
  d.getElementById('btnInsertBibleFloating')?.addEventListener('click', insertBiblePrompt);
  async function insertBiblePrompt(){
    const raw = w.prompt('삽입할 성경구절 (예: 요 3:16, 창세기 1:1-3)');
    if(!raw) return;
    const norm=String(raw).replace(/\s+/g,' ').replace(/[–—－]/g,'-').replace(/[：]/g,':').trim();
    const m=norm.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?$/);
    if(!m){ w.alert('형식: 성경이름 장:절 또는 장:절-절'); return; }
    const bookRaw=m[1], chap=parseInt(m[2],10), vFrom=parseInt(m[3],10), vTo=m[4]?parseInt(m[4],10):parseInt(m[3],10);

    let BOOKS;
    try{ BOOKS = await getBooksInPopup(); }
    catch(e){ w.alert(e.message || '성경 데이터를 불러올 수 없습니다.'); return; }

    const bookKey=resolveBookKey(bookRaw,BOOKS);
    if(!bookKey){ w.alert(`해당 성경을 찾을 수 없습니다: "${bookRaw}"`); return; }

    const ch=BOOKS[bookKey]?.[chap];
    if(!ch){ w.alert(`"${bookKey}" ${chap}장을 찾을 수 없습니다.`); return; }

    const verses=(ch.paras||[]).flatMap(p=>p.verses||[]).filter(([v])=>v>=vFrom&&v<=vTo);
    if(!verses.length){ w.alert('해당 구절을 찾을 수 없습니다.'); return; }

    const header = `<div class="verse-header">&lt;${bookKey} ${chap}:${vFrom}${vTo!==vFrom?'-'+vTo:''}&gt;</div>`;
    const html = verses.map(([v,t])=>`<span class="verse-line"><sup>${v}</sup>${t}</span>`).join('');
    const blockHTML = header + html;

    NSTATE.blocks.push({ id:Nuid(), type:'p', html: blockHTML });
    Nrender(); NpushHistory(); NscheduleAutosave();
    const last = d.querySelector('#editorRoot .editor-block:last-child .content');
    last && last.focus();
  }

  // 저장/삭제/닫기/인쇄
  d.getElementById('s').onclick = ()=>{
    const runsDoc = collectRunsDocument();  // 새 포맷
    const html    = NblocksToHTML();        // 기존 포맷

    const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';
    const images = [];

    w.opener?.postMessage?.({
      type: 'sermon-save',
      title,
      body: runsDoc,     // 표준 저장: runs
      body_html: html,   // 호환 스냅샷: HTML (기존 기능 유지)
      images
    }, '*');

    w.close();
  };

  d.getElementById('d').onclick = ()=>{ if(w.confirm('삭제할까요?')){ w.opener?.postMessage?.({ type:'sermon-delete' }, '*'); w.close(); } };
  d.getElementById('x').onclick = ()=> w.close();
  d.getElementById('print').onclick = ()=> w.print();

  /* ========= 문장 단위 낭독 + 하이라이트 + 화면 중앙 정렬 ========= */
  const readBtn = d.getElementById('read');
  const stopBtn = d.getElementById('stop');
  const readPane = d.getElementById('readPane');

  const TTS = {
    sents: [],
    idx: 0,
    playing: false,
    synth: w.speechSynthesis || window.speechSynthesis,
    utter: null
  };

  function htmlToPlain(html){
    const tmp=d.createElement('div'); tmp.innerHTML=html||'';
    tmp.querySelectorAll('sup').forEach(s=> s.textContent='['+s.textContent+'] ');
    return (tmp.textContent||'').replace(/\s+\n/g,'\n').replace(/\n{2,}/g,'\n').replace(/\s+/g,' ').trim();
  }

  // 한국어/영문 종결부호 기준 문장 분할
  function splitToSentences(text){
    const t = String(text||'').trim();
    if(!t) return [];
    // 마침표, 물음표, 느낌표, 말줄임표, 한국어 종결(다.)도 일반 마침표로 처리됨
    const parts = t.split(/(?<=[\.!\?…]|[。！？])\s+/u).filter(s=>s && s.trim().length>0);
    return parts;
  }

  function renderReadPane(){
    readPane.innerHTML = TTS.sents.map((s,i)=>`<span class="sent" data-i="${i}">${escapeHtml(s)}</span>`).join('');
    readPane.style.display = '';
  }

  function clearPaneHighlight(){
    readPane.querySelectorAll('.sent.reading').forEach(el=> el.classList.remove('reading'));
  }

  function highlightIndex(i){
    clearPaneHighlight();
    const span = readPane.querySelector(`.sent[data-i="${i}"]`);
    if(span){
      span.classList.add('reading');
      span.scrollIntoView({block:'center', behavior:'smooth'});
    }
  }

  function speakIdx(i){
    if(!TTS.synth) return;
    if(i<0 || i>=TTS.sents.length){ stopReading(); return; }
    TTS.idx = i;
    try{ TTS.synth.cancel(); }catch(_){}
    const u = new w.SpeechSynthesisUtterance(TTS.sents[i]);
    // 부모창 음성 설정을 그대로 이용하지 못하므로 기본 ko-KR로 설정
    u.lang = 'ko-KR';
    u.onstart = ()=>{
      highlightIndex(i);
    };
    u.onend = ()=>{
      if(!TTS.playing) return;
      const next = i+1;
      if(next < TTS.sents.length){
        speakIdx(next);
      }else{
        stopReading();
      }
    };
    u.onerror = ()=>{ // 오류 시 다음 문장으로 넘어가되 무한루프 방지
      if(!TTS.playing) return;
      const next = i+1;
      if(next < TTS.sents.length) speakIdx(next); else stopReading();
    };
    TTS.utter = u;
    TTS.synth.speak(u);
  }

  function startReading(){
    const html = NblocksToHTML();
    const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim();
    const plain = [title, htmlToPlain(html)].filter(Boolean).join('. ');
    const sents = splitToSentences(plain);
    if(!sents.length){ w.alert('낭독할 내용이 없습니다.'); return; }
    TTS.sents = sents;
    TTS.idx = 0;
    TTS.playing = true;
    renderReadPane();
    readBtn.textContent = '일시정지';
    speakIdx(0);
  }

  function stopReading(){
    TTS.playing = false;
    try{ TTS.synth && TTS.synth.cancel(); }catch(_){}
    clearPaneHighlight();
    readPane.style.display = 'none';
    readBtn.textContent = '낭독';
  }

  readBtn.onclick = ()=>{
    if(!TTS.synth){ w.alert('이 브라우저는 음성합성을 지원하지 않습니다.'); return; }
    if(!TTS.playing){
      startReading();
    }else{
      // 일시정지 토글: 일시정지 -> 재개
      if(TTS.synth.speaking && !TTS.synth.paused){
        TTS.synth.pause();
        readBtn.textContent = '재개';
      }else if(TTS.synth.paused){
        TTS.synth.resume();
        readBtn.textContent = '일시정지';
      }else{
        startReading();
      }
    }
  };

  stopBtn.onclick = ()=> stopReading();

  // 문장 클릭 시 해당 문장부터 재생
  readPane.addEventListener('click', (e)=>{
    const span = e.target.closest('.sent');
    if(!span) return;
    const i = +span.dataset.i;
    if(!Number.isFinite(i)) return;
    if(!TTS.sents.length) return;
    TTS.playing = true;
    readBtn.textContent = '일시정지';
    speakIdx(i);
  });

  // 저장/삭제/닫기/낭독 끝
  /* ========= 문장 단위 낭독 섹션 끝 ========= */

  // 기존 중지 버튼 핸들러는 위에서 대체( stopReading )로 처리됨
  // 기존 단일-문장 전체 낭독 로직은 요구사항에 맞춰 문장 단위로 치환됨

  // 성경 데이터 로드 유틸
  let __BOOKS_CACHE = null;
  async function getBooksInPopup(){
    if (__BOOKS_CACHE) return __BOOKS_CACHE;
    try{
      const P = w.opener || window.opener;
      if (P && P.BIBLE && P.BIBLE.books){
        __BOOKS_CACHE = P.BIBLE.books;
        return __BOOKS_CACHE;
      }
    }catch(_){}
    async function tryLoad(path){
      try{
        const res = await fetch(path, {cache:'no-store'});
        if(!res.ok) return null;
        const j = await res.json();
        return j && j.books ? j.books : null;
      }catch(_){ return null; }
    }
    __BOOKS_CACHE = await tryLoad('bible_paragraphs.json') || await tryLoad('bible-paragraph.json');
    if(!__BOOKS_CACHE) throw new Error('성경 데이터(BIBLE)를 불러올 수 없습니다.');
    return __BOOKS_CACHE;
  }

  function resolveBookKey(input,BOOKS){
    const s=normalizeBookName(input); const keys=Object.keys(BOOKS||{});
    const byNorm=new Map(keys.map(k=>[normalizeBookName(k),k])); if(byNorm.has(s)) return byNorm.get(s);
    const alias=BOOK_ALIAS_MAP(); if(alias[s] && BOOKS[alias[s]]) return alias[s];
    const startHit=keys.find(k=>normalizeBookName(k).startsWith(s)); if(startHit) return startHit;
    const inclHit=keys.find(k=>normalizeBookName(k).includes(s)); if(inclHit) return inclHit;
    return null;
  }
  function normalizeBookName(x){
    return String(x||'').toLowerCase().replace(/\s+/g,'').replace(/[.\u00B7]/g,'').replace(/서$/,'').replace(/복음서?$/,'복음')
    .replace(/첫째|둘째|셋째/g, m=>({'첫째':'1','둘째':'2','셋째':'3'}[m])).replace(/[일이삼]/g,m=>({'일':'1','이':'2','삼':'3'}[m]))
    .replace(/롬서?$/,'롬').replace(/고린도전서?$/,'고전').replace(/고린도후서?$/,'고후')
    .replace(/데살로니가전서?$/,'살전').replace(/데살로니가후서?$/,'살후')
    .replace(/디모데전서?$/,'딤전').replace(/디모데후서?$/,'딤후')
    .replace(/베드로전서?$/,'벧전').replace(/베드로후서?$/,'벧후')
    .replace(/요한일서?$/,'요1').replace(/요한이서?$/,'요2').replace(/요한삼서?$/,'요3');
  }
  function BOOK_ALIAS_MAP(){
    return {
      // 구약
      '창':'창세기','창세기':'창세기','창세':'창세기','출':'출애굽기','출애굽기':'출애굽기','출애':'출애굽기','레':'레위기','레위기':'레위기','민':'민수기','민수기':'민수기','신':'신명기','신명기':'신명기',
      '수':'여호수아','여호수아':'여호수아','삿':'사사기','사사기':'사사기','룻':'룻기','룻기':'룻기','삼상':'사무엘상','사무엘상':'사무엘상','삼하':'사무엘하','사무엘하':'사무엘하',
      '왕상':'열왕기상','열왕기상':'열왕기상','왕하':'열왕기하','열왕기하':'열왕기하','대상':'역대상','역대상':'역대상','대하':'역대하','역대하':'역대하',
      '스':'에스라','에스라':'에스라','느':'느헤미야','느헤미야':'느헤미야','에':'에스더','에스더':'에스더','욥':'욥기','욥기':'욥기','시':'시편','시편':'시편','잠':'잠언','잠언':'잠언',
      '전':'전도서','전도서':'전도서','아':'아가','아가':'아가','사':'이사야','이사야':'이사야','렘':'예레미야','예레미야':'예레미야','애':'예레미야애가','예레미야애가':'예레미야애가',
      '겔':'에스겔','에스겔':'에스겔','단':'다니엘','다니엘':'다니엘','호':'호세아','호세아':'호세아','욜':'요엘','요엘':'요엘','암':'아모스','아모스':'아모스','옵':'오바댜','오바댜':'오바댜',
      '욘':'요나','요나':'요나','미':'미가','미가':'미가','나':'나훔','나훔':'나훔','합':'하박국','하박국':'하박국','습':'스바냐','스바냐':'스바냐','학':'학개','학개':'학개','슥':'스가랴','스가랴':'스가랴','말':'말라기','말라기':'말라기',
      // 신약
      '마':'마태복음','마태':'마태복음','마태복음':'마태복음','막':'마가복음','마가':'마가복음','마가복음':'마가복음','눅':'누가복음','누가':'누가복음','누가복음':'누가복음',
      '요':'요한복음','요한복음':'요한복음','행':'사도행전','사도행전':'사도행전','롬':'로마서','로마서':'로마서','고전':'고린도전서','고린도전서':'고린도전서','고후':'고린도후서','고린도후서':'고린도후서',
      '갈':'갈라디아서','갈라디아서':'갈라디아서','엡':'에베소서','에베소서':'에베소서','빌':'빌립보서','빌립보서':'빌립보서','골':'골로새서','골로새서':'골로새서',
      '살전':'데살로니가전서','데살로니가전서':'데살로니가전서','살후':'데살로니가후서','데살로니가후서':'데살로니가후서','딤전':'디모데전서','디모데전서':'디모데전서','딤후':'디모데후서','디모데후서':'디모데후서',
      '딛':'디도서','디도서':'디도서','몬':'빌레몬서','빌레몬서':'빌레몬서','히':'히브리서','히브리서':'히브리서','약':'야고보서','야고보서':'야고보서',
      '벧전':'베드로전서','베드로전서':'베드로전서','벧후':'베드로후서','베드로후서':'베드로후서',
      '요1':'요한일서','요일1':'요한일서','요한일':'요한일서','요한일서':'요한일서','요2':'요한이서','요일2':'요한이서','요한이':'요한이서','요한이서':'요한이서',
      '요3':'요한삼서','요일3':'요한삼서','요한삼':'요한삼서','요한삼서':'요한삼서','유':'유다서','유다서':'유다서','계':'요한계시록','계시록':'요한계시록','요한계시록':'요한계시록'
    }
  }
}

/* ===== 모달 RTE 상단 패딩 자동 보정 ===== */
function adjustModalEditorPadding() {
  const wrap = document.getElementById('rteToolbar');
  const body = document.querySelector('#sermonEditor .rte');
  if (!body) return;
  const h = wrap ? (wrap.offsetHeight || 0) : 0;
  body.style.setProperty('--editor-pad-top', (h + 0) + 'px');
}
window.addEventListener('resize', adjustModalEditorPadding);
document.getElementById('sermonTitle')?.addEventListener('input', adjustModalEditorPadding);
window.addEventListener('load', adjustModalEditorPadding);

/* ===== 인라인 제목 편집 더미 ===== */
function startInlineTitleEdit(){ /* 필요 시 실제 구현으로 교체 */ }
