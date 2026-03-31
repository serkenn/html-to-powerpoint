import fs from 'node:fs';
import express from 'express';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import PptxGenJS from 'pptxgenjs';
import { parse } from 'node-html-parser';
import { imageSize } from 'image-size';

const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '8788', 10);
const sharedToken = process.env.SHARED_TOKEN;
const allowedAssetHosts = new Set(
  (process.env.ALLOWED_ASSET_HOSTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

if (!sharedToken) {
  throw new Error('SHARED_TOKEN is required.');
}

app.use(express.json({ limit: '10mb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

app.use((request, response, next) => {
  if (request.headers['x-shared-token'] !== sharedToken) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
});

app.post('/render/pdf', asyncHandler(async (request, response) => {
  const payload = normalizePayload(request.body);
  const slide = await buildSlideModel(payload);
  const buffer = await renderPdf(slide, payload);

  response
    .status(200)
    .setHeader('content-type', 'application/pdf')
    .setHeader('content-disposition', buildDisposition(payload.fileName, 'pdf'))
    .send(buffer);
}));

app.post('/render/pptx', asyncHandler(async (request, response) => {
  const payload = normalizePayload(request.body);
  const slide = await buildSlideModel(payload);
  const buffer = await renderPptx(slide, payload);

  response
    .status(200)
    .setHeader(
      'content-type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
    .setHeader('content-disposition', buildDisposition(payload.fileName, 'pptx'))
    .send(Buffer.from(buffer));
}));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: error.message || 'Render failed' });
});

app.listen(port, host, () => {
  console.log(`htmltopp api listening on ${host}:${port}`);
});

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function normalizePayload(body) {
  if (!body || typeof body.html !== 'string' || !body.html.trim()) {
    throw new Error('html is required');
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
  const chosenFont = pickSupportedFont(fontFamilies, fontMap);
  const color = firstColor(style.color) || '000000';

  return {
    fontFace: chosenFont.pptxName,
    fontSize: pxToPt(Number.parseFloat(style['font-size'] || '16')),
    bold: Number.parseInt(style['font-weight'] || '400', 10) >= 600,
    italic: style['font-style'] === 'italic',
    color,
    breakLine: false,
    charSpace: computeCharSpace(style['letter-spacing'])
  };
}

function computeCharSpace(letterSpacing) {
  const value = Number.parseFloat(letterSpacing || '0');
  return Number.isFinite(value) ? pxToPt(value) : 0;
}

function splitFontFamilies(value = '') {
  return value
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function pickSupportedFont(fontFamilies, fontMap) {
  for (const family of fontFamilies) {
    if (fontMap.has(family)) {
      return fontMap.get(family);
    }
  }

  return {
    pptxName: fontFamilies[0] || 'Arial',
    pdfName: 'Helvetica'
  };
}

async function collectFonts(root) {
  const map = new Map();
  const notoFontPath = resolveSystemFont([
    '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf'
  ]);
  map.set('Arial', { pptxName: 'Arial', pdfName: 'Helvetica' });
  map.set('Helvetica', { pptxName: 'Arial', pdfName: 'Helvetica' });
  map.set('sans-serif', {
    pptxName: 'Arial',
    pdfName: notoFontPath || 'Helvetica'
  });
  if (notoFontPath) {
    map.set('Noto Sans JP', { pptxName: 'Noto Sans JP', pdfName: notoFontPath });
    map.set('Hiragino Sans', { pptxName: 'Hiragino Sans', pdfName: notoFontPath });
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
        pdfName: family === 'Noto Sans JP' && notoFontPath ? notoFontPath : 'Helvetica'
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
          pdfName: family === 'Noto Sans JP' && notoFontPath ? notoFontPath : 'Helvetica'
        });
      }
    }
  }

  return map;
}

async function renderPdf(slide, payload) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [payload.dimensions.width, payload.dimensions.height],
    margin: 0
  });
  const chunks = [];

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', (error) => {
    throw error;
  });

  doc.addPage({ size: [payload.dimensions.width, payload.dimensions.height], margin: 0 });

  for (const item of slide.elements) {
    await drawPdfItem(doc, item, slide.fontMap);
  }

  doc.end();
  await new Promise((resolve) => doc.on('end', resolve));
  return Buffer.concat(chunks);
}

async function drawPdfItem(doc, item, fontMap) {
  if (item.type === 'rect') {
    doc.save();
    doc.fillColor(`#${item.fill}`).fillOpacity(item.opacity);
    doc.roundedRect(item.frame.left, item.frame.top, item.frame.width, item.frame.height, item.radius).fill();
    doc.restore();
    return;
  }

  if (item.type === 'svg') {
    doc.save();
    doc.fillOpacity(item.opacity).strokeOpacity(item.opacity);
    SVGtoPDF(doc, item.svgMarkup, item.frame.left, item.frame.top, {
      width: item.frame.width,
      height: item.frame.height,
      assumePt: false
    });
    doc.restore();
    return;
  }

  if (item.type === 'image') {
    doc.save();
    doc.opacity(item.opacity);
    doc.image(item.buffer, item.frame.left, item.frame.top, {
      width: item.frame.width,
      height: item.frame.height
    });
    doc.restore();
    return;
  }

  if (item.type === 'text') {
    const first = item.textRuns.find((run) => run.text.trim());
    const font = pickSupportedFont(splitFontFamilies(first?.options?.fontFace || 'Arial'), fontMap);
    doc.save();
    doc.fillOpacity(item.opacity);
    doc.font(font.pdfName);
    doc.fontSize(first?.options?.fontSize || 12);
    doc.fillColor(`#${first?.options?.color || '000000'}`);
    doc.text(
      normalizeTextRuns(item.textRuns),
      item.frame.left,
      item.frame.top,
      {
        width: item.frame.width,
        height: item.frame.height,
        align: item.align
      }
    );
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

function resolveSystemFont(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function renderPptx(slide, payload) {
  const pptx = new PptxGenJS();
  const widthInches = payload.dimensions.width / 96;
  const heightInches = payload.dimensions.height / 96;

  pptx.defineLayout({ name: 'CUSTOM', width: widthInches, height: heightInches });
  pptx.layout = 'CUSTOM';
  pptx.author = 'htmltopp-api';
  pptx.title = payload.title;
  pptx.subject = 'Generated from HTML';

  const pptSlide = pptx.addSlide();

  for (const item of slide.elements) {
    await drawPptxItem(pptSlide, item);
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
  if (allowedAssetHosts.size > 0 && !allowedAssetHosts.has(target.hostname)) {
    return null;
  }

  return fetch(target);
}
