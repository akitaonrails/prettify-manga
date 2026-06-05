chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return;
  }

  const target = { tabId: tab.id, allFrames: true };

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "PMR_TOGGLE" });
  } catch (_error) {
    try {
      await chrome.scripting.insertCSS({
        target,
        files: ["content.css"]
      });
      await chrome.scripting.executeScript({
        target,
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, { type: "PMR_TOGGLE" });
    } catch (injectionError) {
      console.warn("Prettify Manga Reader could not run on this page.", injectionError);
    }
  }
});
