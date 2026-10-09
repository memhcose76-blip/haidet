'use strict';
(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const page = $('#page'), toastEl = $('#toast');
  if (!page || !toastEl) return;

  const freshState = () => ({paper:{name:'A4',w:210,h:297},face:'front',faces:{front:[],back:[]},grid:true,snap:true});
  let state=freshState(), selectedId=null, undoStack=[], redoStack=[], idCounter=1, toastTimer, busy=false;
  let pointer=null, cropTarget=null, cropSource=null, cropBox={x:.1,y:.1,w:.8,h:.8}, cropRatio=null, cropDrag=null;
  let editId=null, editOriginal=null, editPreviewSrc=null;

  function toast(message){
    if (!toastEl) return;
    toastEl.textContent=message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2600);
  }

  function currentCards(){return state.faces[state.face]}
  function getSelected(){return currentCards().find(c=>c.id===selectedId)||null}
  function newId(){return 'img-'+Date.now().toString(36)+'-'+(idCounter++).toString(36)}
  function snapshot(){undoStack.push(JSON.stringify(state));if(undoStack.length>20)undoStack.shift();redoStack=[];updateHistoryButtons()}
  function updateHistoryButtons(){const undoBtn=$('#undoBtn');const redoBtn=$('#redoBtn');if(undoBtn)undoBtn.disabled=!undoStack.length;if(redoBtn)redoBtn.disabled=!redoStack.length}
  function restore(raw){try{state=JSON.parse(raw);selectedId=null;render();persist();}catch{toast('تعذر استرجاع الخطوة')}}
  function undo(){if(!undoStack.length)return;redoStack.push(JSON.stringify(state));restore(undoStack.pop());updateHistoryButtons()}
  function redo(){if(!redoStack.length)return;undoStack.push(JSON.stringify(state));restore(redoStack.pop());updateHistoryButtons()}
  function setBusy(on){busy=on;document.body.classList.toggle('busy',on)}

  let dbPromise;
  function getDB(){
    if(!('indexedDB' in window)) return Promise.resolve(null);
    if(dbPromise) return dbPromise;
    dbPromise = new Promise(resolve=>{
      const req = indexedDB.open('prinova-local-editor', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return dbPromise;
  }

  let saveTimer;
  function persist(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(async()=>{
      const db=await getDB();
      if(!db) return;
      try{
        const tx=db.transaction('projects','readwrite');
        tx.objectStore('projects').put(state,'autosave');
      }catch{}
    },500);
  }

  async function loadAutosave(){
    const db=await getDB();
    if(!db) return;
    try{
      const tx=db.transaction('projects','readonly');
      const req=tx.objectStore('projects').get('autosave');
      req.onsuccess=()=>{
        const saved=req.result;
        if(saved?.faces){
          state=saved;
          render();
          toast('تم استرجاع آخر مشروع محفوظ على هذا الجهاز');
        }
      };
    }catch{}
  }

  function setPageAspect(){
    page.style.setProperty('--paper-ratio',`${state.paper.w}/${state.paper.h}`);
    const paperName = $('#paperName');
    if (paperName) paperName.textContent = state.paper.name;
  }

  function render(){
    setPageAspect();
    page.classList.toggle('show-grid', state.grid);
    page.classList.toggle('no-grid', !state.grid);
    const gridBtn = $('#gridBtn');
    const snapBtn = $('#snapBtn');
    if (gridBtn) gridBtn.classList.toggle('active', state.grid);
    if (snapBtn) snapBtn.classList.toggle('active', state.snap);

    const faceTitle = $('#faceTitle');
    if (faceTitle) faceTitle.textContent = state.face === 'front' ? 'الوجه الأمامي' : 'الوجه الخلفي';

    const frontTab = $('#frontTab');
    const backTab = $('#backTab');
    if (frontTab) {
      frontTab.classList.toggle('active', state.face === 'front');
      frontTab.setAttribute('aria-selected', String(state.face === 'front'));
    }
    if (backTab) {
      backTab.classList.toggle('active', state.face === 'back');
      backTab.setAttribute('aria-selected', String(state.face === 'back'));
    }

    const emptyState = $('#emptyState');
    if (emptyState) emptyState.style.display = currentCards().length ? 'none' : 'flex';

    page.querySelectorAll('.image-card').forEach(el => el.remove());

    for (const card of currentCards()) {
      const el = document.createElement('div');
      el.className = 'image-card' + (card.id === selectedId ? ' selected' : '');
      el.dataset.id = card.id;
      el.style.left = card.x + '%';
      el.style.top = card.y + '%';
      el.style.width = card.w + '%';
      el.style.height = card.h + '%';
      el.style.transform = `rotate(${card.rotate || 0}deg) scaleX(${card.flip ? -1 : 1})`;

      const img = document.createElement('img');
      img.src = card.src;
      img.alt = card.name || 'صورة';
      img.draggable = false;
      img.style.filter = filterFor(card);
      el.append(img);

      const rot = document.createElement('button');
      rot.className = 'rotate-handle';
      rot.type = 'button';
      rot.textContent = '↻';
      rot.setAttribute('aria-label', 'تدوير الصورة');

      const br = document.createElement('button');
      br.className = 'resize-handle br';
      br.type = 'button';
      br.setAttribute('aria-label', 'تغيير الحجم');

      const tl = document.createElement('button');
      tl.className = 'resize-handle tl';
      tl.type = 'button';
      tl.setAttribute('aria-label', 'تغيير الحجم');

      el.append(rot, br, tl);
      el.addEventListener('pointerdown', e => onCardPointerDown(e, card, el));
      page.append(el);
    }

    const selected = getSelected();
    const editTextBtn = $('#selectionBar [data-action="edittext"]');
    if (editTextBtn) editTextBtn.hidden = !(selected && selected.kind === 'text');

    const selectionBar = $('#selectionBar');
    if (selectionBar) selectionBar.classList.toggle('show', !!selected);

    updateHistoryButtons();
  }

  function filterFor(c){
    return `brightness(${c.brightness ?? 100}%) contrast(${c.contrast ?? 100}%) saturate(${c.saturation ?? 100}%) ${c.look || ''}`.trim();
  }

  function switchFace(face){
    if (face === state.face) return;
    state.face = face;
    selectedId = null;
    render();
    persist();
  }

  async function imageToDataURL(file){
    const safeType = file && file.type ? file.type : 'image/jpeg';
    if (!safeType.startsWith('image/')) throw new Error('الملف مو صورة');

    const original = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('تعذرت قراءة الصورة'));
      r.readAsDataURL(file);
    });

    const img = await loadImage(original);
    const max = 2400;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return original;

    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(safeType === 'image/png' ? 'image/png' : 'image/jpeg', .91);
  }

  function loadImage(src){
    if (!src) return Promise.reject(new Error('لا توجد صورة'));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('ما گدرت أفتح الصورة'));
      img.src = src;
    });
  }

  async function addFiles(files){
    const list = [...files || []].filter(f => f && f.type && f.type.startsWith('image/'));
    if (!list.length) {
      toast('اختار صورة بصيغة مدعومة');
      return;
    }

    setBusy(true);
    snapshot();
    let added = 0;
    const addedCards = [];

    for (const file of list) {
      try {
        const src = await imageToDataURL(file);
        const img = await loadImage(src);
        const w = 38;
        const ar = img.naturalWidth / img.naturalHeight;
        const h = w * (state.paper.w / state.paper.h) / ar;
        const offset = (added % 5) * 2.5;

        const c = {
          id: newId(),
          name: file.name,
          src,
          originalSrc: src,
          x: Math.max(0, 31 - w / 2 + offset),
          y: Math.max(0, 30 - h / 2 + offset),
          w,
          h,
          rotate: 0,
          flip: false,
          brightness: 100,
          contrast: 100,
          saturation: 100
        };

        currentCards().push(c);
        addedCards.push(c);
        added++;
      } catch (e) {
        toast(e && e.message ? e.message : 'تعذر قراءة الصورة');
      }
    }

    setBusy(false);
    if (added) {
      selectedId = addedCards.at(-1).id;
      render();
      persist();
      toast(`انضافت ${added} صورة`);
      if (window.PrinovaTools?.detectAddedCards) window.PrinovaTools.detectAddedCards(addedCards);
    } else {
      undoStack.pop();
      updateHistoryButtons();
    }
  }

  function onCardPointerDown(e, card, el){
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (selectedId !== card.id) {
      selectedId = card.id;
      render();
      el = page.querySelector(`[data-id="${card.id}"]`);
    }

    const target = e.target;
    const rect = page.getBoundingClientRect();
    const start = {
      x: e.clientX,
      y: e.clientY,
      item: { ...card },
      rect,
      el,
      card,
      mode: target.classList.contains('resize-handle') ? 'resize' : target.classList.contains('rotate-handle') ? 'rotate' : 'move',
      pointerId: e.pointerId
    };

    if (start.mode === 'rotate') {
      const cr = el.getBoundingClientRect();
      start.cx = cr.left + cr.width / 2;
      start.cy = cr.top + cr.height / 2;
      start.angle = Math.atan2(e.clientY - start.cy, e.clientX - start.cx) * 180 / Math.PI;
      start.rotate = card.rotate || 0;
    }

    pointer = start;
    snapshot();
    try { el.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e){
    if (!pointer || e.pointerId !== pointer.pointerId) return;
    const p = pointer, card = p.card;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const rw = p.rect.width;
    const rh = p.rect.height;

    if (p.mode === 'move') {
      card.x = clamp(p.item.x + dx / rw * 100, 0, 100 - card.w);
      card.y = clamp(p.item.y + dy / rh * 100, 0, 100 - card.h);
      if (state.snap) {
        if (Math.abs(card.x + card.w / 2 - 50) < 1.7) card.x = 50 - card.w / 2;
        if (Math.abs(card.y + card.h / 2 - 50) < 1.7) card.y = 50 - card.h / 2;
      }
    } else if (p.mode === 'resize') {
      const dw = dx / rw * 100;
      const dh = dy / rh * 100;
      let nextW = clamp(p.item.w + dw, 5, 100 - p.item.x);
      let nextH = clamp(p.item.h + dh, 5, 100 - p.item.y);
      const ratio = p.item.w / p.item.h;
      if (Math.abs(dw) > Math.abs(dh)) nextH = nextW / ratio;
      else nextW = nextH * ratio;
      if (p.item.x + nextW > 100) nextW = 100 - p.item.x;
      if (p.item.y + nextH > 100) nextH = 100 - p.item.y;
      card.w = nextW;
      card.h = nextH;
    } else {
      const a = Math.atan2(e.clientY - p.cy, e.clientX - p.cx) * 180 / Math.PI;
      card.rotate = p.rotate + (a - p.angle);
    }

    const dom = page.querySelector(`[data-id="${card.id}"]`);
    if (dom) {
      dom.style.left = card.x + '%';
      dom.style.top = card.y + '%';
      dom.style.width = card.w + '%';
      dom.style.height = card.h + '%';
      dom.style.transform = `rotate(${card.rotate || 0}deg) scaleX(${card.flip ? -1 : 1})`;
    }
  }

  function onPointerUp(e){
    if (!pointer || e.pointerId !== pointer.pointerId) return;
    pointer = null;
    persist();
    render();
  }

  function clamp(x, a, b){return Math.max(a, Math.min(b, x))}

  function deleteSelected(){
    const i = currentCards().findIndex(c => c.id === selectedId);
    if (i < 0) return;
    snapshot();
    currentCards().splice(i, 1);
    selectedId = null;
    render();
    persist();
    toast('تم حذف الصورة');
  }

  function duplicateSelected(){
    const c = getSelected();
    if (!c) return;
    snapshot();
    const copy = { ...c, id: newId(), x: clamp(c.x + 4, 0, 100 - c.w), y: clamp(c.y + 4, 0, 100 - c.h), name: `نسخة ${c.name || ''}` };
    currentCards().push(copy);
    selectedId = copy.id;
    render();
    persist();
    toast('تم نسخ الصورة');
  }

  function rotateSelected(){
    const c = getSelected();
    if (!c) return;
    snapshot();
    c.rotate = (c.rotate + 90) % 360;
    render();
    persist();
  }

  function flipSelected(){
    const c = getSelected();
    if (!c) return;
    snapshot();
    c.flip = !c.flip;
    render();
    persist();
  }

  function moveOtherFace(){
    const c = getSelected();
    if (!c) return;
    snapshot();
    const from = currentCards();
    const i = from.indexOf(c);
    from.splice(i, 1);
    const dest = state.face === 'front' ? 'back' : 'front';
    state.faces[dest].push(c);
    state.face = dest;
    selectedId = c.id;
    render();
    persist();
    toast('نُقلت الصورة للوجه الآخر');
  }

  function clearCurrent(){
    if (!currentCards().length) {
      toast('ماكو عناصر حتى تنمسح');
      return;
    }
    if (!confirm('تمسح كل الصور من هذا الوجه؟')) return;
    snapshot();
    currentCards().splice(0);
    selectedId = null;
    render();
    persist();
    toast('تم مسح الوجه');
  }

  function arrange(){
    if (!currentCards().length) {
      toast('أضف صور أولاً');
      return;
    }
    snapshot();
    const cards = currentCards();
    const cols = cards.length === 1 ? 1 : 2;
    const gap = 4;
    const cellW = (100 - gap * (cols + 1)) / cols;
    const rows = Math.ceil(cards.length / cols);
    const cellH = (100 - gap * (rows + 1)) / rows;

    cards.forEach((c, i) => {
      c.x = gap + (i % cols) * (cellW + gap);
      c.y = gap + Math.floor(i / cols) * (cellH + gap);
      const img = new Image();
      img.src = c.src;
      const ar = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.4;
      let w = cellW, h = w * (state.paper.w / state.paper.h) / ar;
      if (h > cellH) {
        h = cellH;
        w = h * ar / (state.paper.w / state.paper.h);
      }
      c.w = w;
      c.h = h;
      c.rotate = 0;
    });

    render();
    persist();
    toast('تم ترتيب الصور تلقائياً');
  }

  function openCrop(){
    const c = getSelected();
    if (!c) return;
    cropTarget = c;
    cropSource = c.src;
    const cropModal = $('#cropModal');
    if (cropModal) {
      cropModal.classList.add('open');
      cropModal.setAttribute('aria-hidden', 'false');
    }
    cropRatio = null;
    $$('#cropPresets button').forEach(b => b.classList.toggle('active', b.dataset.ratio === 'free'));
    loadImage(cropSource)
      .then(img => {
        const canvas = $('#cropCanvas');
        if (!canvas) return;
        const max = 1100;
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * s);
        canvas.height = Math.round(img.naturalHeight * s);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        cropBox = { x: .1, y: .1, w: .8, h: .8 };
        setCropBox();
        fitCropCanvas();
      })
      .catch(() => toast('تعذر تحميل الصورة للقص'));
  }

  function fitCropCanvas(){
    const cv = $('#cropCanvas');
    const box = $('#cropPreview');
    if (!cv || !box) return;
    const r = box.getBoundingClientRect();
    const scale = Math.min((r.width - 16) / cv.width, (r.height - 16) / cv.height);
    const w = cv.width * scale;
    const h = cv.height * scale;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    cv.dataset.drawW = String(w);
    cv.dataset.drawH = String(h);
    setCropBox();
  }

  function setCropBox(){
    const cv = $('#cropCanvas');
    const host = $('#cropPreview');
    const el = $('#cropBox');
    if (!cv || !host || !el) return;
    const cw = Number(cv.dataset.drawW || cv.getBoundingClientRect().width);
    const ch = Number(cv.dataset.drawH || cv.getBoundingClientRect().height);
    const hr = host.getBoundingClientRect();
    const ox = (hr.width - cw) / 2;
    const oy = (hr.height - ch) / 2;

    el.style.left = `${ox + cropBox.x * cw}px`;
    el.style.top = `${oy + cropBox.y * ch}px`;
    el.style.width = `${cropBox.w * cw}px`;
    el.style.height = `${cropBox.h * ch}px`;
  }

  function setCropRatio(ratio){
    cropRatio = ratio;
    const cv = $('#cropCanvas');
    if (!cv) return;
    const ar = cv.width / cv.height;
    let w = 1, h = 1;
    if (ratio) {
      if (ratio > ar) h = ar / ratio;
      else w = ratio / ar;
    }
    cropBox = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    setCropBox();
  }

  function cropDown(e){
    if (!$('#cropModal')?.classList.contains('open')) return;
    const box = $('#cropBox');
    const cv = $('#cropCanvas');
    if (!box || !cv) return;
    const isHandle = e.target === box.querySelector('i');
    cropDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      initial: { ...cropBox },
      mode: isHandle ? 'resize' : 'move',
      scaleX: cv.width,
      scaleY: cv.height
    };
    e.preventDefault();
  }

  function cropMove(e){
    if (!cropDrag || e.pointerId !== cropDrag.pointerId) return;
    const dx = (e.clientX - cropDrag.startX) / cropDrag.scaleX;
    const dy = (e.clientY - cropDrag.startY) / cropDrag.scaleY;
    const o = cropDrag.initial;

    if (cropDrag.mode === 'move') {
      cropBox.x = clamp(o.x + dx, 0, 1 - o.w);
      cropBox.y = clamp(o.y + dy, 0, 1 - o.h);
    } else {
      let nw = clamp(o.w + dx, .08, 1 - o.x);
      let nh = clamp(o.h + dy, .08, 1 - o.y);
      if (cropRatio) {
        const ratioPx = cropRatio / (cropDrag.scaleX / cropDrag.scaleY);
        if (Math.abs(dx) > Math.abs(dy)) nh = nw / ratioPx;
        else nw = nh * ratioPx;
        nw = clamp(nw, .08, 1 - o.x);
        nh = clamp(nh, .08, 1 - o.y);
      }
      cropBox.w = nw;
      cropBox.h = nh;
    }

    setCropBox();
  }

  function cropUp(){
    cropDrag = null;
  }

  async function applyCrop(){
    if (!cropTarget) return;
    try {
      const img = await loadImage(cropSource);
      const sx = Math.round(cropBox.x * img.naturalWidth);
      const sy = Math.round(cropBox.y * img.naturalHeight);
      const sw = Math.max(1, Math.round(cropBox.w * img.naturalWidth));
      const sh = Math.max(1, Math.round(cropBox.h * img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      snapshot();
      cropTarget.src = c.toDataURL('image/png');
      cropTarget.originalSrc = cropTarget.src;
      const ar = sw / sh;
      const h = cropTarget.w * (state.paper.w / state.paper.h) / ar;
      cropTarget.h = Math.min(100 - cropTarget.y, h);
      closeModal($('#cropModal'));
      render();
      persist();
      toast('تم تطبيق القص');
    } catch {
      toast('تعذر تطبيق القص');
    }
  }

  function openAdjust(){
    const c = getSelected();
    if (!c) return;
    editId = c.id;
    editOriginal = { src: c.src, brightness: c.brightness, contrast: c.contrast, saturation: c.saturation };
    editPreviewSrc = c.src;

    const b = $('#brightness');
    const con = $('#contrast');
    const sat = $('#saturation');
    if (b) b.value = c.brightness ?? 100;
    if (con) con.value = c.contrast ?? 100;
    if (sat) sat.value = c.saturation ?? 100;

    $('#brightnessOut').textContent = `${b.value}%`;
    $('#contrastOut').textContent = `${con.value}%`;
    $('#saturationOut').textContent = `${sat.value}%`;

    const modal = $('#adjustModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function updateAdjustPreview(){
    const c = currentCards().find(x => x.id === editId);
    if (!c) return;
    const f = `brightness(${$('#brightness').value}%) contrast(${$('#contrast').value}%) saturate(${$('#saturation').value}%)`;
    $('#brightnessOut').textContent = `${$('#brightness').value}%`;
    $('#contrastOut').textContent = `${$('#contrast').value}%`;
    $('#saturationOut').textContent = `${$('#saturation').value}%`;

    const img = page.querySelector(`[data-id="${c.id}"] img`);
    if (img) {
      img.style.filter = f;
      if (img.src !== editPreviewSrc) img.src = editPreviewSrc;
    }
  }

  function finishAdjust(save=true){
    const c = currentCards().find(x => x.id === editId);
    if (!c) return;
    if (save) {
      snapshot();
      c.src = editPreviewSrc;
      c.brightness = +$('#brightness').value;
      c.contrast = +$('#contrast').value;
      c.saturation = +$('#saturation').value;
      persist();
    }
    editId = null;
    editOriginal = null;
    editPreviewSrc = null;
    closeModal($('#adjustModal'));
    render();
  }

  async function removeBackground(){
    const c = currentCards().find(x => x.id === editId);
    if (!c) return;
    setBusy(true);
    const button = $('#removeBgBtn');
    if (button) button.disabled = true;

    try {
      const img = await loadImage(editPreviewSrc || c.src);
      const max = 1100;
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * s));
      const h = Math.max(1, Math.round(img.naturalHeight * s));
      const can = document.createElement('canvas');
      can.width = w;
      can.height = h;
      const ctx = can.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      const im = ctx.getImageData(0, 0, w, h);
      const d = im.data;
      const n = w * h;
      const tol = +$('#bgTolerance').value;
      const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
      const avg = [0, 0, 0];

      for (const [x, y] of corners) {
        const i = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) avg[k] += d[i + k] / 4;
      }

      const threshold = tol * 1.9;
      const seen = new Uint8Array(n);
      const queue = new Int32Array(n);
      let head = 0, tail = 0;

      function matches(i){
        const p = i * 4;
        const dr = d[p] - avg[0];
        const dg = d[p + 1] - avg[1];
        const db = d[p + 2] - avg[2];
        return Math.sqrt(dr * dr + dg * dg + db * db) < threshold;
      }

      function add(i){
        if (!seen[i] && matches(i)) {
          seen[i] = 1;
          queue[tail++] = i;
        }
      }

      for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }

      while (head < tail) {
        const i = queue[head++];
        const x = i % w;
        const y = (i / w) | 0;
        const p = i * 4;
        d[p + 3] = 0;
        if (x > 0) add(i - 1);
        if (x < w - 1) add(i + 1);
        if (y > 0) add(i - w);
        if (y < h - 1) add(i + w);
      }

      ctx.putImageData(im, 0, 0);
      editPreviewSrc = can.toDataURL('image/png');
      const preview = page.querySelector(`[data-id="${c.id}"] img`);
      if (preview) preview.src = editPreviewSrc;
      toast(tail ? 'تمت إزالة الخلفية المتصلة بالحواف' : 'ما انكشف لون خلفية مناسب؛ جرّب صورة بخلفية أوضح');
    } catch {
      toast('ما تمت إزالة الخلفية؛ قد تكون الصورة غير مدعومة');
    } finally {
      setBusy(false);
      if (button) button.disabled = false;
    }
  }

  function canvasForFace(face){
    return new Promise(async(resolve, reject) => {
      try {
        const scale = Math.min(300 / 25.4, 6000 / Math.max(state.paper.w, state.paper.h), Math.sqrt(24000000 / (state.paper.w * state.paper.h)));
        const c = document.createElement('canvas');
        c.width = Math.round(state.paper.w * scale);
        c.height = Math.round(state.paper.h * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);

        for (const item of state.faces[face]) {
          const img = await loadImage(item.src);
          const x = item.x / 100 * c.width;
          const y = item.y / 100 * c.height;
          const w = item.w / 100 * c.width;
          const h = item.h / 100 * c.height;
          const ar = img.naturalWidth / img.naturalHeight;
          let dw = w, dh = h;
          if (dw / dh > ar) dw = dh * ar;
          else dh = dw / ar;

          ctx.save();
          ctx.translate(x + w / 2, y + h / 2);
          ctx.rotate((item.rotate || 0) * Math.PI / 180);
          ctx.scale(item.flip ? -1 : 1, 1);
          ctx.filter = filterFor(item);
          ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        }

        resolve(c);
      } catch (e) {
        reject(e);
      }
    });
  }

  function downloadBlob(blob, name){
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 3000);
  }

  async function exportFace(face = state.face){
    try {
      setBusy(true);
      const c = await canvasForFace(face);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!blob) throw Error();
      downloadBlob(blob, `prinova-${face}-${state.paper.name.toLowerCase()}.png`);
      toast('بدأ تنزيل ملف PNG عالي الدقة');
    } catch {
      toast('ما نجح التصدير؛ جرّب صورة أصغر');
    } finally {
      setBusy(false);
    }
  }

  async function printBoth(){
    try {
      setBusy(true);
      const root = document.createElement('div');
      root.id = 'printRoot';
      document.body.append(root);

      for (const face of ['front', 'back']) {
        const canvas = await canvasForFace(face);
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.className = 'print-sheet';
        img.style.width = `${state.paper.w}mm`;
        img.style.height = `${state.paper.h}mm`;
        img.alt = face === 'front' ? 'الوجه الأمامي' : 'الوجه الخلفي';
        root.append(img);
      }

      const style = document.createElement('style');
      style.id = 'printDynamic';
      style.textContent = `@media print{@page{size:${state.paper.w}mm ${state.paper.h}mm;margin:0}.print-sheet{display:block;object-fit:fill;break-after:page;page-break-after:always}.print-sheet:last-child{break-after:auto;page-break-after:auto}}`;
      document.head.append(style);
      setBusy(false);
      setTimeout(() => {
        window.print();
        setTimeout(() => {
          root.remove();
          style.remove();
        }, 1000);
      }, 150);
    } catch {
      setBusy(false);
      toast('تعذر تجهيز الطباعة');
    }
  }

  function saveProject(){
    const blob = new Blob([JSON.stringify({ version: 1, app: 'PRINOVA', state }, null, 0)], { type: 'application/json' });
    downloadBlob(blob, 'prinova-project.prinova');
    toast('تم حفظ ملف المشروع على جهازك');
  }

  function loadProjectFile(file){
    const r = new FileReader();
    r.onload = () => {
      try {
        const p = JSON.parse(r.result);
        const s = p.state || p;
        if (!s.faces?.front || !s.faces?.back || !s.paper) throw Error();
        snapshot();
        state = s;
        selectedId = null;
        render();
        persist();
        closeModal($('#menuModal'));
        toast('تم فتح المشروع');
      } catch {
        toast('ملف المشروع غير صالح');
      }
    };
    r.readAsText(file);
  }

  function openModal(el){
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }

  function closeModal(el){
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  function openPaper(){
    const modal = $('#paperModal');
    if (modal) {
      $('#paperW').value = state.paper.w;
      $('#paperH').value = state.paper.h;
      openModal(modal);
    }
  }

  $('#addBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = '' });
  $('#frontTab').addEventListener('click', () => switchFace('front'));
  $('#backTab').addEventListener('click', () => switchFace('back'));
  $('#gridBtn').addEventListener('click', () => { state.grid = !state.grid; render(); persist(); });
  $('#snapBtn').addEventListener('click', () => { state.snap = !state.snap; render(); persist(); });
  $('#paperBtn').addEventListener('click', openPaper);
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#clearBtn').addEventListener('click', clearCurrent);
  $('#arrangeBtn').addEventListener('click', arrange);

  $('#selectionBar').addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    switch (b.dataset.action) {
      case 'crop': openCrop(); break;
      case 'adjust': openAdjust(); break;
      case 'edittext': if (getSelected()?.kind === 'text') window.PrinovaTools?.editText(); break;
      case 'duplicate': duplicateSelected(); break;
      case 'rotate': rotateSelected(); break;
      case 'flip': flipSelected(); break;
      case 'sendback': moveOtherFace(); break;
      case 'delete': deleteSelected(); break;
    }
  });

  page.addEventListener('pointerdown', e => {
    if (e.target === page || e.target === $('#pageGrid') || e.target === $('#emptyState')) {
      selectedId = null;
      render();
    }
  });

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

  $('#menuBtn').addEventListener('click', () => openModal($('#menuModal')));
  $('#exportBtn').addEventListener('click', () => exportFace());
  $('#saveProject').addEventListener('click', saveProject);
  $('#loadProject').addEventListener('click', () => $('#projectInput').click());
  $('#projectInput').addEventListener('change', e => { if (e.target.files[0]) loadProjectFile(e.target.files[0]); e.target.value = '' });
  $('#exportBoth').addEventListener('click', async () => {
    closeModal($('#menuModal'));
    await exportFace('front');
    setTimeout(() => exportFace('back'), 350);
  });
  $('#printBtn').addEventListener('click', () => {
    closeModal($('#menuModal'));
    printBoth();
  });
  $('#clearAll').addEventListener('click', () => {
    if (!confirm('تمسح الصور من الوجهين؟')) return;
    snapshot();
    state.faces = { front: [], back: [] };
    selectedId = null;
    render();
    persist();
    closeModal($('#menuModal'));
    toast('تم مسح المشروع');
  });

  $$('.close-modal').forEach(b => b.addEventListener('click', () => closeModal(b.closest('.modal'))));
  $$('.modal').forEach(m => m.addEventListener('click', e => {
    if (e.target === m) {
      if (m.id === 'adjustModal') finishAdjust(false);
      else closeModal(m);
    }
  }));

  $$('.paper-options button').forEach(b => b.addEventListener('click', () => {
    const [n, w, h] = b.dataset.paper.split(',');
    snapshot();
    state.paper = { name: n, w: +w, h: +h };
    $('#paperW').value = w;
    $('#paperH').value = h;
    $('#paperUnit').value = 'mm';
    render();
    persist();
    closeModal($('#paperModal'));
    toast(`تم اختيار ${n}`);
  }));

  $('#applyPaper').addEventListener('click', () => {
    const unit = $('#paperUnit').value === 'cm' ? 10 : 1;
    const w = +$('#paperW').value * unit;
    const h = +$('#paperH').value * unit;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 30 || h < 30 || w > 1000 || h > 1000) {
      toast('المقاس لازم يكون بين 30 و1000 ملم');
      return;
    }
    snapshot();
    state.paper = { name: 'مخصص', w, h };
    render();
    persist();
    closeModal($('#paperModal'));
    toast('تم تطبيق المقاس المخصص');
  });

  $('#cropBox').addEventListener('pointerdown', cropDown);
  document.addEventListener('pointermove', cropMove);
  document.addEventListener('pointerup', cropUp);
  document.addEventListener('pointercancel', cropUp);
  $('#applyCrop').addEventListener('click', applyCrop);
  $('#cropPresets').addEventListener('click', e => {
    const b = e.target.closest('[data-ratio]');
    if (!b) return;
    $$('#cropPresets button').forEach(x => x.classList.toggle('active', x === b));
    setCropRatio(b.dataset.ratio === 'free' ? null : +b.dataset.ratio);
  });

  window.addEventListener('resize', () => {
    if ($('#cropModal').classList.contains('open')) fitCropCanvas();
  });

  ['brightness', 'contrast', 'saturation'].forEach(id => $('#'+id).addEventListener('input', updateAdjustPreview));
  $('#applyAdjust').addEventListener('click', () => finishAdjust(true));
  $('#resetAdjust').addEventListener('click', () => {
    const c = currentCards().find(x => x.id === editId);
    if (!c) return;
    $('#brightness').value = 100;
    $('#contrast').value = 100;
    $('#saturation').value = 100;
    editPreviewSrc = c.originalSrc || editOriginal.src;
    updateAdjustPreview();
  });
  $('#removeBgBtn').addEventListener('click', removeBackground);
  $('#bgTolerance').addEventListener('input', () => $('#bgToleranceOut').textContent = $('#bgTolerance').value);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $$('.modal.open').forEach(m => m.id === 'adjustModal' ? finishAdjust(false) : closeModal(m));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !$('.modal.open') && getSelected()) {
      deleteSelected();
    }
  });

  page.addEventListener('dragover', e => { e.preventDefault(); });
  page.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  window.PrinovaApp = {
    get state(){return state},
    currentCards,
    getSelected,
    newId,
    snapshot,
    render,
    persist,
    toast,
    loadImage,
    openModal,
    closeModal,
    printBoth,
    canvasForFace,
    selectCard(id){ selectedId = id; render(); },
    async addImageData(src, name = 'scan.png') {
      const img = await loadImage(src);
      const w = 38;
      const ar = img.naturalWidth / img.naturalHeight;
      const h = w * (state.paper.w / state.paper.h) / ar;
      const card = { id: newId(), name, src, originalSrc: src, x: 31 - w / 2, y: 30 - h / 2, w, h, rotate: 0, flip: false, brightness: 100, contrast: 100, saturation: 100 };
      snapshot();
      currentCards().push(card);
      selectedId = card.id;
      render();
      persist();
      return card;
    },
    updateAdjustmentPreview(src){
      editPreviewSrc = src;
      const c = currentCards().find(x => x.id === editId);
      if (c) {
        const img = page.querySelector(`[data-id="${c.id}"] img`);
        if (img) img.src = src;
      }
    },
    currentFace(){ return state.face; }
  };

  render();
  loadAutosave();
})();
