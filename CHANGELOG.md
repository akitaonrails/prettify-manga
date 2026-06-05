# Changelog

## 0.3.1

- Reopen the reader automatically in Book mode after using the reader's previous/next chapter links.
- Added `Enter` for next chapter and `Backspace` for previous chapter while the reader is active.

## 0.3.0

- Fixed chapter navigation scoring for hyphenated subchapters like `chapter-71-5`, treating them as `71.5` instead of `71`.
- Added regression coverage for decimal/subchapter URL parsing.

## 0.2.3

- Fixed paired spread rendering so manga pages display right-to-left while preserving chronological navigation order.

## 0.2.2

- Added a 4-state night filter: off plus three warmer/dimmer levels for less harsh white pages.
- Added `N` keyboard shortcut and toolbar button for cycling night filter levels.
- Added a host-gated Kindle Web Reader manga helper for Amazon/Kindle country reader domains with page-navigation keys and the same night filter.
- Added a Kindle Web Reader screenshot to the README.
- Documented night filter usage in the README.

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
