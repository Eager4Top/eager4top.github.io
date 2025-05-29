// BRISK AI: Bybit Real-time Indicator-based Signal Kit (AI-powered trading bot)
let isScanning = false;
let ws = null;
let wsPingInterval = null;
let restPollingInterval = null;
let signalHistory = JSON.parse(localStorage.getItem('signalHistory')) || [];
let marketDataCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 1000; // Cache market data for 1 minute
const klineData = new Map(); // Store kline data for each symbol and interval
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5; // Max WebSocket reconnection attempts
const SUBSCRIPTION_LIMIT = 8; // 8 subscriptions per second to avoid Bybit limits
const subscriptionQueue = [];
let lastSubscriptionTime = 0;
const SUBSCRIPTION_INTERVAL = 1000 / SUBSCRIPTION_LIMIT; // Throttle subscriptions

// UI Elements
const startScanBtn = document.getElementById('startScanBtn');
const stopScanBtn = document.getElementById('stopScanBtn');
const wsStatusEl = document.getElementById('wsStatus');

// Event Listeners
startScanBtn.addEventListener('click', startScanning);
stopScanBtn.addEventListener('click', stopScanning);

// Rate-limited WebSocket subscription for BRISK AI
function queueSubscription(message) {
    subscriptionQueue.push(message);
    processSubscriptionQueue();
}

function processSubscriptionQueue() {
    if (!ws || ws.readyState !== WebSocket.OPEN || subscriptionQueue.length === 0) return;
    const now = Date.now();
    if (now - lastSubscriptionTime >= SUBSCRIPTION_INTERVAL) {
        const message = subscriptionQueue.shift();
        try {
            ws.send(JSON.stringify(message));
            lastSubscriptionTime = now;
            console.log('BRISK AI: Sent subscription:', message);
        } catch (error) {
            console.error('BRISK AI: Subscription error:', error);
        }
    }
    setTimeout(processSubscriptionQueue, SUBSCRIPTION_INTERVAL);
}

// Start scanning with BRISK AI
function startScanning() {
    if (isScanning) return;
    isScanning = true;
    startScanBtn.disabled = true;
    stopScanBtn.disabled = false;
    updateWebSocketStatus('BRISK AI: Scanning...', 'connecting');
    
    const marketType = document.getElementById('marketType').value;
    const intervals = Array.from(document.getElementById('intervals').selectedOptions).map(opt => opt.value);
    
    updateStatus('BRISK AI: Starting scan...', 'loading');
    connectWebSocket(marketType, intervals);
}

// Stop scanning
function stopScanning() {
    isScanning = false;
    startScanBtn.disabled = false;
    stopScanBtn.disabled = true;
    updateWebSocketStatus('BRISK AI: Stopped', 'disconnected');
    
    if (ws) {
        ws.close();
        ws = null;
    }
    if (wsPingInterval) clearInterval(wsPingInterval);
    if (restPollingInterval) clearInterval(restPollingInterval);
    subscriptionQueue.length = 0; // Clear subscription queue
    updateStatus('BRISK AI: Scanning stopped.', 'success');
}

// Update UI status
function updateStatus(message, status) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${status}`;
    statusEl.style.display = 'block';
}

// Update WebSocket status
function updateWebSocketStatus(message, status) {
    wsStatusEl.textContent = message;
    wsStatusEl.className = `ws-status ${status}`;
    wsStatusEl.setAttribute('aria-live', 'polite');
}

// Render signal card
function renderSignalCard(signalData, pair) {
    const card = document.createElement('div');
    card.className = `signal-card ${signalData.signal.toLowerCase()}`;
    card.innerHTML = `
        <div class="signal-header">
            <span class="pair-name">${pair}</span>
            <span class="signal-type ${signalData.signal.toLowerCase()}">${signalData.signal}</span>
        </div>
        <div class="signal-details">
            <div class="detail-item">
                <div class="detail-label">Price</div>
                <div class="detail-value">${signalData.currentPrice.toFixed(4)}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Strength</div>
                <div class="detail-value">${(signalData.strength * 100).toFixed(1)}%</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Indicators</div>
                <div class="detail-value">${signalData.activeIndicators.join(', ')}</div>
            </div>
        </div>
    `;
    return card;
}

// Render signal history
function renderHistory() {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';
    
    signalHistory.slice(-50).forEach(signal => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date(signal.time).toLocaleString()}</td>
            <td>${signal.pair}</td>
            <td>${signal.signal}</td>
            <td>${signal.price.toFixed(4)}</td>
            <td>${(signal.strength * 100).toFixed(1)}</td>
            <td>${signal.timeframe}</td>
            <td>${signal.marketType}</td>
            <td>${signal.activeIndicators.join(', ')}</td>
        `;
        tbody.prepend(row);
    });
    
    localStorage.setItem('signalHistory', JSON.stringify(signalHistory));
}

// WebSocket Connection for BRISK AI
function connectWebSocket(marketType, intervals) {
    if (ws) {
        ws.close();
        ws = null;
    }
    const wsUrl = marketType === 'spot'
        ? 'wss://api.bybit.com/v5/public/spot'
        : 'wss://api.bybit.com/v5/public/linear';
    ws = new WebSocket(wsUrl);
    updateWebSocketStatus('BRISK AI: Connecting...', 'connecting');

    ws.onopen = () => {
        reconnectAttempts = 0;
        updateWebSocketStatus('BRISK AI: Connected', 'connected');
        console.log('BRISK AI: WebSocket connected');

        fetchMarketData(marketType).then(tickers => {
            if (!tickers || !tickers.length) {
                updateWebSocketStatus('BRISK AI: No USDT pairs found', 'disconnected');
                startRestPolling(marketType, intervals);
                return;
            }
            document.getElementById('stats').style.display = 'grid';
            document.getElementById('totalPairs').textContent = tickers.length;

            const symbols = tickers.map(t => t.symbol).slice(0, 50); // Limit to 50 symbols
            // Queue ticker subscriptions
            symbols.forEach(symbol => {
                queueSubscription({
                    op: 'subscribe',
                    args: [`tickers.${symbol}`]
                });
            });
            // Queue kline subscriptions
            intervals.forEach(interval => {
                symbols.forEach(symbol => {
                    queueSubscription({
                        op: 'subscribe',
                        args: [`kline.${interval}.${symbol}`]
                    });
                });
            });

            // Keep WebSocket alive
            wsPingInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ op: 'ping' }));
                    console.log('BRISK AI: Sent ping');
                }
            }, 30000);
        }).catch(error => {
            updateWebSocketStatus(`BRISK AI: Failed to fetch symbols - ${error.message}`, 'disconnected');
            console.error('BRISK AI: Failed to fetch symbols:', error);
            startRestPolling(marketType, intervals);
        });
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.op === 'pong') {
                console.log('BRISK AI: Pong received');
                return;
            }
            if (data.type === 'snapshot' || data.type === 'delta') {
                if (data.topic.startsWith('kline')) {
                    handleKlineUpdate(data, marketType, intervals);
                } else if (data.topic.startsWith('tickers')) {
                    handleTickerUpdate(data);
                }
            }
        } catch (error) {
            console.error('BRISK AI: WebSocket message error:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('BRISK AI: WebSocket error:', error);
        updateWebSocketStatus('BRISK AI: Connection error', 'disconnected');
    };

    ws.onclose = () => {
        updateWebSocketStatus(`BRISK AI: Disconnected (Attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`, 'disconnected');
        if (wsPingInterval) clearInterval(wsPingInterval);
        if (isScanning && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff
            console.log(`BRISK AI: Reconnecting in ${delay}ms...`);
            setTimeout(() => connectWebSocket(marketType, intervals), delay);
        } else if (isScanning) {
            updateStatus('BRISK AI: WebSocket failed after retries. Falling back to REST API.', 'error');
            startRestPolling(marketType, intervals);
        }
    };
}

// REST Polling with Rate Limiting
async function startRestPolling(marketType, intervals) {
    updateStatus('BRISK AI: Starting REST polling...', 'loading');
    let requestCount = 0;
    const REQUEST_LIMIT = 40; // Conservative limit per 10s
    const RESET_INTERVAL = 10000; // 10s reset window
    let lastResetTime = Date.now();

    async function scan() {
        if (!isScanning) return;

        // Reset rate limit
        const now = Date.now();
        if (now - lastResetTime >= RESET_INTERVAL) {
            requestCount = 0;
            lastResetTime = now;
            console.log('BRISK AI: Rate limit reset');
        }

        if (requestCount >= REQUEST_LIMIT) {
            updateStatus('BRISK AI: Rate limit reached. Waiting for reset...', 'error');
            setTimeout(scan, RESET_INTERVAL - (now - lastResetTime));
            return;
        }

        try {
            const tickers = await fetchMarketData(marketType);
            if (!tickers || !tickers.length) {
                updateStatus('BRISK AI: No valid USDT pairs found', 'error');
                return;
            }
            document.getElementById('stats').style.display = 'grid';
            document.getElementById('totalPairs').textContent = tickers.length;
            const resultsEl = document.getElementById('results');
            resultsEl.innerHTML = '';

            let buySignals = 0, sellSignals = 0;

            for (const ticker of tickers.slice(0, 50)) { // Limit to 50 tickers
                if (!isScanning) break;
                const pair = ticker.symbol;

                for (const interval of intervals) {
                    if (requestCount >= REQUEST_LIMIT) {
                        updateStatus('BRISK AI: Rate limit reached during scan. Waiting...', 'error');
                        setTimeout(scan, RESET_INTERVAL - (Date.now() - lastResetTime));
                        return;
                    }

                    try {
                        requestCount++;
                        const klines = await fetchKlineData(pair, interval, marketType);
                        const signalData = generateSignal(
                            klines,
                            Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
                            parseInt(document.getElementById('bbPeriod').value),
                            parseFloat(document.getElementById('bbStdDev').value),
                            parseFloat(document.getElementById('bbMargin').value),
                            parseInt(document.getElementById('macdFast').value),
                            parseInt(document.getElementById('macdSlow').value),
                            parseInt(document.getElementById('macdSignal').value),
                            parseInt(document.getElementById('kdjPeriod').value),
                            parseInt(document.getElementById('kdjK').value),
                            parseInt(document.getElementById('kdjD').value),
                            parseFloat(document.getElementById('sarStep').value),
                            parseFloat(document.getElementById('sarMaxStep').value),
                            parseFloat(document.getElementById('sarMargin').value),
                            Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => parseFloat(opt.value)),
                            interval,
                            marketType,
                            Array.from(document.getElementById('candlePatterns').selectedOptions).map(opt => opt.value),
                            parseInt(document.getElementById('ichimokuTenkan').value),
                            parseInt(document.getElementById('ichimokuKijun').value),
                            parseInt(document.getElementById('ichimokuSenkouB').value),
                            parseInt(document.getElementById('donchianPeriod').value),
                            parseInt(document.getElementById('stochKPeriod').value),
                            parseInt(document.getElementById('stochDPeriod').value),
                            parseInt(document.getElementById('stochSmooth').value),
                            parseInt(document.getElementById('supertrendPeriod').value),
                            parseFloat(document.getElementById('supertrendMultiplier').value),
                            [
                                parseInt(document.getElementById('ema1').value),
                                parseInt(document.getElementById('ema2').value),
                                parseInt(document.getElementById('ema3').value),
                                parseInt(document.getElementById('ema4').value),
                                parseInt(document.getElementById('ema5').value)
                            ],
                            [
                                parseInt(document.getElementById('ma1').value),
                                parseInt(document.getElementById('ma2').value),
                                parseInt(document.getElementById('ma3').value),
                                parseInt(document.getElementById('ma4').value),
                                parseInt(document.getElementById('ma5').value)
                            ],
                            parseInt(document.getElementById('adxPeriod').value),
                            [
                                parseInt(document.getElementById('stochrsi1').value),
                                parseInt(document.getElementById('stochrsi2').value),
                                parseInt(document.getElementById('stochrsi3').value),
                                parseInt(document.getElementById('stochrsi4').value),
                                parseInt(document.getElementById('stochrsi5').value)
                            ],
                            [
                                parseInt(document.getElementById('rsi5x1').value),
                                parseInt(document.getElementById('rsi5x2').value),
                                parseInt(document.getElementById('rsi5x3').value),
                                parseInt(document.getElementById('rsi5x4').value),
                                parseInt(document.getElementById('rsi5x5').value)
                            ]
                        );

                        if (signalData) {
                            let confirmed = true;
                            for (const confirmInterval of Array.from(document.getElementById('confirmTimeframes').selectedOptions).map(opt => opt.value)) {
                                if (confirmInterval === interval) continue;
                                if (requestCount >= REQUEST_LIMIT) {
                                    updateStatus('BRISK AI: Rate limit reached during confirmation. Waiting...', 'error');
                                    setTimeout(scan, RESET_INTERVAL - (Date.now() - lastResetTime));
                                    return;
                                }
                                requestCount++;
                                const confirmKlines = await fetchKlineData(pair, confirmInterval, marketType);
                                const confirmSignal = generateSignal(
                                    confirmKlines,
                                    Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
                                    parseInt(document.getElementById('bbPeriod').value),
                                    parseFloat(document.getElementById('bbStdDev').value),
                                    parseFloat(document.getElementById('bbMargin').value),
                                    parseInt(document.getElementById('macdFast').value),
                                    parseInt(document.getElementById('macdSlow').value),
                                    parseInt(document.getElementById('macdSignal').value),
                                    parseInt(document.getElementById('kdjPeriod').value),
                                    parseInt(document.getElementById('kdjK').value),
                                    parseInt(document.getElementById('kdjD').value),
                                    parseFloat(document.getElementById('sarStep').value),
                                    parseFloat(document.getElementById('sarMaxStep').value),
                                    parseFloat(document.getElementById('sarMargin').value),
                                    Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => parseFloat(opt.value)),
                                    confirmInterval,
                                    marketType,
                                    Array.from(document.getElementById('candlePatterns').selectedOptions).map(opt => opt.value),
                                    parseInt(document.getElementById('ichimokuTenkan').value),
                                    parseInt(document.getElementById('ichimokuKijun').value),
                                    parseInt(document.getElementById('ichimokuSenkouB').value),
                                    parseInt(document.getElementById('donchianPeriod').value),
                                    parseInt(document.getElementById('stochKPeriod').value),
                                    parseInt(document.getElementById('stochDPeriod').value),
                                    parseInt(document.getElementById('stochSmooth').value),
                                    parseInt(document.getElementById('supertrendPeriod').value),
                                    parseFloat(document.getElementById('supertrendMultiplier').value),
                                    [
                                        parseInt(document.getElementById('ema1').value),
                                        parseInt(document.getElementById('ema2').value),
                                        parseInt(document.getElementById('ema3').value),
                                        parseInt(document.getElementById('ema4').value),
                                        parseInt(document.getElementById('ema5').value)
                                    ],
                                    [
                                        parseInt(document.getElementById('ma1').value),
                                        parseInt(document.getElementById('ma2').value),
                                        parseInt(document.getElementById('ma3').value),
                                        parseInt(document.getElementById('ma4').value),
                                        parseInt(document.getElementById('ma5').value)
                                    ],
                                    parseInt(document.getElementById('adxPeriod').value),
                                    [
                                        parseInt(document.getElementById('stochrsi1').value),
                                        parseInt(document.getElementById('stochrsi2').value),
                                        parseInt(document.getElementById('stochrsi3').value),
                                        parseInt(document.getElementById('stochrsi4').value),
                                        parseInt(document.getElementById('stochrsi5').value)
                                    ],
                                    [
                                        parseInt(document.getElementById('rsi5x1').value),
                                        parseInt(document.getElementById('rsi5x2').value),
                                        parseInt(document.getElementById('rsi5x3').value),
                                        parseInt(document.getElementById('rsi5x4').value),
                                        parseInt(document.getElementById('rsi5x5').value)
                                    ]
                                );
                                if (!confirmSignal || confirmSignal.signal !== signalData.signal) {
                                    confirmed = false;
                                    break;
                                }
                            }

                            if (confirmed) {
                                resultsEl.appendChild(renderSignalCard(signalData, pair));
                                signalHistory.push({
                                    time: Date.now(),
                                    pair,
                                    signal: signalData.signal,
                                    price: signalData.currentPrice,
                                    strength: signalData.strength,
                                    timeframe: interval,
                                    marketType,
                                    activeIndicators: signalData.activeIndicators
                                });
                                if (signalData.signal === 'BUY') buySignals++;
                                else sellSignals++;
                            }
                        }
                    } catch (error) {
                        console.error(`BRISK AI: Error scanning ${pair} on ${interval}:`, error);
                    }
                }
            }

            document.getElementById('buySignals').textContent = buySignals;
            document.getElementById('sellSignals').textContent = sellSignals;
            document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
            updateStatus(`BRISK AI: REST scan completed. Found ${buySignals} buy and ${sellSignals} sell signals.`, 'success');
            renderHistory();
        } catch (error) {
            updateStatus(`BRISK AI: REST scan error: ${error.message}`, 'error');
            console.error('BRISK AI: REST polling error:', error);
        }
    }

    if (isScanning) {
        scan();
        restPollingInterval = setInterval(scan, 30000); // Poll every 30s
    }
}

// Handle Kline Data Updates
function handleKlineUpdate(data, marketType, intervals) {
    const [_, interval, symbol] = data.topic.split('.');
    if (!klineData.has(symbol)) klineData.set(symbol, new Map());
    const symbolKlines = klineData.get(symbol);
    if (!symbolKlines.has(interval)) symbolKlines.set(interval, []);

    const kline = data.data[0];
    const klineEntry = [
        parseInt(kline.start),
        parseFloat(kline.open),
        parseFloat(kline.high),
        parseFloat(kline.low),
        parseFloat(kline.close),
        parseFloat(kline.volume),
        parseInt(kline.end)
    ];

    const klines = symbolKlines.get(interval);
    const index = klines.findIndex(k => k[0] === klineEntry[0]);
    if (index >= 0) {
        klines[index] = klineEntry;
    } else {
        klines.push(klineEntry);
        if (klines.length > 200) klines.shift();
    }

    if (isScanning) {
        processSignal(symbol, interval, marketType, intervals);
    }
}

// Handle Ticker Updates
function handleTickerUpdate(data) {
    const ticker = data.data;
    marketDataCache = marketDataCache || [];
    const index = marketDataCache.findIndex(t => t.symbol === ticker.symbol);
    if (index >= 0) {
        marketDataCache[index] = ticker;
    } else {
        marketDataCache.push(ticker);
    }
}

// Fetch Market Data (REST)
async function fetchMarketData(marketType) {
    if (marketDataCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
        return marketDataCache;
    }
    try {
        const response = await axios.get(`https://api.bybit.com/v5/market/tickers?category=${marketType}`, {
            timeout: 5000
        });
        if (response.data.retCode !== 0) throw new Error(response.data.retMsg);
        const filteredData = response.data.result.list.filter(ticker =>
            ticker.symbol.endsWith('USDT') &&
            parseFloat(ticker.turnover24h) >= parseFloat(document.getElementById('minVolume').value)
        );
        marketDataCache = filteredData;
        cacheTimestamp = Date.now();
        console.log('BRISK AI: Fetched market data:', filteredData.length, 'pairs');
        return filteredData;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            updateStatus('BRISK AI: Rate limit exceeded. Retrying after delay...', 'error');
            await new Promise(resolve => setTimeout(resolve, 10000));
            return fetchMarketData(marketType);
        }
        console.error('BRISK AI: Error fetching market data:', error);
        return [];
    }
}

// Fetch Kline Data (REST)
async function fetchKlineData(symbol, interval, marketType) {
    try {
        const response = await axios.get(`https://api.bybit.com/v5/market/kline?category=${marketType}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=200`, {
            timeout: 5000
        });
        if (response.data.retCode !== 0) throw new Error(response.data.retMsg);
        return response.data.result.list.map(kline => [
            parseInt(kline[0]),
            parseFloat(kline[1]),
            parseFloat(kline[2]),
            parseFloat(kline[3]),
            parseFloat(kline[4]),
            parseFloat(kline[5]),
            parseInt(kline[0]) + 3600000
        ]).reverse();
    } catch (error) {
        if (error.response && error.response.status === 429) {
            updateStatus('BRISK AI: Rate limit exceeded for kline data. Retrying after delay...', 'error');
            await new Promise(resolve => setTimeout(resolve, 10000));
            return fetchKlineData(symbol, interval, marketType);
        }
        console.error('BRISK AI: Kline fetch error:', error);
        throw error;
    }
}

// Process Signal
async function processSignal(symbol, interval, marketType, intervals) {
    const symbolKlines = klineData.get(symbol);
    const klines = symbolKlines?.get(interval);
    if (!klines || klines.length < 100) return;

    const signalData = generateSignal(
        klines,
        Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
        parseInt(document.getElementById('bbPeriod').value),
        parseFloat(document.getElementById('bbStdDev').value),
        parseFloat(document.getElementById('bbMargin').value),
        parseInt(document.getElementById('macdFast').value),
        parseInt(document.getElementById('macdSlow').value),
        parseInt(document.getElementById('macdSignal').value),
        parseInt(document.getElementById('kdjPeriod').value),
        parseInt(document.getElementById('kdjK').value),
        parseInt(document.getElementById('kdjD').value),
        parseFloat(document.getElementById('sarStep').value),
        parseFloat(document.getElementById('sarMaxStep').value),
        parseFloat(document.getElementById('sarMargin').value),
        Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => parseFloat(opt.value)),
        interval,
        marketType,
        Array.from(document.getElementById('candlePatterns').selectedOptions).map(opt => opt.value),
        parseInt(document.getElementById('ichimokuTenkan').value),
        parseInt(document.getElementById('ichimokuKijun').value),
        parseInt(document.getElementById('ichimokuSenkouB').value),
        parseInt(document.getElementById('donchianPeriod').value),
        parseInt(document.getElementById('stochKPeriod').value),
        parseInt(document.getElementById('stochDPeriod').value),
        parseInt(document.getElementById('stochSmooth').value),
        parseInt(document.getElementById('supertrendPeriod').value),
        parseFloat(document.getElementById('supertrendMultiplier').value),
        [
            parseInt(document.getElementById('ema1').value),
            parseInt(document.getElementById('ema2').value),
            parseInt(document.getElementById('ema3').value),
            parseInt(document.getElementById('ema4').value),
            parseInt(document.getElementById('ema5').value)
        ],
        [
            parseInt(document.getElementById('ma1').value),
            parseInt(document.getElementById('ma2').value),
            parseInt(document.getElementById('ma3').value),
            parseInt(document.getElementById('ma4').value),
            parseInt(document.getElementById('ma5').value)
        ],
        parseInt(document.getElementById('adxPeriod').value),
        [
            parseInt(document.getElementById('stochrsi1').value),
            parseInt(document.getElementById('stochrsi2').value),
            parseInt(document.getElementById('stochrsi3').value),
            parseInt(document.getElementById('stochrsi4').value),
            parseInt(document.getElementById('stochrsi5').value)
        ],
        [
            parseInt(document.getElementById('rsi5x1').value),
            parseInt(document.getElementById('rsi5x2').value),
            parseInt(document.getElementById('rsi5x3').value),
            parseInt(document.getElementById('rsi5x4').value),
            parseInt(document.getElementById('rsi5x5').value)
        ]
    );

    if (signalData) {
        let confirmed = true;
        for (const confirmInterval of Array.from(document.getElementById('confirmTimeframes').selectedOptions).map(opt => opt.value)) {
            if (confirmInterval === interval) continue;
            const confirmKlines = symbolKlines?.get(confirmInterval) || await fetchKlineData(symbol, confirmInterval, marketType);
            const confirmSignal = generateSignal(
                confirmKlines,
                Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
                parseInt(document.getElementById('bbPeriod').value),
                parseFloat(document.getElementById('bbStdDev').value),
                parseFloat(document.getElementById('bbMargin').value),
                parseInt(document.getElementById('macdFast').value),
                parseInt(document.getElementById('macdSlow').value),
                parseInt(document.getElementById('macdSignal').value),
                parseInt(document.getElementById('kdjPeriod').value),
                parseInt(document.getElementById('kdjK').value),
                parseInt(document.getElementById('kdjD').value),
                parseFloat(document.getElementById('sarStep').value),
                parseFloat(document.getElementById('sarMaxStep').value),
                parseFloat(document.getElementById('sarMargin').value),
                Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => parseFloat(opt.value)),
                confirmInterval,
                marketType,
                Array.from(document.getElementById('candlePatterns').selectedOptions).map(opt => opt.value),
                parseInt(document.getElementById('ichimokuTenkan').value),
                parseInt(document.getElementById('ichimokuKijun').value),
                parseInt(document.getElementById('ichimokuSenkouB').value),
                parseInt(document.getElementById('donchianPeriod').value),
                parseInt(document.getElementById('stochKPeriod').value),
                parseInt(document.getElementById('stochDPeriod').value),
                parseInt(document.getElementById('stochSmooth').value),
                parseInt(document.getElementById('supertrendPeriod').value),
                parseFloat(document.getElementById('supertrendMultiplier').value),
                [
                    parseInt(document.getElementById('ema1').value),
                    parseInt(document.getElementById('ema2').value),
                    parseInt(document.getElementById('ema3').value),
                    parseInt(document.getElementById('ema4').value),
                    parseInt(document.getElementById('ema5').value)
                ],
                [
                    parseInt(document.getElementById('ma1').value),
                    parseInt(document.getElementById('ma2').value),
                    parseInt(document.getElementById('ma3').value),
                    parseInt(document.getElementById('ma4').value),
                    parseInt(document.getElementById('ma5').value)
                ],
                parseInt(document.getElementById('adxPeriod').value),
                [
                    parseInt(document.getElementById('stochrsi1').value),
                    parseInt(document.getElementById('stochrsi2').value),
                    parseInt(document.getElementById('stochrsi3').value),
                    parseInt(document.getElementById('stochrsi4').value),
                    parseInt(document.getElementById('stochrsi5').value)
                ],
                [
                    parseInt(document.getElementById('rsi5x1').value),
                    parseInt(document.getElementById('rsi5x2').value),
                    parseInt(document.getElementById('rsi5x3').value),
                    parseInt(document.getElementById('rsi5x4').value),
                    parseInt(document.getElementById('rsi5x5').value)
                ]
            );
            if (!confirmSignal || confirmSignal.signal !== signalData.signal) {
                confirmed = false;
                break;
            }
        }

        if (confirmed) {
            const resultsEl = document.getElementById('results');
            resultsEl.prepend(renderSignalCard(signalData, symbol));
            signalHistory.push({
                time: Date.now(),
                pair: symbol,
                signal: signalData.signal,
                price: signalData.currentPrice,
                strength: signalData.strength,
                timeframe: interval,
                marketType,
                activeIndicators: signalData.activeIndicators
            });
            document.getElementById('stats').style.display = 'grid';
            document.getElementById('buySignals').textContent = parseInt(document.getElementById('buySignals').textContent) + (signalData.signal === 'BUY' ? 1 : 0);
            document.getElementById('sellSignals').textContent = parseInt(document.getElementById('sellSignals').textContent) + (signalData.signal === 'SELL' ? 1 : 0);
            document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
            renderHistory();
        }
    }
}

// Helper Functions
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
}

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

// Indicator Calculations
function calculateBB(prices, period, stdDev, marginPercent) {
    if (prices.length < period) return null;
    const sma = calculateSMA(prices, period);
    const variance = prices.slice(-period).reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);
    const margin = marginPercent / 100;
    return {
        middle: sma,
        upper: sma + (standardDeviation * stdDev) * (1 + margin),
        lower: sma - (standardDeviation * stdDev) * (1 - margin),
        bandwidth: ((sma + standardDeviation * stdDev) - (sma - standardDeviation * stdDev)) / sma
    };
}

function calculateMACD(prices, fastPeriod, slowPeriod, signalPeriod) {
    if (prices.length < slowPeriod + signalPeriod) return null;
    const fastEMA = calculateEMA(prices.slice(-fastPeriod - signalPeriod), fastPeriod);
    const slowEMA = calculateEMA(prices.slice(-slowPeriod - signalPeriod), slowPeriod);
    const macd = fastEMA - slowEMA;
    const signalLine = calculateEMA(prices.slice(-signalPeriod).map((_, i) =>
        calculateEMA(prices.slice(-fastPeriod - signalPeriod + i, -signalPeriod + i), fastPeriod) -
        calculateEMA(prices.slice(-slowPeriod - signalPeriod + i, -signalPeriod + i), slowPeriod)
    ), signalPeriod);
    return { macd, signalLine, histogram: macd - signalLine };
}

function calculateKDJ(highs, lows, closes, period, kPeriod, dPeriod) {
    if (closes.length < period) return null;
    let kValues = [];
    for (let i = period - 1; i < closes.length; i++) {
        const high = Math.max(...highs.slice(i - period + 1, i + 1));
        const low = Math.min(...lows.slice(i - period + 1, i + 1));
        const close = closes[i];
        const k = ((close - low) / (high - low || 1)) * 100;
        kValues.push(k);
    }
    const k = calculateSMA(kValues.slice(-kPeriod), kPeriod);
    const d = calculateSMA(kValues.slice(-dPeriod - kPeriod + 1, -kPeriod + 1), dPeriod);
    const j = 3 * k - 2 * d;
    return { k, d, j };
}

function calculateSAR(highs, lows, closes, step, maxStep, marginPercent) {
    if (closes.length < 2) return null;
    let sar = lows[0], ep = highs[0], af = step, trend = 'up';
    const sars = [sar];
    const margin = 1 + marginPercent / 100;
    for (let i = 1; i < closes.length; i++) {
        if (trend === 'up') {
            sar = sar + af * (ep - sar);
            if (sar > lows[i - 1] || sar > lows[i]) {
                sar = ep;
                af = step;
                trend = 'down';
                ep = Math.min(...lows.slice(0, i + 1));
            } else {
                if (highs[i] > ep) {
                    ep = highs[i];
                    af = Math.min(af + step, maxStep);
                }
                sar = Math.min(sar, lows[i - 1]);
            }
        } else {
            sar = sar + af * (ep - sar);
            if (sar < highs[i - 1] || sar < highs[i]) {
                sar = ep;
                af = step;
                trend = 'up';
                ep = Math.max(...highs.slice(0, i + 1));
            } else {
                if (lows[i] < ep) {
                    ep = lows[i];
                    af = Math.min(af + step, maxStep);
                }
                sar = Math.max(sar, highs[i - 1]);
            }
        }
        sars.push(sar * margin);
    }
    return sars[sars.length - 1];
}

function calculateFibonacci(prices, fibLevels) {
    if (prices.length < 2) return null;
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low;
    return fibLevels.map(level => low + (range * (level / 100)));
}

function detectCandlePatterns(klines, patterns) {
    if (klines.length < 3) return null;
    const [open, high, low, close] = klines[klines.length - 1].slice(1, 5);
    const prev = klines[klines.length - 2].slice(1, 5);
    const detected = [];

    patterns.forEach(pattern => {
        if (pattern === 'Doji' && Math.abs(open - close) <= (high - low) * 0.1) {
            detected.push('Doji');
        } else if (pattern === 'Hammer' && (close > open) && (low < open * 0.99) && (high - close < (close - open) * 0.3)) {
            detected.push('Hammer');
        } else if (pattern === 'Bullish Engulfing' && (close > open) && (prev[3] < prev[0]) && (open < prev[3]) && (close > prev[0])) {
            detected.push('Bullish Engulfing');
        } else if (pattern === 'Bearish Engulfing' && (close < open) && (prev[3] > prev[0]) && (open > prev[3]) && (close < prev[0])) {
            detected.push('Bearish Engulfing');
        }
    });

    return detected.length ? detected : null;
}

function calculateIchimoku(klines, tenkanPeriod, kijunPeriod, senkouBPeriod) {
    if (klines.length < senkouBPeriod) return null;
    const highs = klines.map(k => k[2]);
    const lows = klines.map(k => k[3]);
    const tenkan = (Math.max(...highs.slice(-tenkanPeriod)) + Math.min(...lows.slice(-tenkanPeriod))) / 2;
    const kijun = (Math.max(...highs.slice(-kijunPeriod)) + Math.min(...lows.slice(-kijunPeriod))) / 2;
    const senkouA = (tenkan + kijun) / 2;
    const senkouB = (Math.max(...highs.slice(-senkouBPeriod)) + Math.min(...lows.slice(-senkouBPeriod))) / 2;
    return { tenkan, kijun, senkouA, senkouB };
}

function calculateDonchian(prices, period) {
    if (prices.length < period) return null;
    const highs = prices.map((_, i) => Math.max(...prices.slice(i - period + 1, i + 1)));
    const lows = prices.map((_, i) => Math.min(...prices.slice(i - period + 1, i + 1)));
    return { upper: highs[highs.length - 1], lower: lows[lows.length - 1] };
}

function calculateStochastic(highs, lows, closes, kPeriod, dPeriod, smooth) {
    if (closes.length < kPeriod) return null;
    const kValues = [];
    for (let i = kPeriod - 1; i < closes.length; i++) {
        const high = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
        const low = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
        const k = ((closes[i] - low) / (high - low || 1)) * 100;
        kValues.push(k);
    }
    const k = calculateSMA(kValues.slice(-smooth), smooth);
    const d = calculateSMA(kValues.slice(-dPeriod), dPeriod);
    return { k, d };
}

function calculateSupertrend(klines, period, multiplier) {
    if (klines.length < period) return null;
    const atr = calculateATR(klines, period);
    const close = klines[klines.length - 1][4];
    const high = klines[klines.length - 1][2];
    const low = klines[klines.length - 1][3];
    const upper = (high + low) / 2 + multiplier * atr;
    const lower = (high + low) / 2 - multiplier * atr;
    return { upper, lower };
}

function calculateATR(klines, period) {
    if (klines.length < period) return null;
    const tr = [];
    for (let i = 1; i < klines.length; i++) {
        const high = klines[i][2];
        const low = klines[i][3];
        const prevClose = klines[i - 1][4];
        tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    return calculateSMA(tr.slice(-period), period);
}

function calculateADX(klines, period) {
    if (klines.length < period + 1) return null;
    let plusDM = [], minusDM = [], tr = [];
    for (let i = 1; i < klines.length; i++) {
        const high = klines[i][2], low = klines[i][3], prevHigh = klines[i - 1][2], prevLow = klines[i - 1][3];
        const up = high - prevHigh, down = prevLow - low;
        plusDM.push(up > down && up > 0 ? up : 0);
        minusDM.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(high - low, Math.abs(high - klines[i - 1][4]), Math.abs(low - klines[i - 1][4])));
    }
    const plusDI = 100 * calculateSMA(plusDM.slice(-period), period) / calculateSMA(tr.slice(-period), period);
    const minusDI = 100 * calculateSMA(minusDM.slice(-period), period) / calculateSMA(tr.slice(-period), period);
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1) * 100;
    return calculateSMA([dx], period);
}

function calculateStochRSI(prices, period) {
    if (prices.length < period) return null;
    const rsi = calculateRSI(prices, period);
    if (!rsi) return null;
    const stoch = calculateStochastic(
        rsi.map((_, i) => Math.max(...rsi.slice(i - period + 1, i + 1))),
        rsi.map((_, i) => Math.min(...rsi.slice(i - period + 1, i + 1))),
        rsi,
        period,
        3,
        3
    );
    return stoch;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return null;
    let gains = [], losses = [];
    for (let i = 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }
    const avgGain = calculateSMA(gains.slice(-period), period);
    const avgLoss = calculateSMA(losses.slice(-period), period);
    return avgLoss ? 100 - (100 / (1 + avgGain / avgLoss)) : 100;
}

// Generate Signal
function generateSignal(klines, indicators, bbPeriod, bbStdDev, bbMargin, macdFast, macdSlow, macdSignal, kdjPeriod, kdjK, kdjD, sarStep, sarMaxStep, sarMargin, fibLevels, interval, marketType, candlePatterns, ichimokuTenkan, ichimokuKijun, ichimokuSenkouB, donchianPeriod, stochKPeriod, stochDPeriod, stochSmooth, supertrendPeriod, supertrendMultiplier, emaPeriods, maPeriods, adxPeriod, stochrsiPeriods, rsiPeriods) {
    if (klines.length < 100) return null;
    const closes = klines.map(k => k[4]);
    const highs = klines.map(k => k[2]);
    const lows = klines.map(k => k[3]);
    const currentPrice = closes[closes.length - 1];
    let signals = [];
    let activeIndicators = [];

    if (indicators.includes('bb')) {
        const bb = calculateBB(closes, bbPeriod, bbStdDev, bbMargin);
        if (bb) {
            if (currentPrice <= bb.lower) {
                signals.push('BUY');
                activeIndicators.push('BB');
            } else if (currentPrice >= bb.upper) {
                signals.push('SELL');
                activeIndicators.push('BB');
            }
        }
    }

    if (indicators.includes('macd')) {
        const macd = calculateMACD(closes, macdFast, macdSlow, macdSignal);
        if (macd && macd.macd > macd.signalLine) {
            signals.push('BUY');
            activeIndicators.push('MACD');
        } else if (macd && macd.macd < macd.signalLine) {
            signals.push('SELL');
            activeIndicators.push('MACD');
        }
    }

    if (indicators.includes('kdj')) {
        const kdj = calculateKDJ(highs, lows, closes, kdjPeriod, kdjK, kdjD);
        if (kdj && kdj.k < 20 && kdj.k > kdj.d) {
            signals.push('BUY');
            activeIndicators.push('KDJ');
        } else if (kdj && kdj.k > 80 && kdj.k < kdj.d) {
            signals.push('SELL');
            activeIndicators.push('KDJ');
        }
    }

    if (indicators.includes('sar')) {
        const sar = calculateSAR(highs, lows, closes, sarStep, sarMaxStep, sarMargin);
        if (sar && currentPrice > sar) {
            signals.push('BUY');
            activeIndicators.push('SAR');
        } else if (sar && currentPrice < sar) {
            signals.push('SELL');
            activeIndicators.push('SAR');
        }
    }

    if (indicators.includes('fib')) {
        const fib = calculateFibonacci(closes.slice(-50), fibLevels);
        if (fib) {
            const closest = fib.reduce((prev, curr) => Math.abs(curr - currentPrice) < Math.abs(prev - currentPrice) ? curr : prev);
            if (currentPrice <= closest * 1.01 && currentPrice >= closest * 0.99) {
                signals.push('BUY');
                activeIndicators.push('Fibonacci');
            }
        }
    }

    if (indicators.includes('candle')) {
        const patterns = detectCandlePatterns(klines, candlePatterns);
        if (patterns && (patterns.includes('Doji') || patterns.includes('Hammer') || patterns.includes('Bullish Engulfing'))) {
            signals.push('BUY');
            activeIndicators.push('Candle');
        } else if (patterns && patterns.includes('Bearish Engulfing')) {
            signals.push('SELL');
            activeIndicators.push('Candle');
        }
    }

    if (indicators.includes('ichimoku')) {
        const ichimoku = calculateIchimoku(klines, ichimokuTenkan, ichimokuKijun, ichimokuSenkouB);
        if (ichimoku && currentPrice > ichimoku.senkouA && currentPrice > ichimoku.senkouB) {
            signals.push('BUY');
            activeIndicators.push('Ichimoku');
        } else if (ichimoku && currentPrice < ichimoku.senkouA && currentPrice < ichimoku.senkouB) {
            signals.push('SELL');
            activeIndicators.push('Ichimoku');
        }
    }

    if (indicators.includes('donchian')) {
        const donchian = calculateDonchian(closes, donchianPeriod);
        if (donchian && currentPrice >= donchian.upper) {
            signals.push('BUY');
            activeIndicators.push('Donchian');
        } else if (donchian && currentPrice <= donchian.lower) {
            signals.push('SELL');
            activeIndicators.push('Donchian');
        }
    }

    if (indicators.includes('stochastic')) {
        const stochastic = calculateStochastic(highs, lows, closes, stochKPeriod, stochDPeriod, stochSmooth);
        if (stochastic && stochastic.k < 20 && stochastic.k > stochastic.d) {
            signals.push('BUY');
            activeIndicators.push('Stochastic');
        } else if (stochastic && stochastic.k > 80 && stochastic.k < stochastic.d) {
            signals.push('SELL');
            activeIndicators.push('Stochastic');
        }
    }

    if (indicators.includes('supertrend')) {
        const supertrend = calculateSupertrend(klines, supertrendPeriod, supertrendMultiplier);
        if (supertrend && currentPrice > supertrend.upper) {
            signals.push('BUY');
            activeIndicators.push('Supertrend');
        } else if (supertrend && currentPrice < supertrend.lower) {
            signals.push('SELL');
            activeIndicators.push('Supertrend');
        }
    }

    if (indicators.includes('ema5x')) {
        const emas = emaPeriods.map(period => calculateEMA(closes, period));
        if (emasons.every((ema, i) => i === 0 || closes[closes.length - 1] > ema)) {
            signals.push('BUY');
            activeIndicators.push('EMA');
        } else if (emasons.every((ema, i) => i === 0 || closes[closes.length - 1] < ema)) {
            signals.push('SELL');
            activeIndicators.push('EMA');
        }
    }

    if (indicators.includes('ma5x')) {
        const mas = maPeriods.map(period => calculateSMA(closes, period));
        if (mas.every((ma, i) => i === 0 || closes[closes.length - 1] > ma)) {
            signals.push('BUY');
            activeIndicators.push('MA');
        } else if (mas.every((ma, i) => i === 0 || closes[closes.length - 1] < ma)) {
            signals.push('SELL');
            activeIndicators.push('MA');
        }
    }

    if (indicators.includes('adx')) {
        const adx = calculateADX(klines, adxPeriod);
        if (adx && adx > 25) {
            signals.push('BUY');
            activeIndicators.push('ADX');
        }
    }

    if (indicators.includes('stochrsi5x')) {
        const stochrsi = stochrsiPeriods.map(period => calculateStochRSI(closes, period));
        if (stochrsi.some(si => si && si.k < 20)) {
            signals.push('BUY');
            activeIndicators.push('StochRSI');
        } else if (stochrsi.some(s => s && s.k > 80)) {
            signals.push('SELL');
            activeIndicators.push('StochRSI');
        }
    }

    if (indicators.includes('rsi5x')) {
        const rsiIndicators = rsiIndicators.map(period => calculateRSI(closes, period));
        if (rsiIndicators.some(rsi => rsi < 30)) {
            signals.push('BUY');
            activeIndicators.push('RSI');
        } else if (rsiIndicators.some(rsi => rsi > 70)) {
            signals.push('SELL');
            activeIndicators.push('RSI');
        }
    }

    const buyCount = signals.filter(s => s === 'BUY').length;
    const sellCount = signals.filter(s => s === 'SELL').length;
    const totalSignals = buyCount + sellCount;

    if (totalSignals === 0) return null;

    const signal = buyCount > sellCount ? 'BUY' : 'SELL';
    return {
        signal,
        currentPrice,
        strength: Math.max(buyCount, sellCount) / totalSignals,
        activeIndicators: [...new Set(activeIndicators)]
    };
}

// Initialize BRISK AI
console.log('BRISK AI: Initialized at', new Date().toLocaleString());
renderHistory();