// ── APP STATE ────────────────────────────────────────────────────────────
const GOAL = 2201;
const MACRO_GOALS = { carbs:220, protein:140, fat:73 };
const LS_KEY = 'nutritrack_v1';  // localStorage fallback key

const meals = [
  { id:'breakfast', name:'Breakfast', icon:'☀️', color:'#f59e0b', items:[] },
  { id:'lunch',     name:'Lunch',     icon:'🥗', color:'#3ecf8e', items:[] },
  { id:'dinner',    name:'Dinner',    icon:'🍽️', color:'#4a9eff', items:[] },
  { id:'snacks',    name:'Snacks',    icon:'🍎', color:'#a78bfa', items:[] },
];

let currentDateKey = todayKey();
let dayOffset = 0;
let saveTimer = null;
let currentScanMealId = null;
let pendingFood = null;
let scannerRunning = false;
let lastCode = null;

// ── DATE HELPERS ─────────────────────────────────────────────────────────
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateKeyFromOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function friendlyDate(key) {
  const [y,m,d] = key.split('-').map(Number);
  const date = new Date(y,m-1,d);
  if (key === todayKey())              return 'Today · ' + date.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  if (key === dateKeyFromOffset(-1))  return 'Yesterday · ' + date.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  return date.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}

// ── UI: SHOW / HIDE SCREENS ───────────────────────────────────────────────
function hideLoadingScreen() {
  document.getElementById('loadingScreen').classList.add('hidden');
}
function showLoginScreen() {
  hideLoadingScreen();
  document.getElementById('loginScreen').style.display = 'block';
  document.getElementById('mainApp').style.display     = 'none';
}
function showApp(user) {
  hideLoadingScreen();
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display     = 'block';
  // Show user avatar and name in header
  const img = document.getElementById('userAvatar');
  img.src = user.photoURL || '';
  img.style.display = user.photoURL ? 'block' : 'none';
  document.getElementById('umName').textContent  = user.displayName || 'User';
  document.getElementById('umEmail').textContent = user.email || '';
  // Init date nav
  currentDateKey = todayKey();
  dayOffset = 0;
  updateDateNav();
}

function toggleUserMenu() {
  const menu = document.getElementById('userMenu');
  const btn  = document.getElementById('avatarBtn');
  const open = menu.classList.toggle('open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
// Close user menu when clicking elsewhere
document.addEventListener('click', function(e) {
  const menu = document.getElementById('userMenu');
  const btn  = document.getElementById('avatarBtn');
  if (menu && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
});

// ── DATE NAVIGATION ───────────────────────────────────────────────────────
function changeDay(delta) {
  dayOffset += delta;
  if (dayOffset > 0) dayOffset = 0;
  currentDateKey = dateKeyFromOffset(dayOffset);
  meals.forEach(m => m.items = []);
  updateDateNav();
  renderMeals();
  updateSummary();
  markSaving();
  // Re-subscribe Firestore for new date
  if (window.resubscribeForDate) window.resubscribeForDate();
}
function goToday() {
  dayOffset = 0;
  currentDateKey = todayKey();
  meals.forEach(m => m.items = []);
  updateDateNav();
  renderMeals();
  updateSummary();
  if (window.resubscribeForDate) window.resubscribeForDate();
}
function updateDateNav() {
  const lbl = document.getElementById('dateNavLabel');
  if (lbl) lbl.textContent = friendlyDate(currentDateKey);
  const fwd = document.getElementById('fwdBtn');
  if (fwd) { fwd.style.opacity = dayOffset===0?'0.3':'1'; fwd.style.pointerEvents = dayOffset===0?'none':'auto'; }
}

// ── LOCALSTORAGE FALLBACK ─────────────────────────────────────────────────
function loadFromLocalStorage() {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const day = all[currentDateKey] || {};
    meals.forEach(m => { m.items = day[m.id] || []; });
  } catch(e) { meals.forEach(m => m.items = []); }
}
function saveToLocalStorage() {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const snap = {};
    meals.forEach(m => { snap[m.id] = m.items; });
    all[currentDateKey] = snap;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch(e) {}
}

// ── SAVE ORCHESTRATION ────────────────────────────────────────────────────
function scheduleSave() {
  markSaving();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (window.saveToCloud) window.saveToCloud();
    else { saveToLocalStorage(); markSaved(); }
  }, 800);
}
function markSaving() {
  const ind = document.getElementById('saveIndicator');
  const lbl = document.getElementById('saveLabel');
  if (ind) ind.classList.add('dirty');
  if (lbl) lbl.textContent = 'Saving…';
}
function markSaved() {
  const ind = document.getElementById('saveIndicator');
  const lbl = document.getElementById('saveLabel');
  if (ind) ind.classList.remove('dirty');
  if (lbl) lbl.textContent = '☁️ Synced';
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────
function exportData() {
  saveToLocalStorage();
  const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  const blob = new Blob([JSON.stringify(all,null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `nutritrack-${todayKey()}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('📥 Exported!');
}
function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const imp = JSON.parse(ev.target.result);
      if (typeof imp !== 'object' || Array.isArray(imp)) throw new Error();
      const existing = JSON.parse(localStorage.getItem(LS_KEY)||'{}');
      localStorage.setItem(LS_KEY, JSON.stringify({...existing,...imp}));
      loadFromLocalStorage(); renderMeals(); updateSummary();
      showToast('✅ Imported!');
    } catch{ showToast('❌ Import failed',true); }
  };
  reader.readAsText(file);
  e.target.value='';
}

// ── FOCUS TRAP ────────────────────────────────────────────────────────────
// Returns a cleanup function. Call it when the modal closes.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapFocus(dialogEl, onEscape) {
  const prev = document.activeElement;
  const getFocusable = () => [...dialogEl.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[aria-hidden="true"]'));

  // Move focus into the dialog
  const first = getFocusable()[0];
  if (first) first.focus();

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
    const firstEl = focusable[0], lastEl = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    } else {
      if (document.activeElement === lastEl)  { e.preventDefault(); firstEl.focus(); }
    }
  }

  dialogEl.addEventListener('keydown', onKeydown);

  // Return cleanup: remove listener and restore focus to the trigger element
  return function release() {
    dialogEl.removeEventListener('keydown', onKeydown);
    if (prev && prev.focus) prev.focus();
  };
}

// ── CLEAR DAY ─────────────────────────────────────────────────────────────
let releaseClearTrap = null;
function confirmClear() {
  const o=document.getElementById('confirmOverlay'); o.classList.add('open'); o.removeAttribute('aria-hidden');
  releaseClearTrap = trapFocus(o.querySelector('.confirm-box'), closeConfirm);
}
function closeConfirm() {
  const o=document.getElementById('confirmOverlay'); o.classList.remove('open'); o.setAttribute('aria-hidden','true');
  if (releaseClearTrap) { releaseClearTrap(); releaseClearTrap=null; }
}
function clearDay() {
  closeConfirm();
  meals.forEach(m => m.items=[]);
  scheduleSave();
  renderMeals(); updateSummary();
  showToast('🗑 Day cleared');
}

// ── TAB SWITCHING ─────────────────────────────────────────────────────────
const TAB_IDS = ['scan', 'search', 'barcode'];

function switchTab(tab) {
  TAB_IDS.forEach(t => {
    const btn  = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    const pane = document.getElementById('pane' + t.charAt(0).toUpperCase() + t.slice(1));
    const active = t === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.setAttribute('tabindex', active ? '0' : '-1');
    pane.style.display = active ? 'block' : 'none';
  });
  hideFoodResult();
  if (tab === 'scan') {
    setTimeout(startQuagga, 200);
  } else {
    stopQuagga();
  }
  if (tab === 'search') {
    setTimeout(() => document.getElementById('foodSearchInput').focus(), 100);
  }
}

// Arrow-key navigation for the tablist
document.getElementById('scannerModal').addEventListener('keydown', function(e) {
  if (!['ArrowLeft','ArrowRight'].includes(e.key)) return;
  const focused = document.activeElement;
  const idx = TAB_IDS.findIndex(t => focused === document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)));
  if (idx === -1) return;
  e.preventDefault();
  const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + TAB_IDS.length) % TAB_IDS.length;
  const nextTab = TAB_IDS[next];
  switchTab(nextTab);
  document.getElementById('tab' + nextTab.charAt(0).toUpperCase() + nextTab.slice(1)).focus();
});

// ── FOOD NAME SEARCH (Open Food Facts search API) ─────────────────────────
async function searchFood() {
  const query = document.getElementById('foodSearchInput').value.trim();
  if (!query) return;

  const statusEl  = document.getElementById('searchStatus');
  const resultsEl = document.getElementById('searchResults');
  statusEl.innerHTML = '<span class="spinner"></span>Searching…';
  statusEl.className = 'search-status';
  resultsEl.innerHTML = '';
  hideFoodResult();

  try {
    // Open Food Facts search endpoint — searches product name, returns up to 20 results
    // We filter to products that have nutrition data (energy > 0)
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20&fields=product_name,brands,nutriments,serving_size,image_thumb_url`;
    const res  = await fetch(url);
    const data = await res.json();

    const products = (data.products || []).filter(p =>
      p.product_name &&
      p.nutriments &&
      (p.nutriments['energy-kcal_100g'] || p.nutriments['energy_100g'])
    );

    if (products.length === 0) {
      statusEl.textContent = '😕 No results found — try different keywords';
      statusEl.className = 'search-status error';
      return;
    }

    statusEl.textContent = `${products.length} result${products.length!==1?'s':''} found`;
    statusEl.className = 'search-status';

    resultsEl.innerHTML = '';
    products.forEach((p, idx) => {
      const n = p.nutriments || {};
      let kcal100 = n['energy-kcal_100g'] || (n['energy_100g'] ? n['energy_100g']/4.184 : 0);
      let factor = 1, servingLabel = 'per 100g';
      if (p.serving_size) {
        const m = p.serving_size.match(/([\d.]+)/);
        if (m) { factor = parseFloat(m[1])/100; servingLabel = `per serving (${p.serving_size})`; }
      }
      const kcal    = Math.round(kcal100 * factor);
      const carbs   = +((n['carbohydrates_100g']||0)*factor).toFixed(1);
      const protein = +((n['proteins_100g']||0)*factor).toFixed(1);
      const fat     = +((n['fat_100g']||0)*factor).toFixed(1);
      const name    = p.product_name || 'Unknown';
      const brand   = p.brands || '';

      // Build a food object and store it on the element via data attribute
      const foodObj = JSON.stringify({ name, brand, kcal, carbs, protein, fat, servingLabel });

      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div class="sri-left">
          <div class="sri-name">${escHtml(name)}</div>
          ${brand ? `<div class="sri-brand">${escHtml(brand)}</div>` : ''}
        </div>
        <div class="sri-right">
          <div class="sri-kcal">${kcal} kcal</div>
          <div class="sri-macros">${carbs}g C · ${protein}g P · ${fat}g F</div>
          <button class="sri-select-btn" onclick="selectSearchResult(this)">Select</button>
        </div>`;
      item.dataset.food = foodObj;
      resultsEl.appendChild(item);
    });

  } catch(e) {
    statusEl.textContent = '⚠️ Network error — check connection';
    statusEl.className = 'search-status error';
  }
}

// Called when user clicks "Select" on a search result
function selectSearchResult(btn) {
  const item = btn.closest('.search-result-item');
  const food = JSON.parse(item.dataset.food);

  // Highlight selected item
  document.querySelectorAll('.search-result-item').forEach(el => el.style.borderColor = '');
  item.style.borderColor = 'var(--green)';

  pendingFood = food;
  showFoodResult(food);
  // Scroll down to show the food result card
  item.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── OPEN FOOD FACTS BARCODE LOOKUP ────────────────────────────────────────
async function lookupBarcode(barcode, statusId) {
  const sid = statusId || 'scanStatus';
  barcode = String(barcode).trim().replace(/\D/g,'');
  if (!barcode) { setStatus('Please enter a barcode','error',sid); return; }
  setStatus('<span class="spinner"></span>Looking up…','',sid);
  hideFoodResult();
  try {
    const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await res.json();
    if (!data || data.status===0 || !data.product) { setStatus('❌ Product not found','error',sid); lastCode=null; return; }
    const p=data.product, n=p.nutriments||{};
    let kcal100 = n['energy-kcal_100g'] || (n['energy_100g']?n['energy_100g']/4.184:0);
    let factor=1, servingLabel='per 100g';
    if (p.serving_size) { const m=p.serving_size.match(/([\d.]+)/); if(m){factor=parseFloat(m[1])/100;servingLabel=`per serving (${p.serving_size})`;} }
    pendingFood = {
      name:    p.product_name||p.product_name_en||'Unknown Product',
      brand:   p.brands||'',
      kcal:    Math.round(kcal100*factor),
      carbs:   +((n['carbohydrates_100g']||0)*factor).toFixed(1),
      protein: +((n['proteins_100g']||0)*factor).toFixed(1),
      fat:     +((n['fat_100g']||0)*factor).toFixed(1),
      servingLabel
    };
    showFoodResult(pendingFood);
    setStatus('✅ Found! Choose meal and tap Add.','found',sid);
  } catch(e) { setStatus('⚠️ Network error','error',sid); lastCode=null; }
}
function lookupManual(){
  lastCode=null;
  const barcode = document.getElementById('manualBarcode').value;
  lookupBarcode(barcode, 'barcodeStatus');
}
function setStatus(html,cls,elId){
  const id = elId || 'scanStatus';
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML=html; el.className='scan-status'+(cls?' '+cls:'');
}
function showFoodResult(f){
  document.getElementById('frName').textContent=f.name;
  document.getElementById('frBrand').textContent=f.brand||'Unknown brand';
  document.getElementById('frServing').textContent='📏 '+f.servingLabel;
  document.getElementById('frKcal').textContent=f.kcal;
  document.getElementById('frCarbs').textContent=f.carbs;
  document.getElementById('frProtein').textContent=f.protein;
  document.getElementById('frFat').textContent=f.fat;
  if(currentScanMealId) document.getElementById('frMealSelect').value=currentScanMealId;
  document.getElementById('foodResult').classList.add('show');
}
function hideFoodResult(){ document.getElementById('foodResult').classList.remove('show'); pendingFood=null; }
function addScannedFood(){
  if(!pendingFood) return;
  const mealId=document.getElementById('frMealSelect').value;
  meals.find(m=>m.id===mealId).items.push({...pendingFood});
  renderMeals(); openMeal(mealId); updateSummary(); scheduleSave();
  showToast(`${pendingFood.name} added!`);
  closeScanner();
}

// ── QUAGGA SCANNER ────────────────────────────────────────────────────────
const QUAGGA_URL = 'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js';
let quaggaLoading = null; // single shared promise while script is in-flight

function loadQuagga() {
  if (typeof Quagga !== 'undefined') return Promise.resolve();
  if (quaggaLoading) return quaggaLoading;
  quaggaLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QUAGGA_URL;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return quaggaLoading;
}

let releaseScannerTrap = null;
function openScanner(mealId){
  currentScanMealId=mealId; lastCode=null; pendingFood=null;
  const modal = document.getElementById('scannerModal');
  modal.classList.add('open');
  modal.removeAttribute('aria-hidden');
  document.getElementById('manualBarcode').value='';
  document.getElementById('foodSearchInput').value='';
  document.getElementById('searchResults').innerHTML='';
  document.getElementById('searchStatus').textContent='';
  hideFoodResult();
  switchTab('scan');
  releaseScannerTrap = trapFocus(modal.querySelector('.scanner-modal'), closeScanner);
  // Load Quagga on first open — subsequent opens resolve instantly from cache
  loadQuagga().catch(() => showNoCameraNote('Barcode library failed to load. Use manual entry.'));
}
function closeScanner(){
  const m=document.getElementById('scannerModal'); m.classList.remove('open'); m.setAttribute('aria-hidden','true');
  stopQuagga(); hideFoodResult();
  if (releaseScannerTrap) { releaseScannerTrap(); releaseScannerTrap=null; }
}
function startQuagga(){
  if(scannerRunning) return;
  if(typeof Quagga==='undefined') { showNoCameraNote('Barcode library not loaded. Use manual entry.'); return; }
  Quagga.init({
    inputStream:{ name:'Live', type:'LiveStream', target:document.getElementById('interactive'), constraints:{width:{ideal:1280},height:{ideal:720},facingMode:'environment'} },
    decoder:{ readers:['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader'] },
    locate:true, frequency:10
  }, function(err){
    if(err){ showNoCameraNote('Camera unavailable.<br>Use manual entry below.'); return; }
    scannerRunning=true; Quagga.start(); setStatus('📷 Scanning… hold barcode steady','');
  });
  Quagga.onDetected(function(result){
    const code=result.codeResult.code; if(!code||code===lastCode) return;
    const err=result.codeResult.startInfo?result.codeResult.startInfo.error:1;
    if(err>0.3) return;
    lastCode=code; setStatus(`📦 ${code}`,'found','scanStatus'); lookupBarcode(code,'scanStatus');
  });
}
function stopQuagga(){ if(!scannerRunning) return; try{Quagga.offDetected();Quagga.stop();}catch(e){} scannerRunning=false; }
function showNoCameraNote(msg){ document.getElementById('cameraArea').innerHTML=`<div class="no-camera-note"><strong>📷 Camera Unavailable</strong>${msg}</div>`; setStatus('Use manual entry below ↓','error'); }

// ── TRACKER CORE ──────────────────────────────────────────────────────────
function estimateMacros(kcal){ return {carbs:Math.round(kcal*.5/4),protein:Math.round(kcal*.2/4),fat:Math.round(kcal*.3/9)}; }
function totalKcal(){ return meals.reduce((s,m)=>s+m.items.reduce((ss,i)=>ss+i.kcal,0),0); }
function totalMacros(){ const t={carbs:0,protein:0,fat:0}; meals.forEach(m=>m.items.forEach(i=>{t.carbs+=i.carbs;t.protein+=i.protein;t.fat+=i.fat;})); return t; }

function updateSummary(){
  const consumed=totalKcal(), remaining=Math.max(0,GOAL-consumed), pct=Math.min(consumed/GOAL,1), C=301;
  document.getElementById('remainingNum').textContent=remaining;
  document.getElementById('consumedVal').textContent=consumed+' kcal';
  document.getElementById('caloriRing').setAttribute('aria-label', `Calorie progress: ${remaining} of ${GOAL} remaining`);
  const circ=document.getElementById('ringCircle');
  circ.style.strokeDashoffset=C-pct*C; circ.style.stroke=consumed>GOAL?'#e05252':'#3ecf8e';
  const m=totalMacros();
  document.getElementById('carbVal').textContent=m.carbs+'g';
  document.getElementById('proteinVal').textContent=m.protein+'g';
  document.getElementById('fatVal').textContent=m.fat+'g';
  const carbBar    = document.getElementById('carbBar');
  const proteinBar = document.getElementById('proteinBar');
  const fatBar     = document.getElementById('fatBar');
  carbBar.style.width    = Math.min(m.carbs/MACRO_GOALS.carbs*100,100)+'%';
  proteinBar.style.width = Math.min(m.protein/MACRO_GOALS.protein*100,100)+'%';
  fatBar.style.width     = Math.min(m.fat/MACRO_GOALS.fat*100,100)+'%';
  carbBar.setAttribute('aria-valuenow', m.carbs);
  proteinBar.setAttribute('aria-valuenow', m.protein);
  fatBar.setAttribute('aria-valuenow', m.fat);
}

function renderMeals(){
  const container=document.getElementById('mealsContainer'); if(!container) return;
  const focusedId = document.activeElement ? document.activeElement.id : null;
  const open={};
  meals.forEach(m=>{ const el=document.getElementById('log-'+m.id); if(el) open[m.id]=el.classList.contains('open'); });
  container.innerHTML='';
  meals.forEach(meal=>{
    const mkcal=meal.items.reduce((s,i)=>s+i.kcal,0);
    const card=document.createElement('div'); card.className='meal-card';
    card.innerHTML=`
      <button class="meal-header" onclick="toggleMeal('${meal.id}')"
        aria-expanded="${open[meal.id] ? 'true' : 'false'}"
        aria-controls="log-${meal.id}">
        <div class="meal-left">
          <div class="meal-icon" style="background:${meal.color}22">${meal.icon}</div>
          <div><div class="meal-name">${meal.name}</div><div class="meal-sub">${meal.items.length} item${meal.items.length!==1?'s':''}</div></div>
        </div>
        <div class="meal-right">
          <div class="meal-kcal" style="color:${meal.color}">${mkcal} kcal</div>
          <div class="meal-chevron${open[meal.id]?' open':''}" id="chev-${meal.id}" aria-hidden="true">▼</div>
        </div>
      </button>
      <div class="food-log${open[meal.id]?' open':''}" id="log-${meal.id}">
        ${meal.items.map((item,idx)=>`
          <div class="food-item">
            <div>
              <div class="food-name">${escHtml(item.name)}${item.brand?` <span style="color:var(--muted);font-size:11px;font-weight:400">· ${escHtml(item.brand)}</span>`:''}</div>
              <div class="food-details">${item.carbs}g carbs · ${item.protein}g protein · ${item.fat}g fat</div>
            </div>
            <div class="food-right">
              <div class="food-kcal">${item.kcal} kcal</div>
              <button class="del-btn" onclick="deleteItem('${meal.id}',${idx})" aria-label="Delete ${escHtml(item.name)}">✕</button>
            </div>
          </div>`).join('')}
        <div class="add-food-row">
          <button class="scan-btn" onclick="openScanner('${meal.id}')">📷 Scan</button>
          <input class="food-input" id="fi-${meal.id}" type="text" placeholder="Food name…" aria-label="Food name for ${meal.name}" onkeydown="if(event.key==='Enter')addManual('${meal.id}')"/>
          <input class="kcal-input" id="ki-${meal.id}" type="number" placeholder="kcal" aria-label="Calories for ${meal.name}" onkeydown="if(event.key==='Enter')addManual('${meal.id}')"/>
          <button class="log-btn" onclick="addManual('${meal.id}')">+ Log</button>
        </div>
      </div>`;
    container.appendChild(card);
  });
  // Restore focus to the same element if it still exists (e.g. food name input after adding)
  if (focusedId) { const el = document.getElementById(focusedId); if (el) el.focus(); }
}

function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function toggleMeal(id){
  const log=document.getElementById('log-'+id); log.classList.toggle('open');
  document.getElementById('chev-'+id).classList.toggle('open');
  const btn=log.previousElementSibling; if(btn) btn.setAttribute('aria-expanded', log.classList.contains('open') ? 'true' : 'false');
}
function openMeal(id){
  const log=document.getElementById('log-'+id); log.classList.add('open');
  document.getElementById('chev-'+id).classList.add('open');
  const btn=log.previousElementSibling; if(btn) btn.setAttribute('aria-expanded','true');
}

function addManual(mealId){
  const ni=document.getElementById('fi-'+mealId), ki=document.getElementById('ki-'+mealId);
  const name=ni.value.trim(), kcal=parseInt(ki.value);
  if(!name||!kcal||kcal<=0) return;
  meals.find(m=>m.id===mealId).items.push({name,brand:'',kcal,...estimateMacros(kcal)});
  ni.value=''; ki.value='';
  renderMeals(); openMeal(mealId); updateSummary(); scheduleSave();
}
function deleteItem(mealId,idx){
  meals.find(m=>m.id===mealId).items.splice(idx,1);
  renderMeals(); openMeal(mealId); updateSummary(); scheduleSave();
  // Delete buttons have no stable ID — move focus to the food name input for this meal
  const input = document.getElementById('fi-'+mealId);
  if (input) input.focus();
}

function showToast(msg,err=false){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show'+(err?' err':'');
  setTimeout(()=>t.className='toast'+(err?' err':''),3000);
}

// Modal backdrop close
document.getElementById('scannerModal').addEventListener('click',function(e){if(e.target===this)closeScanner();});
document.getElementById('confirmOverlay').addEventListener('click',function(e){if(e.target===this)closeConfirm();});

// ── THEME TOGGLE ─────────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('nutritrack_theme', isLight ? 'light' : 'dark');
  document.getElementById('themeToggle').setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', isLight ? '#f5f5f7' : '#0e0f11');
}
// Apply saved theme on load
(function() {
  const saved = localStorage.getItem('nutritrack_theme');
  if (saved === 'light') {
    document.documentElement.classList.add('light');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.setAttribute('aria-label', 'Switch to dark mode');
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f5f5f7');
  }
})();

// ── INIT ──────────────────────────────────────────────────────────────────
// Show login screen immediately — firebase.js will call showApp() if already logged in
showLoginScreen();
