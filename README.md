# htmltopp

HTML ファイルから `PPTX` / `PDF` / `PNG` を生成する、Cloudflare Pages 向けのアプリです。

## 開発

```bash
npm install
npm run dev
```

## フロントエンドのビルド

```bash
npm run build
```

Cloudflare Pages では以下を指定します。

- Build command: `npm run build`
- Build output directory: `dist`

Pages Functions には以下のシークレットを設定します。

- `API_ORIGIN_URL`: `cloudflared` で公開した API の URL
- `API_SHARED_TOKEN`: Pages Function から API を叩くための共有トークン

ローカル開発では [`.dev.vars.example`](/Users/serken/htmltopp/.dev.vars.example) を元に `.dev.vars` を作成します。

## API サーバー

`api/` には Docker 化した変換 API と `cloudflared` sidecar を用意しています。

```bash
cd api
cp .env.example .env
cp cloudflared/config.yml.example cloudflared/config.yml
docker compose up --build
```

ポイント:

- API 本体は `renderer:8788` で Docker ネットワーク内のみ待ち受けます。
- 外部から見える入口は `cloudflared` トンネルだけです。
- ブラウザは API を直接知らず、`/api/render/*` の Pages Function 経由で呼びます。
- 共有トークンが一致しないと API は応答しません。

## メモ

- `PDF` はサーバー側で Chromium による出力へ切り替えました。
- `PPTX` は現在もサーバー側でレンダリングした画像を 1 スライドに載せる MVP です。
- 完全なネイティブ PowerPoint 要素変換は別途 HTML-to-PPT マッピング実装が必要です。
