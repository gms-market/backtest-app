# Bartleby — Strategy Backtester

A single-page, client-side backtesting tool for equity/index strategies built on
historical OHLC data. No backend, no build step — runs entirely in the browser,
so it's a good fit for GitHub Pages.

## What it does

- **Data**: upload a CSV of historical daily/intraday candles
  (`date, open, high, low, close, volume` — column order/casing is flexible;
  common aliases like `O/H/L/C`, `ltp`, `vol` are recognized).
- **Indicators**: add SMA, EMA, RSI, MACD, Bollinger Bands, VWAP, ATR,
  Supertrend, Highest High, Lowest Low — each as a named instance with its
  own parameters, so you can run e.g. `sma10` and `sma50` side by side.
- **Entry / Exit rules**: build conditions comparing price or any indicator
  output against another indicator or a constant, with `is above`,
  `is below`, `crosses above`, `crosses below`, `equals`, combined with
  AND/OR.
- **Risk**: long or short, position size, stop-loss % and take-profit %
  (checked intrabar against high/low), starting capital.
- **Results**: total return, net P&L, win rate, profit factor, max
  drawdown, an equity curve chart, and a full trade log you can export to CSV.

## Running it locally

It's static — just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying to GitHub Pages

1. Create a new GitHub repo and push these files (`index.html`, `style.css`,
   `app.js`, `indicators.js`, `backtest.js`) to the root of the `main` branch.
2. In the repo: **Settings → Pages → Source**, select `main` branch, `/root`,
   save.
3. GitHub gives you a URL like `https://<username>.github.io/<repo>/` —
   that's HTTPS by default, so on Android Chrome you'll get the
   **"Add to Home Screen"/Install app** option immediately (no extra PWA
   setup needed for this to work, though see below if you want offline/app-icon
   behavior).

### Optional: make it installable as a PWA

Add a `manifest.json` and a small service worker if you want an app icon and
offline caching (right now it just needs an internet connection to load the
Chart.js/PapaParse CDN scripts once). Ask and I'll add these.

## Getting historical data into the CSV format

Wherever you have export access (Upstox historical API, Kite, NSE Bhavcopy,
Yahoo Finance, etc.), export daily or intraday candles with at minimum
`date` and `close`; `open/high/low/volume` unlock more indicators and
accurate SL/TP simulation. A minimal example:

```csv
date,open,high,low,close,volume
2024-01-01,1000.00,1012.50,995.00,1008.25,152300
2024-01-02,1008.25,1020.00,1004.00,1015.60,148900
```

## Architecture notes

- `indicators.js` — pure functions computing indicator arrays from bar data,
  plus a `REGISTRY` describing each indicator's parameters (drives the
  "Add indicator" UI automatically).
- `backtest.js` — condition evaluation (comparisons/groups) and the trade
  simulation loop (entries, SL/TP, exit signals, equity curve, metrics).
- `app.js` — DOM wiring only; no business logic lives here.

This is an original implementation — it is not affiliated with, and does
not reuse any code, data, or design assets from, any commercial trading
platform.
