# Pages Reader

Open Apple Pages (`.pages`) documents on any Mac — no Pages app required.

Drag a `.pages` file into the browser. The app unzips it locally, pulls out the
embedded `Preview.pdf`, and shows it inline. Nothing is uploaded.

Also handles `.key` (Keynote) and `.numbers` (Numbers) since they share the
same archive format.

## How it works

Apple's iWork apps save `.pages` / `.key` / `.numbers` files as zip archives.
Inside is a rendered `Preview.pdf` so Finder and QuickLook can show a
thumbnail. This app:

1. Accepts the file via drag-and-drop or file picker
2. Unzips it in the browser with [JSZip](https://stuk.github.io/jszip/)
3. Looks for `Preview.pdf`, `QuickLook/Preview.pdf`, or `preview.jpg`
4. Renders the result with a native `<embed>` (or `<img>` fallback)
5. Offers "Open in new tab" and "Save as PDF"

If the file was saved with "Include preview in document" disabled, the app
shows a helpful error explaining how to re-export.

## Stack

- Vanilla HTML/CSS/JS — no build step
- JSZip 3.10.1 vendored at `vendor/jszip.min.js`
- PWA: `manifest.json` + `sw.js`
- Deploys to Vercel

## Local dev

```sh
python3 -m http.server 8714
open http://localhost:8714
```

## Privacy

Everything runs in the browser. No server, no upload, no analytics.
