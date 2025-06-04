// WebSocket connection
let ws;
const wsStatus = document.getElementById('wsStatus');
const scanBtn = document.getElementById('scanBtn');
const scanText = document.getElementById('scanText');
const status = document.getElementById('status');
const resultsContainer = document.getElementById('resultsContainer');
const scannerForm = document.getElementById('scannerForm');

function connectWebSocket() {
    ws = new WebSocket('wss://your-backend.com/ws'); // Replace with your backend WebSocket URL

    ws.onopen = () => {
        wsStatus.textContent = 'WebSocket: Connected';
        wsStatus.className = 'ws-status connected';
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'signal') {
            renderSignals(data.signals);
            status.textContent = 'Scan Complete';
            status.className = 'status complete';
        } else if (data.type === 'error') {
            status.textContent = `Error: ${data.message}`;
            status.className = 'status error';
        }
    };

    ws.onclose = () => {
        wsStatus.textContent = 'WebSocket: Disconnected';
        wsStatus.className = 'ws-status disconnected';
        setTimeout(connectWebSocket, 5000); // Reconnect after 5 seconds
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        wsStatus.textContent = 'WebSocket: Error';
        wsStatus.className = 'ws-status error';
    };
}

function renderSignals(signals) {
    resultsContainer.innerHTML = '';
    if (signals.length === 0) {
        resultsContainer.innerHTML = '<div class="no-results">No signals found</div>';
        return;
    }

    signals.forEach(signal => {
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
            </div>
        `;
        resultsContainer.appendChild(signalCard);
    });
}

scannerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    scanText.textContent = 'Scanning...';
    scanBtn.disabled = true;
    status.textContent = 'Scanning...';
    status.className = 'status scanning';

    const formData = {
        minVolume: document.getElementById('minVolume').value,
        marketType: Array.from(document.getElementById('marketType').selectedOptions).map(opt => opt.value),
        exchanges: Array.from(document.getElementById('exchanges').selectedOptions).map(opt => opt.value),
        indicators: Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
        signals: Array.from(document.getElementById('signals').selectedOptions).map(opt => opt.value),
        quoteCurrency: Array.from(document.getElementById('quoteCurrency').selectedOptions).map(opt => opt.value),
        orderTypes: Array.from(document.getElementById('orderTypes').selectedOptions).map(opt => opt.value),
        trend: Array.from(document.getElementById('trend').selectedOptions).map(opt => opt.value),
        fibLevels: Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => opt.value),
        intervals: Array.from(document.getElementById('intervals').selectedOptions).map(opt => opt.value),
        // Add other parameters as needed
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'scan', data: formData }));
    } else {
        status.textContent = 'Error: WebSocket not connected';
        status.className = 'status error';
        scanText.textContent = 'Scan Now';
        scanBtn.disabled = false;
    }
});

// Initialize WebSocket
connectWebSocket();

// Reset button state on page load
scanBtn.disabled = false;