# Release checklist

- [ ] `npm test` passes locally.
- [ ] `npm run package` creates `dist/prettify-manga-reader-<version>.zip`.
- [ ] `manifest.json` and `package.json` versions match.
- [ ] `CHANGELOG.md` has an entry for the release version.
- [ ] Manual smoke test in Chrome/Brave with the unpacked extension.

## Install notes

1. Download the release zip.
2. Unzip it into a permanent directory.
3. Open `chrome://extensions` or `brave://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the unzipped directory.

## Manual smoke test

- Reader pill appears on a manga chapter page.
- Extension icon toggles the overlay.
- Single, Double, and Book modes work.
- Double mode joins portrait pages at the center seam.
- Horizontal/two-page images stay single and full-width.
- End-of-chapter navigation appears only for high-confidence links.
