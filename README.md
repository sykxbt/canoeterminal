<div align="center">

```
 ═══════════════════════════════════════════════════════════════════
  ▄████████    ▄████████ ███▄▄▄▄    ▄██████▄     ▄████████
  ███    ███   ███    ███ ███▀▀▀██▄ ███    ███   ███    ███
  ███    █▀    ███    ███ ███   ███ ███    ███   ███    █▀
  ███          ███    ███ ███   ███ ███    ███  ▄███▄▄▄
  ███        ▀███████████ ███   ███ ███    ███ ▀▀███▀▀▀
  ███    █▄    ███    ███ ███   ███ ███    ███   ███    █▄
  ███    ███   ███    ███ ███   ███ ███    ███   ███    ███
  ████████▀    ███    █▀   ▀█   █▀   ▀██████▀    ██████████
 ═══════════════════════════════════════════════════════════════════
             T  E  R  M  I  N  A  L   ·   v 3 . 0 . 0
```

**A full pop-out trading workspace for Hyperliquid.**  
Market heatmaps · Live charts · Account analytics · Cycle analysis · Trade journal · and more.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-26a65b?style=flat-square&logo=googlechrome&logoColor=white)](.)
[![Version](https://img.shields.io/badge/version-3.0.0-1e2c32?style=flat-square)](.)
[![License](https://img.shields.io/badge/license-MIT-26a69a?style=flat-square)](.)

</div>

---

## Overview

Canoe Terminal is a Chrome extension that opens a freely resizable trading workspace — 17 panels covering everything from live Hyperliquid market data to Bitcoin cycle analysis to a full trade journal, all wired to a dark, data-dense interface built for serious traders.

---

## Panels

### Account
> Look up any Hyperliquid wallet or browse the top 250 traders by PnL.

- **Leaderboard** — Top 250 wallets ranked by PnL across 24H / 7D / 30D / ALL time, with account value, ROI %, and volume. Each entry shows wallet tier (Plankton → Leviathan).
- **Wallet lookup** — Enter any `0x` address to pull the full account snapshot instantly.
- **Equity curve** — Full historical equity / PnL chart with 24H / 7D / 30D / ALL views, toggle between Equity and PnL modes.
- **Account summary** — Perp account value, spot holdings, staked balance, withdrawable, margin used, and notional position size — all shown simultaneously.
- **Most-traded assets** — Top assets by volume share from the last 7 days of fills, displayed as a colored tile grid. Click any tile to jump to that chart.
- **Open positions** — Live table of all open perp positions with side, leverage, margin, entry price, current value, unrealized PnL, and liquidation price.
- **Spot balances** — All spot token holdings with price, balance, USD value, and in-orders amounts.
- **Open orders** — All resting limit and stop orders.
- **Live tracking** — Pin any wallet for live auto-refresh; position overlays appear on the Chart panel in real time.

---

### Journal
> A complete trade log with reflection fields and an equity curve.

- **Trade list** — Filter by All / Open / Closed / Cancelled. Search by asset. Export all trades to CSV.
- **Journal equity curve** — Cumulative realized PnL curve built from your logged trades, shown at the bottom of the panel.
- **Win/Loss tracker** — Running W/L count displayed inline on the trade list header.
- **New trade form** — Full entry modal with:
  - Trade thesis / reason free-text field
  - Asset symbol, Direction (Long / Short), Status (Open / Closed / Cancelled)
  - Entry price with **Use last price** fill from live Hyperliquid feed
  - Stop loss, Liquidation level, Position size, Leverage
  - Date opened / closed
  - Take profit levels — add multiple TP levels, each with a live HL price fill button
  - Conviction rating — Low / Medium / High / Extreme (shown as a filled bar)
  - Reflection fields — What went well, What went wrong, Lessons learned, Improvements for next trade
- **Trade card** — Each logged trade shows direction badge, status, entry/stop/size/leverage/dates, R-multiple, PnL %, duration, and all reflection notes. Send to Notes button links the trade to a canvas note.

---

### Notes
> A freeform infinite canvas for research, playbooks, and trade notes.

- **Sticky notes** — Create draggable notes anywhere on the canvas; drag the header to move, resize from the corner.
- **Color coding** — 10 color options per note for organization.
- **Note connections** — Draw dashed connector lines between notes to link related ideas visually.
- **Templates** — Save and reuse note layouts. Two built-in templates: **Setup** (Asset / Timeframe / Bias / Key Levels / Entry Zone / Trade dead if / Notes) and **Momentum** (IN conditions / OUT conditions / rule set).
- **Image notes** — Add image cards to the canvas alongside text notes.
- **Search** — Live search across all note content.
- **Reset view** — Snap canvas back to origin.

---

### Multi
> Up to 9 live charts side by side from any exchange.

- **Layout selector** — 1 / 2 / 4 / 6 / 9 chart grid layouts with one click.
- **Exchange support** — Each chart independently sources from Hyperliquid, Bybit, Binance, or OKX.
- **Per-chart controls** — Individual symbol input, timeframe selector (1m → 1d), and Draw mode per chart.
- **Global timeframe** — One-click sync all charts to the same timeframe simultaneously.
- **Chart styles** — Candle, Heikin Ashi, Hollow candle, Line, Raindrop per chart.
- **Volume display** — Toggle volume bars on/off per chart.
- **Overlays (global)** — Camera (screenshot), Clock overlay, News overlay, Tape (trades), Indicators button.
- **Indicators available on multi:**
  - EMA 20 / 50 / 200
  - VWMA / VWAP
  - Rainbow VWAP (each session a different color)
  - RVWAP
  - Bollinger Bands
  - Fib SMMA
  - Hull Suite
  - Guppy
  - LELEDC
  - Pattern Finder
  - PVSRA
  - MMO Candles
  - Minervini

---

### Bookmarks
> A minimal browser bookmark manager built into the terminal.

- **4 folders** — Folder 1 through Folder 4, each a separate column.
- **Add bookmarks** — Label + URL input at the top; assign to any folder; click **+ Add**.
- **One-click open** — Click any bookmark to open it in a new tab.

---

### Market
> A live market intelligence dashboard pulling from multiple data sources.

**Top bar stats:** Perp Vol 24H · Open Interest · Gainers/Losers count · Avg Funding/hr · Spot Vol 24H · Perp Markets count

**Panels:**
- **Fear & Greed** — alternative.me index with 1D / 7D / 30D deltas
- **Altcoin Season** — CoinGecko altcoin season index vs BTC dominance
- **Global Market** — Total market cap, 24h change, 24h volume, BTC/ETH/Other dominance
- **Market Dominance** — 30-day dominance chart (BTC vs ETH)
- **Top Movers** — 24h perp gainers and losers with % move
- **OI Leaders** — Top assets by open interest with 24h change
- **Volume Leaders** — Top assets by 24h notional volume
- **Funding Heat** — Hourly funding rate leaders across Hyperliquid perps
- **Trending Coins** — CoinGecko 24h trending list with price and % change
- **Top Gainers / Top Losers** — CoinGecko 24h top 10 each
- **Long/Short Ratio** — Bybit top trader long/short ratio for BTC, ETH, SOL
- **Volume Leader** — Hyperliquid Crypto vs XYZ volume split
- **Stablecoin Monitor** — USDT, USDC, DAI, USDE, FDUSD, FRAX — peg deviation, market cap, volume
- **Funding Rates** — BTC funding APR comparison across Hyperliquid, Binance, OKX, Bybit
- **Exchange OI Breakdown** — Bybit open interest by asset

*Sources: alternative.me · CoinGecko · Bybit · Hyperliquid*

---

### Calendar
> Bitcoin return heatmaps from 2010 to today.

**Views:**
- **Daily** — Full year grid in classic calendar layout. Each day shows its % return, colored green (positive) to red (negative). Navigate years with arrow buttons.
- **Weekly** — Every ISO week number from W1 → W53 across all years since 2010. Annual return shown in the rightmost column.
- **Monthly** — Month-by-month return grid, all years since 2010, with Full Year column.
- **Quarterly** — Q1–Q4 per year since 2010 with Annual column.
- **Yearly** — Single bar per year, colored by magnitude.

**Header:** Live BTC price · 1D % · YTD % · ATH with date · Data range · Total days of data  
**Return filters:** Toggle Very Negative / Negative / Flat / Positive / Very Positive highlighting

---

### History
> Bitcoin's entire price history on a single interactive chart.

- **Timeframes** — 1W, 1M, 3M, 1Y candlestick intervals
- **Scale** — Linear or logarithmic (toggle in settings)
- **Chart controls** — Pan, zoom, crop, freeze scale, reset scale, camera (screenshot), Draw mode
- **Halving markers** — All 4 past halvings labeled on chart with date and reward, plus 5th halving (estimated) marker
- **Indicators:**
  - Hashrate
  - Difficulty
  - Transaction fee cost
  - MVRV
  - MVRV-Z Score
  - Market Cap
  - MA 200
  - Fib SMMA
  - 2yr MA Multiplier
  - 200WMA Bubble Heatmap
  - Rainbow Chart
  - Pi Cycle Top
  - Minervini

---

### Bear
> Bitcoin bear market drawdown vs every past cycle.

**Main view — Drawdown:**
- Overlays current cycle drawdown (from ATH) against 2011, 2013, 2017, 2021 bear markets
- Shaded band = past-cycle mean ±1σ
- Dashed line = past-cycle mean
- **Sidebar:** Day N scatter — current drawdown plotted against historical distribution for the same day, with sigma rating. Worst drawdown bar chart by cycle.
- **Tooltip** — Hover any point to see exact drawdown %, date, and sigma vs mean

**Lows view:**
- Cycles trimmed to low + 60 days; gold band = mature-cycle mean ±1σ
- **Sidebar:** Lows by cycle table — low %, day number, date for each past cycle + current
- **Expected completion box** — Mean timing from ATH, progress %, days remaining, projected completion date with progress bar

**Controls:** Toggle individual cycles on/off · Mean line · Log scale · Reset zoom · Lock scale · Camera

---

### Bull
> Bitcoin bull market rally vs every past cycle.

**Main view — Rally:**
- Overlays current cycle rally (from cycle low) against 2011, 2015, 2018, 2022 bull markets on a log % scale (up to 50,000%)
- Shaded band = past-cycle mean ±1σ
- **Sidebar:** Day N scatter — current rally vs historical distribution, sigma badge. Best rally bar chart by cycle.

**Peaks view:**
- Cycles trimmed to peak + 60 days
- **Sidebar:** Peak stats table per cycle + expected completion with progress bar

**Cycle Settings** — Click the pencil icon to open the cycle editor:
- Adjust the start/end date of any historical cycle via date pickers
- Visual mini-chart of each cycle's price action for reference
- Reset individual cycle or reset all to defaults

**Controls:** Rally / Peaks view · Toggle cycles · Mean · Full · Log · Reset zoom · Lock scale · Camera

---

### Heatmap
> Live market treemap spanning Hyperliquid and external venues.

- **Market tabs** — All · Crypto · XYZ · HIP-3 dexes (KinetIQ, EntropyIO, …) · Spot · Binance · Bybit · OKX. Default view shows **Crypto + XYZ only** — all other markets are opt-in via the market selector.
- **Market selector** — Click the markets button to toggle which venues appear on the heatmap and in the All tab. Choices are saved per-browser; once you've made a change your saved preference always wins over the default.
- **Tile sizing** — Size tiles by Volume, Open Interest, % Move, or Equal
- **Movers filter** — Show All / Top 20 / Top 50 / Top 100 movers (ranks by absolute 24h move, cross-venue on the All tab)
- **Search** — Filter tiles by symbol
- **Tile info** — Each tile shows symbol, % change, and price (icon shown when tile is large enough)
- **Hover tooltip** — Price · 24h change · Volume · Open Interest · Funding · Market, plus a live 24h sparkline (cached 60 s; not shown for Spot)
- **Color scale & colorway picker** — Legend bar at the bottom shows −10% → 0 → +10%. Click it to open the colorway menu:
  - **Default (Red/Green)** — the standard `colorForChange` scheme
  - Any of the 19 built-in heatmap palettes (Magma, Viridis, Neon, Hot, etc.)
  - **Custom Heatmap…** — opens the full gradient-stop editor with live tile preview; cancel snaps back to the previous colorway
  - Selection persists in `localStorage` across sessions
- **Market count** — Total tiles rendered shown in the bottom-right meta bar
- **External data** — Binance / Bybit / OKX ticker data is fetched independently (every 2.5 min) when the Heatmap panel is active; last-fetched rows are cached so switching away and back renders instantly

---

### Chart
> Full-featured live trading chart with a deep indicator stack.

**Toolbar:**
- Symbol input with exchange selector (Hyperliquid / Bybit / Binance / OKX)
- Timeframes: TICK · 1m · 3m · 5m · 15m · 30m · 1h · 2h · 4h · 8h · 12h · 1D · 3D · 1W
- Chart styles: Candles · Bar · Heikin Ashi · Hollow · Line · Raindrop
- PnL · PRIV · ENTRY · ORDERS · LIQ toggles (position overlay layers)
- Stats bar: Mark price · Oracle · 24h Change · 24h Volume · Open Interest · Funding rate · Countdown

**Overlays:**
- Camera (screenshot with html2canvas)
- Clock
- News
- Positions overlay
- Tape (live trades)
- Track wallet — enter a `0x` address to overlay that wallet's positions on the chart live

#### Chart Display settings (gear icon → "Chart Display")

A separate popout from the indicator picker — controls the chart canvas itself rather than any one indicator. Opens via the `#chartSetBtn` button in the indicator bar; position/behavior mirrors the indicator popup (draggable panel, active-state highlight on its toggle button).

| Setting | Type | Default | Notes |
|---|---|---|---|
| Loading animation | Toggle | On | Show the loading GIF while candles fetch |
| Candle opacity | Slider (1–100%) | 100% | Overall opacity of candle bodies/wicks |
| Price label | Toggle | On | Current-price pill on the price axis |
| Label glow (0 = off) | Number (px) | 10 | Blur radius of the price label's border glow; 0 disables it |
| Bar countdown | Toggle | On | Countdown-to-next-bar shown in the price-axis pill |
| Gridlines | Toggle | On | Chart gridlines |
| Separators | Toggle | On | Day/session separators |
| Price line opacity | Number (0–1) | 0.85 | Opacity of the current-price horizontal line |
| Price line style | Select | Dashed | Dashed / Dotted / Solid |
| Price line thickness | Number (px) | 1 | |
| **Overlay Line Styles** (per-line color / style / opacity / thickness) | | | |
| Entry line | Color, style, opacity, width | `#e8c34a`, Dashed, 1.0, 1.3 | Journal/position entry-price line |
| Liq line | Color, style, opacity, width | `#f0554d`, Dashed, 1.0, 1.0 | Liquidation-price line |
| Stop line | Color, style, opacity, width | `#f0554d`, Dashed, 0.9, 1.5 | Stop-loss line |
| Privacy line | Color, style, opacity, width | `#e8c34a`, Dashed, 1.0, 1.3 | Scrambled entry line shown in Privacy mode |

A **Reset** button at the bottom restores all of the above to defaults.

#### Indicators popup

Draggable, resizable panel (`indicators-popup.js`) with a badge on its toggle button showing the active indicator count (position/state persisted per session). Each indicator pill opens/closes its layer on the chart; the separate **⚙ Indicator Settings** popout (built in `main.js`, with a few indicators — Pattern Finder, HTF Candle, Liq Sweep — injecting their own section at runtime) holds the actual parameters, grouped into the same four categories as the picker:

**Volume & Oscillators**

| Indicator | Settings |
|---|---|
| PVSRA | Lookback bars |
| GodMode 3.1 | Channel length (n1), Average length (n2), Short length (n3), Aqua line opacity, Aqua area opacity |
| LWRSI (Liquidity Weighted RSI) | Period, Smoothing EMA, Hyperliquid volume on/off, Binance Futures volume on/off |
| Leledc Exhaustion | Swing length, Bar count |
| Volume Bubbles | Scale from (visible range / all bars), Bubble size, Threshold %, Fill alpha, Outline thickness, Bubble color, Colormap + intensity + opacity, Show labels, Show $ value, per-venue data toggles (Hyperliquid / Binance Futures / OKX / Bybit) |
| Open Interest | Data source (Binance Futures / Bybit), Show EMA + length, Body opacity, Wick opacity |
| Volume In USD | Per-venue data toggles (Hyperliquid / Binance Futures / OKX / Bybit), MA 1 (on/off, length, opacity), MA 2 (on/off, length, opacity), Show extreme line + mini label, Show current-vol line, Extreme % (of MA), Hide small volumes + threshold %, Abbreviate Y-axis |
| OBV / ADL Combo | Per-venue data toggles, Show OBV line (color, width), Show EMA (length, color), Show RSI-of-OBV (length, color), Show top/bottom extremes, Highlight breakouts (top/bottom lookback) |
| SMI (Squeeze Momentum) | BB Length, BB MultFactor, KC Length, KC MultFactor, Use TrueRange (KC), Higher timeframe toggle + interval, Crosshatch texture |
| *EMA / Volume Opacity* (shared) | EMA 20/50/200 opacity, Volume opacity, Volume display mode (Overlay / Window) |

**Moving Averages & Bands**

| Indicator | Settings |
|---|---|
| VWAP | Period (Daily / Weekly / Monthly), VWAP opacity, Bands toggle with 3 configurable bands (each: σ multiplier, on/off, fill opacity, line opacity), Price label |
| Rainbow VWAP | Fixed day-of-week color scheme (Sun=purple … Sat=blue), no numeric params beyond the shared EMA/Volume Opacity block |
| Rolling VWAP / RVWAP (daily/session) | Opacity, Line width, Line style, Weekly VWAP toggle + width + style, Price labels |
| Rolling VWAP (RVWAPsd, auto-window) | Min bars, Overall opacity, RVWAP color/opacity/width, ±1σ band (on/off, color, opacity), ±2σ band (on/off, color, opacity) |
| Bollinger Bands | Period, Std Dev (σ) |
| Fib SMMA | Per-period rows (Fibonacci-length SMMAs), individually enabled |
| Hull Suite | Period, Mode (HMA / EHMA / THMA), Opacity |
| COG Double Channel | Length, Mult (σ), Offset, Opacity — linreg median with a STDEV channel and an ATR channel, plus squeeze markers where the ATR channel pokes outside the STDEV channel on both sides |
| SMMA Cloud Suite | Fast band short/long length (default 9/19, trend-colored), Slow band short/long length (default 89/120, neutral gray), Overall opacity, Fast band opacity, Slow band opacity, Crosshatch texture |
| OS Area (Fair Value Bands) | Overall opacity, Min run (bars), Feather toggle + amount, Up band (on/off, opacity, gradient start/end color, colormap), Down band (on/off, opacity, gradient start/end color, colormap), Threshold up (on/off, opacity), Threshold down (on/off, opacity) — gradient fill wash where price pierces the fair-value threshold band, saturating toward the outer deviation zone |
| BB HTF | Lookback (bars), Min FVG overlap % of OB, x2+ mitigation threshold %, Timeframes (D/2D/3D/4D/5D/6D/W/2W, individually enabled), Show current TF only, Box color (x1–x4+), Overall opacity, Show labels, Show midline + color, Border color/opacity/width — breaker blocks (order block + FVG overlap, engulfed and not re-mitigated) detected across higher timeframes, drawn as boxes on the chart |
| BB LTF | Same parameter set as BB HTF, scoped to lower timeframes (15M/30M/1H/2H/4H, max 4H) — mirrors BB HTF but fetches real intraday candle history independent of the chart's own interval |
| VWMA | Period, Color, Opacity |
| CM Guppy EMAs | Thickness (0.05–4×), Opacity — 6 fast (3–15) + 6 slow (30–60) EMAs, fixed bull/bear/mixed color coding |

**Trend & Pattern**

| Indicator | Settings |
|---|---|
| Supply/Demand Zones | Max zones per side, Fill opacity, Border opacity, Extend to right edge |
| AlphaTrend | Multiplier (coeff), Common Period (AP), Source (Close/Open/High/Low/HL2/HLC3/OHLC4), Show signals, No-volume (RSI) mode, Line opacity, Fill opacity |
| Minervini Trend Template | Color candles by score, Candle opacity, Show SMA 50/150/200, Show criteria table + table opacity, SMA 200 rising lookback, 52-week lookback (9-criterion Trend Template; Relative Performance criterion omitted — no standard crypto benchmark, so max score is 9/9) |
| Liquidity Sweep | Swing lookback, Min wick/body ratio, Level fade (bars), Show bull/bear sweeps, Show swept levels, Show labels, Label size, Overall opacity |
| Stop Order Heatmap | Price window (±%), Bucket size (% of price), Min notional ($), Max bar width (% of chart), Bar opacity, Overall opacity, Colormap + intensity (live Hyperdash buy/sell stop clusters, refreshes every 30s) |
| Liquidation Heatmap | Same parameter set as Stop Order Heatmap, sourced from Hyperdash's liquidation clusters (same data as the Hyperliquid Liq Map tab) |

**Cloud, Sessions & Profile**

| Indicator | Settings |
|---|---|
| Ichimoku | Tenkan, Kijun, Senkou B, Displacement, Cloud opacity, Lagging span toggle, per-line colors (Tenkan/Kijun/Senkou A/Senkou B/Chikou) |
| Crymoku | Cloud opacity, Lagging span toggle, per-line colors (same 5 lines as Ichimoku, different palette) |
| Wednesday | Global box opacity + per-day (Sun–Sat) color, per-day opacity, per-day on/off — daily boxes run 5PM→5PM Vancouver (BTC daily open) |
| Trading Sessions | Box opacity, Text opacity, Text size, per-session rows |
| TPO / Market Profile | Period (minutes), Session (Daily/Weekly/Monthly), Value Area %, Tick size (0 = auto), Show letters, Single prints, VA lines, Opacity |
| VPVR / Volume Profile | Rows (price levels), Value Area %, Width (% of chart), Opacity, POC line, VA lines, Price labels |
| Session VbP / Volume By Price | Per-venue data toggles (Hyperliquid / Binance Futures / OKX / Bybit), Session length (5m–8h, London, NY Open, etc.) |
| HTF Candle Dynamics | HTF interval, Right offset (bars), Profile rows, Profile width, Show volume profile / developing POC / history table / open line / price line / high-low lines / high-low labels, History table position (draggable, position persisted), Overall opacity, Bullish/Bearish/Open/POC/Developing-POC colors (each resettable to theme default) |
| Pattern Finder (Trendscope) | Up to 4 zigzag scales (length/depth, individually enabled), Number of pivots (5/6), Error threshold %, Flat threshold %, Check bar ratio + limit, Avoid overlap, Single trendline color (on/off + picker), Max patterns shown, Show zigzag / pattern label / pivot labels, Line width + style, Opacity, Text scale + opacity — JS port of Auto Chart Patterns by Trendoscope® |

**Settings Templates** — Save and load full indicator configurations (every setting above, per indicator, bundled into a named template)

**Drawing tools** — Full drawing mode with persistent drawing history

---

### Options
> BTC/ETH options positioning dashboard — implied vol, gamma exposure, and dealer-flow analytics sourced entirely from Deribit's public API.

**Currency toggle** — BTC / ETH, switches every section on the panel at once.

**Top stat row:**
- **Spot** — Live Deribit index price
- **ATM IV** — Nearest-expiry at-the-money implied vol
- **Term Structure** — CONTANGO / BACKWARDATION label with a heat-bar gauge (see **Term-structure heat bar** below)
- **Expiries / Instruments** — Count of listed expiry dates and total live option instruments in the chain
- **Put/Call · 24h vol** — Ratio of put to call trading volume over the last 24h

#### Summary card
Three-column ledger under the top row:
- **Column 1 — Spot & positioning:** Spot hero price · Net Gamma (colored + labeled "long — vol-dampening" or "short — vol-amplifying") · Gamma Flip strike with % distance from spot · Vol Regime flag (LOW / NORMAL / ELEVATED / EXTREME, percentile rank over a 90-day lookback, sourced from DVOL when available and falling back to a realized-vol proxy otherwise)
- **Column 2 — Expected move:** Range (straddle-implied ±$ move to nearest expiry) with % · Implied range (low–high) · ATM IV 7D / 30D · Term Structure with the 7D/30D vol-point spread · Vol Risk Premium (IV minus realized vol, colored red when negative)
- **Column 3 — Open interest:** Total OI · Call Wall strike (colored red) with OI at that strike · Put Wall strike (colored green) with OI · Put/Call OI ratio · Max Pain strike · Top Expiry by OI with date

#### Term-structure heat bar
> Click the gradient bar under the "Term Structure" tile to change its colorway.

- Default gauge reads backwardation (red, term-diff negative) through flat (orange blend) to contango (green, positive), clamped to ±8 vol points either side of flat; a marker slides along the bar to the live 30D–7D IV spread
- **Click the bar** to open a dropdown: **Default (Red/Green)**, every built-in heatmap colormap (Magma, Viridis, Prism, Neon, Glacier, Acid, Mahogany, Lipari, Gold & White, Vintage Chart, Acid Sunset, Spring Blossom, Royal Mint, BrBG, PiYG, Hot, Paired, Twilight — same 19 palettes as the [Heatmap Theme Editor](#heatmap-theme-editor)), and any custom palettes you've already saved
- **Custom Heatmap…** opens the full palette editor scoped to this bar — live preview, stop editing, save — without affecting the chart panel's own liq/stop heatmap colorway
- Choice is remembered across sessions (persisted separately from the main heatmap theme)

#### IV Term Structure chart
Line chart of ATM IV by expiry (the same curve the heat bar summarizes) — monthly/quarterly expiries marked distinctly from weeklies on the X-axis. Hover any point for exact date + IV.

#### GEX by Strike
Bar chart of net dollar-gamma per strike, all listed expiries combined. Convention: customers assumed net long calls / net short puts (standard equity-GEX convention, ported as-is — crypto dealer positioning isn't publicly verifiable, so this is an assumption, not a fact). Positive (long-gamma / vol-dampening) bars sit above the zero line in green, negative (short-gamma / vol-amplifying) below in red, both ramped from dim to vivid by magnitude relative to the tallest bar on screen. Chart auto-crops to strikes within ~35% of spot (where nearly all listed OI concentrates), falling back to the full chain if that band is too thin. SPOT marker and Call Wall / Put Wall / Gamma Flip lines overlaid. Hover any bar for exact strike + $ gamma.

#### OI / Notional by Expiry
Bar chart of call vs. put open interest per listed expiry. Toggle between **Contracts** and **Notional** ($ = OI × spot) units. Monthly/quarterly expiries marked on the axis. 
- **Pin-risk flags** — chips below the chart flag any monthly/quarterly expiry that's within 14 days out *and* holding ≥15% of total open interest across the whole chain — the classic setup for price to "pin" toward the strike(s) with the heaviest OI into settlement. Each chip shows the expiry kind, date, days-to-expiry, and % of total OI. Reads "No near-term monthly/quarterly pin risk flagged" when none qualify.

#### IV Skew / Smile by Strike
Call and put ATM-adjacent implied vol plotted by strike, nearest expiry only, calls and puts as separate colored lines so downside (put) vs. upside (call) skew is visible at a glance. Dashed spot line overlaid. Hover any point for exact strike + IV.

#### Vol Index strip
Side-by-side BTC/ETH regime readout:
- **Regime flag** — LOW / NORMAL / ELEVATED / EXTREME, percentile rank over a 90-day lookback
- **Value** — Current DVOL print (Deribit's own implied-vol index) when available, falling back to 7D ATM IV
- **24H Chg** — Change vs. the prior reading, colored
- **Sparkline** — Last 24 readings, colored green/red by 24h direction

#### Expiries table
One row per listed expiry — Expiry date (pin-risk-flagged expiries get an accent dot) · DTE · Kind (Weekly / Monthly / Quarterly) · ATM IV · Call OI · Put OI · Total OI · Put/Call ratio · Notional. Merges the OI-by-expiry and term-structure data into a single scannable table.

#### Notable Flow
Table of the top 8 option trades by notional value, pulled from the last 100 trades across the whole book — Time · Side (BUY/SELL, colored) · Strike + C/P · Expiry · Size · Notional.

#### GEX Levels — price chart
Canvas candlestick chart of the underlying (Deribit perpetual, hourly bars, ~90 days) with Call Wall, Put Wall, and Gamma Flip drawn as dashed horizontal lines plus a live Spot pill on the price axis — same levels the GEX-by-strike chart and summary card use, so all three always agree.

**Header stats:** Gex Flip · Net Gex · Regime (mirrors the summary card's own figures for this instrument)

**Full free pan & zoom**,
- **Drag the chart body** — pans in both directions at once: horizontal drag moves through time, vertical drag moves the price window, freely, independent of the candles
- **Drag the right-side price axis** — stretches/compresses the price scale around the drag start point (candles stay in place; only the price-per-pixel changes)
- **Drag the bottom time axis** — widens/narrows the visible time window (drag right = zoom out, left = zoom in)
- **Scroll wheel over the chart** — zooms the time axis around the cursor position
- Vertical pan and price-scale zoom are independent of the auto-fit default: once you touch either, the view freezes exactly where you leave it — it won't snap back to auto-centering on the next data poll or on a horizontal pan
- You can drag past the most recent candle into empty space on the right,, up to roughly half a screen-width of blank room
- **↺ Reset** button returns to the default auto-fit view (latest bars, full auto-centered price range)

---

### Screener
> Cross-venue market screener merging Hyperliquid, Binance, OKX, and Bybit into one filterable, sortable table.

- **Venue tabs** — All · HL · Binance · OKX · Bybit. All merges every venue's perps into a single ranked table; each other tab scopes to that venue alone.
- **Search** — Filter the current venue/preset by symbol.
- **Preset scans** — One-click filter combinations, each with its own default sort:
  - **High Positive Funding** — Funding ≥ 0.05%, sorted by funding descending
  - **High Negative Funding** — Funding ≤ −0.05%, sorted by funding ascending
  - **OI Spike** — OI Δ ≥ 15% over the selected window (4H/24H), sorted by OI Δ descending
  - **Volume Breakout** — 24h Volume ≥ $50M and 24h % ≥ 5%, sorted by volume descending
  - **Oversold + Low Funding** — Funding ≤ 0.01% and 24h % ≤ −5%, sorted by 24h % ascending
  - Clicking an active preset again clears it back to custom filters
- **Filter bar** — Funding % (min–max) · OI Δ ≥ % with a 4H/24H window toggle · 24h Volume ≥ $ · 24h % (min–max). Any manual edit clears the active preset. **Clear** resets every filter at once.
- **Sortable columns** — Symbol · Price · 24h % · 24h Volume · Open Interest · Funding · OI Δ · Venue. Click any header to sort, click again to reverse direction.
- **OI Δ tracking** — Since none of the four venues expose open-interest change directly, OI is sampled every refresh into a rolling history per symbol+venue and diffed against the oldest sample inside the selected window (4H/24H). Becomes accurate once the terminal's been open for the full window; treated as unknown (not zero) before that, so it never falsely excludes a row.
- **Cross-venue funding** — Binance and Bybit funding rates are normalized to an 8h-equivalent %, matching Hyperliquid's own funding convention, so the Funding column and filter mean the same thing everywhere. OKX funding periods vary by instrument and are rescaled the same way using each instrument's actual funding interval.
- **Pagination** — Loads the top 50 markets by default for performance. A **Load all — Heavy** button appears at the bottom of the table when more rows are available; it warns before fetching (OKX funding has no bulk endpoint — funding is one request per symbol) and, once confirmed, loads every remaining row and stays fully loaded across venue/preset/filter switches for the rest of the session.
- **Click any row** to jump straight to that market on the Chart panel, routed to the correct venue (Hyperliquid, Binance, OKX, or Bybit).
- **Auto-refresh** — Refreshes on entry and every 60 seconds while the tab is open; stops entirely (no background polling, no API calls) the moment you switch to another tab, and picks back up fresh the next time you return.

---

### Time & Sales
> Live trade tape for Hyperliquid with wallet-level detail.

- **Symbol selector** — Switch between any Hyperliquid perp
- **Side filter** — All / Buy / Sell
- **Min $ filter** — Hide trades below a dollar threshold
- **Highlight $ filter** — Flash trades above a size threshold
- **Pause / resume** — Freeze the tape without missing trades
- **Streaming indicator** — Live badge confirms WebSocket connection
- **Columns:** Venue · Time · Price · Size · USD Value · Side · Wallet address
- **Wallet links** — Every wallet address is a clickable link; click to load it in the Account panel
- **Account size cohort SVGs** — Each wallet row shows a tier icon (Plankton → Leviathan) based on account size
- **Summary bar** — Running Buy total · Sell total · Cumulative delta · Trade count
- **Reset** — Clear tape and restart

---

### Hyperliquid
> Full ticker table + HYPE / BTC / ETH / SOL sidebar with live data from Hypurrscan.

**Ticker table:**
- All Hyperliquid perps and spot markets in a sortable table
- Columns: Symbol (with SVG icon) · Price · 24h % · 24h Volume · Open Interest · Funding · Market
- Market tabs: All / Crypto / XYZ / Spot
- Search filter

**Hypurr sidebar — tabs per coin (HYPE / BTC / ETH / SOL):**
- **Funding** — Live funding rate with APR, hero display
- **TWAPs** — Active TWAP orders with side, USD size, progress bar, ETA
- **Stops** — Active stop orders with side, price, distance %, size
- **Liq Map** — Liquidation map visualization
- **Revenue** — Protocol revenue data
- **News** — Latest news feed

---

### Binance
> Binance perp ticker table with the same layout as the Hyperliquid tab.

- Full Binance USDT-margined perp market table
- Columns: Symbol · Price · 24h % · 24h Volume · Open Interest · Funding
- Search filter
- Sortable columns

---

### Journal Trade Tracking on Chart
> Overlay your journal trades on the live chart exactly like a tracked Hyperliquid wallet — built for demo trading immersion.

When you have a trade logged in the Journal with an **Open** status, you can load it onto the Chart panel as a live position overlay:

- The trade entry price appears as a horizontal line on the chart
- Side label (LONG / SHORT), entry price, and unrealized PnL display in the same style as a real Hyperliquid position overlay
- PnL updates live as the market moves against your logged entry
- Works identically to the **Track wallet** feature — same visual language, same overlay layers (Entry, PnL, Liq level if set)
- Designed for paper trading and demo sessions: log a hypothetical trade in the Journal, flip to Chart, and watch it play out with full position immersion
- Toggle off at any time using the same overlay controls as a live wallet track

---

## Theming

### UI Theme Editor
> Fully customize every color token in the interface.

**Access:** Settings → Custom Theme (or the theme picker in the sidenav footer)

**Workflow:**
1. Pick a base theme to start from (or start blank)
2. Name your theme
3. Edit any color group using the color pickers — changes apply live to the entire interface as you drag
4. Save — your theme appears in the theme picker alongside built-ins
5. Export as JSON to back it up or share; Import JSON to load a theme from file

**Editable color tokens:**

| Group | Token | Controls |
|---|---|---|
| Background | `--bg` | Main background |
| | `--bg-alt` | Sidenav / alternate surface |
| | `--bg-panel` | Card / panel background |
| | `--border` | All structural borders |
| Text | `--text` | Primary text |
| | `--text-dim` | Secondary / muted text |
| Accent | `--accent` | Active states, highlights, links |
| | `--accent-dim` | Hover backgrounds, dim accent fills |
| Chart | `--green` | Bull candle / positive values |
| | `--red` | Bear candle / negative values |
| | `--red-dim` | Negative dim fills |
| | `--vwap` | VWAP indicator line |
| | `--rvwap` | Rolling VWAP indicator line |

**Built-in themes** are organized into Dark / Mid / Light groups in the theme dropdown. Custom themes you create appear separately and can be hidden or deleted individually.

---

### Heatmap Theme Editor
> Choose or build a custom color palette for the liquidation / stop heatmap overlays.

**Access:** Chart panel → heatmap settings gear

**Built-in palettes (19):**

| Palette | Character |
|---|---|
| Magma | Black → purple → pink → cream |
| Viridis | Purple → teal → yellow-green |
| Prism | Blue → cyan → orange → red |
| Orchid | Deep purple → lavender → white |
| Neon | Midnight → cyan → magenta → white |
| Glacier | Navy → steel → sky blue → ice |
| Acid | Black → dark green → lime → white |
| Mahogany | Near-black → deep red → orange → cream |
| Lipari | Void → purple → magenta → orange → yellow |
| Gold & White | Grey → teal → navy → yellow |
| Vintage Chart | Black → dark brown → gold → parchment |
| Acid Sunset | Dark violet → magenta → orange → yellow |
| Spring Blossom | Near-black → crimson → pink → blush |
| Royal Mint | Black → teal → mint → near-white |
| BrBG | Brown → sand → off-white → teal → dark green |
| PiYG | Pink → white → yellow-green |
| Hot | Black → red → orange → yellow → white |
| Paired | Multi-stop categorical |
| Twilight | Cyan → navy → deep purple → crimson |

**Custom palette builder:**
- Add, move, or remove gradient stops
- Pick exact hex colors per stop
- Live bubble preview updates as you edit — shows simulated heatmap intensity rendering
- Base a new custom palette off any built-in
- Save custom palettes; they appear alongside built-ins in the palette picker
- Export / Import palette JSON
- Gallery view shows all palettes with rendered gradient swatches side by side

---

## Navigation & Global Features

- **Sidenav** — All panels are accessible from the left sidebar; drag to reorder panels
- **Collapse** — Floating collapse button hides the sidenav for maximum chart space
- **Auto-refresh** — Global auto-refresh toggle with per-panel intervals; indicator shows ON/OFF state
- **Manual refresh** — Refresh all data sources simultaneously
- **Settings** — Theme editor, heatmap theme editor, chart preferences (log scale, etc.)
- **Theme system** — Full CSS variable theme with presets; custom theme editor for every color token
- **Background wallpaper** — Set an image, GIF, or video (MP4/WebM) as the app background from Settings → Background Wallpaper; drag-and-drop or click to browse. Stored locally in your browser (`bg-media.js`). Opacity slider controls how strongly it shows through the UI
- **Sidebar ambient animation** — Decorative, theme-aware canvas animation in the empty sidenav spacer (`sidebar-animations.js`), purely cosmetic. Six selectable styles (Particles, Matrix, Scanline, Grid Pulse, Fireflies, Circuit) plus an Off option, configurable from Settings → Ambient Animation (style + opacity), switchable live without a reload
- **Account tab wave** — The same module's CSS-driven wave hero background behind the Account tab's empty state. Four selectable styles (Ocean, Calm, Storm, Pulse), configurable from Settings → Account Wave (style + opacity + Slow/Normal/Fast speed)

---

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `canoe-terminal` folder
6. The Canoe icon will appear in your Chrome toolbar

> **Note:** Keep the extension folder outside of your Desktop directory to avoid a known Chrome metadata scanning quirk on Windows.

---

## Data Sources

| Source | Used for |
|---|---|
| Hyperliquid API | Perps, spot, account data, fills, positions, orders |
| Binance API | Binance ticker, funding rate, and OHLCV data |
| Bybit API | Long/short ratio, OI breakdown, chart data, funding rate |
| OKX API | Chart data, open interest, funding rate |
| Deribit API | BTC/ETH options chain, implied vol, index price, OHLC candles, option trade flow |
| CoinGecko | Market cap, dominance, trending, gainers/losers |
| alternative.me | Fear & Greed index |
| Hypurrscan | HYPE/BTC/ETH/SOL funding, TWAPs, stops, liq map |
| mempool.space | Bitcoin on-chain data (hashrate, difficulty, fees) |
| Tree of Alpha | Live news WebSocket feed |
| CoinDesk / CointTelegraph / The Block / Decrypt | News aggregation |

---

<div align="center">

```
  ~~~  built for the ones who actually look at the data  ~~~
```

*Canoe Terminal is read-only. No private keys, no trading, no wallet connections.*

</div>
