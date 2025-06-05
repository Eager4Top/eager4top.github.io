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
    ws = new WebSocket('wss://brisk-1qsf.onrender.com/ws');

    ws.onopen = () => {
      wsStatus.textContent = 'WebSocket: Connected';
      wsStatus.classList.remove('disconnected');
      wsStatus.classList.add('connected');
      reconnectAttempts = 0;
      console.log('WebSocket connected successfully');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          status.textContent = `Error: ${data.error}`;
          resultsContainer.textContent = `Error: ${data.error}`;
        } else {
          status.textContent = 'Scan received';
          resultsContainer.textContent = `Result: ${data.result.text || 'No data'}`;
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
    status.textContent = 'Scanning...';
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        chatId: '303763648', // Replace with your Telegram chat ID
        text: 'Scan requested. Learn more at https://eager4top.github.io',
      }));
    } else {
      status.textContent = 'Error: WebSocket not connected';
      resultsContainer.textContent = 'Please wait for WebSocket to reconnect';
      await checkServerHealth();
    }
    setTimeout(() => {
      scanBtn.disabled = false;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        status.textContent = 'Scan failed: WebSocket disconnected';
      }
    }, 1000);
  });
});