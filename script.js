let ws;
const wsStatus = document.getElementById('wsStatus');
const scanBtn = document.getElementById('scanBtn');
const scanText = document.getElementById('scanText');
const status = document.getElementById('status');
const resultsContainer = document.getElementById('resultsContainer');
const scannerForm = document.getElementById('scannerForm');

function connectWebSocket() {
  const wsUrl = 'wss://brisk-1qsf.onrender.com/ws';
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    wsStatus.textContent = 'WebSocket: Connected';
    wsStatus.className = 'ws-status connected';
    scanBtn.disabled = false;
    console.log('WebSocket connected to', wsUrl);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'signal') {
        renderSignals(data.signals);
        status.textContent = 'Scan Complete';
        status.className = 'status complete';
        scanText.textContent = 'Scan Now';
        scanBtn.disabled = false;
      } else if (data.type === 'error') {
        status.textContent = `Error: ${data.message}`;
        status.className = 'status error';
        scanText.textContent = 'Scan Now';
        scanBtn.disabled = false;
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      status.textContent = 'Error: Invalid response from server';
      status.className = 'status error';
      scanText.textContent = 'Scan Now';
      scanBtn.disabled = false;
    }
  };

  ws.onclose = () => {
    wsStatus.textContent = 'WebSocket: Disconnected';
    wsStatus.className = 'ws-status disconnected';
    scanBtn.disabled = true;
    console.log('WebSocket disconnected, reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    wsStatus.textContent = 'WebSocket: Error';
    wsStatus.className = 'ws-status error';
    scanBtn.disabled = true;
  };
}

function renderSignals(signals) {
  resultsContainer.innerHTML = '';
  if (!signals || signals.length === 0) {
    resultsContainer.innerHTML = '<div class="no-results">No signals found</div>';
    return;
  }

  signals.forEach((signal) => {
    const signalCard = document.createElement('div');
    signalCard.className = `signal-card ${signal.type.toLowerCase()}`;
    signalCard.innerHTML = `
      <div class="signal-header">
        <span class="pair-name">${signal.pair}</span>
        <span class="signal-badge ${signal.type.toLowerCase()}">${signal.type}</span>
      </div>
      <div class="signal-details">
        <div class="detail-item">
          <span class="detail-label">Exchange</span>
          <span class="detail-value">${signal.exchange}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Price</span>
          <span class="detail-value">${signal.price}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Timeframe</span>
          <span class="detail-value">${signal.timeframe}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Indicators</span>
          <span class="detail-value">${signal.indicators?.join(', ') || 'N/A'}</span>
        </div>
      </div>
    `;
    resultsContainer.appendChild(signalCard);
  });
}

scannerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    status.textContent = 'Error: WebSocket not connected';
    status.className = 'status error';
    return;
  }

  scanText.textContent = 'Scanning...';
  scanBtn.disabled = true;
  status.textContent = 'Scanning...';
  status.className = 'status scanning';

  const formData = {
    minVolume: parseFloat(document.getElementById('minVolume').value) || 100000,
    marketType: Array.from(document.getElementById('marketType').selectedOptions).map((opt) => opt.value),
    exchanges: Array.from(document.getElementById('exchanges').selectedOptions).map((opt) => opt.value),
    indicators: Array.from(document.getElementById('indicators').selectedOptions).map((opt) => opt.value),
    signals: Array.from(document.getElementById('signals').selectedOptions).map((opt) => opt.value),
    quoteCurrency: Array.from(document.getElementById('quoteCurrency').selectedOptions).map((opt) => opt.value),
    orderTypes: Array.from(document.getElementById('orderTypes').selectedOptions).map((opt) => opt.value),
    trend: Array.from(document.getElementById('trend').selectedOptions).map((opt) => opt.value),
    fibLevels: Array.from(document.getElementById('fibLevels').selectedOptions).map((opt) => opt.value),
    intervals: Array.from(document.getElementById('intervals').selectedOptions).map((opt) => opt.value),
    bbPeriod: parseInt(document.getElementById('bbPeriod')?.value) || 20,
    bbStdDev: parseFloat(document.getElementById('bbStdDev')?.value) || 2,
    rsiPeriod: parseInt(document.getElementById('rsiPeriod')?.value) || 14,
    macdFast: parseInt(document.getElementById('macdFast')?.value) || 12,
    macdSlow: parseInt(document.getElementById('macdSlow')?.value) || 26,
    macdSignal: parseInt(document.getElementById('macdSignal')?.value) || 9
  };

  ws.send(JSON.stringify({ type: 'scan', data: formData }));
});

connectWebSocket();