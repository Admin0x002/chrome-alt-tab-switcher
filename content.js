// content.js - 前台 HUD 视图渲染与事件交互

let config = {
  viewMode: 'classic',       // 'classic': Alt+Tab 浮窗; 'off': 极速切换(无浮窗)
  sortMode: 'mru',           // 'mru': 最近使用; 'index': 物理顺序
  triggerMode: 'strict',     // 'strict': 严格段落刻度; 'accumulate': 累加模式
  sensitivity: 100,          // 阈值
  cooldown: 80,              // 防抖间隔(ms)
  invertDirection: false,
  loopTabs: true,
  mouseHoverSelect: true,    // 允许鼠标悬停跟随高亮
  mouseHoverThreshold: 10,   // 鼠标防误触移动距离阈值 (px)
  altArrowTrigger: true      // 允许 Alt+ArrowUp/Down 唤出并切换
};

// 同步设置
chrome.storage.sync.get(config, (res) => { Object.assign(config, res); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    for (let k in changes) config[k] = changes[k].newValue;
  }
});

// 状态管理
let isHudVisible = false;
let tabsData = [];
let currentIndex = -1;       // 当前高亮选中的索引
let originIndex = -1;        // 呼出前原本停留的标签页索引
let lastTriggerTime = 0;
let wheelAccumulator = 0;
let cancelledByRightClick = false; // 右键取消标记
let hudShowMousePos = null;        // HUD 唤出时的鼠标初始坐标 { x, y }
let isMouseUnlocked = false;       // 鼠标移动是否超过防误触阈值
// ---------- 1. 基于 Shadow DOM 的居中浮窗构建 ----------
const hostEl = document.createElement('div');
hostEl.id = 'chrome-alt-tab-hud-root';
const shadow = hostEl.attachShadow({ mode: 'open' });
document.documentElement.appendChild(hostEl);

shadow.innerHTML = `
<style>
  .hud-mask {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0, 0, 0, 0.45);
    display: none; align-items: center; justify-content: center;
    z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .hud-card {
    background: rgba(30, 30, 36, 0.92);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 16px; padding: 14px 14px 10px 14px;
    width: 560px; max-width: 88vw; max-height: 480px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column; gap: 4px;
    color: #fff; box-sizing: border-box;
  }
  .tab-list {
    display: flex; flex-direction: column; gap: 4px;
    overflow-y: auto; max-height: 380px; padding-right: 2px;
  }
  .tab-list::-webkit-scrollbar { width: 6px; }
  .tab-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
  
  .tab-row {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 8px;
    font-size: 13.5px; transition: background 0.08s ease, transform 0.08s ease;
    position: relative; box-sizing: border-box;
    cursor: pointer; user-select: none;
  }
  .tab-row:hover:not(.active) {
    background: rgba(255, 255, 255, 0.08);
  }
  /* 高亮选中样式 */
  .tab-row.active {
    background: #2563eb !important; color: #fff !important; font-weight: 500;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
  }
  /* 切换前原本停留的标签页标记 */
  .tab-row.origin-tab:not(.active) {
    background: rgba(56, 189, 248, 0.08);
    border-left: 3px solid #38bdf8;
    padding-left: 7px;
  }
  .tab-badge-origin {
    font-size: 10px; padding: 1px 5px; border-radius: 4px;
    background: rgba(56, 189, 248, 0.2);
    border: 1px solid rgba(56, 189, 248, 0.5);
    color: #7dd3fc; flex-shrink: 0; font-weight: normal;
  }
  .tab-row.active .tab-badge-origin {
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.5);
    color: #ffffff;
  }

  .tab-icon { width: 18px; height: 18px; border-radius: 3px; flex-shrink: 0; object-fit: contain; }
  .tab-icon-fallback {
    width: 18px; height: 18px; border-radius: 3px; background: rgba(255,255,255,0.2);
    display: inline-flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0;
  }
  .tab-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tab-index { font-size: 11px; opacity: 0.6; flex-shrink: 0; }

  /* Tab Groups 颜色徽章 */
  .tab-group-badge {
    font-size: 10px; padding: 1px 6px; border-radius: 4px;
    font-weight: 600; flex-shrink: 0; max-width: 90px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .group-grey   { background: rgba(128, 134, 139, 0.3); border: 1px solid #9aa0a6; color: #dadce0; }
  .group-blue   { background: rgba(26, 115, 232, 0.3); border: 1px solid #8ab4f8; color: #8ab4f8; }
  .group-red    { background: rgba(217, 48, 37, 0.3); border: 1px solid #f28b82; color: #f28b82; }
  .group-yellow { background: rgba(242, 153, 0, 0.3); border: 1px solid #fdd663; color: #fdd663; }
  .group-green  { background: rgba(24, 128, 56, 0.3); border: 1px solid #81c995; color: #81c995; }
  .group-pink   { background: rgba(208, 24, 132, 0.3); border: 1px solid #ff8bcb; color: #ff8bcb; }
  .group-purple { background: rgba(161, 66, 244, 0.3); border: 1px solid #c58af9; color: #c58af9; }
  .group-cyan   { background: rgba(0, 123, 131, 0.3); border: 1px solid #78d9ec; color: #78d9ec; }
  .group-orange { background: rgba(232, 113, 10, 0.3); border: 1px solid #fcad70; color: #fcad70; }

  /* 状态图标：固定、休眠、发声/静音 */
  .tab-badge-icon {
    font-size: 12px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  }
  @keyframes audio-pulse {
    0% { transform: scale(0.95); opacity: 0.7; }
    50% { transform: scale(1.18); opacity: 1; filter: drop-shadow(0 0 5px #4ade80); }
    100% { transform: scale(0.95); opacity: 0.7; }
  }
  .tab-audio-icon {
    font-size: 13px; flex-shrink: 0; cursor: pointer; display: inline-flex; align-items: center;
    border-radius: 4px; padding: 1px 3px;
  }
  .tab-audio-icon:hover { background: rgba(255, 255, 255, 0.2); }
  .tab-audio-icon.audible { animation: audio-pulse 1.2s infinite ease-in-out; }
  .tab-audio-icon.muted { opacity: 0.65; }

  /* 底部操作指引提示条 */
  .hud-footer {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 6px; padding-top: 8px; flex-wrap: wrap; gap: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 11px; color: rgba(255, 255, 255, 0.55);
    user-select: none;
  }
  .hud-footer span { display: inline-flex; align-items: center; gap: 3px; }
  .hud-footer kbd {
    background: rgba(255, 255, 255, 0.15); padding: 1px 4px; border-radius: 3px; color: #eee;
  }
</style>
<div class="hud-mask" id="mask">
  <div class="hud-card">
    <div class="tab-list" id="cardList"></div>
    <div class="hud-footer">
      <span>🖱️ 滚轮 / <kbd>Alt</kbd>+<kbd>↑</kbd><kbd>↓</kbd> 呼出与切换</span>
      <span>🖱️ 中键 / <kbd>W</kbd> / <kbd>Del</kbd> / <kbd>Esc</kbd> 关闭</span>
      <span><kbd>M</kbd> 静音</span>
      <span>🖱️ 右键 取消</span>
      <span>⌨️ 松开 Alt 跳转</span>
    </div>
  </div>
</div>
`;

const maskEl = shadow.getElementById('mask');
const cardListEl = shadow.getElementById('cardList');

// 安全发送消息包装器：防御 Extension Context Invalidation
function safeSendMessage(message, callback) {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    cleanupListeners();
    return;
  }

  try {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        return;
      }
      if (callback) callback(res);
    });
  } catch (err) {
    console.debug('[Alt-Tab-Wheel] 通信通道已注销:', err);
    cleanupListeners();
  }
}

function cleanupListeners() {
  window.removeEventListener('wheel', onWheelCapture, { capture: true });
  window.removeEventListener('keydown', onKeyDownCapture, true);
  window.removeEventListener('keyup', onKeyUpCapture, true);
}

function escapeHtml(text) {
  return (text || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function renderHud() {
  cardListEl.innerHTML = '';
  tabsData.forEach((tab, idx) => {
    const row = document.createElement('div');
    const isSelected = (idx === currentIndex);
    const isOrigin = (idx === originIndex);

    row.className = `tab-row ${isSelected ? 'active' : ''} ${isOrigin ? 'origin-tab' : ''}`;
    row.dataset.index = idx;

    // 图标
    const iconHtml = tab.favIconUrl
      ? `<img class="tab-icon" src="${escapeHtml(tab.favIconUrl)}" onerror="this.outerHTML='<span class=\\'tab-icon-fallback\\'>📄</span>'"/>`
      : `<span class="tab-icon-fallback">📄</span>`;

    // 状态标识：Pinned
    const pinnedHtml = tab.pinned ? `<span class="tab-badge-icon" title="固定标签">📌</span>` : '';

    // 状态标识：Discarded
    const discardedHtml = tab.discarded ? `<span class="tab-badge-icon" title="已休眠 (唤醒时需重载)">💤</span>` : '';

    // 状态标识：Group
    let groupHtml = '';
    if (tab.group) {
      const gColor = tab.group.color || 'grey';
      const gTitle = tab.group.title || '分组';
      groupHtml = `<span class="tab-group-badge group-${escapeHtml(gColor)}" title="分组: ${escapeHtml(gTitle)}">${escapeHtml(gTitle)}</span>`;
    }

    // 状态标识：Audio / Muted
    let audioHtml = '';
    if (tab.muted) {
      audioHtml = `<span class="tab-audio-icon muted" data-action="toggle-mute" title="已静音 (点击或按 M 取消静音)">🔇</span>`;
    } else if (tab.audible) {
      audioHtml = `<span class="tab-audio-icon audible" data-action="toggle-mute" title="正在播放声音 (点击或按 M 静音)">🔊</span>`;
    }

    // 原停留标签页徽章
    const originBadge = isOrigin ? `<span class="tab-badge-origin">当前停留</span>` : '';

    row.innerHTML = `
      ${pinnedHtml}
      ${iconHtml}
      ${groupHtml}
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      ${discardedHtml}
      ${audioHtml}
      ${originBadge}
      <span class="tab-index">${idx + 1}/${tabsData.length}</span>
    `;

    cardListEl.appendChild(row);
  });

  const activeEl = cardListEl.querySelector('.tab-row.active');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

function showHud() {
  maskEl.style.display = 'flex';
  isHudVisible = true;
  cancelledByRightClick = false;
  hudShowMousePos = null;
  isMouseUnlocked = false; // 唤出时默认锁定鼠标高亮，防止原地光标误选
}

function hideHud() {
  maskEl.style.display = 'none';
  isHudVisible = false;
  wheelAccumulator = 0;
  hudShowMousePos = null;
  isMouseUnlocked = false;
}

function moveSelection(direction) {
  if (tabsData.length <= 1) return;
  if (direction === 'next') {
    currentIndex = currentIndex + 1 < tabsData.length ? currentIndex + 1 : config.loopTabs ? 0 : currentIndex;
  } else {
    currentIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : config.loopTabs ? tabsData.length - 1 : currentIndex;
  }
}

// 关闭指定索引的标签
function closeTabAtIndex(targetIdx) {
  if (targetIdx < 0 || targetIdx >= tabsData.length) return;
  const targetTab = tabsData[targetIdx];
  if (!targetTab) return;

  safeSendMessage({ type: 'CLOSE_TAB', tabId: targetTab.id }, (res) => {
    // 后台完成通知
  });

  tabsData.splice(targetIdx, 1);
  if (tabsData.length === 0) {
    hideHud();
    return;
  }

  if (originIndex === targetIdx) {
    originIndex = -1;
  } else if (originIndex > targetIdx) {
    originIndex--;
  }

  if (currentIndex >= tabsData.length) {
    currentIndex = tabsData.length - 1;
  }
  renderHud();
}

// 切换指定索引标签的静音状态
function toggleMuteAtIndex(targetIdx) {
  if (targetIdx < 0 || targetIdx >= tabsData.length) return;
  const targetTab = tabsData[targetIdx];
  if (!targetTab) return;

  safeSendMessage({ type: 'TOGGLE_MUTE', tabId: targetTab.id }, (res) => {
    if (res && res.status === 'ok') {
      targetTab.muted = res.muted;
      renderHud();
    }
  });
}

// 确认激活当前选中项
function activateCurrentTab() {
  if (currentIndex < 0 || currentIndex >= tabsData.length) {
    hideHud();
    return;
  }
  const selectedTab = tabsData[currentIndex];
  hideHud();
  if (selectedTab && !selectedTab.active) {
    safeSendMessage({ type: 'ACTIVATE_TAB', tabId: selectedTab.id });
  }
}

// ---------- 2. 交互逻辑 (鼠标滚轮、按键、卡片点击) ----------

// 滚轮事件
function onWheelCapture(e) {
  if (!e.altKey) {
    wheelAccumulator = 0;
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const now = performance.now();
  if (now - lastTriggerTime < config.cooldown) return;

  let delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (e.deltaMode === 1) delta *= 33;
  else if (e.deltaMode === 2) delta *= 100;

  let shouldTrigger = false;
  let stepDirection = 0;

  if (config.triggerMode === 'strict') {
    if (Math.abs(delta) >= config.sensitivity) {
      shouldTrigger = true;
      stepDirection = delta > 0 ? 1 : -1;
    }
  } else {
    if ((delta > 0 && wheelAccumulator < 0) || (delta < 0 && wheelAccumulator > 0)) wheelAccumulator = 0;
    wheelAccumulator += delta;
    if (Math.abs(wheelAccumulator) >= config.sensitivity) {
      shouldTrigger = true;
      stepDirection = wheelAccumulator > 0 ? 1 : -1;
      wheelAccumulator = 0;
    }
  }

  if (!shouldTrigger) return;
  lastTriggerTime = now;

  if (config.invertDirection) stepDirection = -stepDirection;
  const directionStr = stepDirection > 0 ? 'next' : 'prev';

  triggerOrMoveHud(directionStr);
}

window.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });

// 鼠标悬停高亮跟随 (带防误触距离阈值)
cardListEl.addEventListener('mousemove', (e) => {
  if (!config.mouseHoverSelect) return;

  const threshold = typeof config.mouseHoverThreshold === 'number' ? config.mouseHoverThreshold : 10;

  if (threshold <= 0) {
    isMouseUnlocked = true;
  } else {
    if (!hudShowMousePos) {
      hudShowMousePos = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!isMouseUnlocked) {
      const dist = Math.hypot(e.clientX - hudShowMousePos.x, e.clientY - hudShowMousePos.y);
      if (dist < threshold) return;
      isMouseUnlocked = true;
    }
  }

  const row = e.target.closest('.tab-row');
  if (!row) return;
  const targetIdx = parseInt(row.dataset.index, 10);
  if (!isNaN(targetIdx) && targetIdx !== currentIndex) {
    currentIndex = targetIdx;
    renderHud();
  }
});

// 鼠标左键点击跳转
cardListEl.addEventListener('click', (e) => {
  const audioBtn = e.target.closest('[data-action="toggle-mute"]');
  if (audioBtn) {
    e.stopPropagation();
    const row = audioBtn.closest('.tab-row');
    if (row) {
      toggleMuteAtIndex(parseInt(row.dataset.index, 10));
    }
    return;
  }

  const row = e.target.closest('.tab-row');
  if (!row) return;
  const targetIdx = parseInt(row.dataset.index, 10);
  const targetTab = tabsData[targetIdx];
  if (targetTab) {
    hideHud();
    if (!targetTab.active) {
      safeSendMessage({ type: 'ACTIVATE_TAB', tabId: targetTab.id });
    }
  }
});

// 鼠标中键 (button === 1) 关闭标签
cardListEl.addEventListener('auxclick', (e) => {
  if (e.button === 1) {
    e.preventDefault();
    e.stopPropagation();
    const row = e.target.closest('.tab-row');
    if (!row) return;
    const targetIdx = parseInt(row.dataset.index, 10);
    closeTabAtIndex(targetIdx);
  }
});

// 按右键取消切换
window.addEventListener(
  'mousedown',
  (e) => {
    if (isHudVisible && e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      cancelledByRightClick = true;
      hideHud();
    }
  },
  true
);

// 拦截右键上下文菜单
window.addEventListener(
  'contextmenu',
  (e) => {
    if (cancelledByRightClick || isHudVisible) {
      e.preventDefault();
      e.stopPropagation();
      cancelledByRightClick = false;
    }
  },
  true
);

// 键盘按键监听 (包括 Esc 关闭当前停留标签、W/Del 关闭、M 静音、上下箭头与 Tab 移动)
// 统一的触发或移动 HUD 流程
function triggerOrMoveHud(directionStr) {
  if (config.viewMode === 'classic') {
    if (!isHudVisible) {
      safeSendMessage({ type: 'GET_TABS', sortMode: config.sortMode }, (res) => {
        if (res && res.tabs) {
          tabsData = res.tabs;
          originIndex = tabsData.findIndex((t) => t.active);
          currentIndex = originIndex >= 0 ? originIndex : 0;
          moveSelection(directionStr);
          showHud();
          renderHud();
        }
      });
    } else {
      moveSelection(directionStr);
      renderHud();
    }
  } else {
    safeSendMessage({ type: 'SWITCH_TAB', direction: directionStr });
  }
}

// 键盘按键监听 (包括 Esc 关闭当前停留标签、W/Del 关闭、M 静音、上下箭头与 Tab 移动、Alt+Arrow 唤出)
function onKeyDownCapture(e) {
  // 1. 如果 HUD 未展示，检测 Alt + ArrowUp / Alt + ArrowDown 直接触发 HUD
  if (!isHudVisible) {
    if (config.altArrowTrigger && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      const directionStr = e.key === 'ArrowDown' ? 'next' : 'prev';
      triggerOrMoveHud(directionStr);
    }
    return;
  }

  // 以下为 HUD 展示时的按键逻辑

  // 2. Esc 键关闭停留的标签页
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeTabAtIndex(currentIndex);
    return;
  }

  // 3. Delete / Backspace / W 关闭当前标签
  if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    e.stopPropagation();
    closeTabAtIndex(currentIndex);
    return;
  }

  // 4. M 键切换静音
  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    e.stopPropagation();
    toggleMuteAtIndex(currentIndex);
    return;
  }

  // 5. 键盘上下或 Tab 移动高亮 (支持纯 ArrowDown/Up 或按住 Alt+ArrowDown/Up)
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    moveSelection('next');
    renderHud();
    return;
  }

  if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    moveSelection('prev');
    renderHud();
    return;
  }

  // 6. Enter 确认激活
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    activateCurrentTab();
    return;
  }
}


window.addEventListener('keydown', onKeyDownCapture, true);

// 监听松开 Alt 键：确认切换
function onKeyUpCapture(e) {
  if (e.key === 'Alt') {
    if (isHudVisible && config.viewMode === 'classic') {
      e.preventDefault();
      activateCurrentTab();
    }
  }
}

window.addEventListener('keyup', onKeyUpCapture, true);

window.addEventListener('blur', hideHud);
