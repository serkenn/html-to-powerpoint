import './style.css';
import DOMPurify from 'dompurify';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <span class="topbar-brand">htmltopp</span>
      <div class="topbar-actions">
        <button id="exportPngButton" class="export-btn" disabled title="PNG として書き出し">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" focusable="false">
            <path d="M6.5 1.5v7M4 6l2.5 2.5L9 6M1.5 10.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          PNG
        </button>
        <button id="exportPdfButton" class="export-btn" disabled title="PDF として書き出し">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" focusable="false">
            <path d="M6.5 1.5v7M4 6l2.5 2.5L9 6M1.5 10.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          PDF
        </button>
        <button id="exportPptxButton" class="export-btn" disabled title="PPTX として書き出し">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" focusable="false">
            <path d="M6.5 1.5v7M4 6l2.5 2.5L9 6M1.5 10.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          PPTX
        </button>
      </div>
    </header>

    <div class="workspace">
      <aside class="panel sidebar">
        <label class="dropzone" id="dropzone">
          <input id="fileInput" type="file" accept=".html,text/html" multiple hidden />
          <svg class="dropzone-icon" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
            <path d="M15 20V10M12 13l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8 22h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span class="dropzone-title">HTML をドロップ</span>
          <span class="dropzone-hint">または クリックして選択</span>
        </label>
        <button id="loadSampleButton" class="sample-btn">サンプルを読み込む</button>

        <div class="pages-header">
          <span>Pages</span>
          <span id="pageCount" class="pages-badge">0</span>
        </div>

        <div id="pageList" class="page-list"></div>
        <p class="status" id="status" aria-live="polite">HTML を読み込むとページ一覧とプレビューを生成します。</p>
      </aside>

      <section class="panel preview-panel">
        <div class="preview-toolbar">
          <div class="preview-meta">
            <strong id="documentTitle">—</strong>
            <span id="fileName">未選択</span>
          </div>
          <div class="preview-side-meta">
            <span id="slideSize"></span>
            <button id="scaleLabel" class="scale-reset-btn" title="クリックで表示をリセット">fit</button>
          </div>
        </div>
        <div class="preview-stage">
          <div id="previewCanvas" class="preview-canvas">
            <div id="slideViewport" class="viewport empty">
              <div id="previewRoot" class="preview-root"></div>
              <div class="placeholder">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
                  <rect x="7" y="5" width="22" height="28" rx="3" stroke="currentColor" stroke-width="1.5"/>
                  <rect x="13" y="2" width="14" height="6" rx="2" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M13 18h14M13 23h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <p>ページを選択するとプレビューが表示されます</p>
                <p class="placeholder-sub">左のリストから選択、またはHTMLをドロップしてください</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
`;

const fileInput = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
const loadSampleButton = document.querySelector('#loadSampleButton');
const exportPngButton = document.querySelector('#exportPngButton');
const exportPdfButton = document.querySelector('#exportPdfButton');
const exportPptxButton = document.querySelector('#exportPptxButton');
const fileName = document.querySelector('#fileName');
const slideSize = document.querySelector('#slideSize');
const documentTitle = document.querySelector('#documentTitle');
const pageCount = document.querySelector('#pageCount');
const pageList = document.querySelector('#pageList');
const status = document.querySelector('#status');
const previewRoot = document.querySelector('#previewRoot');
const slideViewport = document.querySelector('#slideViewport');
const previewCanvas = document.querySelector('#previewCanvas');
const scaleLabel = document.querySelector('#scaleLabel');

let slides = [];
let activeSlideId = null;
let exportModulesPromise;
let dragSourceId = null;

// Pan & zoom state
let pz = { scale: 1, panX: 0, panY: 0 };
let fitScale = 1;

const SAMPLE_PATH = '/samples/deck.html';
const REMOTE_EXPORT_ENDPOINTS = {
  pdf: '/api/render/pdf',
  pptx: '/api/render/pptx'
};

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
}

function getActiveSlide() {
  return slides.find((slide) => slide.id === activeSlideId) || null;
}

function setExportEnabled(enabled) {
  exportPngButton.disabled = !enabled;
  exportPdfButton.disabled = !enabled;
  exportPptxButton.disabled = !enabled;
}

async function loadExportModules() {
  if (!exportModulesPromise) {
    exportModulesPromise = Promise.all([
      import('html-to-image'),
      import('jspdf'),
      import('pptxgenjs')
    ]).then(([htmlToImage, jspdfModule, pptxModule]) => ({
      toPng: htmlToImage.toPng,
      jsPDF: jspdfModule.jsPDF,
      PptxGenJS: pptxModule.default
    }));
  }

  return exportModulesPromise;
}

function extractSlideDimensions(doc) {
  const candidates = [
    doc.querySelector('.slide-container'),
    doc.querySelector('[data-slide-root]'),
    doc.body.firstElementChild
  ].filter(Boolean);

  for (const element of candidates) {
    const width = Number.parseInt(element.style.width || element.getAttribute('width'), 10);
    const height = Number.parseInt(element.style.height || element.getAttribute('height'), 10);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { width, height };
    }
  }

  return { width: 1280, height: 720 };
}

function scopeStylesheet(css) {
  const SCOPE = '.embedded-document';
  // Strip @import to prevent loading external CSS
  css = css.replace(/@import\s+[^;]*;/gi, '');

  let depth = 0;
  const stack = []; // 'at-group' | 'at-leaf' | 'rule' — pushed on {, popped on }
  const out = [];
  let pendingType = null;

  for (const chunk of css.split(/(\{|\})/)) {
    if (chunk === '{') {
      stack.push(pendingType || 'rule');
      pendingType = null;
      depth++;
      out.push('{');
    } else if (chunk === '}') {
      stack.pop();
      depth--;
      out.push('}');
    } else {
      const trimmed = chunk.trim();
      if (!trimmed) {
        out.push(chunk);
        continue;
      }

      const isAtRule = trimmed.startsWith('@');
      if (isAtRule) {
        pendingType = /^@(media|supports|layer|document)\b/i.test(trimmed) ? 'at-group' : 'at-leaf';
      } else {
        pendingType = 'rule';
      }

      const parentType = stack.length > 0 ? stack[stack.length - 1] : null;
      const shouldScope = !isAtRule && (depth === 0 || parentType === 'at-group');

      if (shouldScope) {
        const scoped = trimmed
          .split(',')
          .map((s) => {
            const t = s.trim();
            if (!t) return s;
            if (/^(html|body|:root)\b/.test(t)) {
              return t.replace(/^(html|body|:root)/, SCOPE);
            }
            return `${SCOPE} ${t}`;
          })
          .join(', ');
        out.push(scoped);
      } else {
        out.push(chunk);
      }
    }
  }

  return out.join('');
}

function buildPreviewMarkup(doc) {
  // <link rel="stylesheet"> は外部リクエストを発生させるため除外する
  const styleNodes = [...doc.head.children].filter((node) => node.tagName === 'STYLE');

  const scopedStyles = styleNodes
    .map((node) => `<style>${scopeStylesheet(node.textContent)}</style>`)
    .join('\n');

  const bodyMarkup = DOMPurify.sanitize(doc.body.innerHTML);

  return `
    <div class="embedded-document">
      ${scopedStyles}
      ${bodyMarkup}
    </div>
  `;
}

function createSlideFromHtml(html, sourceName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim() || sourceName;

  return {
    id: crypto.randomUUID(),
    sourceName,
    fileBase: sourceName.replace(/\.html?$/i, '') || 'slide',
    title,
    dimensions: extractSlideDimensions(doc),
    previewMarkup: buildPreviewMarkup(doc)
  };
}

function applyPanZoom() {
  const total = fitScale * pz.scale;
  slideViewport.style.transform =
    `translate(calc(-50% + ${pz.panX}px), calc(-50% + ${pz.panY}px)) scale(${total})`;
  scaleLabel.textContent = `${Math.round(total * 100)}%`;
}

function resetPanZoom() {
  pz = { scale: 1, panX: 0, panY: 0 };
  applyPanZoom();
}

function fitPreview(dimensions) {
  const stage = previewCanvas.parentElement;
  const padding = 40;
  const availW = stage.clientWidth - padding * 2;
  const availH = stage.clientHeight - padding * 2;
  fitScale = Math.min(availW / dimensions.width, availH / dimensions.height, 1);

  // ステージ全体に広げることで left/top 50% が必ずステージ中央を指す
  previewCanvas.style.width = `${stage.clientWidth}px`;
  previewCanvas.style.height = `${stage.clientHeight}px`;

  slideViewport.style.width = `${dimensions.width}px`;
  slideViewport.style.height = `${dimensions.height}px`;
  slideViewport.style.left = '50%';
  slideViewport.style.top = '50%';
  applyPanZoom();
}

function renderActiveSlide() {
  const activeSlide = getActiveSlide();

  if (!activeSlide) {
    fileName.textContent = '未選択';
    slideSize.textContent = '-';
    documentTitle.textContent = '-';
    previewRoot.innerHTML = '';
    previewCanvas.style.width = '';
    previewCanvas.style.height = '';
    slideViewport.classList.add('empty');
    slideViewport.style.width = '';
    slideViewport.style.height = '';
    slideViewport.style.left = '';
    slideViewport.style.top = '';
    slideViewport.style.transform = '';
    scaleLabel.textContent = 'fit';
    setExportEnabled(false);
    return;
  }

  fileName.textContent = activeSlide.sourceName;
  slideSize.textContent = `${activeSlide.dimensions.width} x ${activeSlide.dimensions.height}`;
  documentTitle.textContent = activeSlide.title;
  previewRoot.innerHTML = activeSlide.previewMarkup;
  slideViewport.classList.remove('empty');
  pz = { scale: 1, panX: 0, panY: 0 };
  fitPreview(activeSlide.dimensions);
  setExportEnabled(true);
}

function renderPageList() {
  pageCount.textContent = String(slides.length);

  if (slides.length === 0) {
    pageList.innerHTML = '<p class="page-list-empty">ページはまだありません。</p>';
    return;
  }

  pageList.innerHTML = slides
    .map((slide, index) => buildPageCard(slide, index))
    .join('');
}

function buildPageCard(slide, index) {
  const thumbScale = Math.min(180 / slide.dimensions.width, 120 / slide.dimensions.height, 1);
  const thumbWidth = slide.dimensions.width * thumbScale;
  const thumbHeight = slide.dimensions.height * thumbScale;
  const isActive = slide.id === activeSlideId;

  return `
    <article class="page-card ${isActive ? 'active' : ''}" data-slide-id="${slide.id}" draggable="true">
      <button class="page-card-main" type="button" data-action="select" data-slide-id="${slide.id}">
        <span class="page-index">${index + 1}</span>
        <span class="page-thumb-stage">
          <span class="page-thumb-canvas" style="width:${thumbWidth}px;height:${thumbHeight}px;">
            <span
              class="page-thumb-viewport"
              style="width:${slide.dimensions.width}px;height:${slide.dimensions.height}px;transform:scale(${thumbScale});"
            >
              ${slide.previewMarkup}
            </span>
          </span>
        </span>
        <span class="page-card-text">
          <strong>${escapeHtml(slide.title)}</strong>
          <span>${escapeHtml(slide.sourceName)}</span>
        </span>
      </button>
      <button class="page-delete" type="button" data-action="delete" data-slide-id="${slide.id}" aria-label="ページを削除">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function refreshUI() {
  renderPageList();
  renderActiveSlide();
}

function addSlides(newSlides) {
  slides = [...slides, ...newSlides];
  activeSlideId = newSlides.at(-1)?.id || activeSlideId;
  refreshUI();
}

function removeSlide(slideId) {
  const index = slides.findIndex((slide) => slide.id === slideId);
  if (index === -1) {
    return;
  }

  const wasActive = activeSlideId === slideId;
  slides = slides.filter((slide) => slide.id !== slideId);

  if (wasActive) {
    activeSlideId = slides[index]?.id || slides[index - 1]?.id || null;
  }

  refreshUI();
  if (slides.length === 0) {
    setStatus('ページをすべて削除しました。');
  } else {
    setStatus('ページを削除しました。');
  }
}

function selectSlide(slideId) {
  if (activeSlideId === slideId) {
    return;
  }

  activeSlideId = slideId;
  refreshUI();
}

async function readFiles(fileList) {
  const files = [...fileList].filter((file) => /\.html?$/i.test(file.name));
  if (files.length === 0) {
    setStatus('HTML ファイルを選択してください。', true);
    return;
  }

  try {
    const newSlides = [];
    for (const file of files) {
      const html = await file.text();
      newSlides.push(createSlideFromHtml(html, file.name));
    }

    addSlides(newSlides);
    setStatus(`${newSlides.length} 件のページを追加しました。`);
  } catch (error) {
    console.error(error);
    setStatus('HTML の解析に失敗しました。レイアウト構造を確認してください。', true);
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function requestServerExport(format) {
  const activeSlide = getActiveSlide();
  const endpoint = REMOTE_EXPORT_ENDPOINTS[format];
  if (!activeSlide || !endpoint) {
    throw new Error(`Unsupported export format: ${format}`);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      html: activeSlide.previewMarkup,
      fileName: activeSlide.fileBase,
      title: activeSlide.title,
      dimensions: activeSlide.dimensions
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Export failed with status ${response.status}`);
  }

  return response.blob();
}

async function exportPreviewAsPngBlob() {
  const activeSlide = getActiveSlide();
  if (!activeSlide) {
    throw new Error('No active slide');
  }

  const { toPng } = await loadExportModules();
  const dataUrl = await toPng(previewRoot, {
    cacheBust: true,
    pixelRatio: 2,
    width: activeSlide.dimensions.width,
    height: activeSlide.dimensions.height,
    canvasWidth: activeSlide.dimensions.width * 2,
    canvasHeight: activeSlide.dimensions.height * 2
  });

  const response = await fetch(dataUrl);
  return response.blob();
}

async function withBusyState(task, activeButton = null) {
  const buttons = [loadSampleButton, exportPngButton, exportPdfButton, exportPptxButton];
  buttons.forEach((button) => { button.disabled = true; });
  if (activeButton) activeButton.dataset.loading = '';

  try {
    await task();
  } catch (error) {
    console.error(error);
    setStatus(`出力に失敗しました: ${error.message}`, true);
  } finally {
    setExportEnabled(Boolean(getActiveSlide()));
    loadSampleButton.disabled = false;
    if (activeButton) delete activeButton.dataset.loading;
  }
}

async function exportPng() {
  const activeSlide = getActiveSlide();
  if (!activeSlide) {
    return;
  }

  await withBusyState(async () => {
    setStatus('PNG を生成しています...');
    const blob = await exportPreviewAsPngBlob();
    downloadBlob(blob, `${activeSlide.fileBase}.png`);
    setStatus('PNG を出力しました。');
  }, exportPngButton);
}

async function exportPdf() {
  const activeSlide = getActiveSlide();
  if (!activeSlide) {
    return;
  }

  await withBusyState(async () => {
    setStatus('PDF を生成しています...');
    const blob = await requestServerExport('pdf');
    downloadBlob(blob, `${activeSlide.fileBase}.pdf`);
    setStatus('PDF を出力しました。');
  }, exportPdfButton);
}

async function exportPptx() {
  const activeSlide = getActiveSlide();
  if (!activeSlide) {
    return;
  }

  await withBusyState(async () => {
    setStatus('PPTX を生成しています...');
    const blob = await requestServerExport('pptx');
    downloadBlob(blob, `${activeSlide.fileBase}.pptx`);
    setStatus('PPTX を出力しました。');
  }, exportPptxButton);
}

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('dragging');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragging');
});

dropzone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
  await readFiles(event.dataTransfer.files);
});

fileInput.addEventListener('change', async (event) => {
  await readFiles(event.target.files);
  event.target.value = '';
});

// ── Drag & drop reorder ──────────────────────────────────────────────────────

function clearDragIndicators() {
  pageList.querySelectorAll('.drag-before, .drag-after').forEach((el) => {
    el.classList.remove('drag-before', 'drag-after');
  });
}

pageList.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.page-card');
  if (!card) return;
  dragSourceId = card.dataset.slideId;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragSourceId);
});

pageList.addEventListener('dragend', () => {
  pageList.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  clearDragIndicators();
  dragSourceId = null;
});

pageList.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const card = event.target.closest('.page-card');
  if (!card || card.dataset.slideId === dragSourceId) return;
  clearDragIndicators();
  const { top, height } = card.getBoundingClientRect();
  card.classList.add(event.clientY < top + height / 2 ? 'drag-before' : 'drag-after');
});

pageList.addEventListener('dragleave', (event) => {
  const card = event.target.closest('.page-card');
  if (card && !card.contains(event.relatedTarget)) {
    card.classList.remove('drag-before', 'drag-after');
  }
});

pageList.addEventListener('drop', (event) => {
  event.preventDefault();
  clearDragIndicators();
  const targetCard = event.target.closest('.page-card');
  if (!targetCard || !dragSourceId) return;
  const targetId = targetCard.dataset.slideId;
  if (targetId === dragSourceId) return;

  const { top, height } = targetCard.getBoundingClientRect();
  const insertBefore = event.clientY < top + height / 2;

  const next = [...slides];
  const srcIdx = next.findIndex((s) => s.id === dragSourceId);
  const [item] = next.splice(srcIdx, 1);
  const dstIdx = next.findIndex((s) => s.id === targetId);
  next.splice(insertBefore ? dstIdx : dstIdx + 1, 0, item);
  slides = next;
  refreshUI();
  setStatus('ページを並び替えました。');
});

// ── Page list click ───────────────────────────────────────────────────────────

pageList.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) {
    return;
  }

  const slideId = target.dataset.slideId;
  if (target.dataset.action === 'select') {
    selectSlide(slideId);
  }

  if (target.dataset.action === 'delete') {
    removeSlide(slideId);
  }
});

loadSampleButton.addEventListener('click', async () => {
  await withBusyState(async () => {
    setStatus('サンプル HTML を読み込んでいます...');
    const response = await fetch(SAMPLE_PATH);
    const html = await response.text();
    addSlides([createSlideFromHtml(html, `sample-${slides.length + 1}.html`)]);
    setStatus('サンプルページを追加しました。');
  });
});

exportPngButton.addEventListener('click', exportPng);
exportPdfButton.addEventListener('click', exportPdf);
exportPptxButton.addEventListener('click', exportPptx);

window.addEventListener('resize', () => {
  const activeSlide = getActiveSlide();
  if (activeSlide) {
    fitPreview(activeSlide.dimensions);
  }
});

// ── Pan & zoom ────────────────────────────────────────────────────────────────

const previewStage = document.querySelector('.preview-stage');
let isPanning = false;
let panPointerStart = { x: 0, y: 0 };
let panPzStart = { x: 0, y: 0 };

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

// Wheel to zoom (Ctrl+wheel or plain wheel)
previewStage.addEventListener('wheel', (event) => {
  if (!getActiveSlide()) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
  pz.scale = Math.min(Math.max(pz.scale * factor, ZOOM_MIN / fitScale), ZOOM_MAX / fitScale);
  applyPanZoom();
}, { passive: false });

// Mouse drag to pan
previewStage.addEventListener('mousedown', (event) => {
  if (event.button !== 0 || !getActiveSlide()) return;
  isPanning = true;
  panPointerStart = { x: event.clientX, y: event.clientY };
  panPzStart = { x: pz.panX, y: pz.panY };
  previewStage.classList.add('panning');
  event.preventDefault();
});

window.addEventListener('mousemove', (event) => {
  if (!isPanning) return;
  pz.panX = panPzStart.x + event.clientX - panPointerStart.x;
  pz.panY = panPzStart.y + event.clientY - panPointerStart.y;
  applyPanZoom();
});

window.addEventListener('mouseup', () => {
  if (!isPanning) return;
  isPanning = false;
  previewStage.classList.remove('panning');
});

// Touch drag to pan
previewStage.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1 || !getActiveSlide()) return;
  const t = event.touches[0];
  isPanning = true;
  panPointerStart = { x: t.clientX, y: t.clientY };
  panPzStart = { x: pz.panX, y: pz.panY };
}, { passive: true });

previewStage.addEventListener('touchmove', (event) => {
  if (!isPanning || event.touches.length !== 1) return;
  event.preventDefault();
  const t = event.touches[0];
  pz.panX = panPzStart.x + t.clientX - panPointerStart.x;
  pz.panY = panPzStart.y + t.clientY - panPointerStart.y;
  applyPanZoom();
}, { passive: false });

previewStage.addEventListener('touchend', () => { isPanning = false; });

// Double-click or click scale button to reset
previewStage.addEventListener('dblclick', () => { resetPanZoom(); });
scaleLabel.addEventListener('click', () => { resetPanZoom(); });

refreshUI();
