# Changelog

## 0.2.1

- Start the reader in Book mode every time it opens.
- Suspend the underlying page from normal painting while the overlay is active instead of deleting site DOM.
- Added regression coverage for the default startup mode.

## 0.2.0

- Added a generic Chrome MV3 manga reader overlay.
- Added Single, Double, and Book spread modes.
- Joined double-page portrait spreads at the center seam.
- Kept already-horizontal two-page scans as singleton full-width spreads.
- Added scroll snapping, keyboard shortcuts, help overlay, and reader controls.
- Added conservative end-of-chapter previous/next navigation detection.
- Added optimized demo video and README usage documentation.
- Added dependency-free validation, unit tests, packaging, and GitHub Actions release workflow.
