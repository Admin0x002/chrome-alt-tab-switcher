let config = {
  viewMode: 'classic',       // 'classic': 系统 Alt+Tab 浮窗模式; 'instant_hud': 即时切换+气泡; 'off': 关闭
  triggerMode: 'strict',     // 'strict': 严格段落刻度模式 (适合 G502 X); 'accumulate': 累加模式
  sensitivity: 100,          // G502 X 推荐 90~120
  cooldown: 80,              // 防抖间隔(ms)
  invertDirection: false,
  loopTabs: true
};

// 读取并监听配置
chrome.storage.sync.get(config, (res) => { Object.assign(config, res); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    for (let k in changes) config[k] = changes[k].newValue;
  }
});

// 状态管理
let isHudVisible = false;
let tabsData = [];
let currentIndex = -1;
let lastTriggerTime = 0;
let wheelAccumulator = 0;

// ---------- 1. 创建基于 Shadow DOM 的居中浮窗 ----------
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
    background: rgba(30, 30, 36, 0.88);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 16px; padding: 14px;
    width: 500px; max-width: 85vw; max-height: 420px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column; gap: 4px;
    overflow-y: auto; color: #fff; box-sizing: border-box;
  }
  .hud-card::-webkit-scrollbar { width: 6px; }
  .hud-card::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
  .tab-row {
    display: flex; align-items: center; gap: 12px;
    padding: 9px 12px; border-radius: 8px;
    font-size: 13.5px; transition: background 0.08s ease;
  }
  .tab-row.active {
    background: #2563eb; color: #fff; font-weight: 500;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
  }
  .tab-icon { width: 18px; height: 18px; border-radius: 3px; flex-shrink: 0; object-fit: contain; }
  .tab-icon-fallback {
    width: 18px; height: 18px; border-radius: 3px; background: rgba(255,255,255,0.2);
    display: inline-flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0;
  }
  .tab-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tab-index { font-size: 11px; opacity: 0.6; flex-shrink: 0; }
</style>
<div class="hud-mask" id="mask">
  <div class="hud-card" id="cardList"></div>
</div>
`;

const maskEl = shadow.getElementById('mask');
const cardListEl = shadow.getElementById('cardList');

function renderHud() {
  cardListEl.innerHTML = '';
  tabsData.forEach((tab, idx) => {
    const row = document.createElement('div');
    row.className = `tab-row ${idx === currentIndex ? 'active' : ''}`;
    row.dataset.index = idx;

    const iconHtml = tab.favIconUrl
      ? `<img class="tab-icon" src="${tab.favIconUrl}" onerror="this.outerHTML='<span class=\\'tab-icon-fallback\\'>📄</span>'"/>`
      : `<span class="tab-icon-fallback">📄</span>`;

    row.innerHTML = `
      ${iconHtml}
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      <span class="tab-index">${idx + 1}/${tabsData.length}</span>
    `;
    cardListEl.appendChild(row);
  });

  const activeEl = cardListEl.querySelector('.tab-row.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function showHud() {
  maskEl.style.display = 'flex';
  isHudVisible = true;
}

function hideHud() {
  maskEl.style.display = 'none';
  isHudVisible = false;
  wheelAccumulator = 0;
}

// ---------- 2. 滚轮与按键交互逻辑 ----------
window.addEventListener(
  'wheel',
  (e) => {
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

    // 【针对 G502 X 的模式判定】
    if (config.triggerMode === 'strict') {
      // 严格模式：单次物理刻度达不到设定的阈值，直接过滤微小位移（完全不累加）
      if (Math.abs(delta) >= config.sensitivity) {
        shouldTrigger = true;
        stepDirection = delta > 0 ? 1 : -1;
      }
    } else {
      // 平滑累加模式
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

    // 模式 A：系统级 Alt+Tab 浮窗
    if (config.viewMode === 'classic') {
      if (!isHudVisible) {
        chrome.runtime.sendMessage({ type: 'GET_TABS' }, (res) => {
          if (res && res.tabs) {
            tabsData = res.tabs;
            currentIndex = tabsData.findIndex((t) => t.active);
            moveSelection(directionStr);
            showHud();
            renderHud();
          }
        });
      } else {
        moveSelection(directionStr);
        renderHud();
      }
    } 
    // 模式 B / C：即时切换
    else {
      chrome.runtime.sendMessage({ type: 'SWITCH_TAB', direction: directionStr });
    }
  },
  { passive: false, capture: true }
);

function moveSelection(direction) {
  if (tabsData.length <= 1) return;
  if (direction === 'next') {
    currentIndex = currentIndex + 1 < tabsData.length ? currentIndex + 1 : config.loopTabs ? 0 : currentIndex;
  } else {
    currentIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : config.loopTabs ? tabsData.length - 1 : currentIndex;
  }
}

// 监听松开 Alt：若处于经典浮窗模式，立即跳转到选中的标签页
window.addEventListener(
  'keyup',
  (e) => {
    if (e.key === 'Alt') {
      if (isHudVisible && config.viewMode === 'classic') {
        e.preventDefault();
        const selectedTab = tabsData[currentIndex];
        hideHud();
        if (selectedTab && !selectedTab.active) {
          chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: selectedTab.id });
        }
      }
    }
  },
  true
);

// Esc 键取消浮窗
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isHudVisible) {
    e.preventDefault();
    hideHud();
  }
}, true);

window.addEventListener('blur', hideHud);