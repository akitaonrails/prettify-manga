# Prettify Manga Reader

A Chrome-compatible Manifest V3 extension that adds a Kindle-like reader overlay to generic manga chapter pages.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this directory.

## Use

- Click the extension icon, or the small **Reader** pill that appears when a likely manga page sequence is detected.
- Click **Off** or press `Esc` to turn it off.
- Press `?` for the in-reader help overlay.

## Shortcuts

- `Space`, `PageDown`, `Down`, `Right`: next page/spread
- `Shift+Space`, `PageUp`, `Up`, `Left`: previous page/spread
- `Home` / `End`: start/end of chapter
- `D`: cycle `Single → Double → Book`
- `S`: toggle scroll snap
- `?`: help
- `Esc`: close help or turn reader off

## Detection approach

The extension is not hardcoded to the sample sites. It detects likely manga pages by combining:

- normal and lazy image attributes (`src`, `currentSrc`, `data-src`, `data-lazy-src`, `data-full-image`, `srcset`)
- image links around pages
- image preloads
- repeated OpenGraph/Twitter image tags when they form a sequence
- image URLs embedded in `noscript` or inline app payloads
- scoring for large/tall images, sequential filenames, repeated URL families, and `alt="Page N"`
- negative scoring for banners, ads, logos, favicons, avatars, placeholders, and common ad dimensions

The examples showed these common patterns:

- WordPress/ComicEasel/Blogger-style pages: repeated `div.separator > a > img`, often numbered `001.jpg`, `002.jpg`, etc.
- Lazy-loaded pages: placeholder SVG in `src`, real image in `data-lazy-src` or `data-src`.
- WordPress block pages: tall `wp-image-*` images named like `01-title-chapter-123.webp`.
- Next.js pages: scan URLs in preloads/app payloads and DOM images with `alt="Page 1"`.
