let isScanning = false;
let ws = null;
let wsPingInterval = null;
let restPollingInterval = null;
let signalHistory = JSON.parse(localStorage.getItem('signalHistory')) || [];
let marketDataCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 1000;
const klineData = new Map();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const SUBSCRIPTION_LIMIT = 10; // Max subscriptions per second
const subscriptionQueue = [];
let lastSubscriptionTime = 0;
const SUBSCRIPTION_INTERVAL = 1000 / SUBSCRIPTION_LIMIT;

const startScanBtn = document.getElementById('startScanBtn');
const stopScanBtn = document.getElementById('stopScanBtn');
const wsStatusEl = document.getElementById('wsStatus');

startScanBtn.addEventListener('click', startScanning);
stopScanBtn.addEventListener('click', stopScanning);

// Rate-limited WebSocket subscription
function queueSubscription(message) {
    subscriptionQueue.push(message);
    processSubscriptionQueue();
}

function processSubscriptionQueue() {
    if (!ws || ws.readyState !== WebSocket.OPEN || subscriptionQueue.length === 0) return;
    const now = Date.now();
    if (now - lastSubscriptionTime >= SUBSCRIPTION_INTERVAL) {
        const message = subscriptionQueue.shift();
        ws.send(JSON.stringify(message));
        lastSubscriptionTime = now;
        console.log('Sent subscription:', message);
    }
    setTimeout(processSubscriptionQueue, SUBSCRIPTION_INTERVAL);
}

function startScanning() {
    if (isScanning) return;
    isScanning = true;
    startScanBtn.disabled = true;
    stopScanBtn.disabled = false;
    wsStatusEl.textContent = 'Bot Status: Scanning...';
    wsStatusEl.className = 'ws-status connecting';
    
    const marketType = document.getElementById('marketType').value;
    const intervals = Array.from(document.getElementById('intervals').selectedOptions).map(opt => opt.value);
    
    updateStatus('Starting scan...', 'loading');
    connectWebSocket(marketType, intervals);
}

function stopScanning() {
    isScanning = false;
    startScanBtn.disabled = false;
    stopScanBtn.disabled = true;
    wsStatusEl.textContent = 'Bot Status: Stopped';
    wsStatusEl.className = 'ws-status disconnected';
    
    if (ws) ws.close();
    if (wsPingInterval) clearInterval(wsPingInterval);
    if (restPollingInterval) clearInterval(restPollingInterval);
    updateStatus('Scanning stopped.', 'success');
}

function updateStatus(message, status) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${status}`;
    statusEl.style.display = 'block';
}

function updateWebSocketStatus(message, status) {
    wsStatusEl.textContent = message;
    wsStatusEl.className = `ws-status ${status}`;
    wsStatusEl.setAttribute('aria-live', 'polite');
}

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
            <td>${signal.strength.toFixed(2)}</td>
            <td>${signal.timeframe}</td>
            <td>${signal.marketType}</td>
            <td>${signal.activeIndicators.join(', ')}</td>
        `;
        tbody.prepend(row);
    });
    
    localStorage.setItem('signalHistory', JSON.stringify(signalHistory));
}

// WebSocket Connection Management
function connectWebSocket(marketType, intervals) {
    if (ws) ws.close();
    const wsUrl = marketType === 'spot'
        ? 'wss://stream.bybit.com/v5/public/spot'
        : 'wss://stream.bybit.com/v5/public/linear';
    ws = new WebSocket(wsUrl);
    updateWebSocketStatus('Bot Status: Connecting...', 'connecting');

    ws.onopen = () => {
        reconnectAttempts = 0;
        updateWebSocketStatus('Bot Status: Connected', 'connected');
        console.log('WebSocket connected');

        fetchMarketData(marketType).then(tickers => {
            if (!tickers.length) {
                updateWebSocketStatus('Bot Status: No USDT pairs found', 'disconnected');
                startRestPolling(marketType, intervals);
                return;
            }
            document.getElementById('stats').style.display = 'grid';
            document.getElementById('totalPairs').textContent = tickers.length;

            const symbols = tickers.map(t => t.symbol);
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

            wsPingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ op: 'ping' }));
                }
            }, 30000);
        }).catch(error => {
            updateWebSocketStatus(`Bot Status: Failed to fetch symbols - ${error.message}`, 'disconnected');
            console.error('Failed to fetch symbols:', error);
            startRestPolling(marketType, intervals);
        });
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'snapshot' || data.type === 'delta') {
            if (data.topic.startsWith('kline')) {
                handleKlineUpdate(data, marketType, intervals);
            } else if (data.topic.startsWith('tickers')) {
                handleTickerUpdate(data);
            }
        } else if (data.op === 'pong') {
            console.log('Pong received');
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateWebSocketStatus('Bot Status: Error occurred', 'disconnected');
    };

    ws.onclose = () => {
        updateWebSocketStatus(`Bot Status: Disconnected (Attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`, 'disconnected');
        if (isScanning && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(() => connectWebSocket(marketType, intervals), 5000);
        } else if (isScanning) {
            updateStatus('WebSocket connection failed after retries. Falling back to REST API.', 'error');
            startRestPolling(marketType, intervals);
        }
        if (wsPingInterval) clearInterval(wsPingInterval);
    };
}

// Axios REST Polling Fallback with Rate Limiting
async function startRestPolling(marketType, intervals) {
    updateStatus('Scanning via REST API...', 'loading');
    let requestCount = 0;
    const REQUEST_LIMIT = 50; // Conservative limit per minute
    const RESET_INTERVAL = 60000; // 1 minute
    let lastResetTime = Date.now();

    async function scan() {
        if (!isScanning) return;

        // Reset request count if a minute has passed
        const now = Date.now();
        if (now - lastResetTime >= RESET_INTERVAL) {
            requestCount = 0;
            lastResetTime = now;
        }

        if (requestCount >= REQUEST_LIMIT) {
            updateStatus('Rate limit reached. Waiting for reset...', 'error');
            setTimeout(scan, RESET_INTERVAL - (now - lastResetTime));
            return;
        }

        try {
            const tickers = await fetchMarketData(marketType);
            document.getElementById('stats').style.display = 'grid';
            document.getElementById('totalPairs').textContent = tickers.length;
            const resultsEl = document.getElementById('results');
            resultsEl.innerHTML = '';

            let buySignals = 0, sellSignals = 0;

            for (const ticker of tickers) {
                if (!isScanning) break;
                const pair = ticker.symbol;

                for (const interval of intervals) {
                    if (requestCount >= REQUEST_LIMIT) {
                        updateStatus('Rate limit reached during scan. Waiting for reset...', 'error');
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
                                    updateStatus('Rate limit reached during confirmation. Waiting for reset...', 'error');
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
                                        parseInt(document.getElementById('ema5').value),
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
                        console.error(`Error scanning ${pair} on ${interval}:`, error);
                    }
                }
            }

            document.getElementById('buySignals').textContent = buySignals;
            document.getElementById('sellSignals').textContent = sellSignals;
            document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
            updateStatus(`REST scan completed. Found ${buySignals} buy and ${sellSignals} sell signals.`, 'success');
            renderHistory();
        } catch (error) {
            updateStatus(`REST scan error: ${error.message}`, 'error');
            console.error(error);
        }
    }

    if (isScanning) {
        scan();
        restPollingInterval = setInterval(scan, 60000);
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
        return filteredData;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            updateStatus('Rate limit exceeded. Retrying after delay...', 'error');
            await new Promise(resolve => setTimeout(resolve, 10000));
            return fetchMarketData(marketType);
        }
        console.error('Error fetching market data:', error);
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
    } catch(error) {
        if (error.response && error.response.status === 429) {
            updateStatus('Rate limit exceeded for kline data. Retrying after delay...', 'error');
            await new Promise(resolve => setTimeout(resolve, 10000));
            return fetchKlineData(symbol, interval, marketType);
        }
        throw error('error');
    }
}

// Process Signal
async function processSignal(symbol, interval, marketType, intervals) {
    const symbolKlines = klineData.get(symbol);
    const klines = symbolKlines.get(interval));
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
        parseFloat(document.getElementById('supertrendMultiplier').value)),
        [
            parseInt(document.getElementById('ema1').value),
            parseInt(document.getElementById('ema2').value),
            parseInt(document.getElementById('ema3').value),
            parseInt(document.getElementById('ema4').value),
            parseInt(document.getElementById('ema5').value),
        ],
        [
            parseInt(document.getElementById('ma1').value),
            parseInt(document.getElementById('ma2').value),
            parseInt(document.getElementById('ma3').value),
            parseInt(document.getElementById('ma4').value),
            parseInt(document.getElementById('ma5').value),
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
            const confirmKlines = symbolKlines.get(confirmInterval) || await fetchKlineData(symbol, confirmInterval, marketType);
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
                    parseInt(document.getElementById('ema5').value),
                ],
                [
                    parseInt(document.getElementById('ma1').value),
                    parseInt(document.getElementById('ma2').value),
                    parseInt(document.getElementById('ma3').value),
                    parseInt(document.getElementById('ma4').value),
                    parseInt(document.getElementById('ma5').value),
                ],
                parseInt(document.getElementById('adxPeriod').value),
                [
                    parseInt(document.getElementById('stochrsi1').value),
                    parseInt(document.getElementById('stochrsi2').value),
                    parseInt(document.getElementById('stochrsi3').value),
                    parseInt(document.getElementById('stochrsi4').value),
                    parseInt(document.getElementById('stochrsi5').value),
                ],
                [
                    parseInt(document.getElementById('rsi5x1').value),
                    parseInt(document.getElementById('rsi5x2').value),
                    parseInt(document.getElementById('rsi5x3').value),
                    parseInt(document.getElementById('rsi5x4').value),
                    parseInt(document.getElementById('rsi5x5').value),
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
        bandwidth: (sma + (standardDeviation * stdDev) - (sma - (standardDeviation * stdDev))) / sma
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
    for