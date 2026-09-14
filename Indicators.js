// indicators.js
// Pure functions that take an array of bars: {date, open, high, low, close, volume}
// and return an array of numeric values (or null where undefined), aligned index-for-index with bars.

const Indicators = (() => {

  function sma(bars, period, field = 'close') {
    const out = new Array(bars.length).fill(null);
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += bars[i][field];
      if (i >= period) sum -= bars[i - period][field];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(bars, period, field = 'close') {
    const out = new Array(bars.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < bars.length; i++) {
      const v = bars[i][field];
      if (i === period - 1) {
        // seed with SMA of first `period` values
        let sum = 0;
        for (let j = 0; j <= i; j++) sum += bars[j][field];
        prev = sum / period;
        out[i] = prev;
      } else if (i >= period) {
        prev = v * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rsi(bars, period = 14, field = 'close') {
    const out = new Array(bars.length).fill(null);
    let gainSum = 0, lossSum = 0;
    for (let i = 1; i < bars.length; i++) {
      const change = bars[i][field] - bars[i - 1][field];
      const gain = Math.max(change, 0);
      const loss = Math.max(-change, 0);
      if (i <= period) {
        gainSum += gain;
        lossSum += loss;
        if (i === period) {
          const avgGain = gainSum / period;
          const avgLoss = lossSum / period;
          out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
          out._avgGain = avgGain;
          out._avgLoss = avgLoss;
        }
      } else {
        const prevAvgGain = out._avgGain;
        const prevAvgLoss = out._avgLoss;
        const avgGain = (prevAvgGain * (period - 1) + gain) / period;
        const avgLoss = (prevAvgLoss * (period - 1) + loss) / period;
        out._avgGain = avgGain;
        out._avgLoss = avgLoss;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    }
    delete out._avgGain;
    delete out._avgLoss;
    return out;
  }

  function macd(bars, fast = 12, slow = 26, signalPeriod = 9, field = 'close') {
    const emaFast = ema(bars, fast, field);
    const emaSlow = ema(bars, slow, field);
    const macdLine = bars.map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
    );
    // signal = EMA of macdLine over non-null stretch
    const signal = new Array(bars.length).fill(null);
    const k = 2 / (signalPeriod + 1);
    let prev = null, count = 0, seedSum = 0, seedStart = -1;
    for (let i = 0; i < bars.length; i++) {
      if (macdLine[i] == null) continue;
      if (seedStart === -1) seedStart = i;
      count = i - seedStart + 1;
      if (count < signalPeriod) {
        seedSum += macdLine[i];
      } else if (count === signalPeriod) {
        seedSum += macdLine[i];
        prev = seedSum / signalPeriod;
        signal[i] = prev;
      } else {
        prev = macdLine[i] * k + prev * (1 - k);
        signal[i] = prev;
      }
    }
    const histogram = bars.map((_, i) =>
      macdLine[i] != null && signal[i] != null ? macdLine[i] - signal[i] : null
    );
    return { macdLine, signal, histogram };
  }

  function bollingerBands(bars, period = 20, stdDevMult = 2, field = 'close') {
    const mid = sma(bars, period, field);
    const upper = new Array(bars.length).fill(null);
    const lower = new Array(bars.length).fill(null);
    for (let i = period - 1; i < bars.length; i++) {
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumSq += Math.pow(bars[j][field] - mid[i], 2);
      }
      const std = Math.sqrt(sumSq / period);
      upper[i] = mid[i] + stdDevMult * std;
      lower[i] = mid[i] - stdDevMult * std;
    }
    return { mid, upper, lower };
  }

  function vwap(bars) {
    // resets each calendar day
    const out = new Array(bars.length).fill(null);
    let cumPV = 0, cumVol = 0, lastDay = null;
    for (let i = 0; i < bars.length; i++) {
      const day = (bars[i].date || '').slice(0, 10);
      if (day !== lastDay) {
        cumPV = 0;
        cumVol = 0;
        lastDay = day;
      }
      const typical = (bars[i].high + bars[i].low + bars[i].close) / 3;
      const vol = bars[i].volume || 0;
      cumPV += typical * vol;
      cumVol += vol;
      out[i] = cumVol > 0 ? cumPV / cumVol : typical;
    }
    return out;
  }

  function atr(bars, period = 14) {
    const trArr = new Array(bars.length).fill(null);
    for (let i = 0; i < bars.length; i++) {
      if (i === 0) { trArr[i] = bars[i].high - bars[i].low; continue; }
      const hl = bars[i].high - bars[i].low;
      const hc = Math.abs(bars[i].high - bars[i - 1].close);
      const lc = Math.abs(bars[i].low - bars[i - 1].close);
      trArr[i] = Math.max(hl, hc, lc);
    }
    const out = new Array(bars.length).fill(null);
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
      sum += trArr[i];
      if (i >= period) sum -= trArr[i - period];
      if (i >= period - 1) {
        out[i] = i === period - 1 ? sum / period : (out[i - 1] * (period - 1) + trArr[i]) / period;
      }
    }
    return out;
  }

  function supertrend(bars, period = 10, multiplier = 3) {
    const atrArr = atr(bars, period);
    const trend = new Array(bars.length).fill(null); // 1 = up, -1 = down
    const line = new Array(bars.length).fill(null);
    let upperBand = null, lowerBand = null, prevUpper = null, prevLower = null, prevTrend = 1;
    for (let i = 0; i < bars.length; i++) {
      if (atrArr[i] == null) continue;
      const mid = (bars[i].high + bars[i].low) / 2;
      let basicUpper = mid + multiplier * atrArr[i];
      let basicLower = mid - multiplier * atrArr[i];
      if (prevUpper == null) {
        upperBand = basicUpper;
        lowerBand = basicLower;
      } else {
        upperBand = (basicUpper < prevUpper || bars[i - 1].close > prevUpper) ? basicUpper : prevUpper;
        lowerBand = (basicLower > prevLower || bars[i - 1].close < prevLower) ? basicLower : prevLower;
      }
      let curTrend;
      if (prevUpper == null) {
        curTrend = 1;
      } else if (prevTrend === 1) {
        curTrend = bars[i].close < lowerBand ? -1 : 1;
      } else {
        curTrend = bars[i].close > upperBand ? 1 : -1;
      }
      trend[i] = curTrend;
      line[i] = curTrend === 1 ? lowerBand : upperBand;
      prevUpper = upperBand;
      prevLower = lowerBand;
      prevTrend = curTrend;
    }
    return { line, trend };
  }

  function highest(bars, period, field = 'high') {
    const out = new Array(bars.length).fill(null);
    for (let i = 0; i < bars.length; i++) {
      if (i < period - 1) continue;
      let max = -Infinity;
      for (let j = i - period + 1; j <= i; j++) max = Math.max(max, bars[j][field]);
      out[i] = max;
    }
    return out;
  }

  function lowest(bars, period, field = 'low') {
    const out = new Array(bars.length).fill(null);
    for (let i = 0; i < bars.length; i++) {
      if (i < period - 1) continue;
      let min = Infinity;
      for (let j = i - period + 1; j <= i; j++) min = Math.min(min, bars[j][field]);
      out[i] = min;
    }
    return out;
  }

  // Registry: id -> { label, params: [{key,label,default,type}], compute(bars, params) -> {seriesName: array} | array }
  const REGISTRY = {
    sma: {
      label: 'Simple Moving Average',
      params: [{ key: 'period', label: 'Period', default: 20, type: 'number' }],
      fields: ['value'],
      compute: (bars, p) => ({ value: sma(bars, p.period) })
    },
    ema: {
      label: 'Exponential Moving Average',
      params: [{ key: 'period', label: 'Period', default: 20, type: 'number' }],
      fields: ['value'],
      compute: (bars, p) => ({ value: ema(bars, p.period) })
    },
    rsi: {
      label: 'RSI',
      params: [{ key: 'period', label: 'Period', default: 14, type: 'number' }],
      fields: ['value'],
      compute: (bars, p) => ({ value: rsi(bars, p.period) })
    },
    macd: {
      label: 'MACD',
      params: [
        { key: 'fast', label: 'Fast', default: 12, type: 'number' },
        { key: 'slow', label: 'Slow', default: 26, type: 'number' },
        { key: 'signal', label: 'Signal', default: 9, type: 'number' }
      ],
      fields: ['macdLine', 'signal', 'histogram'],
      compute: (bars, p) => macd(bars, p.fast, p.slow, p.signal)
    },
    bbands: {
      label: 'Bollinger Bands',
      params: [
        { key: 'period', label: 'Period', default: 20, type: 'number' },
        { key: 'stdDev', label: 'Std Dev', default: 2, type: 'number' }
      ],
      fields: ['mid', 'upper', 'lower'],
      compute: (bars, p) => bollingerBands(bars, p.period, p.stdDev)
    },
    vwap: {
      label: 'VWAP',
      params: [],
      fields: ['value'],
      compute: (bars) => ({ value: vwap(bars) })
    },
    atr: {
      label: 'ATR',
      params: [{ key: 'period', label: 'Period', default: 14, type: 'number' }],
      fields: ['value'],
      compute: (bars, p) => ({ value: atr(bars, p.period) })
    },
    supertrend: {
      label: 'Supertrend',
      params: [
        { key: 'period', label: 'ATR Period', default: 10, type: 'number' },
        { key: 'multiplier', label: 'Multiplier', default: 3, type: 'number' }
      ],
      fields: ['line', 'trend'],
      compute: (bars, p) => supertrend(bars, p.period, p.multiplier)
    },
    highest: {
      label: 'Highest High',
      params: [{ key: 'period', label: 'Period', default: 20, type: 'number' }],
      fields: ['value'],
      compute: (bars, p) => ({ value: highest(bars, p.period, 'high') })
    },
    lowest: {
      label: 'Lowest Low',
      params: [{ key: 'period', label: 'Period', default: 20, type: 'number' }],
      fields: ['value'],
      compute: (bars, p) => ({ value: lowest(bars, p.period, 'low') })
    }
  };

  return { sma, ema, rsi, macd, bollingerBands, vwap, atr, supertrend, highest, lowest, REGISTRY };
})();

if (typeof module !== 'undefined') module.exports = Indicators;
