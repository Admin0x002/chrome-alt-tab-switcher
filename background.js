// background.js - 后台 Service Worker 状态维护与消息调度

const windowMruMap = new Map(); // windowId -> tabId[]

// 1. 维护 MRU (最近使用) 栈
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { windowId, tabId } = activeInfo;
  let stack = windowMruMap.get(windowId) || [];
  stack = stack.filter((id) => id !== tabId);
  stack.unshift(tabId); // 最新激活的压入栈顶
  windowMruMap.set(windowId, stack);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const { windowId } = removeInfo;
  let stack = windowMruMap.get(windowId);
  if (stack) {
    windowMruMap.set(
      windowId,
      stack.filter((id) => id !== tabId)
    );
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  windowMruMap.delete(windowId);
});

// 初始化已有标签页的 MRU 栈（如扩展重新加载或启动）
async function initMruForWindow(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    if (!tabs || tabs.length === 0) return;
    let stack = windowMruMap.get(windowId) || [];
    // 找出当前活跃的 tab
    const activeTab = tabs.find((t) => t.active);
    const validIds = new Set(tabs.map((t) => t.id));
    stack = stack.filter((id) => validIds.has(id));
    if (activeTab) {
      stack = stack.filter((id) => id !== activeTab.id);
      stack.unshift(activeTab.id);
    }
    // 补充未在 stack 中的其他 tab
    for (const t of tabs) {
      if (!stack.includes(t.id)) {
        stack.push(t.id);
      }
    }
    windowMruMap.set(windowId, stack);
  } catch (err) {
    console.debug('initMruForWindow error:', err);
  }
}

// 获取分组信息辅助函数（带缓存）
async function getTabGroupsMap(groupIds) {
  const groupMap = new Map();
  if (!chrome.tabGroups) return groupMap;
  const uniqueIds = Array.from(new Set(groupIds)).filter((id) => id !== -1 && typeof id === 'number');
  await Promise.all(
    uniqueIds.map(async (gid) => {
      try {
        const group = await chrome.tabGroups.get(gid);
        if (group) {
          groupMap.set(gid, {
            id: group.id,
            title: group.title || '',
            color: group.color || 'grey'
          });
        }
      } catch (e) {
        // 分组可能已被删除
      }
    })
  );
  return groupMap;
}

// 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;

  // 1. 获取增强标签页列表
  if (message.type === 'GET_TABS') {
    handleGetTabs(windowId, message.sortMode)
      .then((tabs) => sendResponse({ tabs }))
      .catch((err) => sendResponse({ tabs: [], error: err.message }));
    return true;
  }

  // 2. 激活指定标签页
  if (message.type === 'ACTIVATE_TAB') {
    chrome.tabs.update(message.tabId, { active: true }).then(() => {
      sendResponse({ status: 'ok' });
    }).catch((err) => {
      sendResponse({ status: 'error', error: err.message });
    });
    return true;
  }

  // 3. 关闭指定标签页
  if (message.type === 'CLOSE_TAB') {
    chrome.tabs.remove(message.tabId).then(async () => {
      const remainingTabs = await chrome.tabs.query({ windowId });
      sendResponse({ status: 'ok', remainingCount: remainingTabs ? remainingTabs.length : 0 });
    }).catch((err) => {
      sendResponse({ status: 'error', error: err.message });
    });
    return true;
  }

  // 4. 切换标签页静音状态
  if (message.type === 'TOGGLE_MUTE') {
    chrome.tabs.get(message.tabId).then((tab) => {
      const currentMuted = !!(tab.mutedInfo && tab.mutedInfo.muted);
      return chrome.tabs.update(message.tabId, { muted: !currentMuted });
    }).then((updatedTab) => {
      sendResponse({
        status: 'ok',
        muted: !!(updatedTab.mutedInfo && updatedTab.mutedInfo.muted)
      });
    }).catch((err) => {
      sendResponse({ status: 'error', error: err.message });
    });
    return true;
  }

  // 5. 相对步进切换（无浮窗模式兜底）
  if (message.type === 'SWITCH_TAB') {
    handleStepSwitch(windowId, message.direction)
      .then((newTab) => sendResponse({ status: 'ok', tab: newTab }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true;
  }
});

async function handleGetTabs(windowId, requestedSortMode) {
  const tabs = await chrome.tabs.query({ windowId });
  if (!tabs || tabs.length === 0) return [];

  if (!windowMruMap.has(windowId)) {
    await initMruForWindow(windowId);
  }

  // 确定排序模式，优先取消息指定的，若无则读 storage，默认 'mru'
  let sortMode = requestedSortMode;
  if (!sortMode) {
    const { sortMode: storedSortMode = 'mru' } = await chrome.storage.sync.get(['sortMode']);
    sortMode = storedSortMode;
  }

  // 提取并获取 tab group 信息
  const groupMap = await getTabGroupsMap(tabs.map((t) => t.groupId));

  const enhancedTabs = tabs.map((t) => {
    const enhanced = {
      id: t.id,
      title: t.title || '新标签页',
      favIconUrl: t.favIconUrl || '',
      active: t.active,
      index: t.index,
      pinned: !!t.pinned,
      audible: !!t.audible,
      muted: !!(t.mutedInfo && t.mutedInfo.muted),
      discarded: !!t.discarded
    };
    if (t.groupId !== undefined && t.groupId !== -1 && groupMap.has(t.groupId)) {
      enhanced.group = groupMap.get(t.groupId);
    }
    return enhanced;
  });

  if (sortMode === 'mru') {
    let stack = windowMruMap.get(windowId) || [];
    // 确保当前活跃的在栈顶
    const activeTab = enhancedTabs.find((t) => t.active);
    if (activeTab) {
      stack = [activeTab.id, ...stack.filter((id) => id !== activeTab.id)];
      windowMruMap.set(windowId, stack);
    }
    const tabMap = new Map(enhancedTabs.map((t) => [t.id, t]));
    const sorted = [];
    // 按 stack 顺序提取
    for (const id of stack) {
      if (tabMap.has(id)) {
        sorted.push(tabMap.get(id));
        tabMap.delete(id);
      }
    }
    // 补齐未在 stack 中的标签
    for (const remaining of tabMap.values()) {
      sorted.push(remaining);
    }
    return sorted;
  } else {
    // 物理顺序
    enhancedTabs.sort((a, b) => a.index - b.index);
    return enhancedTabs;
  }
}

let isSwitching = false;
async function handleStepSwitch(windowId, direction) {
  if (isSwitching) return null;
  isSwitching = true;
  try {
    const tabs = await chrome.tabs.query({ windowId });
    if (!tabs || tabs.length <= 1) return null;

    const { sortMode = 'mru', loopTabs = true } = await chrome.storage.sync.get(['sortMode', 'loopTabs']);
    let sortedTabs = tabs;
    if (sortMode === 'mru') {
      sortedTabs = await handleGetTabs(windowId, 'mru');
    } else {
      sortedTabs.sort((a, b) => a.index - b.index);
    }

    const currentIndex = sortedTabs.findIndex((t) => t.active);
    if (currentIndex === -1) return null;

    let targetIndex;
    if (direction === 'next') {
      targetIndex = currentIndex + 1 < sortedTabs.length ? currentIndex + 1 : loopTabs ? 0 : currentIndex;
    } else {
      targetIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : loopTabs ? sortedTabs.length - 1 : currentIndex;
    }

    if (targetIndex !== currentIndex) {
      const targetTab = sortedTabs[targetIndex];
      await chrome.tabs.update(targetTab.id, { active: true });
      return { id: targetTab.id, title: targetTab.title, favIconUrl: targetTab.favIconUrl, index: targetIndex, total: sortedTabs.length };
    }
    return null;
  } finally {
    isSwitching = false;
  }
}
