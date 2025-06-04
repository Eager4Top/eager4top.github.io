let ws;
const wsStatus = document.getElementById('wsStatus');
const scanBtn = document.getElementById('scanBtn');
const scanText = document.getElementById('scanText');
const status = document.getElementById('status');
const resultsContainer = document.getElementById('resultsContainer');

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
    signalCard.className = `signal-card ${signal.signal.toLowerCase()}`;
    signalCard.innerHTML = `
      <div class="signal-header">
        <span class="pair-name">${signal.pair}</span>
        <span class="signal-badge ${signal.signal.toLowerCase()}">${signal.signal}</span>
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
          <span class="detail-label">Indicator</span>
          <span class="detail-value">${signal.indicator || 'N/A'}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Reason</span>
          <span class="detail-value">${signal.reason || 'N/A'}</span>
        </div>
      </div>
    `;
    resultsContainer.appendChild(signalCard);
  });
}

scanBtn.addEventListener('click', (e) => {
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
    marketType: Array.from(document.getElementById('marketType').selectedOptions).map(opt => opt.value),
    exchanges: Array.from(document.getElementById('exchanges').selectedOptions).map(opt => opt.value.toLowerCase()),
    indicators: Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
    signals: Array.from(document.getElementById('signals').selectedOptions).map(opt => opt.value),
    quoteCurrency: Array.from(document.getElementById('quoteCurrency').selectedOptions).map(opt => opt.value),
    orderTypes: Array.from(document.getElementById('orderTypes').selectedOptions).map(opt => opt.value),
    trend: Array.from(document.getElementById('trend').selectedOptions).map(opt => opt.value),
    fibLevels: Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => parseFloat(opt.value)),
    candlePatterns: Array.from(document.getElementById('candlePatterns').selectedOptions).map(opt => opt.value),
    intervals: Array.from(document.getElementById('intervals').selectedOptions).map(opt => opt.value),
    confirmTimeframes: Array.from(document.getElementById('confirmTimeframes').selectedOptions).map(opt => opt.value),
    bbPeriod: parseInt(document.getElementById('bbPeriod').value) || 20,
    bbStdDev: parseFloat(document.getElementById('bbStdDev').value) || 2,
    bbMargin: parseFloat(document.getElementById('bbMargin').value) || 0.2,
    rsiPeriod: parseInt(document.getElementById('rsiPeriod').value) || 14,
    macdFast: parseInt(document.getElementById('macdFast').value) || 12,
    macdSlow: parseInt(document.getElementById('macdSlow').value) || 26,
    macdSignal: parseInt(document.getElementById('macdSignal').value) || 9,
    kdjPeriod: parseInt(document.getElementById('kdjPeriod').value) || 9,
    kdjK: parseInt(document.getElementById('kdjK').value) || 3,
    kdjD: parseInt(document.getElementById('kdjD').value) || 3,
    sarStep: parseFloat(document.getElementById('sarStep').value) || 0.02,
    sarMaxStep: parseFloat(document.getElementById('sarMaxStep').value) || 0.2,
    sarMargin: parseFloat(document.getElementById('sarMargin').value) || 0.5,
    ichimokuTenkan: parseInt(document.getElementById('ichimokuTenkan').value) || 9,
    ichimokuKijun: parseInt(document.getElementById('ichimokuKijun').value) || 26,
    ichimokuSenkouB: parseInt(document.getElementById('ichimokuSenkouB').value) || 52,
    donchianPeriod: parseInt(document.getElementById('donchianPeriod').value) || 20,
    stochKPeriod: parseInt(document.getElementById('stochKPeriod').value) || 14,
    stochDPeriod: parseInt(document.getElementById('stochDPeriod').value) || 3,
    stochSmooth: parseInt(document.getElementById('stochSmooth').value) || 3,
    supertrendPeriod: parseInt(document.getElementById('supertrendPeriod').value) || 10,
    supertrendMultiplier: parseFloat(document.getElementById('supertrendMultiplier').value) || 3,
    ema1: parseInt(document.getElementById('ema1').value) || 5,
    ema2: parseInt(document.getElementById('ema2').value) || 10,
    ema3: parseInt(document.getElementById('ema3').value) || 20,
    ema4: parseInt(document.getElementById('ema4').value) || 50,
    ema5: parseInt(document.getElementById('ema5').value) || 100,
    ma1: parseInt(document.getElementById('ma1').value) || 5,
    ma2: parseInt(document.getElementById('ma2').value) || 10,
    ma3: parseInt(document.getElementById('ma3').value) || 20,
    ma4: parseInt(document.getElementById('ma4').value) || 50,
    ma5: parseInt(document.getElementById('ma5').value) || 100,
    adxPeriod: parseInt(document.getElementById('adxPeriod').value) || 14,
    stochrsi1: parseInt(document.getElementById('stochrsi1').value) || 14,
    stochrsi2: parseInt(document.getElementById('stochrsi2').value) || 14,
    stochrsi3: parseInt(document.getElementById('stochrsi3').value) || 14,
    stochrsi4: parseInt(document.getElementById('stochrsi4').value) || 14,
    stochrsi5: parseInt(document.getElementById('stochrsi5').value) || 14,
    rsi5x1: parseInt(document.getElementById('rsi5x1').value) || 5,
    rsi5x2: parseInt(document.getElementById('rsi5x2').value) || 7,
    rsi5x3: parseInt(document.getElementById('rsi5x3').value) || 9,
    rsi5x4: parseInt(document.getElementById('rsi5x4').value) || 11,
    rsi5x5: parseInt(document.getElementById('rsi5x5').value) || 13,
  };

  console.log('Sending formData:', formData);
  ws.send(JSON.stringify({ type: 'scan', data: formData }));
});

connectWebSocket();