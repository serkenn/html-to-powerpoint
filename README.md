# htmltopp

HTML ファイルから **PDF / PPTX / PNG** を生成する Web アプリです。

Cloudflare Pages 上のフロントエンドと、自前サーバーで動かす変換 API（Docker）を Cloudflare Tunnel で繋ぎます。

---

## 機能

| 形式 | 変換場所 | 方式 |
|------|----------|------|
| PNG  | ブラウザ | `html-to-image` でDOM直接レンダリング |
| PDF  | API サーバー | PDFKit でテキスト・図形・SVG・画像を個別描画 |
| PPTX | API サーバー | PptxGenJS でテキストボックス・図形・SVG・画像をネイティブ要素として配置 |

PDF/PPTX はテキストを選択・検索・再編集できるネイティブ要素として出力します。

対応フォント（サーバー側）:
- **Montserrat** (Regular / Medium / SemiBold / Bold / Black)
- **Noto Sans JP** (Regular / Medium / Bold / Black)
- Arial / Helvetica（組み込み）

---

## リポジトリ構成

```
htmltopp/
├── src/                        # Vite フロントエンド
│   ├── main.js                 # SPA ロジック（ファイル読み込み・プレビュー・エクスポート）
│   └── style.css
├── functions/
│   └── api/render/
│       ├── pdf.js              # Cloudflare Pages Function（PDF プロキシ）
│       └── pptx.js             # Cloudflare Pages Function（PPTX プロキシ）
├── public/
│   └── samples/deck.html       # サンプルスライド
├── api/
│   ├── src/server.js           # Express 変換 API
│   ├── Dockerfile
│   ├── docker-compose.yml      # renderer + cloudflared
│   └── cloudflared/
│       └── config.yml.example
├── index.html
└── package.json
```

---

## セットアップ

### 1. API サーバー（自前マシン / VPS）

```bash
cd api
cp .env.example .env          # 環境変数を設定
cp cloudflared/config.yml.example cloudflared/config.yml  # トンネル設定
docker compose up --build
```

**`api/.env` の設定項目:**

| 変数 | 説明 |
|------|------|
| `SHARED_TOKEN` | Pages Functions と共有するランダムな秘密トークン |
| `TUNNEL_TOKEN` | Cloudflare Tunnel のトークン（ダッシュボードで発行） |
| `ALLOWED_ASSET_HOSTS` | 画像取得を許可するホスト名（カンマ区切り）。未設定時は `fonts.googleapis.com,fonts.gstatic.com` |

**`api/cloudflared/config.yml` の設定:**

```yaml
tunnel: htmltopp-renderer
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: your-private-api.example.com  # Tunnel のホスト名
    service: http://renderer:8788
  - service: http_status:404
```

---

### 2. フロントエンド（ローカル開発）

```bash
npm install
cp .dev.vars.example .dev.vars   # API の接続先を設定
npm run dev
```

**`.dev.vars` の設定項目:**

| 変数 | 説明 |
|------|------|
| `API_ORIGIN_URL` | API サーバーの URL（Tunnel 経由の HTTPS URL） |
| `API_SHARED_TOKEN` | API と同じ共有トークン |

```bash
npm run build   # dist/ を生成
```

---

### 3. Cloudflare Pages デプロイ

| 項目 | 値 |
|------|----|
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |

Pages プロジェクトの **環境変数 / シークレット** に以下を追加:

| 変数 | 説明 |
|------|------|
| `API_ORIGIN_URL` | Tunnel で公開した API の URL |
| `API_SHARED_TOKEN` | API と同じ共有トークン |

---

## アーキテクチャ

```
ブラウザ
  │
  │ POST /api/render/pdf (または /pptx)
  ▼
Cloudflare Pages Functions          ← x-shared-token を付与して転送
  │
  │ HTTPS (Cloudflare Tunnel)
  ▼
cloudflared sidecar
  │
  │ HTTP (Docker 内部ネットワーク)
  ▼
renderer (Express + PDFKit / PptxGenJS)
```

ブラウザは API サーバーの実アドレスを知りません。Pages Functions が `API_ORIGIN_URL` へ転送し、`x-shared-token` ヘッダーで認証します。`renderer` は Docker 内部にのみ公開され、外部からは `cloudflared` 経由でしかアクセスできません。

---

## HTML スライドの書き方

変換対象の HTML は以下のルールに従って作成します。

```html
<div class="slide-container" style="position: relative; width: 1280px; height: 720px; overflow: hidden;">

  <!-- テキストボックス -->
  <div data-object-type="textbox"
       style="position: absolute; left: 120px; top: 200px; width: 500px; height: 80px; z-index: 10;">
    <p style="font-family: 'Noto Sans JP', sans-serif; font-size: 32px; font-weight: 700; color: #334155;">
      テキスト
    </p>
  </div>

  <!-- 図形（SVG） -->
  <div style="position: absolute; left: 0; top: 0; width: 600px; height: 720px; z-index: 1;">
    <svg>...</svg>
  </div>

  <!-- 画像 -->
  <div style="position: absolute; left: 200px; top: 300px; width: 400px; height: 300px;">
    <img src="data:image/png;base64,..." />
  </div>

</div>
```

**ルール:**

- ルート要素は `.slide-container` または `[data-slide-root]`
- 各要素は `position: absolute` + `left / top / width / height` を px で指定
- テキストは `data-object-type="textbox"` を付けるか、テキストのみの div
- フォントは `font-family` インラインスタイルで指定（`<link>` の外部 CSS は変換に使われません）
- 画像は `data:` URI を推奨（外部 URL は `ALLOWED_ASSET_HOSTS` で許可が必要）
