function setStatus(id, text, className) {
  const element = document.getElementById(id);
  element.textContent = text;
  element.className = className;
}

function showKey(id, isSet) {
  setStatus(id, isSet ? 'Set' : 'Not set yet', isSet ? 'good' : 'warn');
}

async function checkServer() {
  try {
    const response = await fetch('/api/health');
    const health = await response.json();
    setStatus('status-server', 'Connected', 'good');
    showKey('status-tmdb', health.keys.tmdb);
    showKey('status-anthropic', health.keys.anthropic);
    showKey('status-model', health.keys.model);
  } catch (error) {
    setStatus('status-server', 'Not reachable', 'warn');
  }
}

checkServer();
