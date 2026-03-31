# htmltopp

Cloudflare Pages 上のフロントエンドと、`cloudflared` 越しの変換 API を組み合わせて、HTML から `PDF / PPTX / PNG` を生成する構成です。

## 構成

- `src/`: Vite フロントエンド
- `functions/`: Cloudflare Pages Functions。ブラウザからの変換要求を API に中継
- `api/`: Docker で動かす変換 API と `cloudflared` sidecar

ブラウザは API の実アドレスを直接知りません。`/api/render/*` を叩き、Pages Functions が `API_ORIGIN_URL` に転送します。

## フロントエンド開発

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

`.dev.vars` には以下を設定します。

- `API_ORIGIN_URL`
- `API_SHARED_TOKEN`

`npm run build` で `dist/` を生成します。

## API 開発

```bash
cd api
npm install
cp .env.example .env
cp cloudflared/config.yml.example cloudflared/config.yml
docker compose up --build
```

`api/.env` には以下を設定します。

- `SHARED_TOKEN`: Pages Functions から送る共有トークン
- `TUNNEL_TOKEN`: Cloudflare Tunnel のトークン
- `ALLOWED_ASSET_HOSTS`: Playwright が取得してよい外部アセットのホスト一覧

`renderer` は Docker ネットワーク内でのみ待ち受け、外部公開は `cloudflared` 経由だけです。

## Cloudflare Pages 設定

- Framework preset: `None`
- Build command: `npm run build`
- Build output directory: `dist`

Pages project の環境変数 / シークレット:

- `API_ORIGIN_URL`: `cloudflared` で公開した API URL
- `API_SHARED_TOKEN`: API と一致する共有トークン

## 現在の変換仕様

- `PNG`: ブラウザ内で生成
- `PDF`: API 側で Playwright/Chromium を使って生成
- `PPTX`: API 側でレンダリング結果を 1 スライド画像として格納

`PPTX` はまだネイティブなテキストボックスや図形への分解はしていません。完全な要素編集対応には、HTML から PowerPoint 要素への専用マッピング実装が別途必要です。
