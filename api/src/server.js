import express from 'express';
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';

const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '8788', 10);
const sharedToken = process.env.SHARED_TOKEN;
const allowedAssetHosts = new Set(
  (process.env.ALLOWED_ASSET_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
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

app.post('/render/pdf', async (request, response) => {
  const payload = normalizePayload(request.body);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: payload.dimensions,
      deviceScaleFactor: 1
    });

    await attachNetworkPolicy(page);
    await page.setContent(wrapHtmlDocument(payload.html, payload.title), {
      waitUntil: 'networkidle'
    });

    const pdf = await page.pdf({
      width: `${payload.dimensions.width}px`,
      height: `${payload.dimensions.height}px`,
      printBackground: true,
      preferCSSPageSize: true
    });

    response
      .status(200)
      .setHeader('content-type', 'application/pdf')
      .setHeader('content-disposition', buildDisposition(payload.fileName, 'pdf'))
      .send(pdf);
  } finally {
    await browser.close();
  }
});

app.post('/render/pptx', async (request, response) => {
  const payload = normalizePayload(request.body);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: payload.dimensions,
      deviceScaleFactor: 2
    });

    await attachNetworkPolicy(page);
    await page.setContent(wrapHtmlDocument(payload.html, payload.title), {
      waitUntil: 'networkidle'
    });

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false
    });

    const pptx = new PptxGenJS();
    const widthInches = payload.dimensions.width / 96;
    const heightInches = payload.dimensions.height / 96;
    pptx.defineLayout({ name: 'CUSTOM', width: widthInches, height: heightInches });
    pptx.layout = 'CUSTOM';
    pptx.author = 'htmltopp-api';
    pptx.title = payload.title;
    pptx.subject = 'Generated from HTML';
    const slide = pptx.addSlide();
    slide.addImage({
      data: `data:image/png;base64,${screenshot.toString('base64')}`,
      x: 0,
      y: 0,
      w: widthInches,
      h: heightInches
    });

    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    response
      .status(200)
      .setHeader(
        'content-type',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
      .setHeader('content-disposition', buildDisposition(payload.fileName, 'pptx'))
      .send(Buffer.from(buffer));
  } finally {
    await browser.close();
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Render failed' });
});

app.listen(port, host, () => {
  console.log(`htmltopp api listening on ${host}:${port}`);
});

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

function wrapHtmlDocument(bodyHtml, title) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function attachNetworkPolicy(page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') {
      await route.continue();
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      await route.abort();
      return;
    }

    if (allowedAssetHosts.size === 0 || allowedAssetHosts.has(url.hostname)) {
      await route.continue();
      return;
    }

    await route.abort();
  });
}
