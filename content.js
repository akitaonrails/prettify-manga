(function () {
  "use strict";

  if (window.__PRETTIFY_MANGA_READER_LOADED__) {
    return;
  }
  window.__PRETTIFY_MANGA_READER_LOADED__ = true;

  const ROOT_ID = "pmr-reader-root";
  const ACTIVATOR_ID = "pmr-reader-activator";
  const TOAST_ID = "pmr-reader-toast";
  const STORAGE_KEY = "pmr.settings.v1";
  const DEFAULT_READER_MODE = "book";
  const DEFAULT_NIGHT_MODE = 0;
  const NIGHT_MODE_LEVELS = 3;
  const MODES = ["single", "double", "book"];
  const MODE_LABELS = {
    single: "Single",
    double: "Double",
    book: "Book"
  };
  const NIGHT_MODE_LABELS = ["Night Off", "Night 1", "Night 2", "Night 3"];
  const IMAGE_ATTRS = [
    "currentSrc",
    "src",
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-original-src",
    "data-full-image",
    "data-light-image",
    "data-image",
    "data-url"
  ];
  const SRCSET_ATTRS = ["srcset", "data-srcset", "data-lazy-srcset"];
  const IMAGE_URL_RE = /(?:https?:\/\/|\/\/|\/|(?:\.{1,2}\/)?[a-z0-9_.-]+\/)[^"'()<>\s\\]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'()<>\s\\]*)?/gi;
  const BAD_URL_RE = /(?:^|[\/_.-])(?:ad|ads|advert|advertisement|banner|logo|avatar|favicon|sprite|icon|placeholder|loader|tracking|pixel|analytics)(?:[\/_.-]|$)/i;
  const COMMON_AD_SIZES = new Set([
    "728x90",
    "970x90",
    "970x250",
    "320x50",
    "300x50",
    "300x250",
    "336x280",
    "160x600",
    "120x600"
  ]);
  // Heuristic thresholds live here so release audits can reason about them
  // without hunting through detection, layout, and navigation code.
  const MIN_DETECTED_PAGES = 3;
  const LANDSCAPE_SPREAD_RATIO = 1.12;
  const MAX_SELECTED_PAGES = 240;
  const MAX_REASONABLE_PAGE_NUMBER = 240;
  const EMBEDDED_SCAN_MAX_BYTES = 2_000_000;
  const EMBEDDED_SCRIPT_MAX_BYTES = 700_000;
  const CHAPTER_NAV_HIGH_CONFIDENCE = 80;
  const CHAPTER_NAV_CONTEXT_CONFIDENCE = 45;
  const CHAPTER_NAV_REL_SCORE = 110;
  const CHAPTER_NAV_TEXT_SCORE = 85;
  const CHAPTER_NAV_SCOPE_SIGNAL_SCORE = 45;
  const CHAPTER_NAV_ICON_CONTEXT_SCORE = 35;
  const CHAPTER_NAV_ICON_WEAK_SCORE = 15;
  const CHAPTER_NAV_WRONG_DIRECTION_PENALTY = 70;
  const CHAPTER_NAV_HTML_SAMPLE_CHARS = 900;
  const READABLE_TITLE_MAX_CHARS = 80;
  const ELEMENT_SIGNATURE_MAX_CHARS = 80;
  const ACTIVATOR_INITIAL_DELAY_MS = 700;
  const ACTIVATOR_PAGESHOW_DELAY_MS = 500;
  const ACTIVATOR_AFTER_CLOSE_DELAY_MS = 400;
  const ACTIVATOR_MUTATION_DELAY_MS = 900;
  const ACTIVATOR_MAX_MUTATION_REFRESHES = 12;
  const LAYOUT_REFRESH_DELAY_MS = 80;
  const TOAST_DURATION_MS = 2200;

  let settings = {
    mode: DEFAULT_READER_MODE,
    snap: true,
    night: DEFAULT_NIGHT_MODE
  };
  let settingsLoaded = false;
  let active = false;
  let pages = [];
  let spreads = [];
  let chapterNav = null;
  let currentSpreadIndex = 0;
  let readerRoot = null;
  let scrollEl = null;
  let mutationObserver = null;
  let activatorRefreshTimer = 0;
  let scrollRaf = 0;
  let layoutRefreshTimer = 0;

  loadSettings();
  scheduleActivatorRefresh(ACTIVATOR_INITIAL_DELAY_MS);
  observeEarlyMutations();
  window.addEventListener("pageshow", () => scheduleActivatorRefresh(ACTIVATOR_PAGESHOW_DELAY_MS), { passive: true });

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== "PMR_TOGGLE") {
        return false;
      }

      Promise.resolve(toggleReader())
        .then(sendResponse)
        .catch((error) => {
          console.warn("Prettify Manga Reader toggle failed", error);
          sendResponse({ active: false, pages: 0, error: String(error?.message || error) });
        });
      return true;
    });
  }

  async function loadSettings() {
    if (!chrome?.storage?.local) {
      settingsLoaded = true;
      return settings;
    }

    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const next = stored?.[STORAGE_KEY];
      if (next && typeof next === "object") {
        settings = {
          mode: MODES.includes(next.mode) ? next.mode : settings.mode,
          snap: typeof next.snap === "boolean" ? next.snap : settings.snap,
          night: isValidNightMode(next.night) ? next.night : settings.night
        };
      }
    } catch (error) {
      console.warn("Prettify Manga Reader could not load settings", error);
    } finally {
      settingsLoaded = true;
    }
    return settings;
  }

  function saveSettings() {
    if (!settingsLoaded || !chrome?.storage?.local) {
      return;
    }
    chrome.storage.local.set({ [STORAGE_KEY]: settings }).catch((error) => {
      console.warn("Prettify Manga Reader could not save settings", error);
    });
  }

  async function toggleReader() {
    await loadSettings();
    if (active) {
      deactivateReader();
      return { active: false, pages: pages.length };
    }
    activateReader();
    return { active, pages: pages.length };
  }

  function activateReader() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    window.clearTimeout(activatorRefreshTimer);

    const detected = collectMangaPages({ includeEmbedded: true });
    if (detected.length < MIN_DETECTED_PAGES) {
      showToast("No manga page sequence found on this page.");
      return;
    }

    pages = detected;
    chapterNav = detectChapterNav();
    settings.mode = DEFAULT_READER_MODE;
    active = true;
    currentSpreadIndex = 0;
    removeActivator();
    removeReaderRoot();

    readerRoot = document.createElement("div");
    readerRoot.id = ROOT_ID;
    readerRoot.setAttribute("role", "dialog");
    readerRoot.setAttribute("aria-label", "Prettify Manga Reader");

    const toolbar = document.createElement("div");
    toolbar.className = "pmr-toolbar";
    toolbar.innerHTML = [
      '<button class="pmr-button" type="button" data-pmr-action="prev" title="Previous page/spread">‹</button>',
      '<span class="pmr-indicator" data-pmr-indicator>1 / 1</span>',
      '<button class="pmr-button" type="button" data-pmr-action="next" title="Next page/spread">›</button>',
      '<button class="pmr-button" type="button" data-pmr-action="mode" title="Cycle single/double/book modes">Mode</button>',
      '<button class="pmr-button" type="button" data-pmr-action="snap" title="Toggle scroll snap">Snap</button>',
      '<button class="pmr-button" type="button" data-pmr-action="night" title="Cycle night filter strength">Night</button>',
      '<button class="pmr-button" type="button" data-pmr-action="help" title="Keyboard shortcuts">?</button>',
      '<button class="pmr-button pmr-button-primary" type="button" data-pmr-action="close" title="Turn reader off">Off</button>'
    ].join("");

    scrollEl = document.createElement("div");
    scrollEl.className = "pmr-scroll";
    scrollEl.setAttribute("tabindex", "-1");

    const help = document.createElement("div");
    help.className = "pmr-help-backdrop";
    help.innerHTML = helpDialogMarkup();

    readerRoot.append(toolbar, scrollEl, help);
    document.documentElement.appendChild(readerRoot);
    document.documentElement.classList.add("pmr-reader-active");

    toolbar.addEventListener("click", handleToolbarClick);
    help.addEventListener("click", (event) => {
      if (event.target === help || event.target.closest("[data-pmr-action='help-close']")) {
        toggleHelp(false);
      }
    });
    scrollEl.addEventListener("scroll", handleReaderScroll, { passive: true });
    document.addEventListener("keydown", handleKeyDown, true);

    renderSpreads(0);
    scrollEl.focus({ preventScroll: true });
    showToast(`Reader on: ${pages.length} pages detected.`);
  }

  function deactivateReader() {
    active = false;
    window.clearTimeout(layoutRefreshTimer);
    chapterNav = null;
    document.removeEventListener("keydown", handleKeyDown, true);
    document.documentElement.classList.remove("pmr-reader-active");
    removeReaderRoot();
    scheduleActivatorRefresh(ACTIVATOR_AFTER_CLOSE_DELAY_MS);
  }

  function removeReaderRoot() {
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      existing.remove();
    }
    readerRoot = null;
    scrollEl = null;
  }

  function handleToolbarClick(event) {
    const button = event.target.closest("[data-pmr-action]");
    if (!button) {
      return;
    }
    const action = button.getAttribute("data-pmr-action");
    if (action === "prev") goToSpread(currentSpreadIndex - 1);
    if (action === "next") goToSpread(currentSpreadIndex + 1);
    if (action === "mode") cycleMode();
    if (action === "snap") toggleSnap();
    if (action === "night") cycleNightMode();
    if (action === "help") toggleHelp();
    if (action === "close") deactivateReader();
  }

  function handleKeyDown(event) {
    if (!active || isEditableTarget(event.target)) {
      return;
    }

    const key = event.key;
    const helpOpen = readerRoot?.classList.contains("pmr-help-open");

    if (key === "Escape") {
      event.preventDefault();
      if (helpOpen) toggleHelp(false);
      else deactivateReader();
      return;
    }

    if (key === "?" || (key === "/" && event.shiftKey)) {
      event.preventDefault();
      toggleHelp();
      return;
    }

    if (helpOpen) {
      return;
    }

    if (key === "d" || key === "D") {
      event.preventDefault();
      cycleMode();
      return;
    }

    if (key === "s" || key === "S") {
      event.preventDefault();
      toggleSnap();
      return;
    }

    if (key === "n" || key === "N") {
      event.preventDefault();
      cycleNightMode();
      return;
    }

    if (key === "Home") {
      event.preventDefault();
      goToSpread(0);
      return;
    }

    if (key === "End") {
      event.preventDefault();
      goToSpread(spreads.length - 1);
      return;
    }

    if (key === "PageDown" || key === "ArrowDown" || key === "ArrowRight" || (key === " " && !event.shiftKey)) {
      event.preventDefault();
      goToSpread(currentSpreadIndex + 1);
      return;
    }

    if (key === "PageUp" || key === "ArrowUp" || key === "ArrowLeft" || (key === " " && event.shiftKey)) {
      event.preventDefault();
      goToSpread(currentSpreadIndex - 1);
    }
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable || target.closest("[contenteditable='true'], [role='textbox']");
  }

  function cycleMode() {
    const currentPage = spreads[currentSpreadIndex]?.pageIndexes?.[0] || 0;
    const nextIndex = (MODES.indexOf(settings.mode) + 1) % MODES.length;
    settings.mode = MODES[nextIndex];
    saveSettings();
    renderSpreads(currentPage);
    showToast(`Mode: ${MODE_LABELS[settings.mode]}`);
  }

  function toggleSnap() {
    settings.snap = !settings.snap;
    saveSettings();
    updateRootClasses();
    updateToolbar();
    showToast(`Scroll snap ${settings.snap ? "on" : "off"}.`);
  }

  function cycleNightMode() {
    settings.night = (settings.night + 1) % (NIGHT_MODE_LEVELS + 1);
    saveSettings();
    updateRootClasses();
    updateToolbar();
    showToast(NIGHT_MODE_LABELS[settings.night]);
  }

  function isValidNightMode(value) {
    return Number.isInteger(value) && value >= 0 && value <= NIGHT_MODE_LEVELS;
  }

  function toggleHelp(force) {
    if (!readerRoot) {
      return;
    }
    const shouldOpen = typeof force === "boolean" ? force : !readerRoot.classList.contains("pmr-help-open");
    readerRoot.classList.toggle("pmr-help-open", shouldOpen);
  }

  function renderSpreads(targetPageIndex = 0) {
    if (!readerRoot || !scrollEl) {
      return;
    }
    spreads = buildSpreads(settings.mode, pages);
    scrollEl.replaceChildren();

    spreads.forEach((spread, spreadIndex) => {
      if (spread.type === "chapter-nav") {
        scrollEl.appendChild(createChapterNavSpread(spreadIndex));
        return;
      }

      const section = document.createElement("section");
      const isSingleton = spread.pageIndexes.length === 1;
      const isLandscape = isSingleton && isLandscapePage(pages[spread.pageIndexes[0]]);
      section.className = ["pmr-spread", isSingleton ? "pmr-singleton" : "", isLandscape ? "pmr-landscape" : ""].filter(Boolean).join(" ");
      section.dataset.spreadIndex = String(spreadIndex);
      section.dataset.pageStart = String(spread.pageIndexes[0] + 1);
      section.setAttribute("aria-label", spreadLabel(spread));

      spread.pageIndexes.forEach((pageIndex) => {
        const page = pages[pageIndex];
        const figure = document.createElement("figure");
        figure.className = "pmr-page";
        figure.dataset.pageIndex = String(pageIndex + 1);

        const image = document.createElement("img");
        image.src = page.url;
        image.alt = page.alt || `Manga page ${pageIndex + 1}`;
        image.decoding = "async";
        image.loading = spreadIndex <= 1 ? "eager" : "lazy";
        image.draggable = false;
        image.addEventListener("load", () => recordLoadedPageSize(pageIndex, image), { once: true });
        figure.appendChild(image);
        section.appendChild(figure);
      });

      scrollEl.appendChild(section);
    });

    updateRootClasses();
    const nextSpreadIndex = findSpreadForPage(targetPageIndex);
    currentSpreadIndex = nextSpreadIndex;
    updateToolbar();
    requestAnimationFrame(() => goToSpread(nextSpreadIndex, "auto"));
  }

  function buildSpreads(mode, pageList) {
    const result = [];
    if (mode === "single") {
      pageList.forEach((_page, index) => result.push({ pageIndexes: [index] }));
      appendChapterNavSpread(result);
      return result;
    }

    let index = 0;
    if (mode === "book" && pageList.length > 0) {
      result.push({ pageIndexes: [0] });
      index = 1;
    }

    while (index < pageList.length) {
      if (isLandscapePage(pageList[index])) {
        result.push({ pageIndexes: [index] });
        index += 1;
        continue;
      }

      const pair = [index];
      if (index + 1 < pageList.length && !isLandscapePage(pageList[index + 1])) {
        pair.push(index + 1);
      }
      result.push({ pageIndexes: pair });
      index += pair.length;
    }

    appendChapterNavSpread(result);
    return result;
  }

  function appendChapterNavSpread(spreadList) {
    if (chapterNav?.prev || chapterNav?.next) {
      spreadList.push({ type: "chapter-nav", pageIndexes: [] });
    }
  }

  function createChapterNavSpread(spreadIndex) {
    const section = document.createElement("section");
    section.className = "pmr-spread pmr-chapter-nav-spread";
    section.dataset.spreadIndex = String(spreadIndex);
    section.setAttribute("aria-label", "Chapter navigation");

    const card = document.createElement("div");
    card.className = "pmr-chapter-nav-card";

    const heading = document.createElement("h2");
    heading.textContent = "End of chapter";

    const summary = document.createElement("p");
    summary.textContent = `${pages.length} page${pages.length === 1 ? "" : "s"} detected.`;

    const actions = document.createElement("div");
    actions.className = "pmr-chapter-nav-actions";

    if (chapterNav?.prev) {
      actions.appendChild(createChapterNavLink(chapterNav.prev, "prev", "‹ Previous chapter"));
    }
    if (chapterNav?.next) {
      actions.appendChild(createChapterNavLink(chapterNav.next, "next", "Next chapter ›"));
    }

    card.append(heading, summary, actions);
    section.appendChild(card);
    return section;
  }

  function createChapterNavLink(link, rel, fallbackText) {
    const anchor = document.createElement("a");
    anchor.className = `pmr-button pmr-chapter-link pmr-chapter-link-${rel}`;
    anchor.href = link.url;
    anchor.rel = rel;
    anchor.textContent = fallbackText;
    anchor.title = link.title || fallbackText;
    return anchor;
  }

  function isLandscapePage(page) {
    const width = Number(page?.width || 0);
    const height = Number(page?.height || 0);
    return width > 0 && height > 0 && width / height >= LANDSCAPE_SPREAD_RATIO;
  }

  function recordLoadedPageSize(pageIndex, image) {
    const page = pages[pageIndex];
    if (!page || !image.naturalWidth || !image.naturalHeight) {
      return;
    }

    const wasLandscape = isLandscapePage(page);
    page.width = image.naturalWidth;
    page.height = image.naturalHeight;

    const isLandscape = isLandscapePage(page);
    if (settings.mode !== "single" && wasLandscape !== isLandscape) {
      scheduleSpreadLayoutRefresh(pageIndex);
    }
  }

  function scheduleSpreadLayoutRefresh(pageIndex) {
    window.clearTimeout(layoutRefreshTimer);
    layoutRefreshTimer = window.setTimeout(() => {
      if (!active || !readerRoot || !scrollEl) {
        return;
      }
      const currentPage = spreads[currentSpreadIndex]?.pageIndexes?.[0] ?? pageIndex;
      renderSpreads(currentPage);
    }, LAYOUT_REFRESH_DELAY_MS);
  }

  function spreadLabel(spread) {
    if (spread.type === "chapter-nav") {
      return "Chapter navigation";
    }
    const labels = spread.pageIndexes.map((index) => index + 1);
    return labels.length === 1 ? `Page ${labels[0]}` : `Pages ${labels[0]} and ${labels[1]}`;
  }

  function findSpreadForPage(pageIndex) {
    const clampedPage = Math.max(0, Math.min(pageIndex, pages.length - 1));
    const exact = spreads.findIndex((spread) => spread.pageIndexes.includes(clampedPage));
    if (exact >= 0) {
      return exact;
    }
    return Math.max(0, Math.min(currentSpreadIndex, spreads.length - 1));
  }

  function goToSpread(index, behavior = "smooth") {
    if (!scrollEl || spreads.length === 0) {
      return;
    }
    const next = Math.max(0, Math.min(index, spreads.length - 1));
    const child = scrollEl.children[next];
    if (!child) {
      return;
    }
    currentSpreadIndex = next;
    updateToolbar();
    scrollEl.scrollTo({ top: child.offsetTop, behavior });
  }

  function handleReaderScroll() {
    if (scrollRaf) {
      return;
    }
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!scrollEl) {
        return;
      }

      let closestIndex = currentSpreadIndex;
      let closestDistance = Infinity;
      Array.from(scrollEl.children).forEach((child, index) => {
        const distance = Math.abs(child.offsetTop - scrollEl.scrollTop);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      if (closestIndex !== currentSpreadIndex) {
        currentSpreadIndex = closestIndex;
        updateToolbar();
      }
    });
  }

  function updateRootClasses() {
    if (!readerRoot) {
      return;
    }
    readerRoot.classList.remove("pmr-mode-single", "pmr-mode-double", "pmr-mode-book", "pmr-snap-off", "pmr-night-1", "pmr-night-2", "pmr-night-3");
    readerRoot.classList.add(`pmr-mode-${settings.mode}`);
    if (!settings.snap) {
      readerRoot.classList.add("pmr-snap-off");
    }
    if (settings.night > 0) {
      readerRoot.classList.add(`pmr-night-${settings.night}`);
    }
  }

  function updateToolbar() {
    if (!readerRoot) {
      return;
    }
    const spread = spreads[currentSpreadIndex] || { pageIndexes: [0] };
    const pageNumbers = spread.pageIndexes.map((index) => index + 1);
    const label = spread.type === "chapter-nav"
      ? "End"
      : pageNumbers.length === 1
        ? String(pageNumbers[0])
        : `${pageNumbers[0]}–${pageNumbers[1]}`;
    const indicator = readerRoot.querySelector("[data-pmr-indicator]");
    const modeButton = readerRoot.querySelector("[data-pmr-action='mode']");
    const snapButton = readerRoot.querySelector("[data-pmr-action='snap']");
    const nightButton = readerRoot.querySelector("[data-pmr-action='night']");
    if (indicator) indicator.textContent = `${label} / ${pages.length}`;
    if (modeButton) modeButton.textContent = MODE_LABELS[settings.mode];
    if (snapButton) snapButton.textContent = `Snap ${settings.snap ? "On" : "Off"}`;
    if (nightButton) nightButton.textContent = NIGHT_MODE_LABELS[settings.night];
  }

  function detectChapterNav() {
    const currentInfo = getCurrentChapterInfo();
    const best = { prev: null, next: null };
    const elements = document.querySelectorAll("a[href], link[href][rel~='prev'], link[href][rel~='next']");

    elements.forEach((element) => {
      if (element.closest?.(`#${ROOT_ID}, #${ACTIVATOR_ID}`)) {
        return;
      }

      const candidate = scoreChapterNavElement(element, currentInfo);
      if (!candidate) {
        return;
      }

      const existing = best[candidate.direction];
      if (!existing || candidate.score > existing.score) {
        best[candidate.direction] = candidate;
      }
    });

    const result = {};
    if (best.prev) {
      result.prev = chapterNavLink(best.prev);
    }
    if (best.next) {
      result.next = chapterNavLink(best.next);
    }
    return result.prev || result.next ? result : null;
  }

  function scoreChapterNavElement(element, currentInfo) {
    const rawHref = element.getAttribute("href");
    const url = safeUrl(rawHref, location.href);
    if (!url || !/^https?:$/i.test(url.protocol) || url.origin !== location.origin) {
      return null;
    }
    if (isSameDocumentUrl(url) || /\.(?:jpe?g|png|webp|avif|gif|svg|css|js)(?:$|\?)/i.test(url.pathname)) {
      return null;
    }

    const text = chapterNavText(element);
    const rel = String(element.getAttribute("rel") || "").toLowerCase();
    if (isBadChapterNavLink(url, text, rel)) {
      return null;
    }

    const targetInfo = chapterInfoFromUrl(url.href);
    const chapterLike = looksChapterLikeNavTarget(url, text, currentInfo, targetInfo);
    if (!chapterLike) {
      return null;
    }

    const navish = isNavishElement(element);
    const nearChapterSelect = hasNearbyChapterSelect(element);
    const scopeText = `${text} ${ancestorNavText(element)}`.toLowerCase();
    const elementHtml = element.outerHTML ? element.outerHTML.slice(0, CHAPTER_NAV_HTML_SAMPLE_CHARS).toLowerCase() : "";
    const scores = { prev: 0, next: 0 };

    if (/\bprev(?:ious)?\b/.test(rel)) scores.prev += CHAPTER_NAV_REL_SCORE;
    if (/\bnext\b/.test(rel)) scores.next += CHAPTER_NAV_REL_SCORE;

    if (/\b(prev(?:ious)?|back|older)\b(?:\s*(?:chapter|chap|ch|episode|ep))?|\b(?:chapter|chap|ch|episode|ep)\s*(?:prev(?:ious)?|back)\b/i.test(text)) {
      scores.prev += CHAPTER_NAV_TEXT_SCORE;
    }
    if (/\b(next|newer)\b(?:\s*(?:chapter|chap|ch|episode|ep))?|\b(?:chapter|chap|ch|episode|ep)\s*next\b/i.test(text)) {
      scores.next += CHAPTER_NAV_TEXT_SCORE;
    }

    if (/nav-previous|\bprevious\b|\bprev\b|pagination-prev|chevron-left|arrow-left/.test(scopeText)) scores.prev += CHAPTER_NAV_SCOPE_SIGNAL_SCORE;
    if (/nav-next|\bnext\b|pagination-next|chevron-right|arrow-right/.test(scopeText)) scores.next += CHAPTER_NAV_SCOPE_SIGNAL_SCORE;
    if (/chevron-left|arrow-left|lucide-chevron-left|lucide-arrow-left/.test(elementHtml)) scores.prev += nearChapterSelect || navish ? CHAPTER_NAV_ICON_CONTEXT_SCORE : CHAPTER_NAV_ICON_WEAK_SCORE;
    if (/chevron-right|arrow-right|lucide-chevron-right|lucide-arrow-right/.test(elementHtml)) scores.next += nearChapterSelect || navish ? CHAPTER_NAV_ICON_CONTEXT_SCORE : CHAPTER_NAV_ICON_WEAK_SCORE;

    if (currentInfo && targetInfo && currentInfo.family === targetInfo.family && targetInfo.number !== currentInfo.number) {
      const delta = targetInfo.number - currentInfo.number;
      const absDelta = Math.abs(delta);
      const deltaScore = absDelta <= 3 ? 55 : absDelta <= 10 ? 35 : 15;
      if (delta < 0) scores.prev += navish || nearChapterSelect ? deltaScore : 15;
      if (delta > 0) scores.next += navish || nearChapterSelect ? deltaScore : 15;

      if (delta < 0) scores.next -= CHAPTER_NAV_WRONG_DIRECTION_PENALTY;
      if (delta > 0) scores.prev -= CHAPTER_NAV_WRONG_DIRECTION_PENALTY;
    }

    const direction = scores.next > scores.prev ? "next" : "prev";
    const score = scores[direction];
    const highConfidence = score >= CHAPTER_NAV_HIGH_CONFIDENCE;
    const contextualConfidence = (navish || nearChapterSelect) && score >= CHAPTER_NAV_CONTEXT_CONFIDENCE;
    if (!highConfidence && !contextualConfidence) {
      return null;
    }

    return {
      direction,
      score,
      url: url.href,
      title: readableChapterNavTitle(element, url, direction)
    };
  }

  function chapterNavLink(candidate) {
    return {
      url: candidate.url,
      title: candidate.title,
      score: candidate.score
    };
  }

  function chapterNavText(element) {
    return normalizeWhitespace([
      element.textContent || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || "",
      element.getAttribute("data-title") || ""
    ].join(" "));
  }

  function ancestorNavText(element) {
    const ancestor = element.closest?.(".nav-previous, .nav-next, .navigation, .post-navigation, .nav-links, .pagination, nav, [role='navigation'], [class*='chapter' i], [id*='chapter' i]");
    if (!ancestor) {
      return "";
    }
    return normalizeWhitespace([
      ancestor.id || "",
      ancestor.className || "",
      ancestor.getAttribute?.("aria-label") || ""
    ].join(" "));
  }

  function isBadChapterNavLink(url, text, rel) {
    const haystack = `${decodeURIComponentSafe(url.href)} ${text}`.toLowerCase();
    if (/\bsponsored\b/.test(rel) && !/\b(prev(?:ious)?|next)\b/i.test(text)) {
      return true;
    }
    if (/\b(fill survey|earn\s*\$?\d+|advertisement|advertise|affiliate|sponsored|comments?|reply|login|register|privacy|terms|contact|about|latest chapters?|share|facebook|twitter|x\.com|pinterest|discord|rss|feed)\b/i.test(haystack)) {
      return true;
    }
    if (/\/(?:feed|comments|wp-json|tag|category|author|search|oembed)(?:\/|$)|[?&](?:replytocom|share)=/i.test(url.href)) {
      return true;
    }
    return false;
  }

  function looksChapterLikeNavTarget(url, text, currentInfo, targetInfo) {
    if (targetInfo) {
      return targetInfo.explicit
        || /\b(chapter|chap|ch\.?|episode|ep\.?|manga|comic|read)\b/i.test(`${url.pathname} ${text}`)
        || Boolean(currentInfo && currentInfo.family === targetInfo.family);
    }
    if (/\b(chapter|chap|ch\.?|episode|ep\.?|manga|comic|read)\b/i.test(`${url.pathname} ${text}`)) {
      return true;
    }
    return false;
  }

  function isNavishElement(element) {
    return Boolean(element.closest?.("nav, [role='navigation'], .navigation, .post-navigation, .nav-links, .pagination, [class*='chapter' i], [id*='chapter' i], [class*='pager' i], [id*='pager' i]"));
  }

  function hasNearbyChapterSelect(element) {
    let node = element;
    for (let depth = 0; node && depth < 5; depth += 1) {
      if (node.querySelector?.("select option[selected], select option:checked")) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function readableChapterNavTitle(element, url, direction) {
    const text = chapterNavText(element);
    if (text && text.length <= READABLE_TITLE_MAX_CHARS && /[a-z0-9]/i.test(text)) {
      return text;
    }
    const info = chapterInfoFromUrl(url.href);
    if (info) {
      return `${direction === "prev" ? "Previous" : "Next"} chapter ${info.number}`;
    }
    return `${direction === "prev" ? "Previous" : "Next"} chapter`;
  }

  function getCurrentChapterInfo() {
    return chapterInfoFromUrl(location.href) || chapterInfoFromText(document.title, location.href);
  }

  function chapterInfoFromUrl(urlValue) {
    const url = safeUrl(urlValue, location.href);
    if (!url) {
      return null;
    }
    return chapterInfoFromText(decodeURIComponentSafe(url.pathname), url.href);
  }

  function chapterInfoFromText(text, familySource = text) {
    const normalized = String(text || "").toLowerCase();
    let match = normalized.match(/(?:chapter|chap|ch|episode|ep)[-_\s\/]*([0-9]+(?:\.[0-9]+)?)/i);
    let explicit = Boolean(match);
    if (!match) {
      if (/(?:^|\/)page\/\d+(?:\/|$)/i.test(normalized)) {
        return null;
      }
      match = normalized.match(/(?:^|[-_\/\s])([0-9]{1,5})(?:\/?$|[-_\/\s])/i);
    }
    if (!match) {
      return null;
    }

    const number = Number(match[1]);
    if (!Number.isFinite(number)) {
      return null;
    }
    const family = String(familySource || text)
      .toLowerCase()
      .replace(/(?:chapter|chap|ch|episode|ep)[-_\s\/]*[0-9]+(?:\.[0-9]+)?/i, "chapter-#")
      .replace(/([\/_-])[0-9]{1,5}(?=\/?$|[\/_-])/i, "$1#")
      .replace(/\/+$/, "");
    return { number, family, explicit };
  }

  function isSameDocumentUrl(url) {
    const current = safeUrl(location.href);
    if (!current) {
      return false;
    }
    return url.origin === current.origin && url.pathname === current.pathname && url.search === current.search;
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function collectMangaPages(options = {}) {
    const candidates = collectCandidates(options);
    if (candidates.length === 0) {
      return [];
    }
    scoreCandidates(candidates);
    const selected = selectBestSequence(candidates);

    return selected
      .sort(compareCandidates)
      .map((candidate, index) => ({
        url: candidate.url,
        pageNumber: candidate.numeric?.page || index + 1,
        width: candidate.width,
        height: candidate.height,
        alt: candidate.alt || `Manga page ${index + 1}`,
        score: candidate.finalScore
      }));
  }

  function collectCandidates(options = {}) {
    const byKey = new Map();
    let sourceIndex = 0;

    const upsert = (rawUrl, context = {}) => {
      const url = toAbsoluteImageUrl(rawUrl, context);
      if (!url) {
        return;
      }
      const key = logicalImageKey(url);
      const existing = byKey.get(key);
      const dims = context.element ? getElementDimensions(context.element) : {};
      const next = existing || {
        key,
        url,
        sourceKinds: new Set(),
        sourceIndex: context.sourceIndex ?? sourceIndex++,
        domIndex: Number.MAX_SAFE_INTEGER,
        width: 0,
        height: 0,
        alt: "",
        title: "",
        containerKey: "",
        element: null,
        score: 0,
        finalScore: 0,
        groupKey: "",
        numeric: null
      };

      if (imageUrlQuality(url) > imageUrlQuality(next.url)) {
        next.url = url;
      }
      if (context.kind) {
        next.sourceKinds.add(context.kind);
      }
      if (Number.isFinite(context.domIndex)) {
        next.domIndex = Math.min(next.domIndex, context.domIndex);
      }
      if (context.element && !next.element) {
        next.element = context.element;
      }
      if (dims.width > next.width) {
        next.width = dims.width;
      }
      if (dims.height > next.height) {
        next.height = dims.height;
      }
      if (!next.alt && context.alt) {
        next.alt = context.alt;
      }
      if (!next.title && context.title) {
        next.title = context.title;
      }
      if (!next.containerKey && context.containerKey) {
        next.containerKey = context.containerKey;
      }
      byKey.set(key, next);
    };

    document.querySelectorAll("img").forEach((img, domIndex) => {
      const baseContext = {
        element: img,
        domIndex,
        alt: img.getAttribute("alt") || "",
        title: img.getAttribute("title") || "",
        containerKey: containerKeyForElement(img)
      };

      IMAGE_ATTRS.forEach((attr) => {
        const value = attr === "currentSrc" ? img.currentSrc : img.getAttribute(attr);
        upsert(value, { ...baseContext, kind: attr.startsWith("data-") ? "lazy-img" : "img" });
      });

      SRCSET_ATTRS.forEach((attr) => {
        parseSrcset(img.getAttribute(attr)).forEach((url) => upsert(url, { ...baseContext, kind: "srcset" }));
      });

      const anchor = img.closest("a[href]");
      if (anchor) {
        upsert(anchor.getAttribute("href"), { ...baseContext, kind: "anchor" });
      }
    });

    document.querySelectorAll("picture source").forEach((source, domIndex) => {
      SRCSET_ATTRS.forEach((attr) => {
        parseSrcset(source.getAttribute(attr)).forEach((url) => upsert(url, { domIndex, kind: "source-srcset" }));
      });
    });

    document.querySelectorAll("link[rel~='preload'][as='image'], link[rel~='prefetch'][as='image']").forEach((link) => {
      upsert(link.getAttribute("href"), { kind: "preload" });
    });

    document.querySelectorAll("meta[property='og:image'], meta[property='og:image:secure_url'], meta[name='twitter:image'], meta[property='twitter:image']").forEach((meta) => {
      upsert(meta.getAttribute("content"), { kind: "meta" });
    });

    if (options.includeEmbedded !== false) {
      scanEmbeddedImageUrls(upsert);
    }
    return Array.from(byKey.values());
  }

  function scanEmbeddedImageUrls(upsert) {
    let scannedBytes = 0;
    const maxBytes = EMBEDDED_SCAN_MAX_BYTES;
    const textNodes = [
      ...document.querySelectorAll("noscript"),
      ...document.querySelectorAll("script:not([src])")
    ];

    for (const node of textNodes) {
      const text = node.textContent || "";
      if (!text || scannedBytes >= maxBytes) {
        break;
      }
      if (!/\.(?:jpe?g|png|webp|avif)|\/api\/img\//i.test(text)) {
        continue;
      }
      if (text.length > EMBEDDED_SCRIPT_MAX_BYTES && node.tagName.toLowerCase() !== "noscript" && node.id !== "__NEXT_DATA__") {
        continue;
      }
      const normalizedText = text.replace(/\\\//g, "/").replace(/\\u002F/gi, "/");
      scannedBytes += normalizedText.length;
      for (const match of normalizedText.matchAll(IMAGE_URL_RE)) {
        upsert(match[0], { kind: node.tagName.toLowerCase() === "noscript" ? "noscript" : "script" });
      }
    }
  }

  function scoreCandidates(candidates) {
    candidates.forEach((candidate) => {
      candidate.numeric = parseNumericInfo(candidate.url);
      candidate.score = baseScore(candidate);
      candidate.groupKey = groupKeyForCandidate(candidate);
    });

    const groups = new Map();
    candidates.forEach((candidate) => {
      if (!candidate.groupKey) {
        return;
      }
      if (!groups.has(candidate.groupKey)) {
        groups.set(candidate.groupKey, []);
      }
      groups.get(candidate.groupKey).push(candidate);
    });

    groups.forEach((group) => {
      const bonus = groupBonus(group);
      group.forEach((candidate) => {
        candidate.finalScore = candidate.score + bonus;
      });
    });

    candidates.forEach((candidate) => {
      if (!candidate.groupKey) {
        candidate.finalScore = candidate.score;
      }
    });
  }

  function baseScore(candidate) {
    const urlText = decodeURIComponentSafe(candidate.url).toLowerCase();
    const sourceKinds = candidate.sourceKinds;
    let score = 0;

    if (isImageLikeUrl(candidate.url)) score += 1;
    if (sourceKinds.has("img") || sourceKinds.has("lazy-img") || sourceKinds.has("srcset")) score += 2;
    if (sourceKinds.has("lazy-img")) score += 1;
    if (sourceKinds.has("anchor")) score += 1;
    if (sourceKinds.has("preload")) score += 1;
    if (sourceKinds.has("meta")) score -= 1;
    if (candidate.numeric) score += 4;
    if (/\bpage\s*0*\d+\b/i.test(candidate.alt || "")) score += 3;
    if (/\bpage\s*0*\d+\b/i.test(candidate.title || "")) score += 2;

    if (candidate.width && candidate.height) {
      const area = candidate.width * candidate.height;
      const ratio = candidate.height / Math.max(candidate.width, 1);
      const sizeKey = `${candidate.width}x${candidate.height}`;
      if (candidate.width >= 450 && candidate.height >= 650) score += 2;
      if (area >= 300_000) score += 1;
      if (ratio >= 1.15) score += 2;
      if (ratio >= 0.65 && candidate.width >= 700 && candidate.height >= 700) score += 1;
      if (COMMON_AD_SIZES.has(sizeKey) || (candidate.width / Math.max(candidate.height, 1) > 3 && candidate.height <= 260)) {
        score -= 8;
      }
    }

    if (BAD_URL_RE.test(urlText)) score -= 8;
    if (/data:image\/svg/i.test(candidate.url)) score -= 20;

    return score;
  }

  function groupBonus(group) {
    const pageNumbers = Array.from(new Set(group.map((candidate) => candidate.numeric?.page).filter(Number.isFinite))).sort((a, b) => a - b);
    let bonus = 0;
    if (group.length >= 3) bonus += 2;
    if (group.length >= 8) bonus += 1;
    if (pageNumbers.length >= 3) bonus += 4;
    if (longestConsecutiveRun(pageNumbers) >= 3) bonus += 3;
    if (pageNumbers.length >= 8) bonus += 1;
    return bonus;
  }

  function selectBestSequence(candidates) {
    const groups = new Map();
    candidates.forEach((candidate) => {
      if (!candidate.groupKey) {
        return;
      }
      if (!groups.has(candidate.groupKey)) {
        groups.set(candidate.groupKey, []);
      }
      groups.get(candidate.groupKey).push(candidate);
    });

    const rankedGroups = Array.from(groups.values())
      .map((group) => {
        const pageNumbers = new Set(group.map((candidate) => candidate.numeric?.page).filter(Number.isFinite));
        const highQuality = group.filter((candidate) => candidate.finalScore >= 6 && candidate.score > -2);
        const rank = pageNumbers.size * 14 + highQuality.length * 4 + average(group.map((candidate) => candidate.finalScore));
        return { group, pageNumbers, highQuality, rank };
      })
      .filter((entry) => entry.pageNumbers.size >= 3 || entry.highQuality.length >= 5)
      .sort((a, b) => b.rank - a.rank);

    if (rankedGroups.length > 0) {
      const best = rankedGroups[0].group
        .filter((candidate) => candidate.finalScore >= 5 && candidate.score > -4)
        .sort((a, b) => b.finalScore - a.finalScore);
      return dedupeByPage(best).sort(compareCandidates);
    }

    return dedupeByPage(candidates.filter((candidate) => candidate.finalScore >= 8)).sort(compareCandidates);
  }

  function dedupeByPage(candidates) {
    const byPage = new Map();
    const withoutPage = [];

    candidates.forEach((candidate) => {
      const page = candidate.numeric?.page;
      if (!Number.isFinite(page)) {
        withoutPage.push(candidate);
        return;
      }
      const existing = byPage.get(page);
      if (!existing || isBetterCandidate(candidate, existing)) {
        byPage.set(page, candidate);
      }
    });

    return [...byPage.values(), ...withoutPage].slice(0, MAX_SELECTED_PAGES);
  }

  function compareCandidates(a, b) {
    const aPage = a.numeric?.page;
    const bPage = b.numeric?.page;
    if (Number.isFinite(aPage) && Number.isFinite(bPage) && aPage !== bPage) {
      return aPage - bPage;
    }
    if (a.domIndex !== b.domIndex) {
      return a.domIndex - b.domIndex;
    }
    return a.sourceIndex - b.sourceIndex;
  }

  function groupKeyForCandidate(candidate) {
    const url = safeUrl(candidate.url);
    if (!url) {
      return "";
    }
    const sourceScope = candidate.containerKey || url.origin;
    if (candidate.numeric) {
      return `num:${imageExtension(url.pathname)}:${sourceScope}:${candidate.numeric.family}`;
    }
    if (candidate.score >= 4) {
      return `path:${sourceScope}:${url.pathname.replace(/\/[^/]*$/, "/")}`;
    }
    return "";
  }

  function parseNumericInfo(urlValue) {
    const url = safeUrl(urlValue);
    if (!url) {
      return null;
    }
    const pathname = decodeURIComponentSafe(url.pathname);
    const filename = pathname.split("/").pop() || "";
    const ext = imageExtension(filename);
    const base = stripResponsiveImageSize(filename).replace(/\.(?:jpe?g|png|webp|avif)$/i, "").toLowerCase();
    if (!base) {
      return null;
    }

    let match = base.match(/^0*(\d{1,4})$/);
    if (match) {
      return { page: Number(match[1]), family: `pure:${ext}` };
    }

    match = base.match(/^0*(\d{1,3})[-_.\s]+(.+)$/);
    if (match && (Number(match[1]) <= MAX_REASONABLE_PAGE_NUMBER || /(?:chapter|chap|manga|page|comic)/i.test(base))) {
      const rest = match[2].replace(/\d+/g, "#");
      if (/^\d{4,}[-_.\s]+0*\d{1,3}$/i.test(base)) {
        const trailing = base.match(/^(.+[-_.\s])0*(\d{1,3})$/);
        return { page: Number(trailing[2]), family: `trailing:${trailing[1].replace(/\d+/g, "#")}:${ext}` };
      }
      return { page: Number(match[1]), family: `leading:${rest}:${ext}` };
    }

    match = base.match(/^(.+[-_.\s])0*(\d{1,3})$/);
    if (match) {
      return { page: Number(match[2]), family: `trailing:${match[1].replace(/\d+/g, "#")}:${ext}` };
    }

    return null;
  }

  function getElementDimensions(img) {
    const width = firstPositiveNumber(
      img.naturalWidth,
      img.getAttribute("width"),
      img.getAttribute("data-original-width"),
      img.getAttribute("data-width")
    );
    const height = firstPositiveNumber(
      img.naturalHeight,
      img.getAttribute("height"),
      img.getAttribute("data-original-height"),
      img.getAttribute("data-height")
    );
    return { width, height };
  }

  function firstPositiveNumber(...values) {
    for (const value of values) {
      const number = Number.parseInt(String(value || "").replace(/[^0-9]/g, ""), 10);
      if (Number.isFinite(number) && number > 0) {
        return number;
      }
    }
    return 0;
  }

  function parseSrcset(value) {
    if (!value) {
      return [];
    }
    return value
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function toAbsoluteImageUrl(rawValue, context = {}) {
    if (!rawValue || typeof rawValue !== "string") {
      return null;
    }
    let value = decodeEntities(rawValue.trim());
    if (!value || /^data:image\/(?:svg|gif)/i.test(value) || /^blob:/i.test(value)) {
      return null;
    }
    value = value.replace(/\\\//g, "/").replace(/\\u002F/gi, "/");
    if (value.startsWith("//")) {
      value = `${location.protocol}${value}`;
    }
    const url = safeUrl(value, location.href);
    if (!url || !/^https?:$/i.test(url.protocol) || !isImageLikeUrl(url.href, context)) {
      return null;
    }
    return url.href;
  }

  function isImageLikeUrl(urlValue, context = {}) {
    const url = safeUrl(urlValue, location.href);
    if (!url) {
      return false;
    }
    if (/\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname) || /[?&](?:format|type|mime)=image\//i.test(url.search)) {
      return true;
    }

    const imageContextKinds = new Set(["img", "lazy-img", "srcset", "source-srcset", "preload"]);
    const hasImageContext = imageContextKinds.has(context.kind);
    if (!hasImageContext) {
      return false;
    }

    return /\/(?:api\/)?(?:img|image|images|media|scan|scans|page|pages|manga|uploads?)(?:\/|$)/i.test(url.pathname);
  }

  function logicalImageKey(urlValue) {
    const url = safeUrl(urlValue);
    if (!url) {
      return urlValue;
    }
    const path = decodeURIComponentSafe(url.pathname)
      .replace(/\/s\d+(?:-[^/]+)?\//gi, "/s*/")
      .replace(/\/(?:w|h)\d+(?:-[whcp]\d+)*\//gi, "/size*/")
      .replace(/-\d{2,5}x\d{2,5}(\.(?:jpe?g|png|webp|avif))$/i, "$1");
    return `${url.origin}${path}${normalizedSearch(url.searchParams)}`.toLowerCase();
  }

  function imageUrlQuality(urlValue) {
    const url = safeUrl(urlValue);
    if (!url) {
      return 0;
    }
    const path = url.pathname;
    const bloggerSize = path.match(/\/s(\d+)(?:-[^/]+)?\//i);
    const widthHeight = path.match(/(?:^|[/-])(?:w|h)(\d+)(?:-[wh](\d+))?/i);
    let quality = 1;
    if (bloggerSize) quality += Number(bloggerSize[1]);
    if (widthHeight) quality += Number(widthHeight[1] || 0) + Number(widthHeight[2] || 0);
    if (/\.(?:webp|png|jpe?g|avif)$/i.test(path)) quality += 10;
    if (/-\d{2,5}x\d{2,5}\.(?:jpe?g|png|webp|avif)$/i.test(path)) quality -= 10_000;
    return quality;
  }

  function isBetterCandidate(candidate, existing) {
    if (candidate.finalScore > existing.finalScore + 0.5) {
      return true;
    }
    if (existing.finalScore > candidate.finalScore + 0.5) {
      return false;
    }

    const candidateQuality = imageUrlQuality(candidate.url);
    const existingQuality = imageUrlQuality(existing.url);
    if (candidateQuality !== existingQuality) {
      return candidateQuality > existingQuality;
    }

    if (candidate.domIndex !== existing.domIndex) {
      return candidate.domIndex < existing.domIndex;
    }

    return candidate.sourceIndex < existing.sourceIndex;
  }

  function containerKeyForElement(element) {
    const container = element.closest([
      "[id*='reader' i]",
      "[class*='reader' i]",
      "[id*='chapter' i]",
      "[class*='chapter' i]",
      "[class*='entry-content' i]",
      "[class*='single-content' i]",
      "[class*='post-content' i]",
      "[class*='manga' i]",
      "article",
      "main"
    ].join(","));

    if (container) {
      return elementSignature(container);
    }

    const repeatedWrapper = element.closest("figure, .separator, p, div");
    return repeatedWrapper ? elementSignature(repeatedWrapper) : "document";
  }

  function elementSignature(element) {
    if (!element) {
      return "document";
    }
    const tag = element.tagName.toLowerCase();
    if (element.id) {
      return `${tag}#${element.id.slice(0, ELEMENT_SIGNATURE_MAX_CHARS)}`;
    }
    const classes = Array.from(element.classList || [])
      .filter((className) => !/^\d/.test(className) && className.length <= 48)
      .slice(0, 4)
      .join(".");
    if (classes) {
      return `${tag}.${classes}`;
    }
    return tag;
  }

  function normalizedSearch(searchParams) {
    const params = new URLSearchParams(searchParams);
    const ignored = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ver", "v", "cache", "cachebuster", "cb", "_"]);
    for (const key of Array.from(params.keys())) {
      const normalizedKey = key.toLowerCase();
      if (ignored.has(normalizedKey) || normalizedKey.startsWith("utm_")) {
        params.delete(key);
      }
    }
    const serialized = params.toString();
    return serialized ? `?${serialized}` : "";
  }

  function longestConsecutiveRun(numbers) {
    if (numbers.length === 0) {
      return 0;
    }
    let best = 1;
    let current = 1;
    for (let index = 1; index < numbers.length; index += 1) {
      if (numbers[index] === numbers[index - 1] + 1) {
        current += 1;
        best = Math.max(best, current);
      } else if (numbers[index] !== numbers[index - 1]) {
        current = 1;
      }
    }
    return best;
  }

  function average(values) {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function imageExtension(pathname) {
    return (pathname.match(/\.(jpe?g|png|webp|avif)(?:$|\?)/i)?.[1] || "img").toLowerCase();
  }

  function stripResponsiveImageSize(filename) {
    return filename.replace(/-\d{2,5}x\d{2,5}(\.(?:jpe?g|png|webp|avif))$/i, "$1");
  }

  function safeUrl(value, base) {
    try {
      return new URL(value, base);
    } catch (_error) {
      return null;
    }
  }

  function decodeEntities(value) {
    return value
      .replace(/&amp;/gi, "&")
      .replace(/&#038;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#x2F;/gi, "/")
      .replace(/&#47;/gi, "/");
  }

  function decodeURIComponentSafe(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  }

  function scheduleActivatorRefresh(delay = 0) {
    if (active) {
      return;
    }
    window.clearTimeout(activatorRefreshTimer);
    activatorRefreshTimer = window.setTimeout(refreshActivator, delay);
  }

  function refreshActivator() {
    if (active || document.getElementById(ROOT_ID)) {
      return;
    }
    const detected = collectMangaPages({ includeEmbedded: false });
    if (detected.length >= MIN_DETECTED_PAGES) {
      showActivator(detected.length);
    } else {
      removeActivator();
    }
  }

  function showActivator(count) {
    let activator = document.getElementById(ACTIVATOR_ID);
    if (!activator) {
      activator = document.createElement("div");
      activator.id = ACTIVATOR_ID;
      activator.innerHTML = '<button class="pmr-button pmr-button-primary" type="button">Reader</button>';
      activator.addEventListener("click", () => {
        toggleReader();
      });
      document.documentElement.appendChild(activator);
    }
    const button = activator.querySelector("button");
    if (button) {
      button.textContent = `Reader · ${count}`;
      button.title = `Open manga reader (${count} pages detected)`;
    }
  }

  function removeActivator() {
    document.getElementById(ACTIVATOR_ID)?.remove();
  }

  function observeEarlyMutations() {
    if (!document.body || mutationObserver) {
      return;
    }
    let refreshes = 0;
    mutationObserver = new MutationObserver(() => {
      if (active) {
        return;
      }
      refreshes += 1;
      scheduleActivatorRefresh(ACTIVATOR_MUTATION_DELAY_MS);
      if (refreshes > ACTIVATOR_MAX_MUTATION_REFRESHES) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "data-src", "data-lazy-src"] });
  }

  function showToast(message) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.remove(), TOAST_DURATION_MS);
  }

  function helpDialogMarkup() {
    return `
      <div class="pmr-help-dialog" role="document">
        <h2>Prettify Manga Reader</h2>
        <p>The extension builds this view from detected page-image sequences instead of site-specific selectors.</p>
        <ul>
          <li><kbd>Space</kbd>, <kbd>PageDown</kbd>, <kbd>↓</kbd>, <kbd>→</kbd>: next page/spread</li>
          <li><kbd>Shift</kbd> + <kbd>Space</kbd>, <kbd>PageUp</kbd>, <kbd>↑</kbd>, <kbd>←</kbd>: previous page/spread</li>
          <li><kbd>Home</kbd> / <kbd>End</kbd>: chapter start/end</li>
          <li><kbd>D</kbd>: cycle Single → Double → Book spread mode</li>
          <li><kbd>S</kbd>: toggle scroll snapping</li>
          <li><kbd>N</kbd>: cycle Night Off → Night 1 → Night 2 → Night 3</li>
          <li><kbd>?</kbd>: show/hide this help</li>
          <li><kbd>Esc</kbd>: close help, then turn reader off</li>
        </ul>
        <p><strong>Modes:</strong> Single shows one fitted page. Double pairs pages from the beginning. Book keeps the first page alone, then pairs the rest.</p>
        <button class="pmr-button pmr-button-primary" type="button" data-pmr-action="help-close">Close</button>
      </div>
    `;
  }

  if (window.__PMR_ENABLE_TEST_API__) {
    window.__PMR_TEST_API__ = {
      DEFAULT_READER_MODE,
      DEFAULT_NIGHT_MODE,
      NIGHT_MODE_LEVELS,
      buildSpreads,
      chapterInfoFromText,
      chapterInfoFromUrl,
      isBadChapterNavLink,
      isLandscapePage,
      logicalImageKey,
      parseNumericInfo,
      setChapterNavForTest(value) {
        chapterNav = value;
      }
    };
  }
})();
