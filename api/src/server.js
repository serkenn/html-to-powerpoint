import fs from 'node:fs';
import express from 'express';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import PptxGenJS from 'pptxgenjs';
import { parse } from 'node-html-parser';
import { imageSize } from 'image-size';
import cors from 'cors';

const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '8788', 10);
const sharedToken = process.env.SHARED_TOKEN || 'local-dev';
const allowedAssetHosts = new Set(
  (process.env.ALLOWED_ASSET_HOSTS || 'fonts.googleapis.com,fonts.gstatic.com')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);


app.use(express.json({ limit: '10mb' }));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-shared-token']
}));

app.options('*', cors());

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

// Auth middleware
app.use((request, response, next) => {
  if (request.method === 'OPTIONS') {
    return next();
  }

  if (request.headers['x-shared-token'] !== sharedToken) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
});

app.post('/api/render/pdf', asyncHandler(async (request, response) => {
  const payload = normalizePayload(request.body, 'pdf');
  const slide = await buildSlideModel(payload);
  const buffer = await renderPdf(slide, payload);

  response
    .status(200)
    .setHeader('content-type', 'application/pdf')
    .setHeader('content-disposition', buildDisposition(payload.fileName, 'pdf'))
    .send(buffer);
}));

app.post('/api/render/pptx', asyncHandler(async (request, response) => {
  const payload = normalizePayload(request.body, 'pptx');
  const buffer = await renderPptx(payload.slides);

  response
    .status(200)
    .setHeader(
      'content-type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
    .setHeader('content-disposition', buildDisposition('presentation', 'pptx'))
    .send(Buffer.from(buffer));
}));

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error.status || 500;
  const message = status < 500 ? error.message : 'Render failed';
  response.status(status).json({ error: message });
});

app.listen(port, host, () => {
  console.log(`htmltopp api listening on ${host}:${port}`);
});

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function normalizePayload(body, format) {
  if (format === 'pptx') {
    // PPTXの場合はslides配列を受け取る
    if (!body || !Array.isArray(body.slides) || body.slides.length === 0) {
      const err = new Error('slides array is required for PPTX');
      err.status = 400;
      throw err;
    }
    return {
      slides: body.slides.map(slide => {
        if (!slide.html || typeof slide.html !== 'string' || !slide.html.trim()) {
          const err = new Error('each slide must have html');
          err.status = 400;
          throw err;
        }
        const width = sanitizeDimension(slide.dimensions?.width, 1280);
        const height = sanitizeDimension(slide.dimensions?.height, 720);
        return {
          html: slide.html,
          fileName: sanitizeBasename(slide.fileName || 'slide'),
          title: String(slide.title || 'Generated Slide'),
          dimensions: { width, height }
        };
      })
    };
  } else {
    // PDF/PNGは従来通り
    if (!body || typeof body.html !== 'string' || !body.html.trim()) {
      const err = new Error('html is required');
      err.status = 400;
      throw err;
    }

    const width = sanitizeDimension(body.dimensions?.width, 1280);
    const height = sanitizeDimension(body.dimensions?.height, 720);

    return {
      html: body.html,
      fileName: sanitizeBasename(body.fileName || 'slide'),
      title: String(body.title || 'Generated Slide'),
      dimensions: { width, height }
    };
  }
}

function sanitizeDimension(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 200), 4000);
}

function sanitizeBasename(input) {
  return String(input).replace(/[^a-zA-Z0-9-_]+/g, '-');
}

function buildDisposition(fileName, extension) {
  return `attachment; filename="${sanitizeBasename(fileName)}.${extension}"`;
}

async function buildSlideModel(payload) {
  const root = parse(payload.html);
  const fontMap = await collectFonts(root);
  const slideRoot = findSlideRoot(root);
  const elements = [];

  for (const child of getRenderableChildren(slideRoot)) {
    const item = await buildRenderableItem(child, fontMap);
    if (item) {
      elements.push(item);
    }
  }

  elements.sort((left, right) => left.zIndex - right.zIndex);
  return { elements, fontMap };
}

function findSlideRoot(root) {
  return (
    root.querySelector('.slide-container') ||
    root.querySelector('[data-slide-root]') ||
    root.querySelector('.embedded-document > div') ||
    root.querySelector('body > div') ||
    root.querySelector('div')
  );
}

function getRenderableChildren(element) {
  if (!element) {
    return [];
  }

  return element.childNodes.filter((child) => child.nodeType === 1);
}

async function buildRenderableItem(element, fontMap) {
  const style = parseStyle(element.getAttribute('style'));
  const frame = buildFrame(style);

  if (!frame) {
    return null;
  }

  const zIndex = Number.parseInt(style['z-index'] || '0', 10) || 0;

  if (isTextElement(element)) {
    const textStyle = findTextStyle(element);
    return {
      type: 'text',
      zIndex,
      frame,
      textRuns: extractTextRuns(element, fontMap),
      align: style['text-align'] || textStyle['text-align'] || 'left',
      opacity: parseOpacity(style.opacity)
    };
  }

  const svg = element.querySelector('svg');
  if (svg) {
    return {
      type: 'svg',
      zIndex,
      frame,
      svgMarkup: svg.toString(),
      opacity: parseOpacity(style.opacity)
    };
  }

  const imageNode = element.tagName === 'IMG' ? element : element.querySelector('img');
  if (imageNode) {
    const imageData = await loadImageData(imageNode.getAttribute('src'));
    if (!imageData) {
      return null;
    }

    return {
      type: 'image',
      zIndex,
      frame,
      ...imageData,
      opacity: parseOpacity(style.opacity)
    };
  }

  const fill = firstColor(style['background'] || style['background-color']);
  if (fill) {
    return {
      type: 'rect',
      zIndex,
      frame,
      fill,
      radius: pxToPt(style['border-radius'] || '0'),
      opacity: parseOpacity(style.opacity)
    };
  }

  return null;
}

function isTextElement(element) {
  if (element.getAttribute('data-object-type') === 'textbox') {
    return true;
  }

  const text = element.textContent?.trim();
  const hasSvg = element.querySelector('svg');
  const hasImage = element.querySelector('img');
  return Boolean(text) && !hasSvg && !hasImage;
}

function buildFrame(style) {
  const left = parsePx(style.left);
  const top = parsePx(style.top);
  const width = parsePx(style.width);
  const height = parsePx(style.height);

  if ([left, top, width, height].some((value) => value === null)) {
    return null;
  }

  return { left, top, width, height };
}

function parseStyle(styleText = '') {
  return styleText
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((styles, part) => {
      const [property, ...valueParts] = part.split(':');
      if (!property || valueParts.length === 0) {
        return styles;
      }

      styles[property.trim().toLowerCase()] = valueParts.join(':').trim();
      return styles;
    }, {});
}

function parsePx(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(String(value).replace('px', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function pxToIn(value) {
  return value / 96;
}

function pxToPt(value) {
  return value * 0.75;
}

function framePxToPt(frame) {
  return {
    left: pxToPt(frame.left),
    top: pxToPt(frame.top),
    width: pxToPt(frame.width),
    height: pxToPt(frame.height)
  };
}

function parseOpacity(value) {
  if (!value) {
    return 1;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 1)) : 1;
}

function firstColor(value) {
  if (!value) {
    return null;
  }

  const rgbMatch = value.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim());
    const [red, green, blue] = parts;
    return rgbToHex(Number(red), Number(green), Number(blue));
  }

  const hexMatch = value.match(/#([0-9a-f]{3,8})/i);
  if (hexMatch) {
    const raw = hexMatch[1];
    if (raw.length === 3) {
      return raw
        .split('')
        .map((char) => char + char)
        .join('')
        .toUpperCase();
    }

    return raw.slice(0, 6).toUpperCase();
  }

  return null;
}

function rgbToHex(red, green, blue) {
  return [red, green, blue]
    .map((channel) => Math.max(0, Math.min(channel, 255)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function findTextStyle(element) {
  const textNode =
    element.querySelector('p') ||
    element.querySelector('span') ||
    element.querySelector('div') ||
    element;
  return parseStyle(textNode.getAttribute('style'));
}

function extractTextRuns(element, fontMap) {
  const paragraphs = element.querySelectorAll('p');
  const targets = paragraphs.length > 0 ? paragraphs : [element];
  const runs = [];

  targets.forEach((node, index) => {
    const inherited = parseStyle(node.getAttribute('style'));
    collectInlineText(node, inherited, runs, fontMap);
    if (index < targets.length - 1) {
      runs.push({ text: '\n', options: { breakLine: true } });
    }
  });

  return runs.filter((run) => run.text);
}

function collectInlineText(node, inheritedStyle, runs, fontMap) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const text = child.rawText;
      if (text) {
        runs.push({
          text,
          options: buildTextOptions(inheritedStyle, fontMap)
        });
      }
      continue;
    }

    if (child.nodeType !== 1) {
      continue;
    }

    const mergedStyle = {
      ...inheritedStyle,
      ...parseStyle(child.getAttribute('style'))
    };
    collectInlineText(child, mergedStyle, runs, fontMap);
  }
}

function buildTextOptions(style, fontMap) {
  const fontFamilies = splitFontFamilies(style['font-family']);
  const fontWeight = Number.parseInt(style['font-weight'] || '400', 10) || 400;
  const chosenFont = pickSupportedFont(fontFamilies, fontMap, fontWeight);
  const fontSize = pxToPt(Number.parseFloat(style['font-size'] || '16'));
  const color = firstColor(style.color) || '000000';

  return {
    fontFace: chosenFont.pptxName,
    fontSize,
    bold: fontWeight >= 600,
    italic: style['font-style'] === 'italic',
    color,
    breakLine: false,
    charSpace: computeCharSpace(style['letter-spacing']),
    fontWeight,
    pdfFont: resolvePdfFont(chosenFont, fontWeight),
    lineHeight: computeLineHeight(style['line-height'], fontSize)
  };
}

function computeCharSpace(letterSpacing) {
  const value = Number.parseFloat(letterSpacing || '0');
  return Number.isFinite(value) ? pxToPt(value) : 0;
}

function computeLineHeight(lineHeight, fontSize) {
  if (!lineHeight) {
    return fontSize * 1.2;
  }

  if (lineHeight.endsWith('px')) {
    return pxToPt(Number.parseFloat(lineHeight));
  }

  const numeric = Number.parseFloat(lineHeight);
  if (Number.isFinite(numeric)) {
    return numeric * fontSize;
  }

  return fontSize * 1.2;
}

function splitFontFamilies(value = '') {
  return value
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function pickSupportedFont(fontFamilies, fontMap, fontWeight = 400) {
  for (const family of fontFamilies) {
    if (fontMap.has(family)) {
      return fontMap.get(family);
    }
  }

  return {
    pptxName: fontFamilies[0] || 'Arial',
    pdfName: 'Helvetica',
    pdfWeights: {
      400: 'Helvetica',
      700: 'Helvetica-Bold'
    }
  };
}

function resolvePdfFont(fontInfo, fontWeight) {
  const weights = fontInfo.pdfWeights || {};
  if (fontWeight >= 900 && weights[900]) {
    return weights[900];
  }
  if (fontWeight >= 700 && weights[700]) {
    return weights[700];
  }
  if (fontWeight >= 600 && weights[600]) {
    return weights[600];
  }
  if (fontWeight >= 500 && weights[500]) {
    return weights[500];
  }
  return weights[400] || fontInfo.pdfName || 'Helvetica';
}

async function collectFonts(root) {
  const map = new Map();
  const montserratFonts = {
    400: resolveSystemFont(['/usr/local/share/fonts/montserrat/Montserrat-Regular.ttf']),
    500: resolveSystemFont(['/usr/local/share/fonts/montserrat/Montserrat-Medium.ttf']),
    600: resolveSystemFont(['/usr/local/share/fonts/montserrat/Montserrat-SemiBold.ttf']),
    700: resolveSystemFont(['/usr/local/share/fonts/montserrat/Montserrat-Bold.ttf']),
    900: resolveSystemFont(['/usr/local/share/fonts/montserrat/Montserrat-Black.ttf'])
  };
  const notoFonts = {
    400: resolveSystemFont([
      '/usr/local/share/fonts/notojp/NotoSansJP-Regular.ttf',
      '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
    ]),
    500: resolveSystemFont(['/usr/local/share/fonts/notojp/NotoSansJP-Medium.ttf']),
    700: resolveSystemFont(['/usr/local/share/fonts/notojp/NotoSansJP-Bold.ttf']),
    900: resolveSystemFont(['/usr/local/share/fonts/notojp/NotoSansJP-Black.ttf'])
  };
  map.set('Arial', {
    pptxName: 'Arial',
    pdfName: 'Helvetica',
    pdfWeights: { 400: 'Helvetica', 700: 'Helvetica-Bold' }
  });
  map.set('Helvetica', {
    pptxName: 'Arial',
    pdfName: 'Helvetica',
    pdfWeights: { 400: 'Helvetica', 700: 'Helvetica-Bold' }
  });
  map.set('sans-serif', {
    pptxName: 'Arial',
    pdfName: notoFonts[400] || 'Helvetica',
    pdfWeights: notoFonts
  });
  if (notoFonts[400]) {
    map.set('Noto Sans JP', { pptxName: 'Noto Sans JP', pdfName: notoFonts[400], pdfWeights: notoFonts });
    map.set('Hiragino Sans', { pptxName: 'Hiragino Sans', pdfName: notoFonts[400], pdfWeights: notoFonts });
  }
  if (montserratFonts[400]) {
    map.set('Montserrat', { pptxName: 'Montserrat', pdfName: montserratFonts[400], pdfWeights: montserratFonts });
  }

  const links = root.querySelectorAll('link');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href || !href.includes('fonts.googleapis.com')) {
      continue;
    }

    const css = await fetchTextAsset(href);
    if (!css) {
      continue;
    }

    const families = [...css.matchAll(/font-family:\s*'([^']+)'/g)].map((match) => match[1]);
    for (const family of families) {
      map.set(family, {
        pptxName: family,
        pdfName:
          family === 'Montserrat' && montserratFonts[400]
            ? montserratFonts[400]
            : family === 'Noto Sans JP' && notoFonts[400]
              ? notoFonts[400]
              : 'Helvetica',
        pdfWeights:
          family === 'Montserrat' && montserratFonts[400]
            ? montserratFonts
            : family === 'Noto Sans JP' && notoFonts[400]
              ? notoFonts
              : { 400: 'Helvetica', 700: 'Helvetica-Bold' }
      });
    }
  }

  const textNodes = root.querySelectorAll('[style]');
  for (const node of textNodes) {
    const style = parseStyle(node.getAttribute('style'));
    for (const family of splitFontFamilies(style['font-family'])) {
      if (!map.has(family)) {
        map.set(family, {
          pptxName: family,
          pdfName:
            family === 'Montserrat' && montserratFonts[400]
              ? montserratFonts[400]
              : family === 'Noto Sans JP' && notoFonts[400]
                ? notoFonts[400]
                : 'Helvetica',
          pdfWeights:
            family === 'Montserrat' && montserratFonts[400]
              ? montserratFonts
              : family === 'Noto Sans JP' && notoFonts[400]
                ? notoFonts
                : { 400: 'Helvetica', 700: 'Helvetica-Bold' }
        });
      }
    }
  }

  return map;
}

async function renderPdf(slide, payload) {
  const pageWidth = pxToPt(payload.dimensions.width);
  const pageHeight = pxToPt(payload.dimensions.height);
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [pageWidth, pageHeight],
    margin: 0
  });
  const chunks = [];

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', (error) => {
    throw error;
  });

  doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });

  for (const item of slide.elements) {
    await drawPdfItem(doc, item, slide.fontMap);
  }

  doc.end();
  await new Promise((resolve) => doc.on('end', resolve));
  return Buffer.concat(chunks);
}

async function drawPdfItem(doc, item, fontMap) {
  const frame = framePxToPt(item.frame);

  if (item.type === 'rect') {
    doc.save();
    doc.fillColor(`#${item.fill}`).fillOpacity(item.opacity);
    doc.roundedRect(frame.left, frame.top, frame.width, frame.height, item.radius).fill();
    doc.restore();
    return;
  }

  if (item.type === 'svg') {
    doc.save();
    doc.fillOpacity(item.opacity).strokeOpacity(item.opacity);
    SVGtoPDF(doc, item.svgMarkup, frame.left, frame.top, {
      width: frame.width,
      height: frame.height,
      assumePt: false
    });
    doc.restore();
    return;
  }

  if (item.type === 'image') {
    doc.save();
    doc.opacity(item.opacity);
    doc.image(item.buffer, frame.left, frame.top, {
      width: frame.width,
      height: frame.height
    });
    doc.restore();
    return;
  }

  if (item.type === 'text') {
    const first = item.textRuns.find((run) => run.text.trim());
    const font = pickSupportedFont(
      splitFontFamilies(first?.options?.fontFace || 'Arial'),
      fontMap,
      first?.options?.fontWeight || 400
    );
    const fontSize = first?.options?.fontSize || 12;
    const lineHeight = first?.options?.lineHeight || fontSize * 1.2;
    const charSpace = first?.options?.charSpace || 0;
    doc.save();
    doc.fillOpacity(item.opacity);
    doc.font(first?.options?.pdfFont || font.pdfName);
    doc.fontSize(fontSize);
    doc.fillColor(`#${first?.options?.color || '000000'}`);

    const measureOptions = { characterSpacing: charSpace };
    const text = normalizeTextRuns(item.textRuns);
    const allLines = wrapTextForPdf(doc, text, frame.width, measureOptions).split('\n');

    // 高さに収まる行だけ抽出
    const visibleLines = [];
    let y = frame.top;
    for (const line of allLines) {
      if (y + lineHeight > frame.top + frame.height) break;
      visibleLines.push({ line, y });
      y += lineHeight;
    }

    // continued: true で全行を同一 BT/ET ブロックに収める
    // → Illustrator でも単一テキスト要素として扱われる
    visibleLines.forEach(({ line, y: lineY }, index) => {
      const isLast = index === visibleLines.length - 1;
      const lineWidth = doc.widthOfString(line, measureOptions);
      let x = frame.left;
      if (item.align === 'center') {
        x = frame.left + Math.max(0, (frame.width - lineWidth) / 2);
      } else if (item.align === 'right') {
        x = frame.left + Math.max(0, frame.width - lineWidth);
      }
      doc.text(line, x, lineY, {
        lineBreak: false,
        continued: !isLast,
        characterSpacing: charSpace
      });
    });

    if (visibleLines.length === 0) {
      doc.text('', frame.left, frame.top, { lineBreak: false });
    }

    doc.restore();
  }
}

function normalizeTextRuns(runs) {
  return runs
    .map((run) => run.text)
    .join('')
    .replace(/\s+\n/g, '\n')
    .trimEnd();
}

function wrapTextForPdf(doc, text, maxWidth, measureOptions) {
  return text
    .split('\n')
    .map((paragraph) => wrapParagraphForPdf(doc, paragraph, maxWidth, measureOptions))
    .join('\n');
}

function wrapParagraphForPdf(doc, text, maxWidth, measureOptions) {
  if (!text) return '';
  let line = '';
  let result = '';
  for (const char of Array.from(text)) {
    const candidate = line + char;
    if (line && doc.widthOfString(candidate, measureOptions) > maxWidth) {
      result += `${line}\n`;
      line = char;
    } else {
      line = candidate;
    }
  }
  return result + line;
}


function resolveSystemFont(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// 複数スライドをpptxで出力してんぞ
async function renderPptx(slides) {
  const pptx = new PptxGenJS();
  // 最初のスライドのdimensionsでレイアウトを定義
  const firstSlide = slides[0];
  const widthInches = firstSlide.dimensions.width / 96;
  const heightInches = firstSlide.dimensions.height / 96;

  pptx.defineLayout({ name: 'CUSTOM', width: widthInches, height: heightInches });
  pptx.layout = 'CUSTOM';
  pptx.author = 'htmltopp-api';
  pptx.title = 'Presentation';
  pptx.subject = 'Generated from HTML';

  for (const slidePayload of slides) {
    const slideModel = await buildSlideModel(slidePayload);
    const pptSlide = pptx.addSlide();
    pptSlide.addText(slidePayload.title, {
      x: 0.5,
      y: 0.2,
      w: widthInches - 1,
      h: 0.5,
      fontSize: 24,
      bold: true
    });

    for (const item of slideModel.elements) {
      await drawPptxItem(pptSlide, item);
    }
  }

  return pptx.write({ outputType: 'nodebuffer' });
}

async function drawPptxItem(slide, item) {
  if (item.type === 'rect') {
    slide.addShape(PptxGenJS.ShapeType.rect, {
      x: pxToIn(item.frame.left),
      y: pxToIn(item.frame.top),
      w: pxToIn(item.frame.width),
      h: pxToIn(item.frame.height),
      fill: { color: item.fill, transparency: (1 - item.opacity) * 100 },
      line: { color: item.fill, transparency: 100 },
      radius: pxToIn(item.radius / 0.75)
    });
    return;
  }

  if (item.type === 'svg') {
    slide.addImage({
      data: `data:image/svg+xml;base64,${Buffer.from(item.svgMarkup).toString('base64')}`,
      x: pxToIn(item.frame.left),
      y: pxToIn(item.frame.top),
      w: pxToIn(item.frame.width),
      h: pxToIn(item.frame.height),
      transparency: (1 - item.opacity) * 100
    });
    return;
  }

  if (item.type === 'image') {
    slide.addImage({
      data: item.dataUrl,
      x: pxToIn(item.frame.left),
      y: pxToIn(item.frame.top),
      w: pxToIn(item.frame.width),
      h: pxToIn(item.frame.height),
      transparency: (1 - item.opacity) * 100
    });
    return;
  }

  if (item.type === 'text') {
    slide.addText(item.textRuns, {
      x: pxToIn(item.frame.left),
      y: pxToIn(item.frame.top),
      w: pxToIn(item.frame.width),
      h: pxToIn(item.frame.height),
      margin: 0,
      valign: 'top',
      align: item.align
    });
  }
}

async function loadImageData(src) {
  if (!src) {
    return null;
  }

  if (src.startsWith('data:')) {
    const buffer = Buffer.from(src.split(',')[1], 'base64');
    return {
      buffer,
      dataUrl: src,
      type: src.slice(5, src.indexOf(';'))
    };
  }

  const response = await fetchAllowed(src);
  if (!response) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const dimensions = imageSize(buffer);
  const contentType = response.headers.get('content-type') || `image/${dimensions.type || 'png'}`;
  return {
    buffer,
    dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    type: contentType
  };
}

async function fetchTextAsset(url) {
  const response = await fetchAllowed(url);
  if (!response || !response.ok) {
    return null;
  }

  return response.text();
}

async function fetchAllowed(url) {
  const target = new URL(url);
  if (!allowedAssetHosts.has(target.hostname)) {
    return null;
  }

  return fetch(target);
}
