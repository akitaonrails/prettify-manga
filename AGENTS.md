# AGENTS.md

## Project overview

This repository contains **Prettify Manga Reader**, a Chrome-compatible Manifest V3 extension. It injects a content-script reader overlay into generic manga chapter pages and reorganizes detected page images into a keyboard-friendly, Kindle-like reading experience.

The core principle is: **do not hardcode for one manga website**. Prefer generic, high-confidence heuristics that work across WordPress, Blogger/CDN-hosted pages, lazy-loaded images, and modern app payloads.

## Important files

- `manifest.json` — Chrome MV3 configuration.
- `background.js` — extension icon click handler and fallback script/CSS injection.
- `content.js` — detection, reader state, spread building, shortcuts, chapter nav detection.
- `content.css` — full-screen overlay, controls, spread/page sizing.
- `README.md` — user-facing docs and demo.
- `assets/demo.mp4` — optimized demo video for README embedding/linking.

## Development rules

- Keep the extension dependency-free unless the user explicitly asks otherwise.
- Do not add site-specific selectors as primary behavior. If adding a selector, make it a generic signal and keep fallback heuristics.
- Avoid brittle assumptions about exact domain names, URL prefixes, or page counts.
- Be conservative with previous/next chapter links. False negatives are better than navigating users to ads, social links, latest-chapter sidebars, comments, feeds, or ordinary pagination.
- Preserve keyboard behavior unless the user explicitly asks to change it.
- Avoid changing extension permissions unless necessary; explain why if you do.
- Do not commit unless the user asks for a commit.

## Validation

Run these checks after JavaScript or manifest changes:

```bash
npm test
python -m json.tool manifest.json >/tmp/pmr-manifest.json
node --check background.js
node --check content.js
```

Build the installable Chromium extension zip with:

```bash
npm run package
```

For video changes, inspect output with:

```bash
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,avg_frame_rate -of json assets/demo.mp4
```

## Manual testing checklist

Load the unpacked extension in Chrome/Brave and test on several manga chapter pages:

- Reader pill appears when a page sequence is detected.
- Extension icon toggles reader on/off.
- Single mode fits one page to viewport.
- Double mode joins two portrait pages at the center seam.
- Book mode keeps the first page alone, then pairs pages.
- Horizontal/two-page spread images stay singleton and use full spread width.
- `Space`, `PageDown`, arrows, `Home`, `End`, `D`, `S`, `?`, and `Esc` work.
- End-of-chapter navigation appears only when previous/next chapter links are high-confidence.
