document.addEventListener('DOMContentLoaded', () => {
  const wsStatus = document.getElementById('wsStatus');
  const scanBtn = document.getElementById('scanBtn');
  const scanText = document.getElementById('scanText');
  const status = document.getElementById('status');
  const resultsContainer = document.getElementById('resultsContainer');

  let ws;

  // Initialize WebSocket
  function connectWebSocket() {
    ws = new WebSocket('wss://brisk-1qsf.onrender.com/ws');

    ws.onopen = () => {
      wsStatus.textContent = 'WebSocket: Connected';
      wsStatus.classList.remove('disconnected');
      wsStatus.classList.add('connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        console.error('WebSocket error:', data.error);
        status.textContent = `Error: ${data.error}`;
      } else {
        console.log('Received signal:', data.result);
        const signalDiv = document.createElement('div');
        signalDiv.textContent = `Signal: ${data.result.text || 'Unknown'}`;
        resultsContainer.innerHTML = '';
        resultsContainer.appendChild(signalDiv);
        status.textContent = 'Signal received';
      }
    };

    ws.onclose = () => {
      wsStatus.textContent = 'WebSocket: Disconnected';
      wsStatus.classList.remove('connected');
      wsStatus.classList.add('disconnected');
      setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  connectWebSocket();

  // Scan button click handler
  scanBtn.addEventListener('click', () => {
    scanText.textContent = 'Scanning...';
    scanBtn.disabled = true;
    status.textContent = 'Scanning...';

    // Collect settings
    const settings = {
      minVolume: document.getElementById('minVolume').value,
      marketType: Array.from(document.getElementById('marketType').selectedOptions).map(opt => opt.value),
      exchanges: Array.from(document.getElementById('exchanges').selectedOptions).map(opt => opt.value),
      indicators: Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
      signals: Array.from(document.getElementById('signals').selectedOptions).map(opt => opt.value),
      quoteCurrency: Array.from(document.getElementById('quoteCurrency').selectedOptions).map(opt => opt.value),
      orderTypes: Array.from(document.getElementById('orderTypes').selectedOptions).map(opt => opt.value),
      trend: Array.from(document.getElementById('trend').selectedOptions).map(opt => opt.value),
      fibLevels: Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => opt.value),
      candlePatterns: Array.from(document.getElementById('candlePatterns').selectedOptions).map(opt => opt.value),
      intervals: Array.from(document.getElementById('intervals').selectedOptions).map(opt => opt.value),
      confirmTimeframes: Array.from(document.getElementById('confirmTimeframes').selectedOptions).map(opt => opt.value),
      bbPeriod: document.getElementById('bbPeriod').value,
      bbStdDev: document.getElementById('bbStdDev').value,
      bbMargin: document.getElementById('bbMargin').value,
      rsiPeriod: document.getElementById('rsiPeriod').value,
      macdFast: document.getElementById('macdFast').value,
      macdSlow: document.getElementById('macdSlow').value,
      macdSignal: document.getElementById('macdSignal').value,
      kdjPeriod: document.getElementById('kdjPeriod').value,
      kdjK: document.getElementById('kdjK').value,
      kdjD: document.getElementById('kdjD').value,
      sarStep: document.getElementById('sarStep').value,
      sarMaxStep: document.getElementById('sarMaxStep').value,
      sarMargin: document.getElementById('sarMargin').value,
      ichimokuTenkan: document.getElementById('ichimokuTenkan').value,
      ichimokuKijun: document.getElementById('ichimokuKijun').value,
      ichimokuSenkouB: document.getElementById('ichimokuSenkouB').value,
      donchianPeriod: document.getElementById('donchianPeriod').value,
      stochKPeriod: document.getElementById('stochKPeriod').value,
      stochDPeriod: document.getElementById('stochDPeriod').value,
      stochSmooth: document.getElementById('stochSmooth').value,
      supertrendPeriod: document.getElementById('supertrendPeriod').value,
      supertrendMultiplier: document.getElementById('supertrendMultiplier').value,
      ema1: document.getElementById('ema1').value,
      ema2: document.getElementById('ema2').value,
      ema3: document.getElementById('ema3').value,
      ema4: document.getElementById('ema4').value,
      ema5: document.getElementById('ema5').value,
      ma1: document.getElementById('ma1').value,
      ma2: document.getElementById('ma2').value,
      ma3: document.getElementById('ma3').value,
      ma4: document.getElementById('ma4').value,
      ma5: document.getElementById('ma5').value,
      adxPeriod: document.getElementById('adxPeriod').value,
      stochrsi1: document.getElementById('stochrsi1').value,
      stochrsi2: document.getElementById('stochrsi2').value,
      stochrsi3: document.getElementById('stochrsi3').value,
      stochrsi4: document.getElementById('stochrsi4').value,
      stochrsi5: document.getElementById('stochrsi5').value,
      rsi5x1: document.getElementById('rsi5x1').value,
      rsi5x2: document.getElementById('rsi5x2').value,
      rsi5x3: document.getElementById('rsi5x3').value,
      rsi5x4: document.getElementById('rsi5x4').value,
      rsi5x5: document.getElementById('rsi5x5').value,
    };

    // Send settings to WebSocket
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        chatId: '303763648', // Replace with valid chat ID from logs
        text: JSON.stringify(settings),
      }));
    } else {
      status.textContent = 'WebSocket not connected';
    }

    // Simulate scan completion
    setTimeout(() => {
      scanText.textContent = 'Scan Now';
      scanBtn.disabled = false;
      if (ws.readyState !== WebSocket.OPEN) {
        status.textContent = 'Scan failed: WebSocket disconnected';
      }
    }, 2000);
  });
});