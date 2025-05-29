// BRISK AI: Bybit Real-time Indicator-based Signal Kit (AI-powered trading bot)
let isScanning = false;
let restPollingInterval = null;
let signalHistory = JSON.parse(localStorage.getItem('signalHistory')) || [];
let marketDataCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 1000; // Cache market data for 1 minute
let requestCount = 0;
const REQUEST_LIMIT = 40; // Max 40 requests per 10s
const RESET_INTERVAL = 10000; // 10s rate limit reset

// UI Elements
const scanBtn = document.getElementById('startScanBtn');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');

// Event Listeners
scanBtn.addEventListener('click', toggleScanning);

// Toggle scanning state
function toggleScanning() {
    if (isScanning) {
        stopScanning();
    } else {
        startScanning();
    }
}

// Start scanning
function startScanning() {
    if (isScanning) return;
    isScanning = true;
    updateScanButton('Scanning...', 'scanning');
    updateStatus('BRISK AI: Starting scan...', 'loading');

    const marketType = document.getElementById('marketType').value;
    const intervals = Array.from(document.getElementById('intervals').selectedOptions).map(opt => opt.value);

    if (!intervals.length) {
        updateStatus('BRISK AI: Please select at least one timeframe.', 'error');
        stopScanning();
        return;
    }

    scanMarket(marketType, intervals);
    restPollingInterval = setInterval(() => scanMarket(marketType, intervals), 30000); // Poll every 30s
}

// Stop scanning
function stopScanning() {
    isScanning = false;
    updateScanButton('Start Scanning', 'stopped');
    if (restPollingInterval) clearInterval(restPollingInterval);
    updateStatus('BRISK AI: Scanning stopped.', 'success');
}

// Update scan button text and style
function updateScanButton(text, state) {
    scanBtn.textContent = text;
    scanBtn.className = `scan-btn ${state}`;
    scanBtn.disabled = false;
}

// Update status message
function updateStatus(message, status) {
    statusEl.textContent = message;
    statusEl.className = `status ${status}`;
    statusEl.style.display = 'block';
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

// Scan market using REST API
async function scanMarket(marketType, intervals) {
    if (!isScanning) return;

    // Reset rate limit if needed
    const now = Date.now();
    if (now - cacheTimestamp >= RESET_INTERVAL) {
        requestCount = 0;
        cacheTimestamp = now;
        console.log('BRISK AI: Rate limit reset');
    }

    if (requestCount >= REQUEST_LIMIT) {
        updateStatus('BRISK AI: Rate limit reached. Waiting for reset...', 'error');
        return;
    }

    try {
        const tickers = await fetchMarketData(marketType);
        if (!tickers || !tickers.length) {
            updateStatus('BRISK AI: No valid USDT pairs found.', 'error');
            return;
        }

        document.getElementById('stats').style.display = 'grid';
        document.getElementById('totalPairs').textContent = tickers.length;
        resultsEl.innerHTML = '';

        let buySignals = 0, sellSignals = 0;

        for (const ticker of tickers.slice(0, 30)) { // Limit to 30 tickers to avoid rate limits
            if (!isScanning) break;
            const pair = ticker.symbol;

            for (const interval of intervals) {
                if (requestCount >= REQUEST_LIMIT) {
                    updateStatus('BRISK AI: Rate limit reached during scan. Waiting...', 'error');
                    return;
                }

                try {
                    requestCount++;
                    const klines = await fetchKlineData(pair, interval, marketType);
                    if (!klines || klines.length < 50) {
                        console.log(`BRISK AI: Insufficient kline data for ${pair} on ${interval}`);
                        continue;
                    }

                    const signalData = generateSignal(
                        klines,
                        Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
                        parseInt(document.getElementById('bbPeriod').value || 20),
                        parseFloat(document.getElementById('bbStdDev').value || 2),
                        parseFloat(document.getElementById('bbMargin').value || 0),
                        parseInt(document.getElementById('macdFast').value || 12),
                        parseInt(document.getElementById('macdSlow').value || 26),
                        parseInt(document.getElementById('macdSignal').value || 9),
                        parseInt(document.getElementById('kdjPeriod').value || 9),
                        parseInt(document.getElementById('kdjK').value || 3),
                        parseInt(document.getElementById('kdjD').value || 3),
                        parseFloat(document.getElementById('sarStep').value || 0.02),
                        parseFloat(document.getElementById('sarMaxStep').value || 0.2),
                        parseFloat(document.getElementById('sarMargin').value || 0),
                        Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => parseFloat(opt.value)),
                        interval,
                        marketType,
                        Array.from(document.getElementById('candlePatterns').selectedOptions).map(opt => opt.value),
                        parseInt(document.getElementById('ichimokuTenkan').value || 9),
                        parseInt(document.getElementById('ichimokuKijun').value || 26),
                        parseInt(document.getElementById('ichimokuSenkouB').value || 52),
                        parseInt(document.getElementById('donchianPeriod').value || 20),
                        parseInt(document.getElementById('stochKPeriod').value || 14),
                        parseInt(document.getElementById('stochDPeriod').value || 3),
                        parseInt(document.getElementById('stochSmooth').value || 3),
                        parseInt(document.getElementById('supertrendPeriod').value || 10),
                        parseFloat(document.getElementById('supertrendMultiplier').value || 3),
                        [
                            parseInt(document.getElementById('ema1').value || 10),
                            parseInt(document.getElementById('ema2').value || 20),
                            parseInt(document.getElementById('ema3').value || 50),
                            parseInt(document.getElementById('ema4').value || 100),
                            parseInt(document.getElementById('ema5').value || 200)
                        ],
                        [
                            parseInt(document.getElementById('ma1').value || 10),
                            parseInt(document.getElementById('ma2').value || 20),
                            parseInt(document.getElementById('ma3').value || 50),
                            parseInt(document.getElementById('ma4').value || 100),
                            parseInt(document.getElementById('ma5').value || 200)
                        ],
                        parseInt(document.getElementById('adxPeriod').value || 14),
                        [
                            parseInt(document.getElementById('stochrsi1').value || 14),
                            parseInt(document.getElementById('stochrsi2').value || 14),
                            parseInt(document.getElementById('stochrsi3').value || 14),
                            parseInt(document.getElementById('stochrsi4').value || 14),
                            parseInt(document.getElementById('stochrsi5').value || 14)
                        ],
                        [
                            parseInt(document.getElementById('rsi5x1').value || 14),
                            parseInt(document.getElementById('rsi5x2').value || 14),
                            parseInt(document.getElementById('rsi5x3').value || 14),
                            parseInt(document.getElementById('rsi5x4').value || 14),
                            parseInt(document.getElementById('rsi5x5').value || 14)
                        ]
                    );

                    if (signalData) {
                        let confirmed = true;
                        for (const confirmInterval of Array.from(document.getElementById('confirmTimeframes').selectedOptions).map(opt => opt.value)) {
                            if (confirmInterval === interval) continue;
                            if (requestCount >= REQUEST_LIMIT) {
                                updateStatus('BRISK AI: Rate limit reached during confirmation. Waiting...', 'error');
                                return;
                            }
                            requestCount++;
                            const confirmKlines = await fetchKlineData(pair, confirmInterval, marketType);
                            if (!confirmKlines || confirmKlines.length < 50) continue;

                            const confirmSignal = generateSignal(
                                confirmKlines,
                                Array.from(document.getElementById('indicators').selectedOptions).map(opt => opt.value),
                                parseInt(document.getElementById('bbPeriod').value || 20),
                                parseFloat(document.getElementById('bbStdDev').value || 2),
                                parseFloat(document.getElementById('bbMargin').value || 0),
                                parseInt(document.getElementById('macdFast').value || 12),
                                parseInt(document.getElementById('macdSlow').value || 26),
                                parseInt(document.getElementById('macdSignal').value || 9),
                                parseInt(document.getElementById('kdjPeriod').value || 9),
                                parseInt(document.getElementById('kdjK').value || 3),
                                parseInt(document.getElementById('kdjD').value || 3),
                                parseFloat(document.getElementById('sarStep').value || 0.02),
                                parseFloat(document.getElementById('sarMaxStep').value || 0.2),
                                parseFloat(document.getElementById('sarMargin').value || 0),
                                Array.from(document.getElementById('fibLevels').selectedOptions).map(opt => parseFloat(opt.value)),
                                confirmInterval,
                                marketType,
                                Array.from(document.getElementById('candlePatterns').selectedOptions).map(opt => opt.value),
                                parseInt(document.getElementById('ichimokuTenkan').value || 9),
                                parseInt(document.getElementById('ichimokuKijun').value || 26),
                                parseInt(document.getElementById('ichimokuSenkouB').value || 52),
                                parseInt(document.getElementById('donchianPeriod').value || 20),
                                parseInt(document.getElementById('stochKPeriod').value || 14),
                                parseInt(document.getElementById('stochDPeriod').value || 3),
                                parseInt(document.getElementById('stochSmooth').value || 3),
                                parseInt(document.getElementById('supertrendPeriod').value || 10),
                                parseFloat(document.getElementById('supertrendMultiplier').value || 3),
                                [
                                    parseInt(document.getElementById('ema1').value || 10),
                                    parseInt(document.getElementById('ema2').value || 20),
                                    parseInt(document.getElementById('ema3').value || 50),
                                    parseInt(document.getElementById('ema4').value || 100),
                                    parseInt(document.getElementById('ema5').value || 200)
                                ],
                                [
                                    parseInt(document.getElementById('ma1').value || 10),
                                    parseInt(document.getElementById('ma2').value || 20),
                                    parseInt(document.getElementById('ma3').value || 50),
                                    parseInt(document.getElementById('ma4').value || 100),
                                    parseInt(document.getElementById('ma5').value || 200)
                                ],
                                parseInt(document.getElementById('adxPeriod').value || 14),
                                [
                                    parseInt(document.getElementById('stochrsi1').value || 14),
                                    parseInt(document.getElementById('stochrsi2').value || 14),
                                    parseInt(document.getElementById('stochrsi3').value || 14),
                                    parseInt(document.getElementById('stochrsi4').value || 14),
                                    parseInt(document.getElementById('stochrsi5').value || 14)
                                ],
                                [
                                    parseInt(document.getElementById('rsi5x1').value || 14),
                                    parseInt(document.getElementById('rsi5x2').value || 14),
                                    parseInt(document.getElementById('rsi5x3').value || 14),
                                    parseInt(document.getElementById('rsi5x4').value || 14),
                                    parseInt(document.getElementById('rsi5x5').value || 14)
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
                    console.error(`BRISK AI: Error scanning ${pair} on ${interval}:`, error.message);
                }
            }
        }

        document.getElementById('buySignals').textContent = buySignals;
        document.getElementById('sellSignals').textContent = sellSignals;
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
        updateStatus(`BRISK AI: Scan completed. Found ${buySignals} buy and ${sellSignals} sell signals.`, 'success');
        renderHistory();
    } catch (error) {
        updateStatus(`BRISK AI: Scan error: ${error.message}`, 'error');
        console.error('BRISK AI: Scan error:', error);
    }
}

// Fetch market data
async function fetchMarketData(marketType) {
    if (marketDataCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
        return marketDataCache;
    }
    try {
        requestCount++;
        const response = await axios.get(`https://api.bybit.com/v5/market/tickers?category=${marketType}`, {
            timeout: 5000
        });
        if (response.data.retCode !== 0) throw new Error(response.data.retMsg);
        const filteredData = response.data.result.list.filter(ticker =>
            ticker.symbol.endsWith('USDT') &&
            parseFloat(ticker.turnover24h) >= parseFloat(document.getElementById('minVolume').value || 100000)
        );
        marketDataCache = filteredData;
        cacheTimestamp = Date.now();
        console.log('BRISK AI: Fetched market data:', filteredData.length, 'pairs');
        return filteredData;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            updateStatus('BRISK AI: Rate limit exceeded. Retrying after delay...', 'error');
            await new Promise(resolve => setTimeout(resolve, 10000));
            requestCount--;
            return fetchMarketData(marketType);
        }
        console.error('BRISK AI: Error fetching market data:', error.message);
        return [];
    }
}

// Fetch kline data
async function fetchKlineData(symbol, interval, marketType) {
    try {
        requestCount++;
        const response = await axios.get(`https://api.bybit.com/v5/market/kline?category=${marketType}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=200`, {
            timeout: 5000
        });
        if (response.data.retCode !== 0) throw new Error(response.data.retMsg);
        const klines = response.data.result.list.map(kline => [
            parseInt(kline[0]),
            parseFloat(kline[1]),
            parseFloat(kline[2]),
            parseFloat(kline[3]),
            parseFloat(kline[4]),
            parseFloat(kline[5]),
            parseInt(kline[0]) + 3600000
        ]).reverse();
        console.log(`BRISK AI: Fetched ${klines.length} klines for ${symbol} on ${interval}`);
        return klines;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            updateStatus('BRISK AI: Rate limit exceeded for kline data. Retrying after delay...', 'error');
            await new Promise(resolve => setTimeout(resolve, 10000));
            requestCount--;
            return fetchKlineData(symbol, interval, marketType);
        }
        console.error('BRISK AI: Kline fetch error:', error.message);
        return [];
    }
}

// Helper functions
function calculateSMA(prices, period) {
    if (!prices || prices.length < period || period <= 0) return null;
    return prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
}

function calculateEMA(prices, period) {
    if (!prices || prices.length < period || period <= 0) return null;
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

// Indicator calculations
function calculateBB(prices, period, stdDev, marginPercent) {
    if (!prices || prices.length < period || period <= 0) return null;
    const sma = calculateSMA(prices, period);
    if (!sma) return null;
    const variance = prices.slice(-period).reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);
    const margin = marginPercent / 100;
    return {
        middle: sma,
        upper: sma + (standardDeviation * stdDev) * (1 + margin),
        lower: sma - (standardDeviation * stdDev) * (1 - margin)
    };
}

function calculateMACD(prices, fastPeriod, slowPeriod, signalPeriod) {
    if (!prices || prices.length < slowPeriod + signalPeriod || fastPeriod <= 0 || slowPeriod <= 0 || signalPeriod <= 0) return null;
    const fastEMA = calculateEMA(prices.slice(-fastPeriod - signalPeriod), fastPeriod);
    const slowEMA = calculateEMA(prices.slice(-slowPeriod - signalPeriod), slowPeriod);
    if (!fastEMA || !slowEMA) return null;
    const macd = fastEMA - slowEMA;
    const signalLine = calculateEMA(prices.slice(-signalPeriod).map((_, i) =>
        calculateEMA(prices.slice(-fastPeriod - signalPeriod + i, -signalPeriod + i), fastPeriod) -
        calculateEMA(prices.slice(-slowPeriod - signalPeriod + i, -signalPeriod + i), slowPeriod)
    ), signalPeriod);
    return { macd, signalLine, histogram: macd - signalLine };
}

function calculateKDJ(highs, lows, closes, period, kPeriod, dPeriod) {
    if (!closes || closes.length < period || period <= 0 || kPeriod <= 0 || dPeriod <= 0) return null;
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
    if (!closes || closes.length < 2 || step <= 0 || maxStep <= 0) return null;
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
    if (!prices || prices.length < 2) return null;
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low;
    return fibLevels.map(level => low + (range * (level / 100)));
}

function detectCandlePatterns(klines, patterns) {
    if (!klines || klines.length < 3) return null;
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
    if (!klines || klines.length < senkouBPeriod || tenkanPeriod <= 0 || kijunPeriod <= 0 || senkouBPeriod <= 0) return null;
    const highs = klines.map(k => k[2]);
    const lows = klines.map(k => k[3]);
    const tenkan = (Math.max(...highs.slice(-tenkanPeriod)) + Math.min(...lows.slice(-tenkanPeriod))) / 2;
    const kijun = (Math.max(...highs.slice(-kijunPeriod)) + Math.min(...lows.slice(-kijunPeriod))) / 2;
    const senkouA = (tenkan + kijun) / 2;
    const senkouB = (Math.max(...highs.slice(-senkouBPeriod)) + Math.min(...lows.slice(-senkouBPeriod))) / 2;
    return { tenkan, kijun, senkouA, senkouB };
}

function calculateDonchian(prices, period) {
    if (!prices || prices.length < period || period <= 0) return null;
    const highs = prices.map((_, i) => Math.max(...prices.slice(Math.max(0, i - period + 1), i + 1)));
    const lows = prices.map((_, i) => Math.min(...prices.slice(Math.max(0, i - period + 1), i + 1)));
    return { upper: highs[highs.length - 1], lower: lows[lows.length - 1] };
}

function calculateStochastic(highs, lows, closes, kPeriod, dPeriod, smooth) {
    if (!closes || closes.length < kPeriod || kPeriod <= 0 || dPeriod <= 0 || smooth <= 0) return null;
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
    if (!klines || klines.length < period || period <= 0 || multiplier <= 0) return null;
    const atr = calculateATR(klines, period);
    const close = klines[klines.length - 1][4];
    const high = klines[klines.length - 1][2];
    const low = klines[klines.length - 1][3];
    const upper = (high + low) / 2 + multiplier * atr;
    const lower = (high + low) / 2 - multiplier * atr;
    return { upper, lower };
}

function calculateATR(klines, period) {
    if (!klines || klines.length < period || period <= 0) return null;
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
    if (!klines || klines.length < period + 1 || period <= 0) return null;
    let plusDM = [], minusDM = [], tr = [];
    for (let i = 1; i < klines.length; i++) {
        const high = klines[i][2], low = klines[i][3], prevHigh = klines[i - 1][2], prevLow = klines[i - 1][3];
        const up = high - prevHigh, down = prevLow - low;
        plusDM.push(up > down && up > 0 ? up : 0);
        minusDM.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(high - low, Math.abs(high - klines[i - 1][4]), Math.abs(low - klines[i - 1][4])));
    }
    const plusDI = 100 * calculateSMA(plusDM.slice(-period), period) / (calculateSMA(tr.slice(-period), period) || 1);
    const minusDI = 100 * calculateSMA(minusDM.slice(-period), period) / (calculateSMA(tr.slice(-period), period) || 1);
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1) * 100;
    return calculateSMA([dx], period);
}

function calculateStochRSI(prices, period) {
    if (!prices || prices.length < period || period <= 0) return null;
    const rsi = calculateRSI(prices, period);
    if (!rsi) return null;
    const stoch = calculateStochastic(
        rsi.map((_, i) => Math.max(...rsi.slice(Math.max(0, i - period + 1), i + 1))),
        rsi.map((_, i) => Math.min(...rsi.slice(Math.max(0, i - period + 1), i + 1))),
        rsi,
        period,
        3,
        3
    );
    return stoch;
}

function calculateRSI(prices, period) {
    if (!prices || prices.length < period + 1 || period <= 0) return null;
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

// Generate signal
function generateSignal(klines, indicators, bbPeriod, bbStdDev, bbMargin, macdFast, macdSlow, macdSignal, kdjPeriod, kdjK, kdjD, sarStep, sarMaxStep, sarMargin, fibLevels, interval, marketType, candlePatterns, ichimokuTenkan, ichimokuKijun, ichimokuSenkouB, donchianPeriod, stochKPeriod, stochDPeriod, stochSmooth, supertrendPeriod, supertrendMultiplier, emaPeriods, maPeriods, adxPeriod, stochrsiPeriods, rsiPeriods) {
    if (!klines || klines.length < 50) {
        console.log('BRISK AI: Not enough kline data for signal generation');
        return null;
    }

    const closes = klines.map(k => k[4]);
    const highs = klines.map(k => k[2]);
    const lows = klines.map(k => k[3]);
    const currentPrice = closes[closes.length - 1];
    let signals = [];
    let activeIndicators = [];

    try {
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
            const emas = emaPeriods.map(period => calculateEMA(closes, period)).filter(ema => ema !== null);
            if (emas.length === emaPeriods.length && emas.every((ema, i) => i === 0 || closes[closes.length - 1] > ema)) {
                signals.push('BUY');
                activeIndicators.push('EMA');
            } else if (emas.length === emaPeriods.length && emas.every((ema, i) => i === 0 || closes[closes.length - 1] < ema)) {
                signals.push('SELL');
                activeIndicators.push('EMA');
            }
        }

        if (indicators.includes('ma5x')) {
            const mas = maPeriods.map(period => calculateSMA(closes, period)).filter(ma => ma !== null);
            if (mas.length === maPeriods.length && mas.every((ma, i) => i === 0 || closes[closes.length - 1] > ma)) {
                signals.push('BUY');
                activeIndicators.push('MA');
            } else if (mas.length === maPeriods.length && mas.every((ma, i) => i === 0 || closes[closes.length - 1] < ma)) {
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
            const stochrsi = stochrsiPeriods.map(period => calculateStochRSI(closes, period)).filter(s => s !== null);
            if (stochrsi.some(s => s && s.k < 20)) {
                signals.push('BUY');
                activeIndicators.push('StochRSI');
            } else if (stochrsi.some(s => s && s.k > 80)) {
                signals.push('SELL');
                activeIndicators.push('StochRSI');
            }
        }

        if (indicators.includes('rsi5x')) {
            const rsi = rsiPeriods.map(period => calculateRSI(closes, period)).filter(r => r !== null);
            if (rsi.some(r => r < 30)) {
                signals.push('BUY');
                activeIndicators.push('RSI');
            } else if (rsi.some(r => r > 70)) {
                signals.push('SELL');
                activeIndicators.push('RSI');
            }
        }
    } catch (error) {
        console.error('BRISK AI: Signal generation error:', error.message);
        return null;
    }

    const buyCount = signals.filter(s => s === 'BUY').length;
    const sellCount = signals.filter(s => s === 'SELL').length;
    const totalSignals = buyCount + sellCount;

    if (totalSignals === 0) {
        console.log('BRISK AI: No signals generated');
        return null;
    }

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