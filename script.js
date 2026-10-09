'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const page = $('page');
  const toastEl = $('toast');

  const freshState = () => ({
    paper: { name: 'A4', w: 210, h: 297 },
    face: 'front',
    faces: { front: [], back: [] },
    grid: true,
    snap: true
  });

  let state = freshState();
  let selectedId = null;
  let undoStack = [];
  let redoStack = [];
  let idCounter = 1;
  let toastTimer = null;
  let busy = false;
  let pointer = null;
  let cropTarget = null;
  let cropSource = null;
  let cropBox = { x: 0.12, y: 0.12, w: 0.76, h: 0.76 };
  let cropRatio = null;
  let cropDrag = null;
  let editId = null;
  let editOriginal = null;
  let editPreviewSrc = null;

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function currentCards() {
    return state.faces[state.face] || [];
  }

  function getSelected() {
    return currentCards().find((c) => c.id === selectedId) || null;
  }

  function newId() {
    return 'img-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
  }

  function snapshot() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 20) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const undoBtn = $('undoBtn');
    const redoBtn = $('redoBtn');
    if (undoBtn) undoBtn.disabled = !undoStack.length;
    if (redoBtn) redoBtn.disabled = !redoStack.length;
  }

  function restore(raw) {
    try {
      state = JSON.parse(raw);
      if (!state.faces) state.faces = { front: [], back: [] };
      if (!state.faces.front) state.faces.front = [];
      if (!state.faces.back) state.faces.back = [];
      selectedId = null;
      render();
      persist();
    } catch (e) {
      toast('تعذر استرجاع الخطوة');
    }
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state));
    restore(undoStack.pop());
    updateHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state));
    restore(redoStack.pop());
    updateHistoryButtons();
  }

  function setBusy(on) {
    busy = on;
    document.body.classList.toggle('busy', on);
  }

  function persist() {
    try {
      localStorage.setItem('prinova-autosave', JSON.stringify({ state, selectedId }));
    } catch (error) {
      // silent fallback
    }
  }

  function loadAutosave() {
    try {
      const raw = localStorage.getItem('prinova-autosave');
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || !saved.state) return;
      state = saved.state;
      selectedId = saved.selectedId || null;
      render();
    } catch (error) {
      // ignore corrupted saved state
    }
  }

  function setPageAspect() {
    if (!page) return;
    page.style.setProperty('--paper-ratio', `${state.paper.w}/${state.paper.h}`);
    const paperName = $('paperName');
    if (paperName) paperName.textContent = state.paper.name || 'A4';
    const faceTitle = $('faceTitle');
    if (faceTitle) faceTitle.textContent = state.face === 'front' ? 'الوجه الأمامي' : 'الوجه الخلفي';
  }

  function filterFor(card) {
    const brightness = card.brightness ?? 100;
    const contrast = card.contrast ?? 100;
    const saturation = card.saturation ?? 100;
    const look = card.look || '';
    return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) ${look}`.trim();
  }

  function switchFace(face) {
    if (face === state.face) return;
    state.face = face;
    selectedId = null;
    render();
    persist();
  }

  function imageToDataURL(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      throw new Error('الملف مو صورة');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('تعذرت قراءة الصورة'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('ما گدرت أفتح الصورة'));
      img.src = src;
    });
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getSafePosition(card, dx, dy) {
    const maxX = 100 - card.w;
    const maxY = 100 - card.h;
    return {
      x: clamp(card.x + dx, 0, maxX),
      y: clamp(card.y + dy, 0, maxY)
    };
  }

  function addFiles(files) {
    const list = [...files].filter((file) => file && file.type && file.type.startsWith('image/'));
    if (!list.length) {
      toast('اختار صورة بصيغة مدعومة');
      return;
    }

    setBusy(true);
    snapshot();
    let added = 0;
    const addedCards = [];

    (async () => {
      try {
        for (const file of list) {
          const src = await imageToDataURL(file);
          const img = await loadImage(src);
          const width = 38;
          const ratio = img.naturalWidth / img.naturalHeight;
          const h = width * (state.paper.w / state.paper.h) / ratio;
          const offset = (added % 5) * 2.6;
          const card = {
            id: newId(),
            kind: 'image',
            name: file.name || 'image',
            src,
            originalSrc: src,
            x: clamp(31 - width / 2 + offset, 0, 100 - width),
            y: clamp(30 - h / 2 + offset, 0, 100 - h),
            w: width,
            h,
            rotate: 0,
            flip: false,
            brightness: 100,
            contrast: 100,
            saturation: 100,
            look: ''
          };
          currentCards().push(card);
          addedCards.push(card);
          added += 1;
        }
        if (added) {
          selectedId = addedCards[addedCards.length - 1].id;
          render();
          persist();
          toast(`انضافت ${added} صورة`);
          if (window.PrinovaTools && typeof window.PrinovaTools.detectAddedCards === 'function') {
            window.PrinovaTools.detectAddedCards(addedCards);
          }
        }
      } catch (error) {
        toast(error && error.message ? error.message : 'تعذر إضافة الصورة');
      } finally {
        setBusy(false);
      }
    })();
  }

  function deleteSelected() {
    const idx = currentCards().findIndex((c) => c.id === selectedId);
    if (idx < 0) return;
    snapshot();
    currentCards().splice(idx, 1);
    selectedId = null;
    render();
    persist();
    toast('تم حذف العنصر');
  }

  function duplicateSelected() {
    const card = getSelected();
    if (!card) return;
    snapshot();
    const copy = { ...card, id: newId(), x: clamp(card.x + 4, 0, 100 - card.w), y: clamp(card.y + 4, 0, 100 - card.h) };
    currentCards().push(copy);
    selectedId = copy.id;
    render();
    persist();
    toast('تم نسخ العنصر');
  }

  function rotateSelected() {
    const card = getSelected();
    if (!card) return;
    snapshot();
    card.rotate = (card.rotate + 90) % 360;
    render();
    persist();
  }

  function flipSelected() {
    const card = getSelected();
    if (!card) return;
    snapshot();
    card.flip = !card.flip;
    render();
    persist();
  }

  function moveOtherFace() {
    const card = getSelected();
    if (!card) return;
    snapshot();
    const from = currentCards();
    const idx = from.findIndex((c) => c.id === card.id);
    if (idx >= 0) from.splice(idx, 1);
    const destFace = state.face === 'front' ? 'back' : 'front';
    state.faces[destFace].push({ ...card, x: clamp(card.x, 0, 100 - card.w), y: clamp(card.y, 0, 100 - card.h) });
    selectedId = null;
    state.face = destFace;
    render();
    persist();
    toast('تم نقل العنصر إلى الوجه الآخر');
  }

  function clearCurrent() {
    if (!currentCards().length) {
      toast('لا توجد عناصر في هذا الوجه');
      return;
    }
    if (!confirm('هل تريد حذف جميع العناصر في هذا الوجه؟')) return;
    snapshot();
    currentCards().length = 0;
    selectedId = null;
    render();
    persist();
    toast('تم مسح الوجه');
  }

  function arrange() {
    const cards = currentCards();
    if (!cards.length) {
      toast('أضف صوراً أولاً');
      return;
    }
    snapshot();
    const cols = cards.length === 1 ? 1 : 2;
    const gap = 4;
    const cellW = (100 - gap * (cols + 1)) / cols;
    const rows = Math.ceil(cards.length / cols);
    cards.forEach((card, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      card.x = gap + col * (cellW + gap);
      card.y = gap + row * (Math.min(28, 40 / rows) + gap);
      card.w = clamp(card.w, 10, cellW);
      card.h = clamp(card.h, 10, 30);
    });
    render();
    persist();
  }

  function render() {
    setPageAspect();
    if (!page) return;

    page.classList.toggle('show-grid', !!state.grid);
    page.classList.toggle('no-grid', !state.grid);
    const gridBtn = $('gridBtn');
    const snapBtn = $('snapBtn');
    if (gridBtn) gridBtn.classList.toggle('active', !!state.grid);
    if (snapBtn) snapBtn.classList.toggle('active', !!state.snap);

    page.querySelectorAll('.image-card, .text-card').forEach((node) => node.remove());

    const cards = currentCards();
    const emptyState = $('emptyState');
    if (emptyState) emptyState.hidden = cards.length > 0;

    cards.forEach((card) => {
      const el = document.createElement('div');
      el.className = `card-item ${card.kind === 'text' ? 'text-card' : 'image-card'} ${card.id === selectedId ? 'selected' : ''}`;
      el.dataset.id = card.id;
      el.style.left = `${card.x}%`;
      el.style.top = `${card.y}%`;
      el.style.width = `${card.w}%`;
      el.style.height = `${card.h}%`;
      el.style.transform = `rotate(${card.rotate || 0}deg)`;
      el.style.zIndex = card.id === selectedId ? '30' : '10';

      if (card.kind === 'text') {
        const text = document.createElement('div');
        text.className = 'card-text';
        text.textContent = card.text || 'نص';
        text.style.fontSize = `${card.fontSize || 32}px`;
        text.style.fontFamily = `${card.fontFamily || 'Cairo'}, sans-serif`;
        text.style.textAlign = card.align || 'center';
        text.style.color = card.color || '#121212';
        text.style.fontWeight = card.bold ? 800 : 600;
        text.style.transform = card.flip ? 'scaleX(-1)' : 'none';
        el.appendChild(text);
      } else {
        const img = document.createElement('img');
        img.src = card.src || '';
        img.alt = card.name || 'صورة';
        img.style.filter = filterFor(card);
        img.style.transform = card.flip ? 'scaleX(-1)' : 'none';
        img.className = 'card-image';
        el.appendChild(img);
      }

      page.appendChild(el);
    });

    const selected = getSelected();
    const selectionBar = $('selectionBar');
    if (selectionBar) {
      selectionBar.classList.toggle('show', !!selected);
      const editTextBtn = selectionBar.querySelector('[data-action="edittext"]');
      if (editTextBtn) editTextBtn.hidden = !(selected && selected.kind === 'text');
    }
    updateHistoryButtons();
  }

  function openModal(el) {
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }

  function closeModal(el) {
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  function openPaper() {
    const modal = $('paperModal');
    if (!modal) return;
    $('paperW').value = state.paper.w;
    $('paperH').value = state.paper.h;
    openModal(modal);
  }

  function openCrop() {
    const card = getSelected();
    if (!card || card.kind !== 'image') return;
    cropTarget = card;
    cropSource = card.src;
    const cropModal = $('cropModal');
    if (cropModal) openModal(cropModal);
    cropRatio = null;
    const canvas = $('cropCanvas');
    const host = $('cropPreview');
    if (!canvas || !host) return;
    const img = new Image();
    img.onload = () => {
      const maxW = 720;
      const maxH = 420;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.dataset.drawW = String(w);
      canvas.dataset.drawH = String(h);
      setCropBox();
    };
    img.src = card.src;
  }

  function setCropBox() {
    const canvas = $('cropCanvas');
    const host = $('cropPreview');
    const box = $('cropBox');
    if (!canvas || !host || !box) return;
    const drawW = Number(canvas.dataset.drawW || canvas.width || 100);
    const drawH = Number(canvas.dataset.drawH || canvas.height || 100);
    const rect = host.getBoundingClientRect();
    const padding = 16;
    const scale = Math.min((rect.width - padding) / drawW, (rect.height - padding) / drawH);
    const wPx = drawW * scale;
    const hPx = drawH * scale;
    const left = (rect.width - wPx) / 2;
    const top = (rect.height - hPx) / 2;
    const x = left + cropBox.x * wPx;
    const y = top + cropBox.y * hPx;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${cropBox.w * wPx}px`;
    box.style.height = `${cropBox.h * hPx}px`;
  }

  function cropDown(e) {
    const box = $('cropBox');
    const host = $('cropPreview');
    const card = getSelected();
    if (!box || !host || !card) return;
    const boxRect = box.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    cropDrag = {
      startX: e.clientX,
      startY: e.clientY,
      initial: { ...cropBox },
      scaleX: hostRect.width / (boxRect.width || 1),
      scaleY: hostRect.height / (boxRect.height || 1)
    };
  }

  function cropMove(e) {
    if (!cropDrag) return;
    const host = $('cropPreview');
    const canvas = $('cropCanvas');
    if (!host || !canvas) return;
    const hostRect = host.getBoundingClientRect();
    const dx = (e.clientX - cropDrag.startX) / hostRect.width;
    const dy = (e.clientY - cropDrag.startY) / hostRect.height;
    cropBox.x = clamp(cropDrag.initial.x + dx, 0, 1 - cropDrag.initial.w);
    cropBox.y = clamp(cropDrag.initial.y + dy, 0, 1 - cropDrag.initial.h);
    setCropBox();
  }

  function cropUp() {
    cropDrag = null;
  }

  async function applyCrop() {
    if (!cropTarget || !cropSource) return;
    try {
      const img = await loadImage(cropSource);
      const canvas = document.createElement('canvas');
      const sx = cropBox.x * img.naturalWidth;
      const sy = cropBox.y * img.naturalHeight;
      const sw = cropBox.w * img.naturalWidth;
      const sh = cropBox.h * img.naturalHeight;
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/png');
      snapshot();
      cropTarget.src = url;
      cropTarget.originalSrc = url;
      cropTarget.w = clamp(cropTarget.w, 8, 90);
      cropTarget.h = clamp(cropTarget.h, 8, 90);
      render();
      persist();
      closeModal($('cropModal'));
      toast('تم قص الصورة');
    } catch (error) {
      toast(error.message || 'تعذر قص الصورة');
    }
  }

  function openAdjust() {
    const card = getSelected();
    if (!card) return;
    editId = card.id;
    editOriginal = { brightness: card.brightness || 100, contrast: card.contrast || 100, saturation: card.saturation || 100, look: card.look || '' };
    editPreviewSrc = card.src;
    const bright = $('brightness');
    const contrast = $('contrast');
    const saturation = $('saturation');
    const sharpness = $('sharpness');
    if (bright) bright.value = card.brightness || 100;
    if (contrast) contrast.value = card.contrast || 100;
    if (saturation) saturation.value = card.saturation || 100;
    if (sharpness) sharpness.value = '0';
    updateAdjustPreview();
    openModal($('adjustModal'));
  }

  function updateAdjustPreview() {
    const card = currentCards().find((c) => c.id === editId);
    if (!card) return;
    const bright = Number($('brightness').value || 100);
    const contrast = Number($('contrast').value || 100);
    const saturation = Number($('saturation').value || 100);
    const sharpness = Number($('sharpness').value || 0);
    card.brightness = bright;
    card.contrast = contrast;
    card.saturation = saturation;
    const preview = page.querySelector(`[data-id="${card.id}"] img`);
    if (preview) preview.style.filter = `brightness(${bright}%) contrast(${contrast}%) saturate(${saturation}%) ${card.look || ''}`;
    if ($('brightnessOut')) $('brightnessOut').textContent = `${bright}%`;
    if ($('contrastOut')) $('contrastOut').textContent = `${contrast}%`;
    if ($('saturationOut')) $('saturationOut').textContent = `${saturation}%`;
    if ($('sharpnessOut')) $('sharpnessOut').textContent = String(sharpness);
  }

  function finishAdjust(save = true) {
    const card = currentCards().find((c) => c.id === editId);
    if (!card) return;
    if (save) {
      snapshot();
      card.brightness = Number($('brightness').value || 100);
      card.contrast = Number($('contrast').value || 100);
      card.saturation = Number($('saturation').value || 100);
      card.look = card.look || '';
      render();
      persist();
      toast('تم تعديل الصورة');
    } else {
      if (editOriginal) {
        card.brightness = editOriginal.brightness;
        card.contrast = editOriginal.contrast;
        card.saturation = editOriginal.saturation;
        card.look = editOriginal.look;
      }
      render();
    }
    closeModal($('adjustModal'));
    editId = null;
    editOriginal = null;
  }

  function resetAdjust() {
    const card = currentCards().find((c) => c.id === editId);
    if (!card) return;
    if (editOriginal) {
      card.brightness = editOriginal.brightness;
      card.contrast = editOriginal.contrast;
      card.saturation = editOriginal.saturation;
      card.look = editOriginal.look;
    }
    if ($('brightness')) $('brightness').value = card.brightness || 100;
    if ($('contrast')) $('contrast').value = card.contrast || 100;
    if ($('saturation')) $('saturation').value = card.saturation || 100;
    updateAdjustPreview();
  }

  async function removeBackground() {
    const card = currentCards().find((c) => c.id === editId);
    if (!card) return;
    setBusy(true);
    const btn = $('removeBgBtn');
    if (btn) btn.disabled = true;
    try {
      const img = await loadImage(card.src);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const tolerance = Number($('bgTolerance').value || 42);
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const dist = Math.abs(r - 255) + Math.abs(g - 255) + Math.abs(b - 255);
        if (dist < tolerance * 3) {
          data[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      card.src = canvas.toDataURL('image/png');
      render();
      persist();
      toast('تمت إزالة الخلفية تقريبياً');
    } catch (error) {
      toast('تعذر إزالة الخلفية');
    } finally {
      if (btn) btn.disabled = false;
      setBusy(false);
    }
  }

  function applyFilter(look) {
    const card = getSelected();
    if (!card) {
      toast('اختَر عنصرًا أولاً');
      return;
    }
    snapshot();
    card.look = look;
    render();
    persist();
    toast('تم تطبيق الفلتر');
  }

  function saveProject() {
    const payload = { version: 1, app: 'PRINOVA', state };
    const blob = new Blob([JSON.stringify(payload, null, 0)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prinova-project.prinova';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('تم حفظ المشروع');
  }

  function loadProjectFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        const next = payload.state || payload;
        if (!next.faces || !next.paper) throw new Error('ملف غير صحيح');
        snapshot();
        state = next;
        selectedId = null;
        render();
        persist();
        toast('تم فتح المشروع');
      } catch (error) {
        toast('تعذر قراءة المشروع');
      }
    };
    reader.readAsText(file);
  }

  async function exportFace(face = state.face) {
    const cards = state.faces[face] || [];
    if (!cards.length) {
      toast('لا توجد عناصر لتصديرها');
      return;
    }
    setBusy(true);
    try {
      const ratio = 300 / 25.4;
      const canvas = document.createElement('canvas');
      const widthMm = state.paper.w;
      const heightMm = state.paper.h;
      canvas.width = Math.round(widthMm * ratio);
      canvas.height = Math.round(heightMm * ratio);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      cards.forEach((card) => {
        if (card.kind === 'text') {
          ctx.save();
          ctx.translate((card.x / 100) * canvas.width, (card.y / 100) * canvas.height);
          ctx.rotate((card.rotate || 0) * Math.PI / 180);
          ctx.font = `${card.bold ? 800 : 600} ${card.fontSize || 40}px ${card.fontFamily || 'Cairo'}, sans-serif`;
          ctx.textAlign = card.align || 'center';
          ctx.fillStyle = card.color || '#111111';
          ctx.fillText(card.text || 'نص', (card.w / 100) * canvas.width / 2, (card.h / 100) * canvas.height / 2);
          ctx.restore();
          return;
        }

        const img = new Image();
        img.src = card.src;
        const cardX = (card.x / 100) * canvas.width;
        const cardY = (card.y / 100) * canvas.height;
        const cardW = (card.w / 100) * canvas.width;
        const cardH = (card.h / 100) * canvas.height;
        ctx.save();
        ctx.translate(cardX + cardW / 2, cardY + cardH / 2);
        ctx.rotate((card.rotate || 0) * Math.PI / 180);
        ctx.translate(-(cardW / 2), -(cardH / 2));
        ctx.filter = filterFor(card);
        ctx.drawImage(img, 0, 0, cardW, cardH);
        ctx.restore();
      });

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('فشل في إنشاء الصورة');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prinova-${face}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('تم تصدير الصورة');
    } catch (error) {
      toast(error.message || 'تعذر التصدير');
    } finally {
      setBusy(false);
    }
  }

  async function printBoth() {
    if (!state.faces.front.length && !state.faces.back.length) {
      toast('لا توجد عناصر للطباعة');
      return;
    }
    window.print();
  }

  function addTextCard() {
    const text = $('artText').value.trim();
    if (!text) {
      toast('اكتب نصًا أولاً');
      return;
    }
    const font = $('artFont')?.value || 'Cairo';
    const fontSize = Number($('artFontSize')?.value || 42);
    const color = $('artColor')?.value || '#121212';
    const align = $('artAlign')?.value || 'center';
    const bold = $('artBold')?.checked ?? true;
    snapshot();
    const card = {
      id: newId(),
      kind: 'text',
      text,
      fontFamily: font,
      fontSize,
      color,
      align,
      bold,
      rotate: 0,
      flip: false,
      x: 20,
      y: 30,
      w: 55,
      h: 22,
      name: 'نص'
    };
    currentCards().push(card);
    selectedId = card.id;
    render();
    persist();
    closeModal($('textModal'));
    toast('تمت إضافة النص');
  }

  function openText() {
    const card = getSelected();
    if (card && card.kind === 'text') {
      $('artText').value = card.text || '';
      $('artFont').value = card.fontFamily || 'Cairo';
      $('artFontSize').value = card.fontSize || 42;
      $('artColor').value = card.color || '#121212';
      $('artAlign').value = card.align || 'center';
      $('artBold').checked = !!card.bold;
    } else {
      $('artText').value = '';
      $('artFont').value = 'Cairo';
      $('artFontSize').value = 42;
      $('artColor').value = '#121212';
      $('artAlign').value = 'center';
      $('artBold').checked = true;
    }
    openModal($('textModal'));
  }

  function applySelectedPhotoSize() {
    const card = getSelected();
    if (!card) return;
    const w = Number($('photoW').value || card.w);
    const h = Number($('photoH').value || card.h);
    snapshot();
    card.w = clamp(w, 8, 90);
    card.h = clamp(h, 8, 90);
    card.x = clamp(card.x, 0, 100 - card.w);
    card.y = clamp(card.y, 0, 100 - card.h);
    render();
    persist();
    closeModal($('sizeModal'));
    toast('تم تحديث حجم الصورة');
  }

  function applyRepeatLayout() {
    const count = Math.max(1, Number($('repeatCount').value || 1));
    const margin = Number($('repeatMargin').value || 5);
    const gap = Number($('repeatGap').value || 3);
    const card = getSelected();
    if (!card) {
      toast('اختَر صورة أولاً');
      return;
    }
    snapshot();
    const cols = Math.min(4, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / cols);
    const pageW = 100;
    const cellW = (pageW - (cols + 1) * margin) / cols;
    const cellH = cellW * (card.h / card.w);
    currentCards().length = 0;
    for (let i = 0; i < count; i += 1) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      currentCards().push({
        ...card,
        id: newId(),
        x: margin + col * (cellW + gap),
        y: margin + row * (cellH + gap),
        w: cellW,
        h: cellH,
        rotate: 0
      });
    }
    selectedId = currentCards()[0]?.id || null;
    render();
    persist();
    closeModal($('repeatModal'));
    toast(`تم ترتيب ${count} نسخ`);
  }

  function setPaperSize() {
    const w = Number($('paperW').value || 210);
    const h = Number($('paperH').value || 297);
    snapshot();
    state.paper = { name: 'مخصص', w, h };
    render();
    persist();
    closeModal($('paperModal'));
    toast('تم تحديث ورق العمل');
  }

  function bindStaticEvents() {
    $('addBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

    $('frontTab').addEventListener('click', () => switchFace('front'));
    $('backTab').addEventListener('click', () => switchFace('back'));
    $('gridBtn').addEventListener('click', () => { state.grid = !state.grid; render(); persist(); });
    $('snapBtn').addEventListener('click', () => { state.snap = !state.snap; render(); persist(); });
    $('paperBtn').addEventListener('click', openPaper);
    $('clearBtn').addEventListener('click', clearCurrent);
    $('arrangeBtn').addEventListener('click', arrange);
    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);
    $('menuBtn').addEventListener('click', () => openModal($('menuModal')));
    $('exportBtn').addEventListener('click', () => exportFace());
    $('printBtn').addEventListener('click', printBoth);
    $('saveProject').addEventListener('click', saveProject);
    $('loadProject').addEventListener('click', () => $('projectInput').click());
    $('projectInput').addEventListener('change', (e) => { const file = e.target.files?.[0]; if (file) loadProjectFile(file); e.target.value = ''; });
    $('exportBoth').addEventListener('click', async () => { await exportFace('front'); await exportFace('back'); });
    $('clearAll').addEventListener('click', () => { if (confirm('هل تريد حذف جميع العناصر من الجهتين؟')) { state.faces.front = []; state.faces.back = []; selectedId = null; render(); persist(); toast('تمت إزالة كل العناصر'); } });

    document.querySelectorAll('.close-modal').forEach((button) => {
      button.addEventListener('click', () => {
        const modal = button.closest('.modal');
        if (modal) closeModal(modal);
      });
    });

    document.querySelectorAll('.modal').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal(modal);
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.open').forEach((modal) => closeModal(modal));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
      const selectedCard = getSelected();
      if (!selectedCard) return;
      const step = 1;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      }
      if (e.key === 'ArrowLeft') selectedCard.x = clamp(selectedCard.x - step, 0, 100 - selectedCard.w);
      if (e.key === 'ArrowRight') selectedCard.x = clamp(selectedCard.x + step, 0, 100 - selectedCard.w);
      if (e.key === 'ArrowUp') selectedCard.y = clamp(selectedCard.y - step, 0, 100 - selectedCard.h);
      if (e.key === 'ArrowDown') selectedCard.y = clamp(selectedCard.y + step, 0, 100 - selectedCard.h);
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        render();
        persist();
      }
    });

    page.addEventListener('pointerdown', (event) => {
      const targetCard = event.target.closest('.card-item');
      if (targetCard) {
        const id = targetCard.dataset.id;
        if (selectedId !== id) {
          selectedId = id;
          render();
        }
        const card = currentCards().find((c) => c.id === id);
        if (!card) return;
        pointer = {
          cardId: id,
          startX: event.clientX,
          startY: event.clientY,
          originalX: card.x,
          originalY: card.y,
          pageRect: page.getBoundingClientRect()
        };
      } else if (event.target === page || event.target === $('pageGrid') || event.target === $('emptyState')) {
        selectedId = null;
        render();
      }
    });

    document.addEventListener('pointermove', (event) => {
      if (!pointer) return;
      const card = currentCards().find((c) => c.id === pointer.cardId);
      if (!card) return;
      const dx = ((event.clientX - pointer.startX) / pointer.pageRect.width) * 100;
      const dy = ((event.clientY - pointer.startY) / pointer.pageRect.height) * 100;
      const next = getSafePosition(card, dx, dy);
      card.x = next.x;
      card.y = next.y;
      render();
    });

    document.addEventListener('pointerup', () => { pointer = null; persist(); });

    $('selectionBar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      switch (action) {
        case 'crop': openCrop(); break;
        case 'adjust': openAdjust(); break;
        case 'edittext': openText(); break;
        case 'duplicate': duplicateSelected(); break;
        case 'rotate': rotateSelected(); break;
        case 'flip': flipSelected(); break;
        case 'sendback': moveOtherFace(); break;
        case 'delete': deleteSelected(); break;
      }
    });

    $('applyCrop').addEventListener('click', applyCrop);
    $('applyAdjust').addEventListener('click', () => finishAdjust(true));
    $('resetAdjust').addEventListener('click', resetAdjust);
    $('brightness').addEventListener('input', updateAdjustPreview);
    $('contrast').addEventListener('input', updateAdjustPreview);
    $('saturation').addEventListener('input', updateAdjustPreview);
    $('sharpness').addEventListener('input', updateAdjustPreview);
    $('removeBgBtn').addEventListener('click', removeBackground);
    $('applyPaper').addEventListener('click', setPaperSize);
    $('applyPhotoSize').addEventListener('click', applySelectedPhotoSize);
    $('applyRepeat').addEventListener('click', applyRepeatLayout);
    $('applyText').addEventListener('click', addTextCard);
    $('textBtn').addEventListener('click', openText);
    $('sizeBtn').addEventListener('click', () => openModal($('sizeModal')));
    $('repeatBtn').addEventListener('click', () => openModal($('repeatModal')));
    $('filtersBtn').addEventListener('click', () => openModal($('filtersModal')));
    $('scanBtn').addEventListener('click', () => openModal($('scannerModal')));

    document.querySelectorAll('.filter-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-preset').forEach((item) => item.classList.remove('active'));
        btn.classList.add('active');
        applyFilter(btn.dataset.look || '');
      });
    });

    document.querySelectorAll('.paper-options button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [name, w, h] = btn.dataset.paper.split(',');
        $('paperW').value = w;
        $('paperH').value = h;
        state.paper = { name, w: Number(w), h: Number(h) };
        render();
        persist();
      });
    });

    document.querySelectorAll('[data-ratio]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ratio]').forEach((item) => item.classList.remove('active'));
        btn.classList.add('active');
        const ratio = btn.dataset.ratio;
        if (ratio === 'free') {
          cropRatio = null;
        } else {
          cropRatio = Number(ratio);
        }
      });
    });

    $('cropBox').addEventListener('pointerdown', cropDown);
    document.addEventListener('pointermove', cropMove);
    document.addEventListener('pointerup', cropUp);
    document.addEventListener('pointercancel', cropUp);
  }

  function init() {
    render();
    bindStaticEvents();
    loadAutosave();
    updateHistoryButtons();
    window.PrinovaApp = {
      state,
      get state() { return state; },
      getSelected,
      currentCards,
      render,
      persist,
      toast,
      loadImage,
      openModal,
      closeModal,
      addImageData: async (src, name = 'scan.png') => {
        const img = await loadImage(src);
        const ar = img.naturalWidth / img.naturalHeight;
        const width = 38;
        const height = width * (state.paper.w / state.paper.h) / ar;
        const card = {
          id: newId(),
          kind: 'image',
          name,
          src,
          originalSrc: src,
          x: clamp(31 - width / 2, 0, 100 - width),
          y: clamp(30 - height / 2, 0, 100 - height),
          w: width,
          h: height,
          rotate: 0,
          flip: false,
          brightness: 100,
          contrast: 100,
          saturation: 100,
          look: ''
        };
        snapshot();
        currentCards().push(card);
        selectedId = card.id;
        render();
        persist();
        return card;
      },
      selectCard(id) { selectedId = id; render(); },
      currentFace() { return state.face; }
    };
  }

  init();
})();
