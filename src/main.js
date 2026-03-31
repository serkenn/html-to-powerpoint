import './style.css';
import DOMPurify from 'dompurify';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Cloudflare Pages Ready</p>
        <h1>HTML から PowerPoint / PDF を生成</h1>
        <p class="lede">
          HTML ファイルを読み込み、プレビューし、そのまま 1 スライドの
          PPTX・PDF・PNG に変換してダウンロードできます。
        </p>
      </div>
      <div class="hero-card">
        <div class="metric">
          <span>実行場所</span>
          <strong>ブラウザ内</strong>
        </div>
        <div class="metric">
          <span>デプロイ先</span>
          <strong>Cloudflare Pages</strong>
        </div>
        <div class="metric">
          <span>出力形式</span>
          <strong>PPTX / PDF / PNG</strong>
        </div>
      </div>
    </section>

    <section class="workspace">
      <div class="panel controls">
        <label class="dropzone" id="dropzone">
          <input id="fileInput" type="file" accept=".html,text/html" hidden />
          <span class="dropzone-title">HTML ファイルを選択</span>
          <span class="dropzone-copy">ドラッグ&ドロップにも対応</span>
        </label>

        <div class="actions">
          <button id="loadSampleButton" class="ghost">サンプルを読み込む</button>
          <button id="exportPngButton" disabled>PNG を出力</button>
          <button id="exportPdfButton" disabled>PDF を出力</button>
          <button id="exportPptxButton" disabled>PPTX を出力</button>
        </div>

        <dl class="meta">
          <div>
            <dt>ファイル名</dt>
            <dd id="fileName">未選択</dd>
          </div>
          <div>
            <dt>スライドサイズ</dt>
            <dd id="slideSize">-</dd>
          </div>
          <div>
            <dt>タイトル</dt>
            <dd id="documentTitle">-</dd>
          </div>
        </dl>

        <p class="status" id="status">HTML を読み込むとプレビューを生成します。</p>
      </div>

      <div class="panel preview-panel">
        <div class="preview-toolbar">
          <span>Preview</span>
          <span id="scaleLabel">fit</span>
        </div>
        <div class="preview-stage">
          <div id="slideViewport" class="viewport empty">
            <div id="previewRoot" class="preview-root"></div>
            <p class="placeholder">ここに変換対象の HTML が表示されます。</p>
          </div>
        </div>
      </div>
    </section>
  </main>
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
const status = document.querySelector('#status');
const previewRoot = document.querySelector('#previewRoot');
const slideViewport = document.querySelector('#slideViewport');
const scaleLabel = document.querySelector('#scaleLabel');

let currentFileBase = 'slide';
let currentDimensions = { width: 1280, height: 720 };
let exportModulesPromise;

const SAMPLE_PATH = '/samples/deck.html';

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
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

function buildPreviewMarkup(doc) {
  const headNodes = [...doc.head.children].filter((node) => {
    if (node.tagName === 'SCRIPT') {
      return false;
    }
    if (node.tagName === 'LINK') {
      const rel = node.getAttribute('rel') || '';
      return rel.includes('stylesheet');
    }
    return node.tagName === 'STYLE';
  });

  const bodyMarkup = DOMPurify.sanitize(doc.body.innerHTML, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ['script'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
  });

  return `
    <div class="embedded-document">
      ${headNodes.map((node) => node.outerHTML).join('\n')}
      ${bodyMarkup}
    </div>
  `;
}

function fitPreview(dimensions) {
  const stage = slideViewport.parentElement;
  const { clientWidth, clientHeight } = stage;
  const scale = Math.min(clientWidth / dimensions.width, clientHeight / dimensions.height, 1);
  slideViewport.style.width = `${dimensions.width}px`;
  slideViewport.style.height = `${dimensions.height}px`;
  slideViewport.style.transform = `scale(${scale})`;
  scaleLabel.textContent = `${Math.round(scale * 100)}%`;
}

function renderDocument(html, sourceName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim() || sourceName;
  const dimensions = extractSlideDimensions(doc);
  const previewMarkup = buildPreviewMarkup(doc);

  currentFileBase = sourceName.replace(/\.html?$/i, '') || 'slide';
  currentDimensions = dimensions;
  fileName.textContent = sourceName;
  slideSize.textContent = `${dimensions.width} x ${dimensions.height}`;
  documentTitle.textContent = title;

  previewRoot.innerHTML = previewMarkup;
  slideViewport.classList.remove('empty');
  fitPreview(dimensions);
  setExportEnabled(true);
  setStatus('プレビューを生成しました。PPTX / PDF / PNG を出力できます。');
}

async function loadHtmlText(html, sourceName) {
  try {
    renderDocument(html, sourceName);
  } catch (error) {
    console.error(error);
    setExportEnabled(false);
    setStatus('HTML の解析に失敗しました。レイアウト構造を確認してください。', true);
  }
}

async function readFile(file) {
  const html = await file.text();
  await loadHtmlText(html, file.name);
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportPreviewAsPngBlob() {
  const { toPng } = await loadExportModules();
  const dataUrl = await toPng(previewRoot, {
    cacheBust: true,
    pixelRatio: 2,
    width: currentDimensions.width,
    height: currentDimensions.height,
    canvasWidth: currentDimensions.width * 2,
    canvasHeight: currentDimensions.height * 2
  });

  const response = await fetch(dataUrl);
  return response.blob();
}

async function withBusyState(task) {
  const buttons = [loadSampleButton, exportPngButton, exportPdfButton, exportPptxButton];
  buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    await task();
  } catch (error) {
    console.error(error);
    setStatus('出力に失敗しました。外部画像やフォント参照を確認してください。', true);
  } finally {
    setExportEnabled(Boolean(previewRoot.innerHTML));
    loadSampleButton.disabled = false;
  }
}

async function exportPng() {
  await withBusyState(async () => {
    setStatus('PNG を生成しています...');
    const blob = await exportPreviewAsPngBlob();
    downloadBlob(blob, `${currentFileBase}.png`);
    setStatus('PNG を出力しました。');
  });
}

async function exportPdf() {
  await withBusyState(async () => {
    setStatus('PDF を生成しています...');
    const blob = await exportPreviewAsPngBlob();
    const dataUrl = await blobToDataUrl(blob);
    const { jsPDF } = await loadExportModules();
    const pdf = new jsPDF({
      orientation: currentDimensions.width >= currentDimensions.height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [currentDimensions.width, currentDimensions.height]
    });

    pdf.addImage(dataUrl, 'PNG', 0, 0, currentDimensions.width, currentDimensions.height);
    pdf.save(`${currentFileBase}.pdf`);
    setStatus('PDF を出力しました。');
  });
}

async function exportPptx() {
  await withBusyState(async () => {
    setStatus('PPTX を生成しています...');
    const blob = await exportPreviewAsPngBlob();
    const dataUrl = await blobToDataUrl(blob);
    const { PptxGenJS } = await loadExportModules();
    const pptx = new PptxGenJS();
    const widthInches = currentDimensions.width / 96;
    const heightInches = currentDimensions.height / 96;

    pptx.defineLayout({
      name: 'CUSTOM',
      width: widthInches,
      height: heightInches
    });
    pptx.layout = 'CUSTOM';
    pptx.author = 'htmltopp';
    pptx.subject = 'Generated from HTML';
    pptx.title = documentTitle.textContent || currentFileBase;
    const slide = pptx.addSlide();
    slide.background = { color: 'F5F1E8' };
    slide.addImage({ data: dataUrl, x: 0, y: 0, w: widthInches, h: heightInches });
    await pptx.writeFile({ fileName: `${currentFileBase}.pptx` });
    setStatus('PPTX を出力しました。');
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
  const [file] = event.dataTransfer.files;
  if (file) {
    await readFile(file);
  }
});

fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (file) {
    await readFile(file);
  }
});

loadSampleButton.addEventListener('click', async () => {
  await withBusyState(async () => {
    setStatus('サンプル HTML を読み込んでいます...');
    const response = await fetch(SAMPLE_PATH);
    const html = await response.text();
    await loadHtmlText(html, 'sample-deck.html');
  });
});

exportPngButton.addEventListener('click', exportPng);
exportPdfButton.addEventListener('click', exportPdf);
exportPptxButton.addEventListener('click', exportPptx);

window.addEventListener('resize', () => fitPreview(currentDimensions));
