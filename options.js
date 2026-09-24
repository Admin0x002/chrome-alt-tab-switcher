const elements = {
  viewMode: () => document.querySelector('input[name="viewMode"]:checked'),
  sortMode: () => document.querySelector('input[name="sortMode"]:checked'),
  triggerMode: () => document.querySelector('input[name="triggerMode"]:checked'),
  sensitivity: document.getElementById('sensitivity'),
  valSensitivity: document.getElementById('valSensitivity'),
  invertDirection: document.getElementById('invertDirection'),
  loopTabs: document.getElementById('loopTabs'),
  mouseHoverSelect: document.getElementById('mouseHoverSelect'),
  mouseHoverThreshold: document.getElementById('mouseHoverThreshold'),
  valMouseHoverThreshold: document.getElementById('valMouseHoverThreshold'),
  hoverThresholdContainer: document.getElementById('hoverThresholdContainer'),
  altArrowTrigger: document.getElementById('altArrowTrigger'),
  status: document.getElementById('status')
};

// 加载已有配置
chrome.storage.sync.get({
  viewMode: 'classic',
  sortMode: 'mru',
  triggerMode: 'strict',
  sensitivity: 100,
  invertDirection: false,
  loopTabs: true,
  mouseHoverSelect: true,
  mouseHoverThreshold: 10,
  altArrowTrigger: true
}, (items) => {
  const vmRadio = document.querySelector(`input[name="viewMode"][value="${items.viewMode}"]`);
  if (vmRadio) vmRadio.checked = true;

  const tmRadio = document.querySelector(`input[name="triggerMode"][value="${items.triggerMode}"]`);
  if (tmRadio) tmRadio.checked = true;
  const smRadio = document.querySelector(`input[name="sortMode"][value="${items.sortMode || 'mru'}"]`);
  if (smRadio) smRadio.checked = true;


  elements.sensitivity.value = items.sensitivity;
  elements.valSensitivity.textContent = items.sensitivity;
  elements.invertDirection.checked = items.invertDirection;
  elements.loopTabs.checked = items.loopTabs;
  elements.mouseHoverSelect.checked = items.mouseHoverSelect !== false;
  elements.mouseHoverThreshold.value = items.mouseHoverThreshold !== undefined ? items.mouseHoverThreshold : 10;
  elements.valMouseHoverThreshold.textContent = elements.mouseHoverThreshold.value;
  elements.hoverThresholdContainer.style.opacity = elements.mouseHoverSelect.checked ? '1' : '0.5';
  elements.altArrowTrigger.checked = items.altArrowTrigger !== false;
});

// 保存配置
function save() {
  chrome.storage.sync.set({
    viewMode: elements.viewMode().value,
    sortMode: elements.sortMode().value,
    triggerMode: elements.triggerMode().value,
    sensitivity: parseInt(elements.sensitivity.value, 10),
    invertDirection: elements.invertDirection.checked,
    loopTabs: elements.loopTabs.checked,
    mouseHoverSelect: elements.mouseHoverSelect.checked,
    mouseHoverThreshold: parseInt(elements.mouseHoverThreshold.value, 10),
    altArrowTrigger: elements.altArrowTrigger.checked
  }, () => {
    elements.status.textContent = '设置已自动同步';
    setTimeout(() => { elements.status.textContent = ''; }, 1200);
  });
}
document.querySelectorAll('input').forEach((input) => {
  if (input.type === 'range') {
    input.addEventListener('input', () => {
      if (input.id === 'sensitivity') {
        elements.valSensitivity.textContent = input.value;
      } else if (input.id === 'mouseHoverThreshold') {
        elements.valMouseHoverThreshold.textContent = input.value;
      }
      save();
    });
  } else {
    input.addEventListener('change', () => {
      if (input.id === 'mouseHoverSelect') {
        elements.hoverThresholdContainer.style.opacity = elements.mouseHoverSelect.checked ? '1' : '0.5';
      }
      save();
    });
  }
});