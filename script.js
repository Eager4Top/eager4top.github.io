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

const startScanBtn = document.getElementById('startScanBtn');
const stopScanBtn = document.getElementById('stopScanBtn');
const wsStatusEl = document.getElementById('wsStatus');

startScanBtn.addEventListener('click', startScanning);
stopScanBtn.addEventListener('click', stopScanning);

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
            const symbols = tickers.map(t => t.symbol);
            const tickerSub = {
                op: 'subscribe',
                args: symbols.map(symbol => `tickers.${symbol}`)
            };
            ws.send(JSON.stringify(tickerSub));

            intervals.forEach(interval => {
                symbols.forEach(symbol => {
                    const klineSub = {
                        op: 'subscribe',
                        args: [`kline.${interval}.${symbol}`]
                    };
                    ws.send(JSON.stringify(klineSub));
                });
            });

            wsPingInterval = setInterval(() => {
                ws.send(JSON.stringify({ op: 'ping' }));
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
        } else if (data.op === 'ping') {
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

// REST Polling Fallback
async function startRestPolling(marketType, intervals) {
    updateStatus('Scanning via REST API...', 'loading');
    async function scan() {
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
                    try {
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
        const data = await fetchWithRetry(`https://api.bybit.com/v5/market/tickers?category=${marketType}`);
        const filteredData = data.result.list.filter(ticker =>
            ticker.symbol.endsWith('USDT') &&
            parseFloat(ticker.turnover24h) >= parseFloat(document.getElementById('minVolume').value)
        );
        marketDataCache = filteredData;
        cacheTimestamp = Date.now();
        return filteredData;
    } catch (error) {
        console.error('Error fetching market data:', error);
        return [];
    }
}

// Fetch Kline Data (REST)
async function fetchKlineData(symbol, interval, marketType) {
    const data = await fetchWithRetry(`https://api.bybit.com/v5/market/kline?category=${marketType}&symbol=${symbol}&interval=${interval}&limit=200`);
    return data.result.list.map(kline => [
        parseInt(kline[0]),
        parseFloat(kline[1]),
        parseFloat(kline[2]),
        parseFloat(kline[3]),
        parseFloat(kline[4]),
        parseFloat(kline[5]),
        parseInt(kline[0]) + 3600000
    ]).reverse();
}

// Retry Fetch
async function fetchWithRetry(url, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (data.retCode !== 0) throw new Error(`API error: ${data.retMsg}`);
            return data;
        } catch (error) {
            if (i === retries - 1) throw error;
            console.warn(`Retry ${i + 1}/${retries} for ${url}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Process Signal
async function processSignal(symbol, interval, marketType, intervals) {
    const symbolKlines = klineData.get(symbol);
    const klines = symbolKlines.get(interval);
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
        lower: sma - (standardDeviation * stdDev) * (1 + margin),
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
    for (let i = 1; i < closes.length; i++) {
        if (trend === 'up') {
            sar = sar + af * (ep - sar);
            sar *= margin;
            if (sar > lows[i]) {
                trend = 'down';
                sar = ep;
                ep = lows[i];
                af = step;
            } else {
                ep = Math.max(ep, highs[i]);
                af = Math.min(af + step, maxStep);
            }
        } else {
            sar = sar + af * (ep - sar);
            sar /= margin;
            if (sar < highs[i]) {
                trend = 'up';
                sar = ep;
                ep = highs[i];
                af = step;
            } else {
                ep = Math.min(ep, lows[i]);
                af = Math.min(af + step, maxStep);
            }
        }
        sars.push(sar);
    }
    return sars[sars.length - 1];
}

function calculateFibonacci(highs, lows, levels) {
    if (highs.length < 2 || lows.length < 2) return null;
    const period = 20;
    const swingHigh = Math.max(...highs.slice(-period));
    const swingLow = Math.min(...lows.slice(-period));
    const range = swingHigh - swingLow;
    return levels.map(level => ({
        level: level,
        price: swingLow + (range * level / 100)
    }));
}

function detectCandlestickPatterns(klines, selectedPatterns) {
    if (klines.length < 3) return null;
    const [prev2, prev, curr] = klines.slice(-3);
    const open = parseFloat(curr[1]), high = parseFloat(curr[2]), low = parseFloat(curr[3]), close = parseFloat(curr[4]);
    const prevOpen = parseFloat(prev[1]), prevClose = parseFloat(prev[4]);
    const body = Math.abs(close - open);
    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;

    if (selectedPatterns.includes('Doji') && body <= (high - low) * 0.1 && upperShadow > body && lowerShadow > body) {
        return { pattern: 'Doji', signal: null };
    }
    if (selectedPatterns.includes('Hammer') && body <= (high - low) * 0.3 && lowerShadow > body * 2 && prevClose < prevOpen && close > open) {
        return { pattern: 'Hammer', signal: 'BUY' };
    }
    if (selectedPatterns.includes('Hanging Man') && body <= (high - low) * 0.3 && lowerShadow > body * 2 && prevClose > prevOpen && close < open) {
        return { pattern: 'Hanging Man', signal: 'SELL' };
    }
    if (selectedPatterns.includes('Bullish Engulfing') && prevClose < prevOpen && close > open && open < prevClose && close > prevOpen) {
        return { pattern: 'Bullish Engulfing', signal: 'BUY' };
    }
    if (selectedPatterns.includes('Bearish Engulfing') && prevClose > prevOpen && close < open && open > prevClose && close < prevOpen) {
        return { pattern: 'Bearish Engulfing', signal: 'SELL' };
    }
    if (selectedPatterns.includes('Morning Star') && klines.length >= 3 && prev2[4] < prev2[1] && Math.abs(prev[4] - prev[1]) < (prev[2] - prev[3]) * 0.3 && close > open && close > prev2[1]) {
        return { pattern: 'Morning Star', signal: 'BUY' };
    }
    if (selectedPatterns.includes('Evening Star') && klines.length >= 3 && prev2[4] > prev2[1] && Math.abs(prev[4] - prev[1]) < (prev[2]