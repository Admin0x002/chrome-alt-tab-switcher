const elements = {
  viewMode: () => document.querySelector('input[name="viewMode"]:checked'),
  triggerMode: () => document.querySelector('input[name="triggerMode"]:checked'),
  sensitivity: document.getElementById('sensitivity'),
  valSensitivity: document.getElementById('valSensitivity'),
  invertDirection: document.getElementById('invertDirection'),
  loopTabs: document.getElementById('loopTabs'),
  status: document.getElementById('status')
};

// 加载已有配置
chrome.storage.sync.get({
  viewMode: 'classic',
  triggerMode: 'strict',
  sensitivity: 100,
  invertDirection: false,
  loopTabs: true
}, (items) => {
  const vmRadio = document.querySelector(`input[name="viewMode"][value="${items.viewMode}"]`);
  if (vmRadio) vmRadio.checked = true;

  const tmRadio = document.querySelector(`input[name="triggerMode"][value="${items.triggerMode}"]`);
  if (tmRadio) tmRadio.checked = true;

  elements.sensitivity.value = items.sensitivity;
  elements.valSensitivity.textContent = items.sensitivity;
  elements.invertDirection.checked = items.invertDirection;
  elements.loopTabs.checked = items.loopTabs;
});

// 保存配置
function save() {
  chrome.storage.sync.set({
    viewMode: elements.viewMode().value,
    triggerMode: elements.triggerMode().value,
    sensitivity: parseInt(elements.sensitivity.value, 10),
    invertDirection: elements.invertDirection.checked,
    loopTabs: elements.loopTabs.checked
  }, () => {
    elements.status.textContent = '设置已自动同步';
    setTimeout(() => { elements.status.textContent = ''; }, 1200);
  });
}

document.querySelectorAll('input').forEach((input) => {
  if (input.type === 'range') {
    input.addEventListener('input', () => {
      elements.valSensitivity.textContent = input.value;
      save();
    });
  } else {
    input.addEventListener('change', save);
  }
});