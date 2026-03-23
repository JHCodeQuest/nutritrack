// ── APP STATE ────────────────────────────────────────────────────────────
let GOAL = 2201;
let MACRO_GOALS = { carbs:220, protein:140, fat:73 };
const LS_KEY = 'nutritrack_v1';  // localStorage fallback key
const GOALS_KEY = 'nutritrack_goals';
const HISTORY_KEY = 'nutritrack_history';
const HISTORY_MAX = 30;

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
  loadWater();
  loadExercise();
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
  loadWater();
  loadExercise();
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
  loadWater();
  loadExercise();
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
    // Restore camera area in case it was hidden after a successful scan
    const camArea = document.getElementById('cameraArea');
    const sawBtn  = document.getElementById('scanAgainWrap');
    if (camArea) camArea.style.display = '';
    if (sawBtn)  sawBtn.style.display  = 'none';
    setTimeout(startQuagga, 200);
  } else {
    stopQuagga();
  }
  if (tab === 'search') {
    setTimeout(() => document.getElementById('foodSearchInput').focus(), 100);
    renderRecentSearch();
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
  if (!query) { renderRecentSearch(); return; }

  const statusEl  = document.getElementById('searchStatus');
  const resultsEl = document.getElementById('searchResults');
  statusEl.innerHTML = '<span class="spinner"></span>Searching…';
  statusEl.className = 'search-status';
  resultsEl.innerHTML = '';
  const rss = document.getElementById('recentSearchSection'); if (rss) rss.style.display = 'none';
  hideFoodResult();

  // Cancel previous in-flight request
  if(_searchAbort) _searchAbort.abort();
  const cacheKey='modal:'+_getOFFLocale().sub+':'+query.toLowerCase();
  const cached=_searchCache.get(cacheKey);
  let products;
  if(cached){ products=cached; }
  else {
    try {
      _searchAbort=new AbortController();
      const url = _offSearchUrl(query, 20, ',image_thumb_url');
      const res  = await fetch(url,{signal:_searchAbort.signal});
      const data = await res.json();
      products = (data.products || []).filter(p =>
        p.product_name &&
        p.nutriments &&
        _kcal100FromNutriments(p.nutriments) > 0
      );
      if(_searchCache.size>=CACHE_MAX) _searchCache.delete(_searchCache.keys().next().value);
      _searchCache.set(cacheKey,products);
    } catch(e) {
      if(e.name==='AbortError') return;
      statusEl.textContent = '⚠️ Network error — check connection';
      statusEl.className = 'search-status error';
      return;
    }
  }

    if (products.length === 0) {
      statusEl.textContent = '😕 No results found — try different keywords';
      statusEl.className = 'search-status error';
      return;
    }

    statusEl.textContent = `${products.length} result${products.length!==1?'s':''} found`;
    statusEl.className = 'search-status';

    resultsEl.innerHTML = '';
    // Prepend matching history items
    const histMatches = filterHistory(query);
    if (histMatches.length) {
      const hdr = document.createElement('div');
      hdr.className = 'history-group-label';
      hdr.textContent = 'Recently added';
      resultsEl.appendChild(hdr);
      histMatches.forEach(food => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.dataset.food = _makeHistoryFoodObj(food);
        item.innerHTML = `
          <div class="sri-left">
            <div class="sri-history-badge">Recent</div>
            <div class="sri-name">${escHtml(food.name)}</div>
            ${food.brand ? `<div class="sri-brand">${escHtml(food.brand)}</div>` : ''}
          </div>
          <div class="sri-right">
            <div class="sri-kcal">${food.kcal} kcal</div>
            <div class="sri-macros">${food.carbs}g C · ${food.protein}g P · ${food.fat}g F</div>
            <button class="sri-select-btn" onclick="selectSearchResult(this)">Select</button>
          </div>`;
        resultsEl.appendChild(item);
      });
      const sep = document.createElement('div');
      sep.className = 'history-group-label';
      sep.textContent = 'All results';
      resultsEl.appendChild(sep);
    }
    products.forEach((p, idx) => {
      const n = p.nutriments || {};
      const kcal100   = _kcal100FromNutriments(n);
      const carbs100  = n['carbohydrates_100g'] || 0;
      const protein100 = n['proteins_100g']     || 0;
      const fat100    = n['fat_100g']           || 0;
      let factor = 1, servingLabel = 'per 100g';
      if (p.serving_size) {
        const m = p.serving_size.match(/([\d.]+)\s*g/i);
        if (m) { factor = parseFloat(m[1])/100; servingLabel = `per serving (${p.serving_size})`; }
      }
      // Default display values in the list are always per 100g so users can compare
      const kcal    = Math.round(kcal100);
      const carbs   = +carbs100.toFixed(1);
      const protein = +protein100.toFixed(1);
      const fat     = +fat100.toFixed(1);
      // Stored serving-size defaults for when the food card opens
      const kcalServing    = Math.round(kcal100 * factor);
      const carbsServing   = +(carbs100   * factor).toFixed(1);
      const proteinServing = +(protein100 * factor).toFixed(1);
      const fatServing     = +(fat100     * factor).toFixed(1);
      const name  = p.product_name || 'Unknown';
      const brand = p.brands || '';

      // Store per-100g base values for flexible qty calculation in the food card
      const foodObj = JSON.stringify({
        name, brand,
        kcal: kcalServing, carbs: carbsServing, protein: proteinServing, fat: fatServing,
        servingLabel, kcal100, carbs100, protein100, fat100, servingFactor: factor
      });

      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div class="sri-left">
          <div class="sri-name">${escHtml(name)}</div>
          ${brand ? `<div class="sri-brand">${escHtml(brand)}</div>` : ''}
        </div>
        <div class="sri-right">
          <div class="sri-kcal">${kcal} <span class="sri-per">kcal/100g</span></div>
          <div class="sri-macros">${carbs}g C · ${protein}g P · ${fat}g F</div>
          <button class="sri-select-btn" onclick="selectSearchResult(this)">Select</button>
        </div>`;
      item.dataset.food = foodObj;
      resultsEl.appendChild(item);
    });
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
    let kcal100 = _kcal100FromNutriments(n);
    let factor=1, servingLabel='per 100g';
    if (p.serving_size) { const m=p.serving_size.match(/([\d.]+)\s*g/i); if(m){factor=parseFloat(m[1])/100;servingLabel=`per serving (${p.serving_size})`;} }
    const carbs100=n['carbohydrates_100g']||0, protein100=n['proteins_100g']||0, fat100=n['fat_100g']||0;
    pendingFood = {
      name:    p.product_name||p.product_name_en||'Unknown Product',
      brand:   p.brands||'',
      kcal:    Math.round(kcal100*factor),
      carbs:   +((carbs100)*factor).toFixed(1),
      protein: +((protein100)*factor).toFixed(1),
      fat:     +((fat100)*factor).toFixed(1),
      servingLabel, kcal100, carbs100, protein100, fat100, servingFactor:factor
    };
    showFoodResult(pendingFood);
    setStatus('✅ Found! Choose meal and tap Add.','found',sid);
    // If called from the live scan tab, stop the camera and collapse it
    if (sid === 'scanStatus') {
      stopQuagga();
      const camArea = document.getElementById('cameraArea');
      if (camArea) camArea.style.display = 'none';
      const sawBtn = document.getElementById('scanAgainWrap');
      if (sawBtn) sawBtn.style.display = '';
    }
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
  document.getElementById('frQty').value=1;
  // Reset unit selector — show "per serving" only if serving data exists
  const unitSel=document.getElementById('frUnit');
  const servingOpt=unitSel.querySelector('option[value="serving"]');
  if(f.servingFactor && f.servingFactor!==1){
    servingOpt.style.display='';
    unitSel.value='serving';
  } else {
    servingOpt.style.display='none';
    unitSel.value='100g';
  }
  document.getElementById('frGrams').style.display='none';
  document.getElementById('frGrams').value='';
  updateQtyPreview();
  if(currentScanMealId) document.getElementById('frMealSelect').value=currentScanMealId;
  document.getElementById('foodResult').classList.add('show');
}
function changeQty(delta){
  const input=document.getElementById('frQty');
  let val=parseFloat(input.value)||1;
  val=Math.max(1,Math.round(val+delta));
  input.value=val;
  updateQtyPreview();
}
function updateQtyPreview(){
  if(!pendingFood) return;
  const qty=parseFloat(document.getElementById('frQty').value)||1;
  const unit=document.getElementById('frUnit').value;
  const gramInput=document.getElementById('frGrams');
  const qtyLabel=document.getElementById('frQtyLabel');
  // Show/hide custom gram input
  gramInput.style.display=unit==='custom'?'inline-block':'none';
  // Update qty label
  if(unit==='serving') qtyLabel.textContent='Servings';
  else if(unit==='100g') qtyLabel.textContent='Qty (x100g)';
  else qtyLabel.textContent='Qty';
  // Calculate factor: how many grams per 1 unit
  const p=pendingFood;
  let baseFactor; // factor relative to 100g
  if(unit==='serving') baseFactor=p.servingFactor||1;
  else if(unit==='custom') baseFactor=(parseFloat(gramInput.value)||0)/100;
  else baseFactor=1; // per 100g
  const totalFactor=baseFactor*qty;
  document.getElementById('frKcal').textContent=Math.round(p.kcal100*totalFactor);
  document.getElementById('frCarbs').textContent=+(p.carbs100*totalFactor).toFixed(1);
  document.getElementById('frProtein').textContent=+(p.protein100*totalFactor).toFixed(1);
  document.getElementById('frFat').textContent=+(p.fat100*totalFactor).toFixed(1);
}
function hideFoodResult(){ document.getElementById('foodResult').classList.remove('show'); pendingFood=null; }
function addScannedFood(){
  if(!pendingFood) return;
  const qty=parseFloat(document.getElementById('frQty').value)||1;
  const unit=document.getElementById('frUnit').value;
  const p=pendingFood;
  let baseFactor;
  if(unit==='serving') baseFactor=p.servingFactor||1;
  else if(unit==='custom') baseFactor=(parseFloat(document.getElementById('frGrams').value)||0)/100;
  else baseFactor=1;
  const totalFactor=baseFactor*qty;
  const mealId=document.getElementById('frMealSelect').value;
  // Build descriptive name
  let label=p.name;
  if(unit==='custom'){ const g=parseFloat(document.getElementById('frGrams').value)||0; label+=qty!==1?` (${qty} x ${g}g)`:(` (${g}g)`); }
  else if(unit==='serving'&&qty!==1) label+=` (x${qty})`;
  else if(unit==='100g'&&qty!==1) label+=` (x${qty})`;
  const item={
    name: label,
    brand: p.brand,
    kcal: Math.round(p.kcal100*totalFactor),
    carbs: +(p.carbs100*totalFactor).toFixed(1),
    protein: +(p.protein100*totalFactor).toFixed(1),
    fat: +(p.fat100*totalFactor).toFixed(1),
    kcal100: p.kcal100, carbs100: p.carbs100, protein100: p.protein100, fat100: p.fat100, servingFactor: p.servingFactor
  };
  meals.find(m=>m.id===mealId).items.push(item);
  renderMeals(); openMeal(mealId); updateSummary(); scheduleSave();
  saveToHistory(pendingFood);
  showToast(`${item.name} added!`);
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
  const rss = document.getElementById('recentSearchSection'); if (rss) rss.style.display = 'none';
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
    if(pendingFood) return; // food already found — don't wipe it if camera moves
    const code=result.codeResult.code; if(!code||code===lastCode) return;
    const err=result.codeResult.startInfo?result.codeResult.startInfo.error:1;
    if(err>0.3) return;
    lastCode=code; setStatus(`📦 ${code}`,'found','scanStatus'); lookupBarcode(code,'scanStatus');
  });
}
function stopQuagga(){ if(!scannerRunning) return; try{Quagga.offDetected();Quagga.stop();}catch(e){} scannerRunning=false; }
function scanAgain(){
  const camArea = document.getElementById('cameraArea');
  const sawBtn  = document.getElementById('scanAgainWrap');
  if (camArea) camArea.style.display = '';
  if (sawBtn)  sawBtn.style.display  = 'none';
  hideFoodResult();
  lastCode = null;
  setStatus('📷 Scanning… hold barcode steady','');
  startQuagga();
}
function showNoCameraNote(msg){ document.getElementById('cameraArea').innerHTML=`<div class="no-camera-note"><strong>📷 Camera Unavailable</strong>${msg}</div>`; setStatus('Use manual entry below ↓','error'); }

// ── TRACKER CORE ──────────────────────────────────────────────────────────
function estimateMacros(kcal){ return {carbs:Math.round(kcal*.5/4),protein:Math.round(kcal*.2/4),fat:Math.round(kcal*.3/9)}; }
function totalKcal(){ return meals.reduce((s,m)=>s+m.items.reduce((ss,i)=>ss+i.kcal,0),0); }
function totalMacros(){ const t={carbs:0,protein:0,fat:0}; meals.forEach(m=>m.items.forEach(i=>{t.carbs+=i.carbs;t.protein+=i.protein;t.fat+=i.fat;})); t.carbs=+t.carbs.toFixed(1);t.protein=+t.protein.toFixed(1);t.fat=+t.fat.toFixed(1); return t; }

function updateSummary(){
  const consumed=totalKcal(), exercised=totalExerciseKcal();
  const netConsumed=consumed-exercised;
  const remaining=Math.max(0,GOAL-netConsumed), pct=Math.min(Math.max(0,netConsumed)/GOAL,1), C=301;
  document.getElementById('remainingNum').textContent=remaining;
  document.getElementById('consumedVal').textContent=consumed+' kcal';
  const exVal=document.getElementById('exerciseVal');
  if(exVal) exVal.textContent=exercised+' kcal';
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
              <button class="edit-btn" onclick="openEditModal('${meal.id}',${idx})" aria-label="Edit ${escHtml(item.name)}">✏️</button>
              <button class="del-btn" onclick="deleteItem('${meal.id}',${idx})" aria-label="Delete ${escHtml(item.name)}">✕</button>
            </div>
          </div>`).join('')}
        <div class="add-food-row">
          <div class="inline-search-wrap">
            <input class="food-input" id="fi-${meal.id}" type="text" placeholder="Search food…" aria-label="Search food for ${meal.name}" oninput="debouncedInlineSearch('${meal.id}')" onfocus="debouncedInlineSearch('${meal.id}')" onkeydown="if(event.key==='Enter'){clearTimeout(_inlineDebounce);inlineSearch('${meal.id}')}" autocomplete="off"/>
            <button class="log-btn" onclick="inlineSearch('${meal.id}')">🔍</button>
            <button class="scan-btn" onclick="openScanner('${meal.id}')">📷 Scan</button>
          </div>
          <div class="inline-results" id="ir-${meal.id}"></div>
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

// ── FOOD HISTORY ─────────────────────────────────────────────────────────
function saveToHistory(food) {
  try {
    const history = getHistory();
    const key = (food.name + '|' + (food.brand || '')).toLowerCase();
    const filtered = history.filter(h => (h.name + '|' + (h.brand || '')).toLowerCase() !== key);
    filtered.unshift({
      name: food.name, brand: food.brand || '',
      kcal: food.kcal, carbs: food.carbs, protein: food.protein, fat: food.fat,
      servingLabel: food.servingLabel, kcal100: food.kcal100,
      carbs100: food.carbs100, protein100: food.protein100, fat100: food.fat100,
      servingFactor: food.servingFactor, addedAt: Date.now()
    });
    if (filtered.length > HISTORY_MAX) filtered.length = HISTORY_MAX;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
  } catch(e) {}
}
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch(e) { return []; }
}
function filterHistory(query) {
  const history = getHistory();
  if (!query) return history.slice(0, 8);
  const q = query.toLowerCase();
  return history.filter(h => h.name.toLowerCase().includes(q) || (h.brand && h.brand.toLowerCase().includes(q))).slice(0, 5);
}

// Robust kcal-per-100g extraction from Open Food Facts nutriments.
// Prefers the dedicated kcal field; falls back through explicit kJ fields.
function _kcal100FromNutriments(n) {
  if (n['energy-kcal_100g'] > 0)  return n['energy-kcal_100g'];
  if (n['energy-kj_100g']   > 0)  return n['energy-kj_100g']   / 4.184;
  if (n['energy_100g']      > 0)  return n['energy_100g']       / 4.184;
  return 0;
}

function _makeHistoryFoodObj(food) {
  return JSON.stringify({
    name: food.name, brand: food.brand, kcal: food.kcal, carbs: food.carbs,
    protein: food.protein, fat: food.fat, servingLabel: food.servingLabel,
    kcal100: food.kcal100, carbs100: food.carbs100, protein100: food.protein100,
    fat100: food.fat100, servingFactor: food.servingFactor
  });
}

// Renders recent foods into the "recentSearchSection" in the search pane
function renderRecentSearch() {
  const section = document.getElementById('recentSearchSection');
  const list = document.getElementById('recentSearchList');
  if (!section || !list) return;
  const query = (document.getElementById('foodSearchInput') || {}).value || '';
  if (query.trim()) { section.style.display = 'none'; return; }
  const history = getHistory();
  if (!history.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';
  history.slice(0, 8).forEach(food => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.dataset.food = _makeHistoryFoodObj(food);
    item.innerHTML = `
      <div class="sri-left">
        <div class="sri-history-badge">Recent</div>
        <div class="sri-name">${escHtml(food.name)}</div>
        ${food.brand ? `<div class="sri-brand">${escHtml(food.brand)}</div>` : ''}
      </div>
      <div class="sri-right">
        <div class="sri-kcal">${food.kcal} kcal</div>
        <div class="sri-macros">${food.carbs}g C · ${food.protein}g P · ${food.fat}g F</div>
        <button class="sri-select-btn" onclick="selectSearchResult(this)">Select</button>
      </div>`;
    list.appendChild(item);
  });
}

// ── LOCALE-AWARE OPEN FOOD FACTS ─────────────────────────────────────────
// Returns the best OFF subdomain and country tag for the user's locale.
// Falls back to world.openfoodfacts.org with no country filter if unknown.
function _getOFFLocale() {
  const lang = (navigator.language || '').toLowerCase();
  // Exact locale matches (most specific first)
  const exact = {
    'en-gb': { sub: 'uk',    tag: 'united-kingdom'   },
    'en-us': { sub: 'us',    tag: 'united-states'    },
    'en-ca': { sub: 'ca',    tag: 'canada'           },
    'en-au': { sub: 'au',    tag: 'australia'        },
    'en-nz': { sub: 'world', tag: 'new-zealand'      },
    'en-ie': { sub: 'world', tag: 'ireland'          },
    'en-za': { sub: 'world', tag: 'south-africa'     },
    'fr-fr': { sub: 'fr',    tag: 'france'           },
    'fr-be': { sub: 'be',    tag: 'belgium'          },
    'fr-ch': { sub: 'ch',    tag: 'switzerland'      },
    'fr-ca': { sub: 'ca',    tag: 'canada'           },
    'de-de': { sub: 'de',    tag: 'germany'          },
    'de-at': { sub: 'at',    tag: 'austria'          },
    'de-ch': { sub: 'ch',    tag: 'switzerland'      },
    'es-es': { sub: 'es',    tag: 'spain'            },
    'es-mx': { sub: 'mx',    tag: 'mexico'           },
    'es-ar': { sub: 'world', tag: 'argentina'        },
    'it-it': { sub: 'it',    tag: 'italy'            },
    'nl-nl': { sub: 'nl',    tag: 'the-netherlands'  },
    'nl-be': { sub: 'be',    tag: 'belgium'          },
    'pt-pt': { sub: 'pt',    tag: 'portugal'         },
    'pt-br': { sub: 'br',    tag: 'brazil'           },
    'pl-pl': { sub: 'pl',    tag: 'poland'           },
    'ru-ru': { sub: 'ru',    tag: 'russia'           },
    'ja-jp': { sub: 'world', tag: 'japan'            },
    'zh-cn': { sub: 'world', tag: 'china'            },
    'ko-kr': { sub: 'world', tag: 'south-korea'      },
  };
  if (exact[lang]) return exact[lang];
  // Fall back on the country portion of the tag (e.g. 'en-in' → 'in')
  const country = lang.split('-')[1] || '';
  const byCountry = {
    'gb': { sub: 'uk',    tag: 'united-kingdom'   },
    'us': { sub: 'us',    tag: 'united-states'    },
    'ca': { sub: 'ca',    tag: 'canada'           },
    'au': { sub: 'au',    tag: 'australia'        },
    'fr': { sub: 'fr',    tag: 'france'           },
    'de': { sub: 'de',    tag: 'germany'          },
    'at': { sub: 'at',    tag: 'austria'          },
    'ch': { sub: 'ch',    tag: 'switzerland'      },
    'es': { sub: 'es',    tag: 'spain'            },
    'mx': { sub: 'mx',    tag: 'mexico'           },
    'it': { sub: 'it',    tag: 'italy'            },
    'nl': { sub: 'nl',    tag: 'the-netherlands'  },
    'be': { sub: 'be',    tag: 'belgium'          },
    'pt': { sub: 'pt',    tag: 'portugal'         },
    'br': { sub: 'br',    tag: 'brazil'           },
    'pl': { sub: 'pl',    tag: 'poland'           },
    'ru': { sub: 'ru',    tag: 'russia'           },
  };
  return byCountry[country] || { sub: 'world', tag: null };
}

// Build the OFF search URL for a given query and page size.
function _offSearchUrl(query, pageSize, extraFields) {
  const { sub, tag } = _getOFFLocale();
  const base = `https://${sub}.openfoodfacts.org/cgi/search.pl`;
  const countryFilter = tag
    ? `&tagtype_0=countries&tag_contains_0=contains&tag_0=${encodeURIComponent(tag)}`
    : '';
  const fields = `product_name,brands,nutriments,serving_size,countries_tags${extraFields || ''}`;
  return `${base}?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${pageSize}${countryFilter}&fields=${fields}`;
}

// ── SEARCH OPTIMISATION ─────────────────────────────────────────────────
let _inlineDebounce = null;
let _inlineAbort = null;
let _searchAbort = null;
const _searchCache = new Map();
const CACHE_MAX = 50;

function debouncedInlineSearch(mealId) {
  clearTimeout(_inlineDebounce);
  const query = document.getElementById('fi-'+mealId).value.trim();
  if (!query) {
    const resultsEl = document.getElementById('ir-'+mealId);
    const history = getHistory();
    if (!history.length) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '';
    history.slice(0, 6).forEach(food => {
      const item = document.createElement('div');
      item.className = 'inline-result-item';
      item.dataset.food = _makeHistoryFoodObj(food);
      item.innerHTML = `
        <div class="iri-left">
          <div class="iri-history-badge">Recent</div>
          <div class="iri-name">${escHtml(food.name)}</div>
          <div class="iri-meta">${food.brand ? escHtml(food.brand)+' · ' : ''}${food.kcal} kcal · ${food.carbs}g C · ${food.protein}g P · ${food.fat}g F</div>
        </div>
        <button class="iri-add-btn" onclick="addInlineFood('${mealId}',this)" aria-label="Quick add ${escHtml(food.name)}">+</button>`;
      resultsEl.appendChild(item);
    });
    return;
  }
  if (query.length < 2) return;
  _inlineDebounce = setTimeout(() => inlineSearch(mealId), 300);
}

async function inlineSearch(mealId){
  const input=document.getElementById('fi-'+mealId);
  const query=input.value.trim();
  if(!query) return;
  const resultsEl=document.getElementById('ir-'+mealId);
  // Cancel previous in-flight request
  if(_inlineAbort) _inlineAbort.abort();
  // Check cache first
  const cacheKey='inline:'+_getOFFLocale().sub+':'+query.toLowerCase();
  const cached=_searchCache.get(cacheKey);
  let products;
  if(cached){ products=cached; }
  else {
    resultsEl.innerHTML='<div class="inline-loading"><span class="spinner"></span>Searching…</div>';
    try {
      _inlineAbort=new AbortController();
      const url=_offSearchUrl(query, 10, '');
      const res=await fetch(url,{signal:_inlineAbort.signal});
      const data=await res.json();
      products=(data.products||[]).filter(p=>p.product_name&&p.nutriments&&_kcal100FromNutriments(p.nutriments)>0);
      if(_searchCache.size>=CACHE_MAX) _searchCache.delete(_searchCache.keys().next().value);
      _searchCache.set(cacheKey,products);
    } catch(e){ if(e.name==='AbortError') return; resultsEl.innerHTML='<div class="inline-no-results">Network error</div>'; return; }
  }
    const histInline = filterHistory(query);
    if(!products.length && !histInline.length){ resultsEl.innerHTML='<div class="inline-no-results">No results found</div>'; return; }
    resultsEl.innerHTML='';
    // Prepend history matches
    histInline.forEach(food => {
      const item = document.createElement('div');
      item.className = 'inline-result-item';
      item.dataset.food = _makeHistoryFoodObj(food);
      item.innerHTML = `
        <div class="iri-left">
          <div class="iri-history-badge">Recent</div>
          <div class="iri-name">${escHtml(food.name)}</div>
          <div class="iri-meta">${food.brand ? escHtml(food.brand)+' · ' : ''}${food.kcal} kcal · ${food.carbs}g C · ${food.protein}g P · ${food.fat}g F</div>
        </div>
        <button class="iri-add-btn" onclick="addInlineFood('${mealId}',this)" aria-label="Quick add ${escHtml(food.name)}">+</button>`;
      resultsEl.appendChild(item);
    });
    products.forEach(p=>{
      const n=p.nutriments||{};
      const kcal100=_kcal100FromNutriments(n);
      const carbs100=n['carbohydrates_100g']||0,protein100=n['proteins_100g']||0,fat100=n['fat_100g']||0;
      let factor=1,servingLabel='per 100g';
      if(p.serving_size){const m=p.serving_size.match(/([\d.]+)\s*g/i);if(m){factor=parseFloat(m[1])/100;servingLabel=`per serving (${p.serving_size})`;}}
      const food={
        name:p.product_name||'Unknown',
        brand:p.brands||'',
        kcal:Math.round(kcal100*factor),
        carbs:+((carbs100)*factor).toFixed(1),
        protein:+((protein100)*factor).toFixed(1),
        fat:+((fat100)*factor).toFixed(1),
        servingLabel, kcal100, carbs100, protein100, fat100, servingFactor:factor
      };
      const item=document.createElement('div');
      item.className='inline-result-item';
      item.dataset.food=JSON.stringify(food);
      // Show per-100g in the list so values are consistent and comparable
      item.innerHTML=`
        <div class="iri-left">
          <div class="iri-name">${escHtml(food.name)}</div>
          <div class="iri-meta">${food.brand?escHtml(food.brand)+' · ':''}${Math.round(kcal100)} kcal/100g · ${carbs100.toFixed(1)}g C · ${protein100.toFixed(1)}g P · ${fat100.toFixed(1)}g F</div>
        </div>
        <button class="iri-add-btn" onclick="addInlineFood('${mealId}',this)">+</button>`;
      resultsEl.appendChild(item);
    });
}
function addInlineFood(mealId,btn){
  const item=btn.closest('.inline-result-item');
  const food=JSON.parse(item.dataset.food);
  currentScanMealId=mealId;
  const modal=document.getElementById('scannerModal');
  modal.classList.add('open');
  modal.removeAttribute('aria-hidden');
  switchTab('search');
  // Set pendingFood after switchTab (which calls hideFoodResult and clears it)
  pendingFood=food;
  showFoodResult(food);
  releaseScannerTrap=trapFocus(modal.querySelector('.scanner-modal'),closeScanner);
}
function deleteItem(mealId,idx){
  meals.find(m=>m.id===mealId).items.splice(idx,1);
  renderMeals(); openMeal(mealId); updateSummary(); scheduleSave();
  const input = document.getElementById('fi-'+mealId);
  if (input) input.focus();
}

// ── EDIT FOOD ITEM ────────────────────────────────────────────────────────
let editMealId = null;
let editItemIdx = null;
let releaseEditTrap = null;

function openEditModal(mealId, idx) {
  editMealId = mealId;
  editItemIdx = idx;
  const item = meals.find(m => m.id === mealId).items[idx];
  document.getElementById('emName').textContent = item.name;
  document.getElementById('emBrand').textContent = item.brand || '';
  const hasBaseData = item.kcal100 != null;
  document.getElementById('emServingControls').style.display = hasBaseData ? '' : 'none';
  document.getElementById('emRawControls').style.display = hasBaseData ? 'none' : '';
  if (hasBaseData) {
    const unitSel = document.getElementById('emUnit');
    const servingOpt = unitSel.querySelector('option[value="serving"]');
    if (item.servingFactor && item.servingFactor !== 1) {
      servingOpt.style.display = ''; unitSel.value = 'serving';
    } else {
      servingOpt.style.display = 'none'; unitSel.value = '100g';
    }
    document.getElementById('emGrams').style.display = 'none';
    document.getElementById('emGrams').value = '';
    document.getElementById('emQty').value = 1;
    updateEditPreview();
  } else {
    document.getElementById('emRawKcal').value = item.kcal;
    document.getElementById('emRawCarbs').value = item.carbs;
    document.getElementById('emRawProtein').value = item.protein;
    document.getElementById('emRawFat').value = item.fat;
  }
  const modal = document.getElementById('editModal');
  modal.classList.add('open'); modal.removeAttribute('aria-hidden');
  releaseEditTrap = trapFocus(modal.querySelector('.scanner-modal'), closeEditModal);
}

function closeEditModal() {
  const modal = document.getElementById('editModal');
  modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
  if (releaseEditTrap) { releaseEditTrap(); releaseEditTrap = null; }
}

function updateEditPreview() {
  if (editMealId === null || editItemIdx === null) return;
  const item = meals.find(m => m.id === editMealId).items[editItemIdx];
  if (!item || item.kcal100 == null) return;
  const qty = parseFloat(document.getElementById('emQty').value) || 1;
  const unit = document.getElementById('emUnit').value;
  const gramInput = document.getElementById('emGrams');
  const qtyLabel = document.getElementById('emQtyLabel');
  gramInput.style.display = unit === 'custom' ? 'inline-block' : 'none';
  if (unit === 'serving') qtyLabel.textContent = 'Servings';
  else if (unit === '100g') qtyLabel.textContent = 'Qty (x100g)';
  else qtyLabel.textContent = 'Qty';
  let baseFactor;
  if (unit === 'serving') baseFactor = item.servingFactor || 1;
  else if (unit === 'custom') baseFactor = (parseFloat(gramInput.value) || 0) / 100;
  else baseFactor = 1;
  const totalFactor = baseFactor * qty;
  document.getElementById('emKcal').textContent = Math.round(item.kcal100 * totalFactor);
  document.getElementById('emCarbs').textContent = +(item.carbs100 * totalFactor).toFixed(1);
  document.getElementById('emProtein').textContent = +(item.protein100 * totalFactor).toFixed(1);
  document.getElementById('emFat').textContent = +(item.fat100 * totalFactor).toFixed(1);
}

function changeEditQty(delta) {
  const input = document.getElementById('emQty');
  let val = parseFloat(input.value) || 1;
  val = Math.max(0.5, Math.round((val + delta) * 2) / 2);
  input.value = val;
  updateEditPreview();
}

function saveEditFood() {
  const meal = meals.find(m => m.id === editMealId);
  if (!meal) return;
  const item = meal.items[editItemIdx];
  if (!item) return;
  if (item.kcal100 != null) {
    const qty = parseFloat(document.getElementById('emQty').value) || 1;
    const unit = document.getElementById('emUnit').value;
    const gramInput = document.getElementById('emGrams');
    let baseFactor;
    if (unit === 'serving') baseFactor = item.servingFactor || 1;
    else if (unit === 'custom') baseFactor = (parseFloat(gramInput.value) || 0) / 100;
    else baseFactor = 1;
    const totalFactor = baseFactor * qty;
    // Strip any existing serving suffix then re-add
    const baseName = item.name.replace(/ \(x[\d.]+\)$/, '').replace(/ \([\d.]+ x \d+g\)$/, '').replace(/ \(\d+g\)$/, '');
    let newLabel = baseName;
    if (unit === 'custom') { const g = parseFloat(gramInput.value) || 0; newLabel += qty !== 1 ? ` (${qty} x ${g}g)` : ` (${g}g)`; }
    else if (unit === 'serving' && qty !== 1) newLabel += ` (x${qty})`;
    else if (unit === '100g' && qty !== 1) newLabel += ` (x${qty})`;
    item.name = newLabel;
    item.kcal = Math.round(item.kcal100 * totalFactor);
    item.carbs = +(item.carbs100 * totalFactor).toFixed(1);
    item.protein = +(item.protein100 * totalFactor).toFixed(1);
    item.fat = +(item.fat100 * totalFactor).toFixed(1);
  } else {
    item.kcal = parseFloat(document.getElementById('emRawKcal').value) || 0;
    item.carbs = parseFloat(document.getElementById('emRawCarbs').value) || 0;
    item.protein = parseFloat(document.getElementById('emRawProtein').value) || 0;
    item.fat = parseFloat(document.getElementById('emRawFat').value) || 0;
  }
  renderMeals(); openMeal(editMealId); updateSummary(); scheduleSave();
  showToast(`${item.name} updated!`);
  closeEditModal();
}

function showToast(msg,err=false){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show'+(err?' err':'');
  setTimeout(()=>t.className='toast'+(err?' err':''),3000);
}

// Modal backdrop close
document.getElementById('scannerModal').addEventListener('click',function(e){if(e.target===this)closeScanner();});
document.getElementById('confirmOverlay').addEventListener('click',function(e){if(e.target===this)closeConfirm();});
document.getElementById('editModal').addEventListener('click',function(e){if(e.target===this)closeEditModal();});

// ── WATER TRACKER ────────────────────────────────────────────────────────
let WATER_GOAL = 2500; // ml
let waterEntries = []; // array of {ml, time}

function getWaterKey() { return 'nutritrack_water_' + currentDateKey; }

function loadWater() {
  try { waterEntries = JSON.parse(localStorage.getItem(getWaterKey())) || []; }
  catch(e) { waterEntries = []; }
  updateWaterUI();
}

function saveWater() {
  localStorage.setItem(getWaterKey(), JSON.stringify(waterEntries));
  updateWaterUI();
}

function addWater(ml) {
  waterEntries.push({ ml, time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) });
  saveWater();
  showToast(`💧 +${ml}ml water`);
}

function addCustomWater() {
  const input = document.getElementById('waterCustom');
  const ml = parseInt(input.value);
  if (!ml || ml <= 0) return;
  addWater(ml);
  input.value = '';
}

function undoWater() {
  if (!waterEntries.length) return;
  const removed = waterEntries.pop();
  saveWater();
  showToast(`↩ Removed ${removed.ml}ml`);
}

function updateWaterUI() {
  const total = waterEntries.reduce((s, e) => s + e.ml, 0);
  const pct = Math.min(total / WATER_GOAL, 1);
  const C = 132; // circumference of water ring

  const sub = document.getElementById('waterSub');
  const bar = document.getElementById('waterBar');
  const ring = document.getElementById('waterRing');
  const pctEl = document.getElementById('waterPct');
  const undoBtn = document.getElementById('waterUndoBtn');
  const logEl = document.getElementById('waterLog');

  if (sub) sub.textContent = `${total} / ${WATER_GOAL} ml`;
  if (bar) bar.style.width = (pct * 100) + '%';
  if (ring) ring.style.strokeDashoffset = C - pct * C;
  if (pctEl) pctEl.textContent = Math.round(pct * 100) + '%';
  if (undoBtn) undoBtn.style.display = waterEntries.length ? 'block' : 'none';
  if (logEl) {
    logEl.innerHTML = waterEntries.map(e => `<span class="water-log-entry">${e.ml}ml · ${e.time}</span>`).join('');
  }
}

// ── EXERCISE TRACKER ─────────────────────────────────────────────────────
// MET values: { low, moderate, high } for each exercise type
const EXERCISE_METS = {
  walking:         { low: 2.5, moderate: 3.5, high: 4.5, label: 'Walking (casual)' },
  brisk_walking:   { low: 3.5, moderate: 4.5, high: 5.5, label: 'Brisk walking' },
  running:         { low: 7.0, moderate: 9.8, high: 12.0, label: 'Running' },
  cycling:         { low: 4.0, moderate: 6.8, high: 10.0, label: 'Cycling' },
  swimming:        { low: 4.5, moderate: 6.0, high: 8.0, label: 'Swimming' },
  yoga:            { low: 2.0, moderate: 3.0, high: 4.0, label: 'Yoga' },
  hiit:            { low: 6.0, moderate: 8.0, high: 11.0, label: 'HIIT' },
  weight_training: { low: 3.5, moderate: 5.0, high: 6.0, label: 'Weight training' },
  dancing:         { low: 3.0, moderate: 4.8, high: 7.0, label: 'Dancing' },
  rowing:          { low: 4.5, moderate: 7.0, high: 9.5, label: 'Rowing' },
  jump_rope:       { low: 8.0, moderate: 10.0, high: 12.3, label: 'Jump rope' },
  stairs:          { low: 4.0, moderate: 6.0, high: 8.5, label: 'Stair climbing' },
  elliptical:      { low: 4.0, moderate: 5.5, high: 7.5, label: 'Elliptical' },
  pilates:         { low: 2.5, moderate: 3.5, high: 5.0, label: 'Pilates' },
  sports:          { low: 4.0, moderate: 6.5, high: 9.0, label: 'Team sports' },
};

let exerciseEntries = [];

function getExerciseKey() { return 'nutritrack_exercise_' + currentDateKey; }

function loadExercise() {
  try { exerciseEntries = JSON.parse(localStorage.getItem(getExerciseKey())) || []; }
  catch(e) { exerciseEntries = []; }
  renderExerciseLog();
  updateSummary();
}

function saveExercise() {
  localStorage.setItem(getExerciseKey(), JSON.stringify(exerciseEntries));
  renderExerciseLog();
  updateSummary();
}

function calcExerciseKcal(type, intensity, durationMin) {
  const ex = EXERCISE_METS[type];
  if (!ex) return 0;
  const met = ex[intensity] || ex.moderate;
  // Get user weight from goals, default 75kg
  const goals = loadGoalData();
  const weight = (goals && goals.weight) ? goals.weight : 75;
  // Calories = MET × weight(kg) × duration(hours)
  return Math.round(met * weight * (durationMin / 60));
}

function previewExercise() {
  const type = document.getElementById('exType').value;
  const duration = parseInt(document.getElementById('exDuration').value) || 0;
  const intensity = document.getElementById('exIntensity').value;
  const preview = document.getElementById('exPreview');
  if (!type || !duration) { preview.innerHTML = ''; return; }
  const kcal = calcExerciseKcal(type, intensity, duration);
  const label = EXERCISE_METS[type].label;
  preview.innerHTML = `<span class="exp-kcal">${kcal} kcal</span><span class="exp-label">${label} · ${duration} min · ${intensity}</span>`;
}

function addExercise() {
  const type = document.getElementById('exType').value;
  const duration = parseInt(document.getElementById('exDuration').value) || 0;
  const intensity = document.getElementById('exIntensity').value;
  if (!type || !duration) { showToast('Select exercise and duration', true); return; }
  const kcal = calcExerciseKcal(type, intensity, duration);
  const ex = EXERCISE_METS[type];
  exerciseEntries.push({
    type, label: ex.label, intensity, duration, kcal,
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  });
  saveExercise();
  showToast(`🏃 ${ex.label} — ${kcal} kcal burned`);
  document.getElementById('exType').value = '';
  document.getElementById('exDuration').value = '';
  document.getElementById('exPreview').innerHTML = '';
}

function deleteExercise(idx) {
  exerciseEntries.splice(idx, 1);
  saveExercise();
}

function totalExerciseKcal() {
  return exerciseEntries.reduce((s, e) => s + e.kcal, 0);
}

function renderExerciseLog() {
  const logEl = document.getElementById('exLog');
  const totalEl = document.getElementById('exTotal');
  const total = totalExerciseKcal();
  if (totalEl) totalEl.textContent = total + ' kcal burned';
  if (!logEl) return;
  logEl.innerHTML = exerciseEntries.map((e, idx) => `
    <div class="ex-log-item">
      <div class="ex-log-left">
        <div class="ex-log-name">${escHtml(e.label)}</div>
        <div class="ex-log-meta">${e.duration} min · ${e.intensity} · ${e.time}</div>
      </div>
      <div class="ex-log-kcal">
        ${e.kcal} kcal
        <button class="ex-del-btn" onclick="deleteExercise(${idx})" aria-label="Delete ${escHtml(e.label)}">✕</button>
      </div>
    </div>`).join('');
}

// ── GOAL SETTINGS ────────────────────────────────────────────────────────
let releaseGoalTrap = null;

function calcTDEE(sex, age, height, weight, activity) {
  // Mifflin-St Jeor equation
  let bmr;
  if (sex === 'male') bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  else bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  return Math.round(bmr * activity);
}

// Health condition adjustments
const CONDITION_INFO = {
  heart:        { label: 'Heart condition', carbPct: 0.50, proteinPct: 0.25, fatPct: 0.25, calAdj: -0.05, note: 'Lower fat intake, focus on unsaturated fats, fibre-rich foods.' },
  pcos:         { label: 'PCOS',            carbPct: 0.30, proteinPct: 0.35, fatPct: 0.35, calAdj: -0.05, note: 'Lower carbs to help insulin sensitivity, higher protein.' },
  diabetes:     { label: 'Type 2 Diabetes', carbPct: 0.30, proteinPct: 0.30, fatPct: 0.40, calAdj: -0.05, note: 'Reduced carbs for blood sugar control, avoid refined sugars.' },
  hypertension: { label: 'High BP',         carbPct: 0.45, proteinPct: 0.25, fatPct: 0.30, calAdj:  0,    note: 'DASH-style diet: fruits, veg, whole grains, limit sodium.' },
  thyroid:      { label: 'Hypothyroidism',   carbPct: 0.40, proteinPct: 0.30, fatPct: 0.30, calAdj: -0.10, note: 'Slower metabolism — slightly lower calorie target. Ensure iodine & selenium.' },
  kidney:       { label: 'Kidney disease',   carbPct: 0.50, proteinPct: 0.15, fatPct: 0.35, calAdj:  0,    note: 'Lower protein to reduce kidney load. Limit potassium & phosphorus.' },
};

function calcGoals(formData) {
  const tdee = calcTDEE(formData.sex, formData.age, formData.height, formData.weight, formData.activity);
  let dailyCal = Math.round(tdee + formData.rate * 1100); // ~1100 kcal per kg/week

  // Default macro split
  let carbPct = 0.40, proteinPct = 0.30, fatPct = 0.30;
  const conditions = formData.conditions || [];
  const notes = [];

  // Apply condition adjustments — average if multiple
  if (conditions.length > 0) {
    let totalCalAdj = 0;
    let cP = 0, pP = 0, fP = 0;
    conditions.forEach(c => {
      const info = CONDITION_INFO[c];
      if (!info) return;
      cP += info.carbPct;
      pP += info.proteinPct;
      fP += info.fatPct;
      totalCalAdj += info.calAdj;
      notes.push(info.note);
    });
    carbPct = cP / conditions.length;
    proteinPct = pP / conditions.length;
    fatPct = fP / conditions.length;
    // Apply calorie adjustment (average of adjustments)
    dailyCal = Math.round(dailyCal * (1 + totalCalAdj / conditions.length));
  }

  dailyCal = Math.max(1200, dailyCal);

  const macros = {
    carbs: Math.round(dailyCal * carbPct / 4),
    protein: Math.round(dailyCal * proteinPct / 4),
    fat: Math.round(dailyCal * fatPct / 9)
  };
  // Estimate goal date
  let goalDate = null;
  const diff = formData.target - formData.weight;
  if (formData.rate !== 0 && Math.sign(diff) === Math.sign(formData.rate)) {
    const weeks = Math.abs(diff / formData.rate);
    const d = new Date();
    d.setDate(d.getDate() + Math.round(weeks * 7));
    goalDate = d;
  }
  return { tdee, dailyCal, macros, goalDate, notes };
}

function openGoalSettings() {
  const modal = document.getElementById('goalModal');
  modal.classList.add('open');
  modal.removeAttribute('aria-hidden');
  // Load saved values
  const saved = loadGoalData();
  if (saved) {
    document.getElementById('gfSex').value = saved.sex || 'male';
    document.getElementById('gfAge').value = saved.age || '';
    document.getElementById('gfHeight').value = saved.height || '';
    document.getElementById('gfWeight').value = saved.weight || '';
    document.getElementById('gfTarget').value = saved.target || '';
    document.getElementById('gfActivity').value = saved.activity || '1.55';
    document.getElementById('gfRate').value = saved.rate || '-0.5';
    document.getElementById('gfWater').value = saved.waterGoal || 2500;
    // Restore condition checkboxes
    const conditions = saved.conditions || [];
    document.querySelectorAll('#gfConditions input').forEach(el => {
      el.checked = conditions.includes(el.value);
    });
  } else {
    document.querySelectorAll('#gfConditions input').forEach(el => { el.checked = false; });
  }
  updateGoalPreview();
  releaseGoalTrap = trapFocus(modal.querySelector('.scanner-modal'), closeGoalSettings);
  // Live preview on input change — use { once: false } but only bind once
  if (!modal._goalListenersBound) {
    modal.querySelectorAll('input,select').forEach(el => {
      el.addEventListener('input', updateGoalPreview);
      el.addEventListener('change', updateGoalPreview);
    });
    modal._goalListenersBound = true;
  }
}

function closeGoalSettings() {
  const modal = document.getElementById('goalModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (releaseGoalTrap) { releaseGoalTrap(); releaseGoalTrap = null; }
}

function getGoalFormData() {
  const conditions = [...document.querySelectorAll('#gfConditions input:checked')].map(el => el.value);
  return {
    sex: document.getElementById('gfSex').value,
    age: parseInt(document.getElementById('gfAge').value) || 0,
    height: parseInt(document.getElementById('gfHeight').value) || 0,
    weight: parseFloat(document.getElementById('gfWeight').value) || 0,
    target: parseFloat(document.getElementById('gfTarget').value) || 0,
    activity: parseFloat(document.getElementById('gfActivity').value) || 1.55,
    rate: parseFloat(document.getElementById('gfRate').value) || 0,
    waterGoal: parseInt(document.getElementById('gfWater').value) || 2500,
    conditions
  };
}

function updateGoalPreview() {
  const data = getGoalFormData();
  const preview = document.getElementById('gfPreview');
  const notesEl = document.getElementById('gfConditionNotes');
  if (!data.age || !data.height || !data.weight) {
    preview.innerHTML = '<div class="gfp-label">Fill in your details to see your target</div>';
    if (notesEl) notesEl.innerHTML = '';
    return;
  }
  const g = calcGoals(data);
  const goalDateStr = g.goalDate ? g.goalDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  preview.innerHTML = `
    <div class="gfp-kcal">${g.dailyCal} kcal/day</div>
    <div class="gfp-label">TDEE: ${g.tdee} kcal · Goal date: ${goalDateStr}</div>
    <div class="gfp-macros">
      <span style="color:var(--blue)">${g.macros.carbs}g carbs</span>
      <span style="color:var(--green)">${g.macros.protein}g protein</span>
      <span style="color:var(--orange)">${g.macros.fat}g fat</span>
    </div>`;
  if (notesEl) {
    notesEl.innerHTML = g.notes.length ? '⚠️ ' + g.notes.join(' ') : '';
  }
}

function saveGoalSettings() {
  const data = getGoalFormData();
  if (!data.age || !data.height || !data.weight) {
    showToast('Please fill in age, height and weight', true);
    return;
  }
  localStorage.setItem(GOALS_KEY, JSON.stringify(data));
  applyGoals(data);
  closeGoalSettings();
  showToast('Goals saved!');
}

function loadGoalData() {
  try { return JSON.parse(localStorage.getItem(GOALS_KEY)); } catch (e) { return null; }
}

function applyGoals(data) {
  const g = calcGoals(data);
  GOAL = g.dailyCal;
  MACRO_GOALS = g.macros;
  // Update water goal
  if (data.waterGoal) {
    WATER_GOAL = data.waterGoal;
    updateWaterUI();
  }
  // Update header badge
  const badge = document.querySelector('.goal-badge');
  if (badge) badge.textContent = `Goal: ${GOAL} kcal`;
  // Update calorie ring goal display
  const goalValEl = document.querySelector('.stat-val[style*="--green"]');
  if (goalValEl) goalValEl.textContent = GOAL + ' kcal';
  // Update My Plan card
  const rateVal = Math.abs(data.rate);
  const planRate = document.getElementById('planRate');
  const planRateLabel = document.getElementById('planRateLabel');
  const planKcal = document.getElementById('planKcal');
  const planGoalDate = document.getElementById('planGoalDate');
  const goalDetails = document.getElementById('goalDetails');
  if (planRate) planRate.textContent = rateVal + 'kg';
  if (planRateLabel) planRateLabel.textContent = data.rate < 0 ? 'lose / week' : data.rate > 0 ? 'gain / week' : 'maintain';
  if (planKcal) planKcal.textContent = GOAL;
  if (planGoalDate) {
    planGoalDate.textContent = g.goalDate
      ? g.goalDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : '—';
  }
  if (goalDetails) {
    goalDetails.innerHTML = `<span>${data.weight}kg → ${data.target}kg</span><span>TDEE: ${g.tdee}</span>`;
  }
  // Update exercise recommendation based on activity
  const exAdvice = document.getElementById('exAdvice');
  if (exAdvice) {
    const levels = { '1.2': '1–2 days/week · 30 min · Light walks', '1.375': '1–3 days/week · 45 min · Low–moderate intensity', '1.55': '3–5 days/week · 60 min · Moderate intensity', '1.725': '5–6 days/week · 60–90 min · High intensity', '1.9': '6–7 days/week · 90+ min · Very high intensity' };
    exAdvice.textContent = levels[String(data.activity)] || levels['1.55'];
  }
  // Update macro bar max values
  const carbBar = document.getElementById('carbBar');
  const proteinBar = document.getElementById('proteinBar');
  const fatBar = document.getElementById('fatBar');
  if (carbBar) carbBar.setAttribute('aria-valuemax', MACRO_GOALS.carbs);
  if (proteinBar) proteinBar.setAttribute('aria-valuemax', MACRO_GOALS.protein);
  if (fatBar) fatBar.setAttribute('aria-valuemax', MACRO_GOALS.fat);
  // Refresh summary
  updateSummary();
}

// Load saved goals on startup
(function() {
  const saved = loadGoalData();
  if (saved) applyGoals(saved);
})();

// Close goal modal on backdrop click
document.getElementById('goalModal').addEventListener('click', function(e) { if (e.target === this) closeGoalSettings(); });

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
