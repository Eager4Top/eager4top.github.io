document.addEventListener('DOMContentLoaded', async () => {
  const wsStatus = document.getElementById('wsStatus');
  const scanBtn = document.getElementById('scanBtn');
  const status = document.getElementById('status');
  const resultsContainer = document.getElementById('resultsContainer');

  // Load cross-fetch from CDN
  const { default: fetch } = await import('https://unpkg.com/cross-fetch@3.1.5/dist/cross-fetch.js');

  // Test server health
  async function checkServerHealth() {
    try {
      const response = await fetch('https://brisk-1qsf.onrender.com/health', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      console.log('Server health:', data);
      status.textContent = `Server status: ${data.status}`;
      return data.status === 'OK';
    } catch (error) {
      console.error('Health check failed:', error);
      status.textContent = 'Server health check failed';
      return false;
    }
  }

  // Initial health check
  await checkServerHealth();

  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectDelay = 5000;

  function connectWebSocket() {
    if (reconnectAttempts >= maxReconnectAttempts) {
      wsStatus.textContent = 'WebSocket: Failed to connect after max attempts';
      wsStatus.classList.remove('connected');
      wsStatus.classList.add('disconnected');
      console.error('Max WebSocket reconnect attempts reached');
      return;
    }

    console.log(`Attempting WebSocket connection (Attempt ${reconnectAttempts + 1})`);
    ws = new WebSocket(`wss://brisk-1qsf.onrender.com/ws?token=${encodeURIComponent('your-secret-token')}`);

    ws.onopen = () => {
      wsStatus.textContent = 'WebSocket: Connected';
      wsStatus.classList.remove('disconnected');
      wsStatus.classList.add('connected');
      reconnectAttempts = 0;
      console.log('WebSocket connected successfully');
    };

    ws.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        if (type === 'signals') {
          status.textContent = `Received ${data.length} signals`;
          resultsContainer.innerHTML = ''; // Clear previous results
          data.forEach(signal => {
            const signalElement = document.createElement('div');
            signalElement.textContent = `${signal.exchange} | ${signal.symbol} | Timeframe(s): ${signal.timeframes ? signal.timeframes.join(', ') : signal.timeframe} | ${signal.indicator}: ${signal.signals.join(', ')} | Order: ${signal.orderType || 'N/A'} | Trend: ${signal.trend}`;
            resultsContainer.appendChild(signalElement);
          });
        } else if (data.error) {
          status.textContent = `Error: ${data.error}`;
          resultsContainer.textContent = `Error: ${data.error}`;
        } else {
          status.textContent = 'Message received';
          resultsContainer.textContent = JSON.stringify(data, null, 2);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        status.textContent = 'Error processing message';
      }
    };

    ws.onclose = (event) => {
      wsStatus.textContent = `WebSocket: Disconnected (Code: ${event.code})`;
      wsStatus.classList.remove('connected');
      wsStatus.classList.add('disconnected');
      ws = null;
      reconnectAttempts++;
      console.warn(`WebSocket closed (Code: ${event.code}, Reason: ${event.reason}). Reconnecting attempt ${reconnectAttempts}...`);
      setTimeout(connectWebSocket, reconnectDelay);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      wsStatus.textContent = 'WebSocket: Error';
      wsStatus.classList.remove('connected');
      wsStatus.classList.add('disconnected');
    };
  }

  connectWebSocket();

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    status.textContent = 'Requesting scan...';
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        chatId: process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID', // Replace with your Telegram chat ID
        text: 'Scan requested for BRISK AI Trading Bot. Learn more at https://eager4top.github.io',
      }));
    } else {
      status.textContent = 'Error: WebSocket not connected';
      resultsContainer.textContent = 'Please wait for WebSocket to reconnect';
      await checkServerHealth();
    }
    setTimeout(() => {
      scanBtn.disabled = false;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        status.textContent = 'Scan request failed: WebSocket disconnected';
      }
    }, 1000);
  });
});