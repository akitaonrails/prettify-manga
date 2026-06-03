# Prettify Manga Reader

<video src="assets/demo.mp4" controls muted loop playsinline width="100%"></video>

Demo video: [`assets/demo.mp4`](assets/demo.mp4)

A Chrome-compatible Manifest V3 extension that turns generic vertical manga chapter pages into a Kindle-like reader. It is built for manga/fansub sites that usually render every page as one long scroll, without hardcoding support for a specific domain.

## What it does

- Adds a toggleable full-screen reader overlay.
- Fits each manga page to the available screen space.
- Supports Single, Double, and Book spread modes.
- Joins paired pages in the middle for seamless two-page art spreads.
- Keeps already-horizontal spread images as single full-width spreads.
- Uses scroll snapping so page/spread navigation lands cleanly.
- Adds keyboard shortcuts and small mouse controls.
- Adds an end-of-chapter card with detected previous/next chapter links when confidence is high.

## Install locally

### From a release zip

1. Download `prettify-manga-reader-<version>.zip` from the release.
2. Unzip it into a permanent directory.
3. Open `chrome://extensions` or `brave://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped directory.

### From source

1. Run `npm test`.
2. Run `npm run package`.
3. Unzip `dist/prettify-manga-reader-<version>.zip`.
4. Load the unzipped directory from `chrome://extensions` with Developer mode enabled.

You can also load this repository directory directly while developing.

## Use

- Click the extension icon, or the small **Reader** pill that appears when a likely manga page sequence is detected.
- Click **Off** or press `Esc` to turn the reader off.
- Press `?` for help inside the reader.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Space`, `PageDown`, `Down`, `Right` | Next page/spread |
| `Shift+Space`, `PageUp`, `Up`, `Left` | Previous page/spread |
| `Home` | Start of chapter |
| `End` | End of chapter / chapter nav card |
| `D` | Cycle `Single → Double → Book` |
| `S` | Toggle scroll snap |
| `?` | Help |
| `Esc` | Close help or turn reader off |

## Reader modes

- **Single**: one fitted page per screen.
- **Double**: pairs portrait pages side-by-side from the start.
- **Book**: keeps the first page alone, then pairs the rest.

Horizontal images, such as scans that already contain a two-page spread, stay as one full-width spread in Double and Book modes.

## Generic detection approach

The extension is not hardcoded to the tested sites. It detects likely manga pages by combining:

- normal and lazy image attributes: `src`, `currentSrc`, `data-src`, `data-lazy-src`, `data-full-image`, `srcset`
- image links around pages
- image preloads
- repeated OpenGraph/Twitter image tags when they form a sequence
- image URLs embedded in `noscript` or inline app payloads
- scoring for large/tall images, sequential filenames, repeated URL families, and `alt="Page N"`
- negative scoring for banners, ads, logos, favicons, avatars, placeholders, and common ad dimensions

Previous/next chapter detection is deliberately conservative. It prefers `rel="prev"` / `rel="next"`, WordPress post navigation, explicit `Previous Chapter` / `Next Chapter` text, or chapter-number links near chapter selectors. It rejects ads, social links, feeds, comments, login/register links, and ordinary pagination like `/page/2`.

## Patterns found in sampled sites

- WordPress/ComicEasel/Blogger-style chapters: repeated `div.separator > a > img`, often numbered `001.jpg`, `002.jpg`, etc.
- Lazy-loaded pages: placeholder SVG in `src`, real image in `data-lazy-src` or `data-src`.
- WordPress block pages: tall `wp-image-*` images named like `01-title-chapter-123.webp`.
- Next.js pages: scan URLs in preloads/app payloads and DOM images with `alt="Page 1"`.

## Files

- `manifest.json`: Chrome MV3 manifest.
- `background.js`: extension-action toggle and fallback content-script injection.
- `content.js`: manga page detection, reader UI, spread layout, shortcuts, chapter navigation.
- `content.css`: overlay, controls, page fitting, double-spread layout.
- `assets/demo.mp4`: optimized showcase video.

## Development and release

```bash
npm test
npm run package
```

The package command writes `dist/prettify-manga-reader-<version>.zip`. Tagged releases named `v<version>` build the zip in GitHub Actions and attach it to the GitHub release.
