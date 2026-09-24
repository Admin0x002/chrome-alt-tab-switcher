chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;

  // 1. 获取当前窗口的所有标签页数据（给浮窗展示用）
  if (message.type === 'GET_TABS') {
    chrome.tabs.query({ windowId }).then((tabs) => {
      tabs.sort((a, b) => a.index - b.index);
      sendResponse({
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title || '新标签页',
          favIconUrl: t.favIconUrl || '',
          active: t.active,
          index: t.index
        }))
      });
    });
    return true; // 保持异步通道
  }

  // 2. 直接激活指定 ID 的标签页（Alt+Tab 浮窗确认选择）
  if (message.type === 'ACTIVATE_TAB') {
    chrome.tabs.update(message.tabId, { active: true }).then(() => {
      sendResponse({ status: 'ok' });
    });
    return true;
  }

  // 3. 相对步进切换（无浮窗或即时模式）
  if (message.type === 'SWITCH_TAB') {
    handleStepSwitch(windowId, message.direction)
      .then((newTab) => sendResponse({ status: 'ok', tab: newTab }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true;
  }
});

let isSwitching = false;
async function handleStepSwitch(windowId, direction) {
  if (isSwitching) return null;
  isSwitching = true;
  try {
    const tabs = await chrome.tabs.query({ windowId });
    if (!tabs || tabs.length <= 1) return null;

    tabs.sort((a, b) => a.index - b.index);
    const currentIndex = tabs.findIndex((t) => t.active);
    if (currentIndex === -1) return null;

    const { loopTabs = true } = await chrome.storage.sync.get(['loopTabs']);
    let targetIndex;
    if (direction === 'next') {
      targetIndex = currentIndex + 1 < tabs.length ? currentIndex + 1 : loopTabs ? 0 : currentIndex;
    } else {
      targetIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : loopTabs ? tabs.length - 1 : currentIndex;
    }

    if (targetIndex !== currentIndex) {
      const targetTab = tabs[targetIndex];
      await chrome.tabs.update(targetTab.id, { active: true });
      return { id: targetTab.id, title: targetTab.title, favIconUrl: targetTab.favIconUrl, index: targetIndex, total: tabs.length };
    }
    return null;
  } finally {
    isSwitching = false;
  }
}