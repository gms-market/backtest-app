// backtest.js
// Condition evaluation + single-instrument long/short backtest simulation over OHLC bars.

const Backtest = (() => {

  // ---- Series resolution -------------------------------------------------
  // A "source" for a condition operand is either:
  //   { kind: 'price', field: 'close'|'open'|'high'|'low' }
  //   { kind: 'indicator', seriesId: '<instanceId>.<fieldKey>' }
  //   { kind: 'constant', value: number }
  // computedSeries: map of instanceId -> { fieldKey: array }

  function resolveSeriesValue(source, computedSeries, bars, i) {
    if (source.kind === 'price') return bars[i][source.field];
    if (source.kind === 'constant') return source.value;
    if (source.kind === 'indicator') {
      const [instanceId, fieldKey] = source.seriesId.split('.');
      const s = computedSeries[instanceId];
      if (!s) return null;
      const arr = s[fieldKey];
      return arr ? arr[i] : null;
    }
    return null;
  }

  function resolvePrev(source, computedSeries, bars, i) {
    if (i === 0) return null;
    return resolveSeriesValue(source, computedSeries, bars, i - 1);
  }

  // A single comparison: { left, op, right }
  // op in: 'above','below','crossesAbove','crossesBelow','equals'
  function evalComparison(cmp, computedSeries, bars, i) {
    const lv = resolveSeriesValue(cmp.left, computedSeries, bars, i);
    const rv = resolveSeriesValue(cmp.right, computedSeries, bars, i);
    if (lv == null || rv == null) return false;

    switch (cmp.op) {
      case 'above': return lv > rv;
      case 'below': return lv < rv;
      case 'equals': return Math.abs(lv - rv) < 1e-9;
      case 'crossesAbove': {
        const plv = resolvePrev(cmp.left, computedSeries, bars, i);
        const prv = resolvePrev(cmp.right, computedSeries, bars, i);
        if (plv == null || prv == null) return false;
        return plv <= prv && lv > rv;
      }
      case 'crossesBelow': {
        const plv = resolvePrev(cmp.left, computedSeries, bars, i);
        const prv = resolvePrev(cmp.right, computedSeries, bars, i);
        if (plv == null || prv == null) return false;
        return plv >= prv && lv < rv;
      }
      default: return false;
    }
  }

  // A condition group: { logic: 'AND'|'OR', comparisons: [cmp,...] }
  function evalGroup(group, computedSeries, bars, i) {
    if (!group || !group.comparisons || group.comparisons.length === 0) return false;
    if (group.logic === 'OR') {
      return group.comparisons.some(c => evalComparison(c, computedSeries, bars, i));
    }
    return group.comparisons.every(c => evalComparison(c, computedSeries, bars, i));
  }

  // ---- Core simulation -----------------------------------------------------
  // config: {
  //   direction: 'long' | 'short' | 'both',
  //   entryGroup, exitGroup,
  //   stopLossPct, takeProfitPct,      // 0 = disabled
  //   quantity, initialCapital,
  //   allowReEntry: bool
  // }
  function run(bars, computedSeries, config) {
    const trades = [];
    const equityCurve = new Array(bars.length).fill(null);
    let capital = config.initialCapital || 100000;
    let position = null; // { side, entryPrice, entryIndex, qty }
    const qty = config.quantity || 1;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];

      // manage open position: check SL/TP intrabar using high/low, then exit signal on close
      if (position) {
        let exitPrice = null, exitReason = null;

        if (position.side === 'long') {
          if (config.stopLossPct > 0) {
            const slPrice = position.entryPrice * (1 - config.stopLossPct / 100);
            if (bar.low <= slPrice) { exitPrice = slPrice; exitReason = 'Stop Loss'; }
          }
          if (!exitPrice && config.takeProfitPct > 0) {
            const tpPrice = position.entryPrice * (1 + config.takeProfitPct / 100);
            if (bar.high >= tpPrice) { exitPrice = tpPrice; exitReason = 'Take Profit'; }
          }
        } else {
          if (config.stopLossPct > 0) {
            const slPrice = position.entryPrice * (1 + config.stopLossPct / 100);
            if (bar.high >= slPrice) { exitPrice = slPrice; exitReason = 'Stop Loss'; }
          }
          if (!exitPrice && config.takeProfitPct > 0) {
            const tpPrice = position.entryPrice * (1 - config.takeProfitPct / 100);
            if (bar.low <= tpPrice) { exitPrice = tpPrice; exitReason = 'Take Profit'; }
          }
        }

        if (!exitPrice && evalGroup(config.exitGroup, computedSeries, bars, i)) {
          exitPrice = bar.close;
          exitReason = 'Exit Signal';
        }

        if (exitPrice != null) {
          const pnl = position.side === 'long'
            ? (exitPrice - position.entryPrice) * position.qty
            : (position.entryPrice - exitPrice) * position.qty;
          capital += pnl;
          trades.push({
            side: position.side,
            entryDate: bars[position.entryIndex].date,
            entryPrice: position.entryPrice,
            exitDate: bar.date,
            exitPrice,
            qty: position.qty,
            pnl,
            pnlPct: (pnl / (position.entryPrice * position.qty)) * 100,
            reason: exitReason,
            barsHeld: i - position.entryIndex
          });
          position = null;
        }
      }

      // entries
      if (!position && evalGroup(config.entryGroup, computedSeries, bars, i)) {
        const side = config.direction === 'short' ? 'short' : 'long';
        position = { side, entryPrice: bar.close, entryIndex: i, qty };
      }

      // mark-to-market equity
      let unrealized = 0;
      if (position) {
        unrealized = position.side === 'long'
          ? (bar.close - position.entryPrice) * position.qty
          : (position.entryPrice - bar.close) * position.qty;
      }
      equityCurve[i] = capital + unrealized;
    }

    // force-close any open position at last bar for reporting purposes
    if (position) {
      const last = bars[bars.length - 1];
      const pnl = position.side === 'long'
        ? (last.close - position.entryPrice) * position.qty
        : (position.entryPrice - last.close) * position.qty;
      trades.push({
        side: position.side,
        entryDate: bars[position.entryIndex].date,
        entryPrice: position.entryPrice,
        exitDate: last.date,
        exitPrice: last.close,
        qty: position.qty,
        pnl,
        pnlPct: (pnl / (position.entryPrice * position.qty)) * 100,
        reason: 'End of Data',
        barsHeld: bars.length - 1 - position.entryIndex
      });
    }

    return { trades, equityCurve, finalCapital: equityCurve[equityCurve.length - 1] };
  }

  function computeMetrics(result, initialCapital) {
    const { trades, equityCurve } = result;
    const totalTrades = trades.length;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const winRate = totalTrades ? (wins.length / totalTrades) * 100 : 0;
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

    let peak = -Infinity, maxDrawdown = 0, maxDrawdownPct = 0;
    for (const eq of equityCurve) {
      if (eq == null) continue;
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    const totalReturnPct = ((result.finalCapital - initialCapital) / initialCapital) * 100;

    return {
      totalTrades,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnl,
      totalReturnPct,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown,
      maxDrawdownPct,
      finalCapital: result.finalCapital
    };
  }

  return { evalComparison, evalGroup, resolveSeriesValue, run, computeMetrics };
})();

if (typeof module !== 'undefined') module.exports = Backtest;
