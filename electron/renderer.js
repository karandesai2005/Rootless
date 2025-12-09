const outEl = document.getElementById('out');
const runBtn = document.getElementById('run');

runBtn.onclick = async () => {
  const tool = document.getElementById('tool').value.trim();
  const target = document.getElementById('target').value.trim();
  if (!tool || !target) {
    outEl.textContent = 'tool and target required';
    return;
  }
  outEl.textContent = 'sending request...';

  const result = await window.api.runTool({ tool, target });
  if (!result.ok) {
    outEl.textContent = 'ERROR: ' + result.error;
    return;
  }
  outEl.textContent = JSON.stringify(result.data, null, 2);
};
