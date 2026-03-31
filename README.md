# htmltopp

HTML ファイルから `PPTX` / `PDF` / `PNG` を生成する、Cloudflare Pages 向けのフロントエンドです。

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

Cloudflare Pages では以下を指定します。

- Build command: `npm run build`
- Build output directory: `dist`

## メモ

- 変換はサーバー側ではなくブラウザ内で実行します。
- 現状の `PPTX` / `PDF` は HTML を画像化して 1 ページに載せる MVP です。
- 複数スライド対応や要素単位での PowerPoint ネイティブ変換は、次段階で追加できます。
