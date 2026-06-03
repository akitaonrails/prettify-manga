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

test("chapter nav bad-link filter rejects ads, feeds, and social links", () => {
  const api = loadApi();
  assert.equal(api.isBadChapterNavLink(new URL("https://example.test/feed/"), "Next", ""), true);
  assert.equal(api.isBadChapterNavLink(new URL("https://example.test/survey"), "Fill Survey Earn $50", "sponsored"), true);
  assert.equal(api.isBadChapterNavLink(new URL("https://example.test/manga/series-chapter-11/"), "Next Chapter", "next"), false);
});
