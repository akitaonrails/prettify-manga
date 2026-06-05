import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadApi() {
  const code = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  class FakeElement {}
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const context = {
    console,
    URL,
    URLSearchParams,
    Element: FakeElement,
    MutationObserver: FakeMutationObserver,
    chrome: undefined,
    location: { href: "https://example.test/manga/series-chapter-10/", origin: "https://example.test", pathname: "/manga/series-chapter-10/", search: "" },
    setTimeout: () => 1,
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => fn(),
    document: {
      body: {},
      documentElement: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; },
      createElement() { return { remove() {} }; },
      title: "Series Chapter 10"
    },
    window: {
      __PMR_ENABLE_TEST_API__: true,
      addEventListener() {},
      clearTimeout: () => {},
      setTimeout: () => 1
    }
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: "content.js" });
  return context.window.__PMR_TEST_API__;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("default startup mode is book", () => {
  const api = loadApi();
  assert.equal(api.DEFAULT_READER_MODE, "book");
});

test("night mode has off plus three filter levels", () => {
  const api = loadApi();
  assert.equal(api.DEFAULT_NIGHT_MODE, 0);
  assert.equal(api.NIGHT_MODE_LEVELS, 3);
});

test("kindle manga handler is gated to country reader manga paths", () => {
  const api = loadApi();
  assert.equal(api.isKindleMangaReaderPage({ hostname: "read.amazon.com", pathname: "/manga/B08FBPPCHM" }), true);
  assert.equal(api.isKindleMangaReaderPage({ hostname: "read.amazon.co.jp", pathname: "/manga/B08FBPPCHM" }), true);
  assert.equal(api.isKindleMangaReaderPage({ hostname: "read.amazon.co.uk", pathname: "/manga/B08FBPPCHM" }), true);
  assert.equal(api.isKindleMangaReaderPage({ hostname: "read.amazon.com.br", pathname: "/manga/B08FBPPCHM" }), true);
  assert.equal(api.isKindleMangaReaderPage({ hostname: "read.kindle.com", pathname: "/manga/B08FBPPCHM" }), true);
  assert.equal(api.isKindleMangaReaderPage({ hostname: "read.amazon.com", pathname: "/kindle-library" }), false);
  assert.equal(api.isKindleMangaReaderPage({ hostname: "read.amazon.com.evil.test", pathname: "/manga/B08FBPPCHM" }), false);
  assert.equal(api.isKindleMangaReaderPage({ hostname: "www.amazon.com", pathname: "/manga/B08FBPPCHM" }), false);
});

test("kindle key bindings map to page navigation intents", () => {
  const api = loadApi();
  assert.deepEqual(plain(api.kindleNavigationPlanFromKey("PageDown")), { action: "next", nativeKey: "PageDown", wheelDirection: 1 });
  assert.deepEqual(plain(api.kindleNavigationPlanFromKey("ArrowRight")), { action: "next", nativeKey: "ArrowRight", turnerSide: "right" });
  assert.deepEqual(plain(api.kindleNavigationPlanFromKey("PageUp")), { action: "prev", nativeKey: "PageUp", wheelDirection: -1 });
  assert.deepEqual(plain(api.kindleNavigationPlanFromKey("ArrowLeft")), { action: "prev", nativeKey: "ArrowLeft", turnerSide: "left" });
  assert.deepEqual(plain(api.kindleNavigationPlanFromKey(" ", true)), { action: "prev", nativeKey: " ", shiftKey: true, wheelDirection: -1 });
  assert.deepEqual(plain(api.kindleNavigationPlanFromKey("Home")), { action: "start", nativeKey: "Home" });
  assert.deepEqual(plain(api.kindleNavigationPlanFromKey("End")), { action: "end", nativeKey: "End" });
});

test("spread builder keeps horizontal scans singleton in double mode", () => {
  const api = loadApi();
  api.setChapterNavForTest(null);
  const pages = [
    { width: 800, height: 1200 },
    { width: 800, height: 1200 },
    { width: 1800, height: 1000 },
    { width: 800, height: 1200 },
    { width: 800, height: 1200 }
  ];
  assert.deepEqual(plain(api.buildSpreads("double", pages).map((spread) => spread.pageIndexes)), [[0, 1], [2], [3, 4]]);
});

test("book mode does not pair portrait pages with landscape pages", () => {
  const api = loadApi();
  api.setChapterNavForTest(null);
  const pages = [
    { width: 800, height: 1200 },
    { width: 800, height: 1200 },
    { width: 1800, height: 1000 },
    { width: 800, height: 1200 },
    { width: 800, height: 1200 }
  ];
  assert.deepEqual(plain(api.buildSpreads("book", pages).map((spread) => spread.pageIndexes)), [[0], [1], [2], [3, 4]]);
});

test("paired manga spreads render right-to-left visually", () => {
  const api = loadApi();
  api.setChapterNavForTest(null);
  const spreads = api.buildSpreads("book", [{}, {}, {}]);
  assert.deepEqual(plain(spreads.map((spread) => api.visualPageIndexesForSpread(spread))), [[0], [2, 1]]);
});

test("chapter nav spread is appended in single mode", () => {
  const api = loadApi();
  api.setChapterNavForTest({ next: { url: "https://example.test/manga/series-chapter-11/" } });
  const spreads = api.buildSpreads("single", [{}, {}, {}]);
  assert.equal(spreads.at(-1).type, "chapter-nav");
});

test("numeric parsing handles common page filename families", () => {
  const api = loadApi();
  assert.equal(api.parseNumericInfo("https://cdn.test/s1600/001.jpg").page, 1);
  assert.equal(api.parseNumericInfo("https://cdn.test/01-dandadan-chapter-235-196x300.webp").page, 1);
  assert.equal(api.parseNumericInfo("https://cdn.test/manga/One-Piece/1184-001.png").page, 1);
});

test("logical image keys normalize responsive thumbnails", () => {
  const api = loadApi();
  assert.equal(
    api.logicalImageKey("https://img.test/uploads/01-chapter-196x300.webp"),
    api.logicalImageKey("https://img.test/uploads/01-chapter.webp")
  );
});

test("chapter URL parsing rejects ordinary page pagination", () => {
  const api = loadApi();
  assert.equal(api.chapterInfoFromUrl("https://example.test/page/2/"), null);
  const info = api.chapterInfoFromUrl("https://example.test/manga/series-chapter-11/");
  assert.equal(info.number, 11);
  assert.equal(info.explicit, true);
});

test("chapter URL parsing treats hyphenated subchapters as decimals", () => {
  const api = loadApi();
  const chapter71 = api.chapterInfoFromUrl("https://example.test/manga/rent-a-girlfriend-chapter-71/");
  const chapter711 = api.chapterInfoFromUrl("https://example.test/manga/rent-a-girlfriend-chapter-71-1/");
  const chapter715 = api.chapterInfoFromUrl("https://example.test/manga/rent-a-girlfriend-chapter-71-5/");
  const chapter72 = api.chapterInfoFromUrl("https://example.test/manga/rent-a-girlfriend-chapter-72/");

  assert.equal(chapter711.number, 71.1);
  assert.equal(chapter715.number, 71.5);
  assert.equal(chapter71.family, chapter711.family);
  assert.equal(chapter711.family, chapter715.family);
  assert.equal(chapter715.family, chapter72.family);
});

test("chapter auto-open intent is same-tab, same-origin, and one-shot", () => {
  const api = loadApi();
  const now = 1_000;
  const currentUrl = "https://example.test/manga/series-chapter-10/";
  const targetUrl = "https://example.test/manga/series-chapter-11/";
  const intent = api.chapterAutoOpenIntentForTarget(targetUrl, "next", now, currentUrl);

  assert.equal(intent.mode, api.DEFAULT_READER_MODE);
  assert.equal(intent.direction, "next");
  assert.equal(api.shouldConsumeChapterAutoOpenIntent(intent, "https://example.test/manga/series-chapter-11/#page", now + 1), true);
  assert.equal(api.shouldConsumeChapterAutoOpenIntent(intent, "https://example.test/manga/series-chapter-12/", now + 1), false);
  assert.equal(api.shouldConsumeChapterAutoOpenIntent(intent, targetUrl, intent.expiresAt + 1), false);
  assert.equal(api.chapterAutoOpenIntentForTarget("https://other.test/manga/series-chapter-11/", "next", now, currentUrl), null);
  assert.equal(api.chapterAutoOpenIntentForTarget(currentUrl, "next", now, currentUrl), null);
});

test("chapter keyboard shortcuts map enter and backspace to chapter navigation", () => {
  const api = loadApi();
  assert.equal(api.chapterDirectionFromKey("Enter"), "next");
  assert.equal(api.chapterDirectionFromKey("Backspace"), "prev");
  assert.equal(api.chapterDirectionFromKey("PageDown"), "");
});

test("chapter nav bad-link filter rejects ads, feeds, and social links", () => {
  const api = loadApi();
  assert.equal(api.isBadChapterNavLink(new URL("https://example.test/feed/"), "Next", ""), true);
  assert.equal(api.isBadChapterNavLink(new URL("https://example.test/survey"), "Fill Survey Earn $50", "sponsored"), true);
  assert.equal(api.isBadChapterNavLink(new URL("https://example.test/manga/series-chapter-11/"), "Next Chapter", "next"), false);
});
