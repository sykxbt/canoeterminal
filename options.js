'use strict';

/* ============================================================
   options.js — Canoe Terminal
   "Options" panel: BTC/ETH implied-vol & positioning dashboard,
   sourced entirely from Deribit's public REST API — no key, no
   auth, same free-tier pattern as every other data source in the
   terminal (api.js, volusd.js, vbp.js).

   Endpoints used (all public/*, unauthenticated):
     get_index_price               — spot/index mid (btc_usd, eth_usd)
     get_book_summary_by_currency  — full option chain: mark_iv,
                                      mark_price, OI, 24h volume per
                                      instrument, kind=option
     get_tradingview_chart_data    — free OHLC candles for the index,
                                      used to compute realized vol
                                      client-side (no historical-IV
                                      endpoint exists on the free tier,
                                      so realized vol is what backs the
                                      "vol regime" percentile bucket)

   Greeks (gamma) are NOT pulled from Deribit's ticker endpoint (that
   would mean one request per instrument, hundreds of calls per
   refresh). Instead gamma is computed client-side with Black-Scholes
   straight from each instrument's mark_iv/strike/expiry — one chain
   fetch gives us the whole surface for free.

   Deribit only lists BTC/ETH options, so the Vol Index strip only covers
   those two — non-Deribit assets (HYPE, SOL, DOGE, XRP, AVAX) were dropped
   from this strip; their realized-vol proxy numbers were unreliable and
   Deribit itself doesn't surface them either.

   Panel lifecycle mirrors bear.js/bull.js/calendar.js: this file
   exposes window.startOptionsPanel()/stopOptionsPanel(), which
   main.js's onPanelEnter() calls when the "options" nav tab is
   entered/left. DOM + <style> are injected once, lazily, on first
   start — same pattern as indicators-popup.js / htfCandle.js.
   ============================================================ */

const DERIBIT_BASE = 'https://www.deribit.com/api/v2';

async function deribitGet(method, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${DERIBIT_BASE}/${method}?${qs}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[deribit] ' + method + ' HTTP ' + res.status, body);
    throw new Error('Deribit HTTP ' + res.status);
  }
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Deribit error');
  return json.result;
}

const DeribitApi = {
  async indexPrice(ccy) {
    const r = await deribitGet('public/get_index_price', { index_name: `${ccy.toLowerCase()}_usd` });
    return r.index_price;
  },

  // kind=option gives every live BTC or ETH option in one call: mark_iv,
  // mark_price, open_interest, volume, underlying_price per instrument.
  async optionChain(ccy) {
    const rows = await deribitGet('public/get_book_summary_by_currency', { currency: ccy, kind: 'option' });
    // NOTE: previously filtered out rows missing mark_iv/open_interest right
    // here, which silently dropped their 24h volume too — an instrument with
    // no live quote right now (thin/no market-maker presence) can still have
    // traded heavily earlier in the day. Filtering for Greeks/IV purposes now
    // happens downstream in processChain(), scoped to only the calcs that
    // actually need a valid mark_iv, so volume/OI aggregation sees every row.
    return rows || [];
  },

  // Free OHLC candles for the index itself — used to compute realized vol
  // client-side (resolution in minutes; '60' = 1h bars), and now also to
  // paint the GEX Levels mini price chart (needs full OHLC, not just close).
  async indexCandles(ccy, resolution = '60', days = 30) {
    const end = Date.now();
    const start = end - days * 86400000;
    const r = await deribitGet('public/get_tradingview_chart_data', {
      instrument_name: `${ccy}-PERPETUAL`,
      start_timestamp: start,
      end_timestamp: end,
      resolution
    });
    if (!r || !Array.isArray(r.ticks) || r.status === 'no_data') return [];
    return r.ticks.map((t, i) => ({
      t, c: r.close[i], o: r.open[i], h: r.high[i], l: r.low[i]
    })).filter(p => Number.isFinite(p.c));
  },

  // Deribit's own official implied-vol index (DVOL) — real IV history,
  // not the realized-vol proxy used elsewhere as a fallback. Dedicated
  // endpoint (NOT get_tradingview_chart_data — DVOL isn't a tradable
  // instrument for that endpoint, it's an index series with its own
  // getter). Resolution here is in seconds per Deribit's convention for
  // this endpoint (e.g. 3600 = 1h, 86400 = 1D) — NOTE this differs from
  // indexCandles()'s minute-based resolution string, verify against
  // Deribit's docs if results look off; this endpoint's exact shape is
  // unverified in this environment (Deribit isn't reachable from here to
  // test live), so refreshDvol() below fails soft to the RV proxy if the
  // shape doesn't match.
  async volIndexData(ccy, resolutionSec = 3600, days = 90) {
    const end = Date.now();
    const start = end - days * 86400000;
    const r = await deribitGet('public/get_volatility_index_data', {
      currency: ccy,
      start_timestamp: start,
      end_timestamp: end,
      resolution: String(resolutionSec)
    });
    if (!r || !Array.isArray(r.data)) return [];
    // Documented row shape: [timestamp, open, high, low, close]
    return r.data.map(row => ({ t: row[0], c: row[4] })).filter(p => Number.isFinite(p.c));
  },

  // Current DVOL print. DVOL is an index, not a regular tradable
  // instrument — public/ticker with instrument_name: "BTC-DVOL" returns
  // HTTP 400 (confirmed live), so there's no ticker shortcut for "current
  // value" here. Instead, pull the most recent point from the same
  // get_volatility_index_data series used elsewhere (volIndexData above),
  // just over a short window so it's cheap and fast.
  async dvolCurrent(ccy) {
    const series = await this.volIndexData(ccy, 3600, 1); // 1h resolution, last 1 day
    if (!series.length) return null;
    const latest = series[series.length - 1];
    return Number.isFinite(latest.c) ? latest.c : null;
  },

};


/* ---------------- instrument-name parsing ---------------- */
// e.g. "BTC-27JUN25-70000-C" -> { ccy:'BTC', expiry:<ms>, strike:70000, type:'call' }
const _OPT_MONTHS = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };

function parseDeribitExpiry(s) {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(s);
  if (!m) return null;
  const mon = _OPT_MONTHS[m[2]];
  if (mon === undefined) return null;
  // Deribit options settle 08:00 UTC on expiry day.
  return Date.UTC(2000 + parseInt(m[3], 10), mon, parseInt(m[1], 10), 8, 0, 0);
}

function parseInstrumentName(name) {
  const parts = name.split('-');
  if (parts.length < 4) return null;
  const expiry = parseDeribitExpiry(parts[1]);
  const strike = parseFloat(parts[2]);
  if (!expiry || !Number.isFinite(strike)) return null;
  return { ccy: parts[0], expiry, expiryLabel: parts[1], strike, type: parts[3] === 'C' ? 'call' : 'put' };
}

/* ---------------- stats helpers (self-contained, no shared dep) ---------------- */

function _normPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

// Abramowitz-Stegun approximation of the standard normal CDF — good to
// ~1e-7, plenty for a Greeks display (not a pricing engine).
function _normCdf(x) {
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937, b4 = -1.821255978, b5 = 1.330274429;
  const p = 0.2316419, c = 0.39894228;
  if (x >= 0) {
    const t = 1 / (1 + p * x);
    return 1 - c * Math.exp(-x * x / 2) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
  }
  return 1 - _normCdf(-x);
}

// Black-Scholes gamma, r=0 (crypto perp/option desks conventionally price
// off the futures/index with zero risk-free drift baked in separately —
// close enough for a positioning gauge, not meant to be a pricing engine).
function bsGamma(S, K, sigma, T) {
  if (!(S > 0) || !(K > 0) || !(sigma > 0) || !(T > 0)) return 0;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return _normPdf(d1) / (S * sigma * Math.sqrt(T));
}

// Black-Scholes delta, same r=0 convention as bsGamma above.
function bsDelta(S, K, sigma, T, type) {
  if (!(S > 0) || !(K > 0) || !(sigma > 0) || !(T > 0)) return null;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return type === 'call' ? _normCdf(d1) : _normCdf(d1) - 1;
}

// Black-Scholes theta, r=0. Returned as decay per calendar day (annualized
// theta / 365) in underlying-currency terms (BTC/ETH), matching how
// Deribit's own ticker and every other chain viewer quotes it — the raw
// per-year figure is unreadably large and nobody actually uses it that way.
function bsTheta(S, K, sigma, T, type) {
  if (!(S > 0) || !(K > 0) || !(sigma > 0) || !(T > 0)) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  // r=0 collapses the standard call/put theta formulas to the same first
  // term; they only differ in the sign/side of the second (N(d2) vs N(-d2))
  // term, same as delta above.
  const term1 = -(S * _normPdf(d1) * sigma) / (2 * sqrtT);
  const thetaPerYear = type === 'call'
    ? term1 // r=0: the -rK*e^{-rT}*N(d2) term vanishes entirely
    : term1; // same vanishing term on the put side
  return thetaPerYear / 365;
}

// Black-Scholes vega, r=0. Returned per 1 vol point (i.e. already divided
// by 100) since IV is quoted here as a percentage (e.g. 43.4, not 0.434) —
// this is "price change for a 1-point IV move", the standard vega convention.
function bsVega(S, K, sigma, T) {
  if (!(S > 0) || !(K > 0) || !(sigma > 0) || !(T > 0)) return null;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return (S * _normPdf(d1) * Math.sqrt(T)) / 100;
}

function percentileRank(arr, value) {
  if (!arr.length) return 50;
  const below = arr.filter(v => v <= value).length;
  return Math.round((below / arr.length) * 100);
}

function regimeLabel(pct) {
  if (pct >= 85) return { label: 'EXTREME', cls: 'opt-regime-extreme' };
  if (pct >= 65) return { label: 'ELEVATED', cls: 'opt-regime-elevated' };
  if (pct <= 20) return { label: 'LOW', cls: 'opt-regime-low' };
  return { label: 'NORMAL', cls: 'opt-regime-normal' };
}

// Annualized realized vol (close-to-close) from an array of {t,c} candles.
function realizedVol(candles, barsPerYear) {
  if (candles.length < 3) return null;
  const rets = [];
  for (let i = 1; i < candles.length; i++) {
    const r = Math.log(candles[i].c / candles[i - 1].c);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(barsPerYear) * 100; // as a %, matches IV convention
}

// Classifies an expiry as weekly/monthly/quarterly using Deribit's own
// listing convention: the expiry that falls in the last ~7 days of its
// calendar month is that month's "monthly" (this is where OI structurally
// clusters — most desks roll/hedge into it), and if that month is a
// quarter-end (Mar/Jun/Sep/Dec) it's the bigger "quarterly" instead. No
// separate contract-type flag exists in get_book_summary_by_currency, so
// this is inferred from the date itself — same approach traders use to
// eyeball a chain.
function classifyExpiry(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const lastDayOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const isMonthEnd = (lastDayOfMonth - day) <= 7;
  const isQuarterMonth = (m === 2 || m === 5 || m === 8 || m === 11);
  if (isMonthEnd && isQuarterMonth) return 'quarterly';
  if (isMonthEnd) return 'monthly';
  return 'weekly';
}

/* ---------------- chain processing ---------------- */

function processChain(rows, spot) {
  const now = Date.now();

  // Raw pass over every currently-listed instrument, used ONLY for 24h
  // volume totals. An instrument with no live quote right now (mark_iv
  // null — thin book / no active market-maker) can still carry real 24h
  // volume from earlier trades, so volume must not depend on having a
  // current quote the way Greeks/IV calcs legitimately do.
  const rawLive = rows.map(r => {
    const meta = parseInstrumentName(r.instrument_name);
    if (!meta) return null;
    if ((meta.expiry - now) <= 0) return null;
    // Reverted to raw contract volume — switching to volume_usd (notional)
    // moved the aggregate ratio further from the DM reference (0.49 -> 0.35),
    // not closer, which rules out "richer put premiums inflate $ volume" as
    // the explanation. Contracts is the better-supported baseline of the two
    // tested; the remaining gap to ~0.85 isn't explained by volume weighting.
    return { type: meta.type, volume: r.volume || 0 };
  }).filter(Boolean);

  // Strike+expiry -> mark_iv lookup, keyed off whichever instruments DO have
  // a live quote right now. Used below to backfill a strike whose own quote
  // is momentarily missing, instead of dropping it outright. Rationale:
  // dropping a strike (rather than estimating it) punches a hole in the
  // cumulative-gamma walk the gamma flip is computed from, and thin
  // in-between strikes drop out more often than round, heavily-quoted
  // ones — which was silently forcing the flip onto whichever round strike
  // happened to still have a live quote, instead of reflecting real
  // positioning. Put/call IV at the same strike+expiry is near-identical
  // outside deep skew, so the opposite-type quote is a reasonable fill-in.
  const ivByStrikeExpiry = {};
  rows.forEach(r => {
    if (r.mark_iv == null) return;
    const meta = parseInstrumentName(r.instrument_name);
    if (!meta) return;
    const key = meta.expiry + '_' + meta.strike;
    if (!ivByStrikeExpiry[key]) ivByStrikeExpiry[key] = [];
    ivByStrikeExpiry[key].push(r.mark_iv);
  });
  function ivForStrike(expiry, strike) {
    const vals = ivByStrikeExpiry[expiry + '_' + strike];
    return vals && vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  const parsed = rows.map(r => {
    const meta = parseInstrumentName(r.instrument_name);
    if (!meta) return null;
    const T = (meta.expiry - now) / (365 * 86400000);
    if (T <= 0) return null;
    // OI still requires the row's own reported open_interest — that's a real
    // count, not something to synthesize. IV falls back to the opposite-type
    // quote at the same strike+expiry when this instrument's own mark_iv is
    // momentarily missing (see ivByStrikeExpiry above).
    if (r.open_interest == null) return null;
    const markIv = r.mark_iv != null ? r.mark_iv : ivForStrike(meta.expiry, meta.strike);
    if (markIv == null) return null;
    const ivFrac = markIv / 100;
    // Floor T at 1 calendar day — same-day expiries (T → 0) produce
    // pathological gamma spikes that blow up net GEX. Tested excluding
    // these entirely instead (matching some dashboards' convention), but
    // that overshot the DM reference in the opposite direction (79,517 ->
    // 77,689 while DM sat at 78,795) — worse, not better — so flooring is
    // the better-supported choice here, confirmed empirically.
    const Tclamped = Math.max(T, 1 / 365);
    return {
      ...meta,
      iv: markIv,
      oi: r.open_interest || 0,
      volume: r.volume || 0,
      markPrice: Number.isFinite(r.mark_price) ? r.mark_price : null, // in underlying units (BTC/ETH), per Deribit convention
      bidPrice: Number.isFinite(r.bid_price) ? r.bid_price : null,    // top-of-book, underlying units — book_summary gives price only, no size/IV
      askPrice: Number.isFinite(r.ask_price) ? r.ask_price : null,
      T,
      gamma: bsGamma(spot, meta.strike, ivFrac, Tclamped),
      delta: bsDelta(spot, meta.strike, ivFrac, Tclamped, meta.type),
      theta: bsTheta(spot, meta.strike, ivFrac, Tclamped, meta.type),
      vega: bsVega(spot, meta.strike, ivFrac, Tclamped)
    };
  }).filter(Boolean);

  if (!parsed.length) return null;

  // Group expiries, nearest-first.
  const expiries = [...new Set(parsed.map(p => p.expiry))].sort((a, b) => a - b);
  const nearest = expiries[0];
  // near7/near30 drive the "ATM IV Front / 30D" ledger display only. near7 is
  // the true nearest listed expiry (can be a 0-3 day, thin/noisy print) —
  // fine for display, but too fragile to anchor the CONTANGO/BACKWARDATION
  // label on by itself (see termShapeNear/termShapeFar below for that).
  const near7 = nearest;
  const laterExpiries = expiries.filter(e => e > near7);
  const near30 = expiries.find(e => (e - now) >= 25 * 86400000)
    || (laterExpiries.length ? laterExpiries[laterExpiries.length - 1] : near7);
  // Dedicated pair for the termStructure/termDiff label: ~7D vs ~14D. Tried,
  // and rejected in testing, in order: (a) diffing whichever two arbitrary
  // snapshot tenors happened to be picked — broke on a flat patch giving a
  // false FLAT; (b) nearest-listed-expiry vs 30D — too exposed to the
  // nearest expiry's own noise (agreed with BTC's true shape by chance, but
  // mislabeled ETH); (c) a whole-curve log(days) slope fit — washed out a
  // genuine near-term kink under the long tail's dominant trend; (d) DVOL
  // (Deribit's smoothed ~30D index) vs this chain's 30D IV — DVOL tracks
  // close to the front by construction, so it's structurally the same
  // front-vs-back read as (b) and produced the same wrong split. What
  // actually distinguishes the two live curves is a LOCAL kink around the
  // 1-2 week mark (BTC dips 7D->14D; ETH rises 7D->14D) — both tenors here
  // are liquid enough to not be dominated by 0-3 day noise, while still
  // being local enough to catch that kink instead of averaging across the
  // whole curve.
  const termShapeNear = expiries.find(e => (e - now) >= 5 * 86400000) || nearest;
  const termShapeFarCandidates = expiries.filter(e => e > termShapeNear && (e - now) >= 12 * 86400000);
  const termShapeFar = termShapeFarCandidates.length ? termShapeFarCandidates[0] : near30;


  function atmRowsForExpiry(expiryMs) {
    const rowsAtExpiry = parsed.filter(p => p.expiry === expiryMs);
    if (!rowsAtExpiry.length) return null;
    // strike closest to spot, averaged across call/put if both exist there
    let closest = rowsAtExpiry[0];
    for (const r of rowsAtExpiry) {
      if (Math.abs(r.strike - spot) < Math.abs(closest.strike - spot)) closest = r;
    }
    const atStrike = rowsAtExpiry.filter(r => r.strike === closest.strike);
    return { strike: closest.strike, rows: atStrike };
  }
  function atmIvForExpiry(expiryMs) {
    const a = atmRowsForExpiry(expiryMs);
    if (!a) return null;
    return a.rows.reduce((acc, r) => acc + r.iv, 0) / a.rows.length;
  }

  const iv7 = atmIvForExpiry(near7);
  const iv30 = atmIvForExpiry(near30);
  // ATM IV at the actual nearest listed expiry — distinct from iv7 (the
  // ~weekly-tenor snapshot, which can land on a *different*, later expiry
  // than "nearest" once anything inside 5 days is skipped). The header
  // tile labels itself with nearestExpiry's date, so it must show this
  // value, not iv7 — showing iv7 there previously meant the label and the
  // number belonged to two different expiries.
  const atmIvNearest = atmIvForExpiry(nearest);

  // Full term structure: ATM IV at every listed expiry, not just a two-point
  // snapshot — lets the curve show humps/kinks/event risk baked into a
  // specific date (e.g. a single expiry sitting well above its neighbors
  // usually means something — an FOMC date, an unlock, etc — is priced
  // into that print specifically).
  const termCurve = expiries.map(e => ({
    expiry: e,
    daysOut: Math.max(0, (e - now) / 86400000),
    iv: atmIvForExpiry(e),
    kind: classifyExpiry(e)
  })).filter(pt => pt.iv != null);

  // CONTANGO/BACKWARDATION label driven by the ~7D vs ~14D local kink (see
  // termShapeNear/termShapeFar above for why this pair, specifically, was
  // chosen over several rejected alternatives).
  let termStructure = 'FLAT';
  let termDiff = 0;
  {
    const shapeNearIv = atmIvForExpiry(termShapeNear);
    const shapeFarIv = atmIvForExpiry(termShapeFar);
    if (shapeNearIv != null && shapeFarIv != null && termShapeFar !== termShapeNear) {
      termDiff = shapeFarIv - shapeNearIv;
      if (termDiff > 0.5) termStructure = 'CONTANGO';
      else if (termDiff < -0.5) termStructure = 'BACKWARDATION';
    } else if (iv7 != null && iv30 != null) {
      termDiff = iv30 - iv7;
      if (termDiff > 0.5) termStructure = 'CONTANGO';
      else if (termDiff < -0.5) termStructure = 'BACKWARDATION';
    }
  }

  // Expected move — ATM straddle (call mark + put mark at the strike
  // nearest spot) at the nearest expiry, translated to a $ range. Deribit
  // quotes option mark_price in the underlying currency (BTC/ETH), so
  // straddle cost in $ = (callMark + putMark) * spot. This is the
  // standard "market-implied" expected move a straddle price encodes —
  // not a probability band, just what the market is charging to hedge
  // that range by expiry.
  let expectedMove = null;
  {
    const atm = atmRowsForExpiry(nearest);
    if (atm) {
      const callRow = atm.rows.find(r => r.type === 'call');
      const putRow = atm.rows.find(r => r.type === 'put');
      if (callRow && putRow && callRow.markPrice != null && putRow.markPrice != null) {
        const straddleUnderlying = callRow.markPrice + putRow.markPrice;
        const dollars = straddleUnderlying * spot;
        expectedMove = {
          expiry: nearest,
          strike: atm.strike,
          dollars,
          pct: spot > 0 ? (dollars / spot) * 100 : null,
          low: spot - dollars,
          high: spot + dollars
        };
      }
    }
  }

  // Put/call by 24h volume (header tile) and by OI (levels panel).
  const callVol = rawLive.reduce((a, p) => a + (p.type === 'call' ? p.volume : 0), 0);
  const putVol  = rawLive.reduce((a, p) => a + (p.type === 'put'  ? p.volume : 0), 0);
  const callOi  = parsed.reduce((a, p) => a + (p.type === 'call' ? p.oi : 0), 0);
  const putOi   = parsed.reduce((a, p) => a + (p.type === 'put'  ? p.oi : 0), 0);

  // Net gamma exposure, $ per 1% move — standard GEX-style approximation.
  // Convention: customers assumed net LONG calls / net SHORT puts (dealers
  // therefore short gamma on calls, long gamma on puts they've sold back)
  // — this is the standard equity-GEX convention ported as-is; crypto
  // dealer positioning isn't publicly verifiable, so treat the sign as
  // an assumption, not a fact, and say so in the UI tooltip.
  let netGammaStrikes = {};
  parsed.forEach(p => {
    const sign = p.type === 'call' ? 1 : -1;
    // Dollar GEX convention: gamma × OI (contracts) × spot² × 0.01 — the
    // standard textbook dollar-gamma form ($ P&L for a 1% spot move), same
    // convention SpotGamma/SqueezeMetrics-style GEX uses. Previously swapped
    // to strike×spot chasing DerivativesMonkey's headline Net Gamma number,
    // but that figure turned out to be a 7-venue blend (Deribit + Binance +
    // Bybit + OKX + Derive + Thalex + Paradex), not a Deribit-only figure —
    // the wrong target for a Deribit-only calc. The original spot² form
    // landed close to the actual Deribit-only reference (~$230M), so
    // reverted here rather than kept "fixed."
    const dollarGamma = p.gamma * p.oi * spot * spot * 0.01 * sign;
    netGammaStrikes[p.strike] = (netGammaStrikes[p.strike] || 0) + dollarGamma;
  });
  const strikesSorted = Object.keys(netGammaStrikes).map(Number).sort((a, b) => a - b);
  const netGammaTotal = Object.values(netGammaStrikes).reduce((a, b) => a + b, 0);
  const gammaByStrike = strikesSorted.map(k => ({ strike: k, gamma: netGammaStrikes[k] }));

  // OI walls: strike with the largest raw same-side OI, constrained to the
  // correct half of the chain (call wall ≥ spot, put wall ≤ spot).
  //
  // GEX-based wall finding doesn't match Coinglass/DM for BTC because far-OTM
  // strikes (e.g. $60K puts) accumulate massive nominal OI but have near-zero
  // gamma — their GEX signal is wiped out even though they represent the
  // biggest real positioning cluster. Raw OI is what those platforms actually
  // rank on, and it's what makes $80K calls and $60K puts the dominant walls
  // at the current chain structure.
  //
  // GEX (netGammaStrikes / gammaByStrike) is still used for the gamma flip
  // and the GEX bar chart — those genuinely need gamma-weighting. Only the
  // wall definition switches to raw OI here.
  const callOiByStrike = {};
  const putOiByStrike  = {};
  parsed.forEach(p => {
    if (p.type === 'call') callOiByStrike[p.strike] = (callOiByStrike[p.strike] || 0) + p.oi;
    else                    putOiByStrike[p.strike]  = (putOiByStrike[p.strike]  || 0) + p.oi;
  });

  function wall(type) {
    const oiMap = type === 'call' ? callOiByStrike : putOiByStrike;
    // Constrain to the natural side; fall back to full chain if empty.
    const candidates = strikesSorted.filter(k =>
      type === 'call' ? k >= spot : k <= spot
    );
    const pool = candidates.length ? candidates : strikesSorted;
    let best = null, bestOi = -Infinity;
    for (const k of pool) {
      const o = oiMap[k] || 0;
      if (o > bestOi) { bestOi = o; best = k; }
    }
    // gex on the returned object uses the net GEX map so downstream renderers
    // that display wall.gex still get a gamma-weighted value (sign: calls +, puts −).
    const wallGex = best == null ? 0 : (netGammaStrikes[best] || 0);
    return { strike: best, oi: bestOi, gex: wallGex };
  }
  const callWall = wall('call');
  const putWall  = wall('put');

  // Gamma flip: strike where net cumulative gamma crosses zero, closest to
  // current spot. Real BTC/ETH gamma profiles often cross zero more than
  // once across the full chain (multiple OI clusters at different strikes),
  // so picking the first crossing found walking up from the lowest strike
  // can land on an irrelevant, far-OTM crossing instead of the one that
  // actually describes current dealer positioning near spot.
  //
  // NOTE ON THE REMAINING GAP TO DERIVATIVESMONKEY: confirmed via their own
  // client bundle that their sign convention isn't purely the textbook
  // "customers long calls / short puts" assumption used here — they offer
  // a "standard/naive" view (same assumption as this file) AND a
  // "corrected" view that flips a strike's dealer-gamma sign based on real
  // taker trade-flow direction at that strike (their own copy: "Sign
  // adjusted by taker-side flow. Inverted strikes reflect dealer long-gamma
  // est."). That requires trade-tape data (who initiated each trade),
  // which Deribit's get_book_summary_by_currency does not provide — would
  // need get_last_trades_by_instrument or similar to replicate. This file's
  // flipStrike is therefore the non-corrected/naive equivalent of DM's
  // "Standard" toggle, not their "Corrected" one — hence the UI label.
  // Remaining gap vs. their reference is expected and not a bug.
  let flipStrike = null;
  {
    const crossings = [];
    let cum = 0;
    for (let i = 0; i < strikesSorted.length; i++) {
      const prevCum = cum;
      const k = strikesSorted[i];
      cum += netGammaStrikes[k];
      if ((prevCum <= 0 && cum > 0) || (prevCum >= 0 && cum < 0)) {
        // Linear interpolation of the actual zero crossing between the
        // previous listed strike and this one, instead of snapping to
        // whichever listed strike the cumulative sum happened to cross at.
        // Snapping is why this used to always land on a round strike
        // (78,000 / 80,000 etc.) — the true crossing is almost never
        // exactly on a listed strike. Interpolation was tried before and
        // made things worse, but that was on a strike series with holes
        // near spot (missing mark_iv strikes were dropped rather than
        // filled), so it was interpolating across gaps. With that fixed
        // upstream, the series is complete and interpolation should track
        // a reference like DerivativesMonkey's non-round flip value.
        const prevK = strikesSorted[i - 1];
        const interp = (prevK == null || cum === prevCum)
          ? k
          : prevK + (0 - prevCum) * (k - prevK) / (cum - prevCum);
        crossings.push(interp);
      }
    }
    if (crossings.length) {
      flipStrike = crossings.reduce((best, k) => Math.abs(k - spot) < Math.abs(best - spot) ? k : best);
    } else if (strikesSorted.length) {
      flipStrike = strikesSorted[Math.floor(strikesSorted.length / 2)];
    }
  }

  // Max pain across the whole chain (all expiries combined) — matches how
  // most aggregate dashboards report a single blended max-pain figure
  // rather than one scoped to just the nearest expiry. Strike minimizing
  // total option holder payout at settlement, summed across every live
  // contract regardless of expiry.
  const candidateStrikes = [...new Set(parsed.map(p => p.strike))];
  let maxPain = null, minPayout = Infinity;
  for (const S of candidateStrikes) {
    let payout = 0;
    for (const p of parsed) {
      if (p.type === 'call' && S > p.strike) payout += (S - p.strike) * p.oi;
      if (p.type === 'put'  && S < p.strike) payout += (p.strike - S) * p.oi;
    }
    if (payout < minPayout) { minPayout = payout; maxPain = S; }
  }

  // IV skew/smile — nearest-dated expiry only, calls and puts kept separate
  // so downside (put) vs upside (call) skew is visible at a glance. Deribit
  // often lists both a call and put at the same strike; average mark_iv
  // across duplicates at a given strike/type (rare, but two illiquid quotes
  // can land on the same strike).
  const nearExpiryRows = parsed.filter(p => p.expiry === nearest);
  function skewSide(type) {
    const byStrike = {};
    nearExpiryRows.filter(p => p.type === type).forEach(p => {
      if (!byStrike[p.strike]) byStrike[p.strike] = { sum: 0, n: 0 };
      byStrike[p.strike].sum += p.iv;
      byStrike[p.strike].n += 1;
    });
    return Object.keys(byStrike).map(Number).sort((a, b) => a - b)
      .map(k => ({ strike: k, iv: byStrike[k].sum / byStrike[k].n }));
  }
  const ivSkew = {
    expiry: nearest,
    calls: skewSide('call'),
    puts: skewSide('put')
  };

  // OI / Notional by expiry — one row per listed expiry, call/put split,
  // plus notional (OI * spot) since raw contract-count OI isn't directly
  // comparable across BTC/ETH. Feeds the bar chart and the pin-risk flags
  // below: monthly/quarterly expiries structurally accumulate the deepest
  // OI (that's where market-makers and desks concentrate rolls/hedges), so
  // a big monthly/quarterly bar sitting within the next couple weeks is the
  // classic setup for price to "pin" toward the strike(s) with the heaviest
  // open interest into settlement.
  const oiByExpiry = expiries.map(e => {
    const rows = parsed.filter(p => p.expiry === e);
    const callOi = rows.filter(p => p.type === 'call').reduce((a, p) => a + p.oi, 0);
    const putOi = rows.filter(p => p.type === 'put').reduce((a, p) => a + p.oi, 0);
    const totalOi = callOi + putOi;
    return {
      expiry: e,
      kind: classifyExpiry(e),
      daysOut: Math.max(0, (e - now) / 86400000),
      callOi, putOi, totalOi,
      notional: totalOi * spot
    };
  });
  const totalOiAllExpiries = oiByExpiry.reduce((a, o) => a + o.totalOi, 0);
  // Flag: monthly/quarterly expiry, within 14 days, holding a meaningfully
  // outsized share (>=15%) of total open interest across the whole chain.
  const pinRiskExpiries = oiByExpiry
    .filter(o => o.kind !== 'weekly' && o.daysOut <= 14 && totalOiAllExpiries > 0 && (o.totalOi / totalOiAllExpiries) >= 0.15)
    .sort((a, b) => a.daysOut - b.daysOut);

  return {
    spot,
    expiries: expiries.length,
    expiryList: expiries,      // raw timestamps, ascending — needed to drive the chain table's expiry selector
    parsed,                    // per-instrument rows — needed to build the strike-by-strike chain table
    instruments: parsed.length,
    nearestExpiry: nearest,
    iv7, iv30, atmIvNearest, termStructure, termDiff, termCurve, expectedMove,
    callVol, putVol,
    putCallVolRatio: callVol > 0 ? putVol / callVol : null,
    callOi, putOi,
    putCallOiRatio: callOi > 0 ? putOi / callOi : null,
    totalOi: callOi + putOi,
    callWall, putWall,
    netGammaTotal, flipStrike, gammaByStrike,
    maxPain, ivSkew,
    oiByExpiry, pinRiskExpiries, totalOiAllExpiries,
    topExpiry: (() => {
      const byExpiry = {};
      parsed.forEach(p => { byExpiry[p.expiry] = (byExpiry[p.expiry] || 0) + p.oi; });
      let best = nearest, bestOi = -1;
      for (const [e, oi] of Object.entries(byExpiry)) if (oi > bestOi) { bestOi = oi; best = Number(e); }
      return { expiry: best, oi: bestOi };
    })()
  };
}

/* ---------------- formatting ---------------- */

function fmtUsd(n, compact = true) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (!compact) return sign + '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1e9) return sign + '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return sign + '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return sign + '$' + (n / 1e3).toFixed(1) + 'K';
  return sign + '$' + n.toFixed(0);
}

function fmtNum(n, decimals = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase().replace(/ /g, '');
}

function sparklinePath(values, w = 100, h = 28) {
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || 1;
  const step = w / Math.max(1, values.length - 1);
  return values.map((v, i) => {
    const x = (i * step).toFixed(1);
    const y = (h - ((v - min) / range) * h).toFixed(1);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
}

function sparklineAreaPath(values, w = 100, h = 28) {
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || 1;
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = (i * step).toFixed(1);
    const y = (h - ((v - min) / range) * h).toFixed(1);
    return `${x},${y}`;
  });
  const lastX = ((values.length - 1) * step).toFixed(1);
  // Line + close down to baseline
  return `M${pts[0]} ` + pts.slice(1).map(p => `L${p}`).join(' ')
    + ` L${lastX},${h} L0,${h} Z`;
}

/* ============================================================
   Panel state + lifecycle
   ============================================================ */

const OPT = {
  built: false,
  currency: 'BTC',           // BTC | ETH — drives the header + summary card
  pollTimer: null,
  slowTimer: null,
  loading: false,
  slowLoading: false,
  fastFetchedAt: 0,          // Date.now() of last successful refreshAll() fetch (0 = never)
  slowFetchedAt: 0,          // Date.now() of last successful refreshSlow() fetch (0 = never)
  chain: {},                 // ccy -> processed chain object (includes gammaByStrike for the GEX chart)
  spot: {},                  // ccy -> index price
  rvSeries: {},              // ccy -> array of realized-vol samples (fallback for regime %, when DVOL unavailable)
  dvolSeries: {},             // ccy -> array of DVOL closes (preferred source for regime %)
  dvol: {},                   // ccy -> current DVOL print
  dvolAvailable: {},          // ccy -> bool, whether the DVOL endpoints worked this session
  oiExpiryUnit: 'contracts', // 'contracts' | 'notional' — OI-by-expiry chart unit toggle
  priceCandles: {},          // ccy -> OHLC candles for the GEX Levels price chart
  priceCandlesError: {}      // ccy -> last fetch error message, or null once successful
};

/* ── Term-structure heat bar colorway ──────────────────────────────
   Default is the classic red(backwardation)/green(contango) gauge built
   in renderTermHeat() below. Clicking the bar opens a dropdown (built with
   heatmap-theme-editor.js's shared picker) offering any built-in or
   custom heatmap colormap as an alternative — same palettes/editor used
   by the backtester's liq/stop heatmaps, so a palette made in one place
   is available in the other. null = default red/green. */
const OPT_TERM_HEAT_KEY_STORAGE = 'canoeOptTermHeatColorway';
let OPT_TERM_HEAT_KEY = null;
try { OPT_TERM_HEAT_KEY = localStorage.getItem(OPT_TERM_HEAT_KEY_STORAGE) || null; } catch {}

function _setOptTermHeatKey(key) {
  OPT_TERM_HEAT_KEY = key || null;
  try {
    if (OPT_TERM_HEAT_KEY) localStorage.setItem(OPT_TERM_HEAT_KEY_STORAGE, OPT_TERM_HEAT_KEY);
    else localStorage.removeItem(OPT_TERM_HEAT_KEY_STORAGE);
  } catch {}
  const c = OPT.chain[OPT.currency];
  if (c) renderTermHeat(c.termDiff);
}

const OPT_CHAIN_POLL_MS  = 30000;   // book summary — matches other live-ish panels' 30s cadence
const OPT_SLOW_POLL_MS   = 300000;  // realized-vol / candle-derived series — 5 min is plenty
// TTLs: how old data can be before we re-fetch on tab entry, rather than
// unconditionally hitting Deribit every time startOptionsPanel() runs.
// Same pattern as funding.js's FND_FAST_TTL_MS/FND_SLOW_TTL_MS — a bit
// under each poll interval so a normal interval tick still refetches, but
// rapid tab-switches (leave Options, come right back) reuse the cache.
const OPT_FAST_TTL_MS = 25000;   // re-fetch fast data if >25s stale
const OPT_SLOW_TTL_MS = 270000;  // re-fetch slow data if >4.5min stale

async function refreshChain(ccy) {
  const [spot, rows] = await Promise.all([
    DeribitApi.indexPrice(ccy),
    DeribitApi.optionChain(ccy)
  ]);
  OPT.spot[ccy] = spot;
  OPT.chain[ccy] = processChain(rows, spot);
}

async function refreshRealizedVolSeries(ccy) {
  // 90 daily closes -> rolling 7d realized-vol samples. Fallback source for
  // the Vol Regime badge/percentile — used only when DVOL (refreshDvol)
  // isn't available. Always computed regardless, so the fallback is ready
  // instantly if DVOL fails on any given refresh.
  const candles = await DeribitApi.indexCandles(ccy, '60', 90); // hourly bars, 90d
  if (candles.length < 24 * 8) { OPT.rvSeries[ccy] = []; return; }
  const perDay = 24; // hourly bars
  const samples = [];
  for (let end = perDay * 7; end < candles.length; end += perDay) {
    const window = candles.slice(end - perDay * 7, end);
    const rv = realizedVol(window, 365 * perDay);
    if (rv != null) samples.push(rv);
  }
  OPT.rvSeries[ccy] = samples;
  OPT.rv7d = OPT.rv7d || {};
  OPT.rv7d[ccy] = samples.length ? samples[samples.length - 1] : null;
}

async function refreshDvol(ccy) {
  // Vol Regime badge only — NOT used for termStructure/termDiff. (An earlier
  // version tried DVOL vs 30D IV as the term-structure signal; disproven —
  // DVOL tracks close to the front of the curve by construction, so it's
  // structurally the same front-vs-back read that already mislabeled ETH.
  // See the termShapeNear/termShapeFar comment in processChain() for what's
  // actually used.) Falls back to the realized-vol proxy
  // (refreshRealizedVolSeries, still run unconditionally) if either call
  // fails or comes back empty — this endpoint's response shape is
  // unverified in this environment, so treat a failure here as
  // expected/handled, not an error.
  try {
    const [series, current] = await Promise.all([
      DeribitApi.volIndexData(ccy, 3600, 90),
      DeribitApi.dvolCurrent(ccy)
    ]);
    if (series.length >= 24 * 8 && current != null) {
      OPT.dvolSeries[ccy] = series.map(p => p.c);
      OPT.dvol[ccy] = current;
      OPT.dvolAvailable[ccy] = true;
    } else {
      OPT.dvolAvailable[ccy] = false;
    }
  } catch (_) {
    OPT.dvolAvailable[ccy] = false;
  }
}

// GEX Levels price chart — fetches enough history so the candles actually
// reach the Put Wall price level.  If the put wall is far below (or above)
// current spot we need to go back further in time; we estimate how many days
// that requires by looking at the % distance from spot to the put wall and
// assuming a rough 1-2 %/day drift, then clamp to a sane [3, 365] day range.
async function refreshPriceCandles(ccy) {
  const MIN_DAYS = 30;  // always fetch at least this much so recent action is always in view
  const MAX_DAYS = 720; // hard ceiling — 2y of history is plenty even for very distant walls
  const c = OPT.chain[ccy];
  const spot = OPT.spot[ccy];
  let days = MIN_DAYS;

  if (c && spot && c.putWall && Number.isFinite(c.putWall.strike) && c.callWall && Number.isFinite(c.callWall.strike)) {
    // How far (%) is the most distant level (put wall or call wall) from spot?
    const distPct = Math.max(
      Math.abs(c.putWall.strike  - spot) / spot,
      Math.abs(c.callWall.strike - spot) / spot
    ) * 100;
    // Assume a conservative ~0.6%/day drift budget, plus a 60% buffer so the
    // level lands well inside the fetched range rather than right at the edge.
    const estimatedDays = Math.ceil((distPct / 0.6) * 1.6);
    days = Math.max(MIN_DAYS, Math.min(MAX_DAYS, estimatedDays));
  }

  // Pick a resolution that keeps the candle count within a sane request size
  // (Deribit's get_tradingview_chart_data 400s on overly large requests —
  // there's no documented exact cap, so we target a conservative ~500 bars).
  // '720' = 12h is the coarsest sub-daily resolution Deribit offers, so very
  // large windows (>360d) fall back to daily ('1D') instead of ballooning
  // the bar count past what '720' can keep under the target.
  function resolutionFor(d) {
    // Only resolutions Deribit's get_tradingview_chart_data actually accepts:
    // 1,3,5,10,15,30,60,120,180,360,720,'1D' — 240 and 360 are NOT supported.
    const targetBars = 500;
    const minutesNeeded = (d * 1440) / targetBars;
    if (minutesNeeded <= 60)  return '60';
    if (minutesNeeded <= 120) return '120';
    if (minutesNeeded <= 180) return '180';
    if (minutesNeeded <= 720) return '720';
    return '1D';
  }

  // Try the estimated window first; on any failure (including a 400 from an
  // over-large request, a transient network blip, or an undocumented per-
  // request size cap) back off through progressively shorter/coarser
  // windows rather than leaving the chart blank. The final rung is an exact
  // match for the request refreshRealizedVolSeries already makes
  // successfully every 5 minutes (90d @ 1h resolution), so it's the one
  // attempt we know works against this endpoint.
  const attempts = [];
  attempts.push({ d: days, res: resolutionFor(days) });                 // best estimate for the actual walls
  if (days > 180) attempts.push({ d: 180, res: resolutionFor(180) });   // back off if the full estimate was too large
  if (days !== 90) attempts.push({ d: 90, res: '60' });                 // known-good fallback shape (matches refreshRealizedVolSeries)

  let lastErr = null;
  for (const { d, res } of attempts) {
    try {
      const candles = await DeribitApi.indexCandles(ccy, res, d);
      if (candles.length) {
        OPT.priceCandles[ccy] = candles;
        OPT.priceCandlesError[ccy] = null;
        return;
      }
      lastErr = 'No candle data returned';
    } catch (err) {
      lastErr = (err && err.message) || 'Failed to load price history';
    }
  }

  // Every attempt failed — surface the last error only if we have nothing
  // cached at all, so the panel doesn't just sit blank with no explanation.
  if (!OPT.priceCandles[ccy] || !OPT.priceCandles[ccy].length) {
    OPT.priceCandlesError[ccy] = lastErr;
  }
}

// Fast poll: option chain + price candles for both currencies. Skips
// entirely if the cache is still within TTL — safe to call on tab
// re-entry (or on the visibilitychange "catch up") without burning
// Deribit quota when nothing's actually stale yet.
async function refreshAll() {
  if (OPT.loading) return;
  const now = Date.now();
  if (OPT.fastFetchedAt && now - OPT.fastFetchedAt < OPT_FAST_TTL_MS) {
    renderOptionsPanel();
    return;
  }
  OPT.loading = true;
  try {
    await Promise.allSettled([refreshChain('BTC'), refreshChain('ETH')]);
    await Promise.allSettled([
      refreshPriceCandles('BTC'), refreshPriceCandles('ETH')
    ]);
    OPT.fastFetchedAt = Date.now();
    renderOptionsPanel();
  } finally {
    OPT.loading = false;
  }
}

// Slow poll: realized-vol series + DVOL for both currencies. Same
// TTL-skip shape as refreshAll() above.
async function refreshSlow() {
  if (OPT.slowLoading) return;
  const now = Date.now();
  if (OPT.slowFetchedAt && now - OPT.slowFetchedAt < OPT_SLOW_TTL_MS) {
    renderVolIndexStrip();
    renderSummaryCard();
    return;
  }
  OPT.slowLoading = true;
  try {
    await Promise.allSettled([
      refreshRealizedVolSeries('BTC'),
      refreshRealizedVolSeries('ETH'),
      refreshDvol('BTC'),
      refreshDvol('ETH')
    ]);
    OPT.slowFetchedAt = Date.now();
    renderVolIndexStrip();
    renderSummaryCard();
  } finally {
    OPT.slowLoading = false;
  }
}

/* ============================================================
   DOM build (once) + render
   ============================================================ */

function ensureOptionsStyle() {
  if (document.getElementById('optionsPanelStyle')) return;
  const style = document.createElement('style');
  style.id = 'optionsPanelStyle';
  style.textContent = `
#panel-options { padding: 6px 10px 14px; overflow-y: auto; overflow-x: hidden; height: 100%; box-sizing: border-box; }
.opt-toprow {
  display: flex; flex-wrap: nowrap; margin-bottom: 3px;
  background: var(--bg-panel, #111c21); border: 1px solid var(--border, #1e2c32);
}
.opt-tile {
  flex: 1 1 130px; display: flex; justify-content: center; align-items: center;
  position: relative;
}
.opt-tile + .opt-tile { border-left: 1px solid var(--border, #1e2c32); }
.opt-tile-inner {
  display: inline-block; padding: 2px 14px; text-align: center;
}
.opt-tile-hdr { display: flex; justify-content: center; align-items: center; gap: 6px;
  font-size: 8px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 1px; font-family: var(--mono); }
.opt-tile-val { font-size: 13px; font-weight: 700; color: var(--text); font-family: var(--mono); line-height: 1.1; text-align: center; }
#optScreenshotBtn {
  position: absolute; top: 3px; right: 4px;
  width: 14px; height: 14px; padding: 0; border: none; background: none;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  opacity: 0.55; transition: opacity 0.15s;
}
#optScreenshotBtn:hover { opacity: 1; }
#optScreenshotBtn .opt-sc-ico {
  display: block; width: 12px; height: 12px;
  background-color: var(--text-dim, #8a9690);
  -webkit-mask-image: url('icons/camera.svg'); -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;
  mask-image: url('icons/camera.svg'); mask-size: contain;
  mask-repeat: no-repeat; mask-position: center;
  pointer-events: none; transition: background-color 0.15s;
}
#optScreenshotBtn:hover .opt-sc-ico { background-color: var(--text, #e8ece9); }
.opt-tabs { display: flex; align-items: center; gap: 8px; margin: 0 0 3px; font-size: 9px;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); font-family: var(--mono); }
.opt-tabs .opt-tab-active { color: var(--accent); font-weight: 700; border-bottom: 1px solid var(--accent); padding-bottom: 1px; }
.opt-ccy-toggle { display: flex; gap: 0; margin-left: auto; border: 1px solid var(--border); }
.opt-ccy-btn { background: transparent; border: none; color: var(--text-dim);
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.05em; padding: 2px 9px; cursor: pointer; }
.opt-ccy-btn + .opt-ccy-btn { border-left: 1px solid var(--border); }
.opt-ccy-btn.on { background: var(--accent-dim, #17331f); color: var(--accent); }

/* ---- Two-column layout: pairs charts/tables side by side to halve vertical stacking ---- */
.opt-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-items: start; }
.opt-2col-col { min-width: 0; }

/* ---- Ledger: dense two-column label/value rows, house hl-table language ---- */
.opt-ledger-wrap { display: flex; gap: 0; border: 1px solid var(--border); margin-bottom: 4px; }
.opt-ledger-col { flex: 1; min-width: 0; }
.opt-ledger-col + .opt-ledger-col { border-left: 1px solid var(--border); }
.opt-ledger-hdr {
  font-family: var(--mono); font-size: 8px; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--text-dim); padding: 3px 8px; border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center; background: rgba(128,128,128,0.03);
}
.opt-ledger-row {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 2px 8px; border-bottom: 1px solid var(--border); font-family: var(--mono);
}
.opt-ledger-row:last-child { border-bottom: none; }
.opt-ledger-row:hover { background: rgba(128,128,128,0.04); }
.opt-ledger-lbl { font-size: 8.5px; color: var(--text-dim); letter-spacing: 0.02em; }
.opt-ledger-val { font-size: 10.5px; font-weight: 700; color: var(--text); text-align: right; }
.opt-ledger-sub { font-size: 7.5px; color: var(--text-dim); font-weight: 400; margin-left: 5px; }
.opt-ledger-hero { padding: 4px 8px 2px; border-bottom: 1px solid var(--border); }
.opt-ledger-hero-val { font-size: 16px; font-weight: 700; font-family: var(--mono); color: var(--text); line-height: 1; }
.opt-ledger-hero-sub { font-size: 8px; color: var(--text-dim); margin-top: 1px; text-transform: uppercase; letter-spacing: 0.04em; }
.opt-flag { font-size: 8.5px; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 700; }
.opt-flag-extreme { color: #e8a03a; }
.opt-flag-elevated { color: #d9c15a; }
.opt-flag-low { color: var(--text-dim); }
.opt-flag-normal { color: var(--green, #26a69a); }
.opt-maxpain-grad {
  background: linear-gradient(90deg, #e8a03a 0%, #f2c14e 55%, #ffdf8a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 700;
}
.opt-flag::before { content: '●'; margin-right: 3px; font-size: 6px; vertical-align: 1px; }
.opt-footer-note { font-size: 8px; line-height: 1.25; color: var(--text-dim); margin: 0 0 3px; font-family: var(--mono); }

/* ---- Vol index: compact row-list, not card tiles ---- */
.opt-vi-title { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); margin: 8px 0 9px; font-family: var(--mono); }
.opt-vi-table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 10px; }
.opt-vi-table th {
  text-align: right; font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim);
  font-weight: 400; padding: 2px 8px; border-bottom: 1px solid var(--border);
}
.opt-vi-table th:first-child { text-align: left; }
.opt-vi-table td { padding: 3px 8px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
.opt-vi-table td:first-child { text-align: left; font-weight: 700; color: var(--text); }
.opt-vi-table tr:hover td { background: rgba(128,128,128,0.04); }
.opt-vi-table tr:last-child td { border-bottom: none; }

/* ---- Vol Index section: fixed-height rows, no stretch ----
   Scoped to #optViStrip only — this used to be a bare .opt-vi-table
   selector, which also matched the Expiries table below (it reuses
   .opt-vi-table for its base styling) and forced all 13 expiry rows to
   52px tall (~680px total), shoving the bottom rows off the panel. */
.opt-2col-vif { align-items: start; }
#optViStrip { margin-bottom: 12px; }
#optViStrip .opt-vi-table tbody tr { height: 62px; }
#optViStrip .opt-vi-table td { padding-top: 0; padding-bottom: 0; vertical-align: middle; }
.opt-vi-spark-cell { width: 80px; }
.opt-vi-spark { width: 80px; height: 36px; min-height: 20px; display: block; }
/* Expiries table needs to fit all 13 rows in the available column height —
   keep rows compact rather than inheriting the vol-index row height. */
.opt-expiry-table tbody tr { height: auto; }
.opt-expiry-table td { padding-top: 2px; padding-bottom: 2px; }


/* Expiries table — full-width, 9 columns. Base .opt-vi-table already right-
   aligns every td but the first; only DTE/Kind/ATM IV (2nd-4th) need the
   same left-align override the flow table uses, since they're not numeric-
   comparison columns either. */
.opt-expiry-table { table-layout: fixed; }
.opt-expiry-table td:nth-child(-n+4) { text-align: left; }
.opt-expiry-table col.opt-exp-col-expiry  { width: 14%; }
.opt-expiry-table col.opt-exp-col-dte     { width: 8%; }
.opt-expiry-table col.opt-exp-col-kind    { width: 11%; }
.opt-expiry-table col.opt-exp-col-iv      { width: 10%; }
.opt-expiry-table col.opt-exp-col-calloi  { width: 12%; }
.opt-expiry-table col.opt-exp-col-putoi   { width: 12%; }
.opt-expiry-table col.opt-exp-col-totaloi { width: 12%; }
.opt-expiry-table col.opt-exp-col-pc      { width: 8%; }
.opt-expiry-table col.opt-exp-col-notional{ width: 13%; }
.opt-vi-asset-lbl { display: flex; align-items: center; gap: 6px; }
.opt-vi-kind { font-size: 7px; color: var(--text-dim); border: 1px solid var(--border); padding: 0 3px; letter-spacing: 0.04em; font-weight: 400; }
.opt-vi-val-cell { font-weight: 700; font-size: 11px; }
.opt-vi-chg.pos { color: var(--green, #26a69a); } .opt-vi-chg.neg { color: var(--red, #ef5350); }
/* spark cell sized via .opt-vi-spark-cell / .opt-vi-spark above */
.opt-loading, .opt-error { color: var(--text-dim); font-size: 10px; padding: 14px; text-align: center; font-family: var(--mono); }

/* ---- GEX by Strike: net dealer $-gamma per strike, all listed expiries ---- */
.opt-gex-meta { font-size: 8.5px; color: var(--text-dim); font-family: var(--mono); }
.opt-gex-wrap { border: 1px solid var(--border); padding: 3px 3px 0; }
.opt-gex-plot { position: relative; height: 90px; }
#optTermChart .opt-gex-plot { height: 188px; }
#optGexChart .opt-gex-plot { height: 160px; }
#optOiExpiryChart .opt-gex-plot { height: 160px; }
#optSkewChart .opt-gex-plot { height: 140px; }
.opt-gex-svg { width: 100%; height: 100%; display: block; }
.opt-gex-axis-lbl, .opt-gex-spot-lbl {
  position: absolute; transform: translateX(-50%); white-space: nowrap; pointer-events: none;
  font-family: var(--mono); letter-spacing: 0.02em;
}
.opt-gex-axis-lbl { bottom: 3px; font-size: 7.5px; color: var(--text-dim); }
.opt-gex-axis-lbl.edge-start { transform: translateX(0); }
.opt-gex-axis-lbl.edge-end { transform: translateX(-100%); }
.opt-gex-spot-lbl { top: 1px; font-size: 7.5px; font-weight: 700; letter-spacing: 0.05em; color: var(--text); }
.opt-skew-ylbl {
  position: absolute; left: 3px; transform: translateY(-50%); pointer-events: none;
  font-family: var(--mono); font-size: 7.5px; color: var(--text-dim); letter-spacing: 0.02em;
  background: var(--bg-panel, #111c21); padding: 0 2px;
}
/* Term-structure heat meter: a small gauge under the header showing where
   the 30D-7D IV spread (termDiff) sits — backwardation (red, negative) at
   the left through flat (theme orange-ish blend) in the middle to contango
   (green, positive) at the right. Track gradient is drawn from --red/--green
   in JS (renderTermHeat) so it always matches the active theme instead of
   a baked-in hardcoded gradient. */
.opt-term-heat { position: relative; height: 4px; margin-top: 5px; cursor: pointer; }
.opt-term-heat:hover .opt-term-heat-track { filter: brightness(1.25); }
.opt-term-heat-track { position: absolute; inset: 0; border-radius: 2px; transition: filter 0.15s ease; }
.opt-term-heat-marker {
  position: absolute; top: -2px; width: 2px; height: 8px; background: var(--text, #e6ede9);
  border-radius: 1px; transform: translateX(-50%);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.35);
  transition: left 0.4s ease;
}
/* Term-heat colorway dropdown — appended to document.body (not this panel)
   so it can float above everything else and isn't clipped by any
   overflow:hidden ancestor. Positioned in JS via getBoundingClientRect().
   Moved to terminal.css (shared with Market's gauge swatches) — see
   .opt-term-heat-menu there. Kept out of this injected block so Market
   isn't dependent on the Options panel having been opened first. */
.opt-gex-legend { display: flex; gap: 10px; flex-wrap: wrap; margin: 1px 2px 0; font-size: 8px; color: var(--text-dim); font-family: var(--mono); align-items: center; }
.opt-gex-legend-bottom { margin: 0; flex-wrap: nowrap; border: 1px solid var(--border); border-top: none; padding: 3px 6px; }
.opt-gex-legend span { display: inline-flex; align-items: center; gap: 4px; }
.opt-gex-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.opt-oi-axis-pin { color: var(--accent, #e8a03a); font-weight: 700; }
#optOiExpiryFlags { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.opt-pinrisk-chip {
  display: inline-flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 8.5px;
  letter-spacing: 0.03em; color: var(--accent, #e8a03a); border: 1px solid var(--accent, #e8a03a);
  background: rgba(232,160,58,0.08); padding: 2px 7px;
}
.opt-pinrisk-none { color: var(--text-dim); border-color: var(--border); background: transparent; }
.opt-gex-tooltip {
  position: fixed; z-index: 1000; pointer-events: none; display: none;
  background: var(--bg-panel, #111c21); border: 1px solid var(--border);
  padding: 5px 8px; font-family: var(--mono); font-size: 9.5px; color: var(--text);
  white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,0.45);
}
@media (max-width: 900px) {
  .opt-2col { grid-template-columns: 1fr; }
}
/* Expiry table: no scroll — show all rows */
#optExpiryTable { overflow-y: visible; }
/* Compact gex section header row */
.opt-gex-hdr-row { display: flex; align-items: baseline; justify-content: space-between; margin: 3px 0 1px; }
.opt-gex-title { font-size: 9px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--text-dim); font-family: var(--mono); }

/* ---- GEX Levels: price candles + Call/Put wall + Gamma Flip lines ---- */
.opt-levels-section { margin-top: 4px; border: 1px solid var(--border); }
.opt-levels-topbar {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;
  padding: 5px 8px; border-bottom: 1px solid var(--border); font-family: var(--mono);
}
.opt-levels-topbar-left { display: flex; align-items: center; gap: 7px; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim); }
.opt-levels-price-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green,#26a69a); display: inline-block; }
.opt-levels-reset-btn {
  background: transparent; border: 1px solid var(--border); color: var(--text-dim); font-family: var(--mono);
  font-size: 8.5px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 8px; cursor: pointer; border-radius: 2px;
}
.opt-levels-reset-btn:hover { color: var(--text); border-color: var(--text-dim); }
.opt-levels-topbar-right { display: flex; align-items: center; gap: 18px; }
.opt-levels-stat { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.opt-levels-stat-lbl { font-size: 7.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-dim); }
.opt-levels-stat-val { font-size: 11px; font-weight: 700; color: var(--text); }

/* Outer wrapper — the canvas fills it edge to edge; price-scale/time-axis
   lanes are painted ON the canvas itself (mirrors main.js's mini-chart
   convention in multi.js), not laid out with CSS padding/gutters. */
.opt-levels-plot-wrap {
  position: relative;
  user-select: none;
}
.opt-levels-plot { position: relative; height: 390px; overflow: hidden; }
.opt-levels-plot canvas {
  width: 100%; height: 100%; display: block;
  cursor: grab; touch-action: none;
}
.opt-levels-plot canvas.panning { cursor: grabbing; }
/* Drag zones layered over the canvas's own right price-scale / bottom time-axis
   lanes for TradingView-style axis-drag zooming. Widths/heights here just need
   to roughly cover the painted lanes — exact hit-testing happens in JS from
   the same layout numbers the draw call used, these are only cursor hints. */
.opt-levels-yscale {
  position: absolute; top: 0; right: 0; width: 56px; height: calc(100% - 22px);
  cursor: ns-resize; z-index: 5;
}
.opt-levels-xscale {
  position: absolute; left: 0; right: 56px; bottom: 0; height: 22px;
  cursor: ew-resize; z-index: 5;
}
.opt-levels-plot-wrap.zoom-x .opt-levels-xscale,
.opt-levels-plot-wrap.zoom-x canvas { cursor: ew-resize; }
.opt-levels-plot-wrap.zoom-y .opt-levels-yscale,
.opt-levels-plot-wrap.zoom-y canvas { cursor: ns-resize; }

`;
  document.head.appendChild(style);
}

function buildOptionsDom() {
  const panel = document.getElementById('panel-options');
  if (!panel || OPT.built) return;
  ensureOptionsStyle();
  panel.innerHTML = `
    <div class="opt-toprow" id="optTopRow"></div>
    <div class="opt-tabs">
      <span class="opt-tab-active">SUMMARY</span>
      <span>· All expiries · cross-instrument snapshot (Deribit)</span>
      <div class="opt-ccy-toggle">
        <button class="opt-ccy-btn on" id="optBtnBTC">BTC</button>
        <button class="opt-ccy-btn" id="optBtnETH">ETH</button>
      </div>
    </div>
    <div id="optSummaryCard"><div class="opt-loading">Loading option chain…</div></div>
    <div class="opt-2col">
      <div class="opt-2col-col">
        <div class="opt-gex-hdr-row">
          <div class="opt-gex-title">IV Term Structure</div>
          <span class="opt-gex-meta" id="optTermMeta"></span>
        </div>
        <div class="opt-gex-wrap" id="optTermChart"><div class="opt-loading">Loading term structure…</div></div>
        <div class="opt-gex-legend opt-gex-legend-bottom">
          <span><i class="opt-gex-dot" style="background:var(--accent,#e8a03a)"></i>ATM IV per expiry</span>
          <span><i class="opt-gex-dot" style="background:var(--text-dim,#8a9690)"></i>Monthly / quarterly</span>
        </div>
      </div>
      <div class="opt-2col-col">
        <div class="opt-gex-hdr-row">
          <div class="opt-gex-title">GEX by Strike</div>
          <span class="opt-gex-meta" id="optGexMeta"></span>
        </div>
        <div class="opt-gex-wrap" id="optGexChart"><div class="opt-loading">Loading gamma exposure…</div></div>
        <div class="opt-gex-legend opt-gex-legend-bottom">
          <span><i class="opt-gex-dot" style="background:rgb(52,211,153)"></i>Long gamma</span>
          <span><i class="opt-gex-dot" style="background:rgb(248,113,113)"></i>Short gamma</span>
          <span><i class="opt-gex-dot" style="background:var(--accent,#e8a03a)"></i>Flip</span>
        </div>
      </div>
    </div>
    <div class="opt-2col">
      <div class="opt-2col-col">
        <div class="opt-gex-hdr-row">
          <div class="opt-gex-title">OI / Notional by Expiry</div>
          <div style="display:flex; align-items:baseline; gap:8px;">
            <span class="opt-gex-meta" id="optOiExpiryMeta"></span>
            <div class="opt-ccy-toggle">
              <button class="opt-ccy-btn on" id="optOiUnitContracts">CONTRACTS</button>
              <button class="opt-ccy-btn" id="optOiUnitNotional">NOTIONAL</button>
            </div>
          </div>
        </div>
        <div class="opt-gex-wrap" id="optOiExpiryChart"><div class="opt-loading">Loading OI by expiry…</div></div>
        <div class="opt-gex-legend opt-gex-legend-bottom">
          <span><i class="opt-gex-dot" style="background:var(--green,#26a69a)"></i>Call OI</span>
          <span><i class="opt-gex-dot" style="background:var(--red,#ef5350)"></i>Put OI</span>
          <span><i class="opt-gex-dot" style="background:var(--accent,#e8a03a)"></i>Monthly/quarterly</span>
          <span id="optOiExpiryFlags"></span>
        </div>
      </div>
      <div class="opt-2col-col">
        <div class="opt-gex-hdr-row">
          <div class="opt-gex-title">IV Skew / Smile by Strike</div>
          <span class="opt-gex-meta" id="optSkewMeta"></span>
        </div>
        <div class="opt-gex-wrap" id="optSkewChart"><div class="opt-loading">Loading IV skew…</div></div>
        <div class="opt-gex-legend opt-gex-legend-bottom">
          <span><i class="opt-gex-dot" style="background:var(--green,#26a69a)"></i>Calls</span>
          <span><i class="opt-gex-dot" style="background:var(--red,#ef5350)"></i>Puts</span>
          <span>Nearest expiry</span>
        </div>
      </div>
    </div>
    <div class="opt-2col opt-2col-vif">
      <div class="opt-2col-col">
        <div class="opt-vi-title">Vol Index · BTC/ETH — DVOL (falls back to IV)</div>
        <div id="optViStrip"><div class="opt-loading">Loading…</div></div>
        <div class="opt-gex-hdr-row" style="margin-top:6px">
          <div class="opt-gex-title">Expiries</div>
          <span class="opt-gex-meta" id="optExpiryTableMeta"></span>
        </div>
        <div id="optExpiryTable"><div class="opt-loading">Loading expiries…</div></div>
      </div>
      <div class="opt-2col-col">
        <div class="opt-levels-section">
          <div class="opt-levels-topbar">
            <div class="opt-levels-topbar-left">
              <span class="opt-levels-price-dot"></span>Price · Deribit
              <button class="opt-levels-reset-btn" id="optLevelsReset">↺ Reset</button>
            </div>
            <div class="opt-levels-topbar-right">
              <div class="opt-levels-stat"><span class="opt-levels-stat-lbl">Gex Flip (Non-Corrected)</span><span class="opt-levels-stat-val" id="optLevelsFlipVal">—</span></div>
              <div class="opt-levels-stat"><span class="opt-levels-stat-lbl">Net Gex</span><span class="opt-levels-stat-val" id="optLevelsNetVal">—</span></div>
              <div class="opt-levels-stat"><span class="opt-levels-stat-lbl">Regime</span><span class="opt-levels-stat-val" id="optLevelsRegimeVal">—</span></div>
            </div>
          </div>
          <div class="opt-levels-plot-wrap" id="optLevelsChart">
            <div class="opt-levels-plot">
              <canvas id="optLevelsCanvas"></canvas>
              <div class="opt-levels-yscale" id="optLevelsYScale"></div>
              <div class="opt-levels-xscale" id="optLevelsXScale"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('optBtnBTC').addEventListener('click', () => setOptCurrency('BTC'));
  document.getElementById('optBtnETH').addEventListener('click', () => setOptCurrency('ETH'));
  document.getElementById('optOiUnitContracts').addEventListener('click', () => setOiExpiryUnit('contracts'));
  document.getElementById('optOiUnitNotional').addEventListener('click', () => setOiExpiryUnit('notional'));
  document.getElementById('optLevelsReset').addEventListener('click', () => resetGexLevelsView());
  // Delegated on the stable #optTopRow container (not the .opt-term-heat
  // element itself) because renderTopRow() replaces innerHTML on every
  // poll — a direct listener would be wiped out every 30s.
  document.getElementById('optTopRow').addEventListener('click', (e) => {
    const bar = e.target.closest('.opt-term-heat');
    if (bar) openTermHeatColorwayMenu(bar);
  });
  _initGexLevelsInteraction();
  OPT.built = true;
}

function setOiExpiryUnit(unit) {
  OPT.oiExpiryUnit = unit;
  document.getElementById('optOiUnitContracts').classList.toggle('on', unit === 'contracts');
  document.getElementById('optOiUnitNotional').classList.toggle('on', unit === 'notional');
  renderOiByExpiryChart();
}

function setOptCurrency(ccy) {
  OPT.currency = ccy;
  document.getElementById('optBtnBTC').classList.toggle('on', ccy === 'BTC');
  document.getElementById('optBtnETH').classList.toggle('on', ccy === 'ETH');
  renderOptionsPanel();
}

/* ── Screenshot (options panel only) ────────────────────────
   Reuses the same local html2canvas.min.js that screenshot.js loads for
   the full-page capture (same file, same convention: ./html2canvas.min.js,
   no CDN) — but scoped to just #panel-options instead of the whole page,
   since this button lives inside the Options panel and a full-page capture
   isn't what "screenshot this panel" implies here. If screenshot.js has
   already loaded html2canvas (likely, since both live in the same
   terminal), we reuse the already-loaded global instead of re-requesting
   the script. */
let _optH2cStatus = 'idle'; // idle | loading | ready | missing
const _optH2cQueue = [];
function _optGetH2C(cb) {
  if (typeof html2canvas === 'function') { cb(html2canvas); return; }
  if (_optH2cStatus === 'ready')   { cb(html2canvas); return; }
  if (_optH2cStatus === 'missing') { cb(null); return; }
  _optH2cQueue.push(cb);
  if (_optH2cStatus === 'loading') return;
  _optH2cStatus = 'loading';
  const s = document.createElement('script');
  s.src = './html2canvas.min.js';
  s.onload = () => { _optH2cStatus = 'ready'; _optH2cQueue.splice(0).forEach(f => f(html2canvas)); };
  s.onerror = () => { _optH2cStatus = 'missing'; _optH2cQueue.splice(0).forEach(f => f(null)); };
  document.head.appendChild(s);
}

// html2canvas has incomplete support for `background-clip: text` — it
// renders the background box but doesn't clip it to the glyphs, and since
// the real text color is transparent (to let the gradient show through the
// clip), the capture ends up with a solid gradient block and invisible
// text (confirmed: this is exactly what happened to the Max Pain tile,
// which uses .opt-maxpain-grad for that gradient-text effect). Fix: right
// before capture, swap every such element to a plain solid color with no
// background/clip, then restore the gradient styling afterward — same
// temporary-swap-then-restore pattern already used for `zoom` in
// screenshot.js's swapZoomForTransform().
function _optSwapGradientTextForCapture() {
  const restores = [];
  document.querySelectorAll('.opt-maxpain-grad').forEach(el => {
    restores.push({
      el,
      prevBackground: el.style.background,
      prevWebkitClip: el.style.webkitBackgroundClip,
      prevClip: el.style.backgroundClip,
      prevColor: el.style.color,
    });
    el.style.background = 'none';
    el.style.webkitBackgroundClip = 'unset';
    el.style.backgroundClip = 'unset';
    // Solid fallback color close to the gradient's midtone, so the capture
    // still reads clearly as "this value is highlighted" rather than
    // defaulting to plain body text color.
    el.style.color = '#f2c14e';
  });
  return () => {
    restores.forEach(({ el, prevBackground, prevWebkitClip, prevClip, prevColor }) => {
      el.style.background = prevBackground;
      el.style.webkitBackgroundClip = prevWebkitClip;
      el.style.backgroundClip = prevClip;
      el.style.color = prevColor;
    });
  };
}

function captureOptionsPanel() {
  const panel = document.getElementById('panel-options');
  if (!panel) return;
  const btn = document.getElementById('optScreenshotBtn');

  _optGetH2C((h2c) => {
    if (!h2c) {
      console.warn('[options.js] html2canvas not available — cannot capture panel. Add html2canvas.min.js to the terminal folder (see screenshot.js setup notes).');
      return;
    }
    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-panel').trim()
      || getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      || '#0a0f0d';

    if (btn) btn.style.visibility = 'hidden';
    const restoreGradientText = _optSwapGradientTextForCapture();

    h2c(panel, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: bgColor,
      scale: window.devicePixelRatio || 1,
      logging: false,
    }).then(canvas => {
      if (btn) btn.style.visibility = '';
      restoreGradientText();
      let url;
      try { url = canvas.toDataURL('image/png'); } catch (e) {
        console.error('[options.js] toDataURL failed:', e); return;
      }
      const ccy = OPT.currency || 'options';
      const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ccy}_options_${ts}.png`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
    }).catch(err => {
      if (btn) btn.style.visibility = '';
      restoreGradientText();
      console.error('[options.js] html2canvas capture failed:', err);
    });
  });
}

function renderTopRow() {
  const ccy = OPT.currency;
  const c = OPT.chain[ccy];
  const spot = OPT.spot[ccy];
  const row = document.getElementById('optTopRow');
  if (!row) return;
  if (!c) { row.innerHTML = '<div class="opt-loading">—</div>'; return; }
  row.innerHTML = `
    <div class="opt-tile"><div class="opt-tile-inner"><div class="opt-tile-hdr"><span>${ccy} Spot</span></div><div class="opt-tile-val">${fmtUsd(spot, false)}</div></div></div>
    <div class="opt-tile"><div class="opt-tile-inner"><div class="opt-tile-hdr"><span>ATM IV · ${fmtDate(c.nearestExpiry)}</span></div><div class="opt-tile-val">${c.atmIvNearest != null ? c.atmIvNearest.toFixed(1) + '%' : '—'}</div></div></div>
    <div class="opt-tile"><div class="opt-tile-inner"><div class="opt-tile-hdr"><span>Term Structure</span></div><div class="opt-tile-val" style="font-size:16px;">${c.termStructure}</div><div class="opt-term-heat" id="optTermHeat"><div class="opt-term-heat-track"></div><div class="opt-term-heat-marker" id="optTermHeatMarker"></div></div></div></div>
    <div class="opt-tile"><div class="opt-tile-inner"><div class="opt-tile-hdr"><span>Expiries / Instruments</span></div><div class="opt-tile-val">${c.expiries} / ${c.instruments}</div></div></div>
    <div class="opt-tile"><div class="opt-tile-inner"><div class="opt-tile-hdr"><span>Put / Call · 24h vol</span></div><div class="opt-tile-val">${c.putCallVolRatio != null ? c.putCallVolRatio.toFixed(2) : '—'}</div></div><button id="optScreenshotBtn" title="Screenshot options panel"><span class="opt-sc-ico"></span></button></div>
  `;
  document.getElementById('optScreenshotBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    captureOptionsPanel();
  });
}

function renderSummaryCard() {
  const ccy = OPT.currency;
  const c = OPT.chain[ccy];
  const card = document.getElementById('optSummaryCard');
  if (!card) return;
  if (!c) { card.innerHTML = '<div class="opt-loading">Loading option chain…</div>'; return; }

  // Vol Regime badge: prefer Deribit's own DVOL history when available,
  // fall back to the realized-vol proxy otherwise. Whichever source is
  // live is labelled explicitly so the number is never presented as IV
  // when it's actually RV, or vice versa.
  const dvolAvail = !!OPT.dvolAvailable[ccy];
  const regimeSamples = dvolAvail ? (OPT.dvolSeries[ccy] || []) : (OPT.rvSeries[ccy] || []);
  const regimeNow = dvolAvail ? OPT.dvol[ccy] : ((OPT.rv7d && OPT.rv7d[ccy]) != null ? OPT.rv7d[ccy] : null);
  const pct = regimeSamples.length && regimeNow != null ? percentileRank(regimeSamples, regimeNow) : 50;
  const regime = regimeLabel(pct);
  const flagCls = regime.cls === 'opt-regime-normal' ? 'opt-flag-normal'
    : regime.cls === 'opt-regime-low' ? 'opt-flag-low'
    : regime.cls === 'opt-regime-elevated' ? 'opt-flag-elevated' : 'opt-flag-extreme';
  const rvNow = (OPT.rv7d && OPT.rv7d[ccy]) != null ? OPT.rv7d[ccy] : null;
  const vrp = (c.iv7 != null && rvNow != null) ? (c.iv7 - rvNow) : null;
  const gammaColor = c.netGammaTotal >= 0 ? 'var(--green,#26a69a)' : 'var(--red,#ef5350)';
  const em = c.expectedMove;

  card.innerHTML = `
    <div class="opt-ledger-wrap">
      <div class="opt-ledger-col">
        <div class="opt-ledger-hero">
          <div class="opt-ledger-hero-val">${fmtUsd(c.spot, false)}</div>
          <div class="opt-ledger-hero-sub">${ccy} · Deribit index · ${c.instruments} instruments</div>
        </div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Net Gamma</span><span class="opt-ledger-val" style="color:${gammaColor}">${fmtUsd(c.netGammaTotal)}<span class="opt-ledger-sub">${c.netGammaTotal >= 0 ? 'long — vol-dampening' : 'short — vol-amplifying'}</span></span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Gamma Flip (Non-Corrected)</span><span class="opt-ledger-val">${fmtUsd(c.flipStrike, false)}<span class="opt-ledger-sub">${c.flipStrike && c.spot ? (((c.flipStrike - c.spot) / c.spot) * 100).toFixed(2) + '% from spot' : '—'}</span></span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Vol Regime</span><span class="opt-ledger-val"><span class="opt-flag ${flagCls}">${regime.label}</span><span class="opt-ledger-sub">${pct}th pct, 90D · ${dvolAvail ? 'DVOL' : 'RV proxy'}</span></span></div>
      </div>
      <div class="opt-ledger-col">
        <div class="opt-ledger-hdr"><span>Expected Move</span><span>${em ? fmtDate(em.expiry) : '—'}</span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Range (straddle)</span><span class="opt-ledger-val">${em ? `±${fmtUsd(em.dollars, false)}` : '—'}<span class="opt-ledger-sub">${em && em.pct != null ? em.pct.toFixed(1) + '%' : ''}</span></span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Implied Range</span><span class="opt-ledger-val" style="font-size:11px;">${em ? `${fmtUsd(em.low, false)} – ${fmtUsd(em.high, false)}` : '—'}</span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">ATM IV Front / 30D</span><span class="opt-ledger-val">${c.iv7 != null ? c.iv7.toFixed(1) : '—'} / ${c.iv30 != null ? c.iv30.toFixed(1) : '—'}</span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Term Structure</span><span class="opt-ledger-val">${c.termStructure}<span class="opt-ledger-sub">${c.termDiff >= 0 ? '+' : ''}${c.termDiff.toFixed(1)} vp</span></span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Vol Risk Premium</span><span class="opt-ledger-val" style="color:${vrp != null && vrp < 0 ? 'var(--red,#ef5350)' : 'var(--text)'}">${vrp != null ? (vrp >= 0 ? '+' : '') + vrp.toFixed(1) + ' vp' : '—'}</span></div>
      </div>
      <div class="opt-ledger-col">
        <div class="opt-ledger-hdr"><span>Open Interest</span><span>${fmtNum(c.totalOi, 1)}</span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Call Wall</span><span class="opt-ledger-val" style="color:var(--red,#ef5350)">${fmtUsd(c.callWall.strike, false)}<span class="opt-ledger-sub">${fmtNum(c.callWall.oi, 1)} OI</span></span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Put Wall</span><span class="opt-ledger-val" style="color:var(--green,#26a69a)">${fmtUsd(c.putWall.strike, false)}<span class="opt-ledger-sub">${fmtNum(c.putWall.oi, 1)} OI</span></span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Put/Call (OI)</span><span class="opt-ledger-val">${c.putCallOiRatio != null ? c.putCallOiRatio.toFixed(2) : '—'}</span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Max Pain</span><span class="opt-ledger-val"><span class="opt-maxpain-grad">${fmtUsd(c.maxPain, false)}</span></span></div>
        <div class="opt-ledger-row"><span class="opt-ledger-lbl">Top Expiry</span><span class="opt-ledger-val">${fmtDate(c.topExpiry.expiry)}<span class="opt-ledger-sub">${fmtNum(c.topExpiry.oi, 1)} OI</span></span></div>
      </div>
    </div>
    <div class="opt-footer-note">${c.expiries} expiries · ${c.instruments} instruments · net-gamma sign assumes standard dealer positioning (customers net long calls / short puts) — unverifiable for crypto, shown as a convention, not a fact. Vol Regime uses ${dvolAvail ? "Deribit's DVOL index" : 'a realized-vol proxy (DVOL unavailable this session)'}. Expected Move is the ATM straddle price, not a probability band.</div>
  `;
}

function renderVolIndexStrip() {
  const strip = document.getElementById('optViStrip');
  if (!strip) return;

  const rows = [];

  ['BTC', 'ETH'].forEach(ccy => {
    const c = OPT.chain[ccy];
    const dvolAvail = !!OPT.dvolAvailable[ccy];
    const series = dvolAvail ? (OPT.dvolSeries[ccy] || []) : (OPT.rvSeries[ccy] || []);
    const iv = dvolAvail ? OPT.dvol[ccy] : (c ? c.iv7 : null);
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const chg = (iv != null && prev != null) ? iv - prev : null;
    const pct = series.length && iv != null ? percentileRank(series, iv) : 50;
    const regime = regimeLabel(pct);
    const flagCls = regime.cls === 'opt-regime-normal' ? 'opt-flag-normal'
      : regime.cls === 'opt-regime-low' ? 'opt-flag-low'
      : regime.cls === 'opt-regime-elevated' ? 'opt-flag-elevated' : 'opt-flag-extreme';
    const hot = regime.cls === 'opt-regime-extreme' || regime.cls === 'opt-regime-elevated';
    // Sparkline color: green when 24h change positive, red when negative, dim when flat/unknown
    const sparkColor = chg == null ? 'var(--text-dim,#8a9690)'
      : chg >= 0 ? 'var(--green,#26a69a)' : 'var(--red,#ef5350)';
    rows.push(`
      <tr>
        <td><div class="opt-vi-asset-lbl">${ccy}<span class="opt-vi-kind">${dvolAvail ? 'DVOL' : 'IV'}</span></div></td>
        <td><span class="opt-flag ${flagCls}">${regime.label}</span></td>
        <td class="opt-vi-val-cell" style="${hot ? 'color:var(--red,#ef5350);' : ''}">${iv != null ? iv.toFixed(1) : '—'}</td>
        <td class="opt-vi-chg ${chg != null && chg < 0 ? 'neg' : 'pos'}">${chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) : '—'}</td>
        <td class="opt-vi-spark-cell"><svg class="opt-vi-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
          <defs>
            <pattern id="spark-hatch-${ccy}" patternUnits="userSpaceOnUse" width="10" height="10">
              <line x1="0" y1="10" x2="10" y2="0" stroke="rgba(255,255,255,0.13)" stroke-width="0.75"/>
              <line x1="0" y1="0"  x2="10" y2="10" stroke="rgba(255,255,255,0.13)" stroke-width="0.75"/>
            </pattern>
          </defs>
          <path d="${sparklineAreaPath(series.slice(-24))}" fill="${sparkColor}" fill-opacity="0.18"/>
          <path d="${sparklineAreaPath(series.slice(-24))}" fill="url(#spark-hatch-${ccy})"/>
          <path d="${sparklinePath(series.slice(-24))}" fill="none" stroke="${sparkColor}" stroke-width="1.3"/>
        </svg></td>
      </tr>
    `);
  });

  strip.innerHTML = `
    <table class="opt-vi-table">
      <thead><tr><th style="text-align:left;">Asset</th><th>Regime</th><th>Value</th><th>24H Chg</th><th></th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

// 70000 -> "70K", 72500 -> "72.5K" (matches the compact strike shorthand
// used elsewhere in the panel).
function fmtStrikeShort(strike) {
  if (strike >= 1000) return (strike / 1000).toFixed(strike % 1000 === 0 ? 0 : 1) + 'K';
  return String(strike);
}

// Builds the GEX-by-strike bar chart as raw SVG (same inline-SVG pattern as
// the vol-index sparklines). Bars are net $-gamma per strike, all listed
// expiries combined — same convention/assumption as the summary card's Net
// Gamma tile (customers net long calls / short puts), just broken out by
// strike instead of collapsed to one number. Positive (green) bars sit
// above the zero line, negative (red) below.
// Interpolates a bar's fill along a dim -> vivid ramp based on how large its
// $-gamma is relative to the tallest bar on screen (same maxAbs used for bar
// height), so the dominant strikes pop and the near-zero ones fade back
// toward the panel background instead of every bar reading one flat color.
// Parse a CSS color string (hex or rgb()) into [r,g,b] integers.
function _parseRgb(str) {
  str = str.trim();
  if (str.startsWith('#')) {
    const h = str.slice(1);
    if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  const m = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return [128, 128, 128];
}

// Read --green and --red from the active theme at render time so the GEX
// bar ramp always matches the current theme rather than baked-in hex values.
function _themeGexColors() {
  const style = getComputedStyle(document.documentElement);
  const green = _parseRgb(style.getPropertyValue('--green').trim() || '#26a69a');
  const red   = _parseRgb(style.getPropertyValue('--red').trim()   || '#ef5350');
  const greenDim = green.map(c => Math.round(c * 0.22));
  const redDim   = red.map(c => Math.round(c * 0.22));
  return { green, red, greenDim, redDim };
}

function gexRampColor(ratio, positive) {
  const t = Math.pow(Math.max(0, Math.min(1, ratio)), 0.6);
  const { green, red, greenDim, redDim } = _themeGexColors();
  const dim  = positive ? greenDim : redDim;
  const peak = positive ? green    : red;
  const r = Math.round(dim[0] + (peak[0] - dim[0]) * t);
  const g = Math.round(dim[1] + (peak[1] - dim[1]) * t);
  const b = Math.round(dim[2] + (peak[2] - dim[2]) * t);
  return `rgb(${r},${g},${b})`;
}

function gexChartSvg(rows, spot, callWallStrike, putWallStrike, flipStrike) {
  const n = rows.length;
  if (!n) return { svg: '', axisLabels: [], spotLabel: null };
  const W = 1000, H = 210, padTop = 14, padBottom = 30, padL = 4, padR = 4, padMarker = 16;
  const plotH = H - padTop - padBottom;
  const slot = (W - padL - padR) / n;
  const barW = Math.max(1.5, slot * 0.62);
  const maxAbs = Math.max(1e-9, ...rows.map(r => Math.abs(r.gamma)));
  const yZero = padTop + plotH / 2;

  function xCenter(i) { return padL + i * slot + slot / 2; }
  function nearestIdx(target) {
    let bi = 0, bd = Infinity;
    rows.forEach((r, i) => { const d = Math.abs(r.strike - target); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }

  // Bars carry their tooltip content as a data attribute (custom hover
  // tooltip below) rather than a native <title> — instant on hover instead
  // of the browser's ~1s-delayed default, and styled to match the terminal.
  const bars = rows.map((r, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    const ratio = Math.abs(r.gamma) / maxAbs;
    const h = Math.max(0, ratio * (plotH / 2 - 2));
    const y = r.gamma >= 0 ? yZero - h : yZero;
    const fill = gexRampColor(ratio, r.gamma >= 0);
    const hatchId = `gex-hatch-${i}`;
    const sub = r.gamma >= 0 ? 'long — vol-dampening' : 'short — vol-amplifying';
    const tip = `${fmtStrikeShort(r.strike)} · ${fmtUsd(r.gamma)} · ${sub}`;
    const bh = Math.max(h, 1.5);
    // Each bar: solid color base + crosshatch overlay (two diagonals, matches account equity curve)
    return `
      <defs>
        <pattern id="${hatchId}" patternUnits="userSpaceOnUse" width="10" height="10">
          <line x1="0" y1="10" x2="10" y2="0" stroke="rgba(255,255,255,0.13)" stroke-width="0.75"/>
          <line x1="0" y1="0"  x2="10" y2="10" stroke="rgba(255,255,255,0.13)" stroke-width="0.75"/>
        </pattern>
      </defs>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${fill}" fill-opacity="0.55" data-gex-tip="${tip}"/>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="url(#${hatchId})" data-gex-tip="${tip}"/>`;
  }).join('');

  let markers = '';
  if (spot != null) {
    const xi = xCenter(nearestIdx(spot));
    markers += `<line x1="${xi.toFixed(1)}" y1="${padTop}" x2="${xi.toFixed(1)}" y2="${padTop + plotH}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3,3" opacity="0.55" vector-effect="non-scaling-stroke"/>`;
  }
  if (flipStrike != null) {
    const xi = xCenter(nearestIdx(flipStrike));
    markers += `<line x1="${xi.toFixed(1)}" y1="${padTop}" x2="${xi.toFixed(1)}" y2="${padTop + plotH}" stroke="var(--accent,#e8a03a)" stroke-width="1.2" opacity="0.9" vector-effect="non-scaling-stroke" data-gex-tip="Gamma Flip (Non-Corrected) · ${fmtStrikeShort(flipStrike)}"/>`;
  }
  if (callWallStrike != null) {
    const xi = xCenter(nearestIdx(callWallStrike));
    markers += `<circle cx="${xi.toFixed(1)}" cy="${padTop + plotH + padMarker}" r="2.5" fill="var(--green,#26a69a)" data-gex-tip="Call Wall · ${fmtStrikeShort(callWallStrike)}"/>`;
  }
  if (putWallStrike != null) {
    const xi = xCenter(nearestIdx(putWallStrike));
    markers += `<circle cx="${xi.toFixed(1)}" cy="${padTop + plotH + padMarker}" r="2.5" fill="var(--red,#ef5350)" data-gex-tip="Put Wall · ${fmtStrikeShort(putWallStrike)}"/>`;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="opt-gex-svg">
    <line x1="${padL}" y1="${yZero.toFixed(1)}" x2="${W - padR}" y2="${yZero.toFixed(1)}" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    ${bars}
    ${markers}
  </svg>`;

  // Axis + SPOT labels are plain HTML, positioned by left-% over the plot —
  // NOT SVG <text>. The chart's viewBox is stretched non-uniformly
  // (preserveAspectRatio="none", so it can fill the panel's full width),
  // and SVG text sized in viewBox units stretches right along with it —
  // that's what was reading as "wide" on an ultrawide/fullscreen window.
  // HTML text sits outside that transform and stays normal.
  const labelEvery = Math.max(1, Math.ceil(n / 11));
  const axisLabels = rows.map((r, i) => i % labelEvery === 0
    ? { leftPct: (xCenter(i) / W) * 100, text: fmtStrikeShort(r.strike) }
    : null).filter(Boolean);
  const spotLabel = spot != null ? { leftPct: (xCenter(nearestIdx(spot)) / W) * 100 } : null;

  return { svg, axisLabels, spotLabel };
}

// Builds the OI/Notional by Expiry bar chart — one stacked bar per listed
// expiry (call OI on top, put OI on bottom), same non-uniform-stretch
// viewBox + HTML-overlay-label pattern as the GEX/skew charts above.
// Monthly/quarterly expiries get an accent dot above the bar and an
// outlined bar edge, since that's where OI structurally clusters and pin
// risk actually lives — weeklies never get the marker even if one happens
// to carry a lot of OI.
function oiByExpiryChartSvg(rows, useNotional) {
  const n = rows.length;
  if (!n) return { svg: '', axisLabels: [] };
  const W = 1000, H = 210, padTop = 24, padBottom = 34, padL = 4, padR = 4;
  const plotH = H - padTop - padBottom;
  const slot = (W - padL - padR) / n;
  const barW = Math.max(3, slot * 0.56);
  const yBase = padTop + plotH;

  const unitRows = rows.map(r => {
    if (!useNotional || r.totalOi <= 0) return { ...r, callU: r.callOi, putU: r.putOi };
    const px = r.notional / r.totalOi; // effectively spot, but derived defensively
    return { ...r, callU: r.callOi * px, putU: r.putOi * px };
  });
  const maxTotal = Math.max(1e-9, ...unitRows.map(r => r.callU + r.putU));

  function xLeft(i) { return padL + i * slot + (slot - barW) / 2; }

  const bars = unitRows.map((r, i) => {
    const x = xLeft(i);
    const callH = (r.callU / maxTotal) * plotH;
    const putH = (r.putU / maxTotal) * plotH;
    const putY = yBase - putH;
    const callY = putY - callH;
    const pin = r.kind !== 'weekly';
    const edge = pin ? `stroke="var(--accent,#e8a03a)" stroke-width="1" stroke-opacity="0.85"` : '';
    const unitLbl = useNotional ? fmtUsd(r.callU) : fmtNum(r.callU, 1);
    const unitLblP = useNotional ? fmtUsd(r.putU) : fmtNum(r.putU, 1);
    const tag = pin ? ` · ${r.kind.toUpperCase()}` : '';
    const tipCall = `${fmtDate(r.expiry)}${tag} · Calls ${unitLbl}`;
    const tipPut = `${fmtDate(r.expiry)}${tag} · Puts ${unitLblP}`;
    const hatchId = `oi-hatch-${i}`;
    const ch = Math.max(callH, 0.6), ph = Math.max(putH, 0.6);
    return `
      <defs>
        <pattern id="${hatchId}" patternUnits="userSpaceOnUse" width="10" height="10">
          <line x1="0" y1="10" x2="10" y2="0" stroke="rgba(255,255,255,0.13)" stroke-width="0.75"/>
          <line x1="0" y1="0"  x2="10" y2="10" stroke="rgba(255,255,255,0.13)" stroke-width="0.75"/>
        </pattern>
      </defs>
      <rect x="${x.toFixed(1)}" y="${callY.toFixed(1)}" width="${barW.toFixed(1)}" height="${ch.toFixed(1)}" fill="var(--green,#26a69a)" fill-opacity="0.82" ${edge} data-gex-tip="${tipCall}"/>
      <rect x="${x.toFixed(1)}" y="${callY.toFixed(1)}" width="${barW.toFixed(1)}" height="${ch.toFixed(1)}" fill="url(#${hatchId})" data-gex-tip="${tipCall}"/>
      <rect x="${x.toFixed(1)}" y="${putY.toFixed(1)}" width="${barW.toFixed(1)}" height="${ph.toFixed(1)}" fill="var(--red,#ef5350)" fill-opacity="0.82" ${edge} data-gex-tip="${tipPut}"/>
      <rect x="${x.toFixed(1)}" y="${putY.toFixed(1)}" width="${barW.toFixed(1)}" height="${ph.toFixed(1)}" fill="url(#${hatchId})" data-gex-tip="${tipPut}"/>`;
  }).join('');

  const pinMarkers = unitRows.map((r, i) => {
    if (r.kind === 'weekly') return '';
    const xi = xLeft(i) + barW / 2;
    const label = r.kind === 'quarterly' ? 'Quarterly' : 'Monthly';
    return `<circle cx="${xi.toFixed(1)}" cy="${(padTop - 9).toFixed(1)}" r="3" fill="var(--accent,#e8a03a)" data-gex-tip="${label} expiry · ${fmtDate(r.expiry)} · pin-risk cluster"/>`;
  }).join('');

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="opt-gex-svg">
    <line x1="${padL}" y1="${yBase.toFixed(1)}" x2="${W - padR}" y2="${yBase.toFixed(1)}" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    ${bars}
    ${pinMarkers}
  </svg>`;

  const axisLabels = unitRows.map((r, i) => ({
    leftPct: ((xLeft(i) + barW / 2) / W) * 100,
    text: fmtDate(r.expiry),
    pin: r.kind !== 'weekly'
  }));

  return { svg, axisLabels };
}

// Builds the IV Skew/Smile chart — two line series (calls, puts) plotted
// against strike for the nearest-dated expiry only, same viewBox/scaling
// approach as the GEX chart (non-uniform stretch, HTML axis labels laid
// on top by left-%). Put IV running above call IV at the same strike is
// the textbook "put skew" — crash/downside-hedging premium; the reverse
// (call IV richer) shows up during melt-up/upside-chase conditions.
// Builds the IV Term Structure line chart — ATM IV at every listed
// expiry (not just the 7D/30D snapshot), same non-uniform-stretch
// viewBox + HTML-label pattern as the other charts. X axis is expiry
// date, evenly spaced by index (not by calendar day) so near-dated
// weeklies don't get crushed into an unreadable sliver next to a
// quarterly months out — shape-of-curve legibility over strict time
// scaling, same tradeoff options desks make on a vol-surface term plot.
function termCurveChartSvg(points) {
  const n = points.length;
  if (!n) return { svg: '', axisLabels: [] };
  const W = 1000, H = 210, padTop = 18, padBottom = 34, padL = 4, padR = 4;
  const plotH = H - padTop - padBottom;
  const ivs = points.map(p => p.iv);
  const minIv = Math.min(...ivs), maxIv = Math.max(...ivs);
  const ivPad = Math.max(1, (maxIv - minIv) * 0.15);
  const yMin = Math.max(0, minIv - ivPad), yMax = maxIv + ivPad;
  const yRange = (yMax - yMin) || 1;

  function xAt(i) { return n === 1 ? W / 2 : padL + (i / (n - 1)) * (W - padL - padR); }
  function yAt(iv) { return padTop + (1 - (iv - yMin) / yRange) * plotH; }

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.iv).toFixed(1)}`).join(' ');
  const area = `${path} L${xAt(n - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${xAt(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

  const dots = points.map((p, i) => {
    const pin = p.kind !== 'weekly';
    const r = pin ? 3.4 : 2.4;
    const fill = pin ? 'var(--accent,#e8a03a)' : 'var(--text,#e6ede9)';
    const tag = pin ? ` · ${p.kind.toUpperCase()}` : '';
    const tip = `${fmtDate(p.expiry)}${tag} · ATM IV ${p.iv.toFixed(1)}% · ${Math.round(p.daysOut)}D out`;
    return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.iv).toFixed(1)}" r="${r}" fill="${fill}" data-gex-tip="${tip}"/>`;
  }).join('');

  const gridN = 4;
  let grid = '';
  const gridLabels = [];
  for (let i = 0; i <= gridN; i++) {
    const iv = yMin + (yRange * i / gridN);
    const y = yAt(iv);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.4" vector-effect="non-scaling-stroke"/>`;
    gridLabels.push({ topPct: (y / H) * 100, text: iv.toFixed(0) });
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="opt-gex-svg">
    <defs>
      <pattern id="term-hatch" patternUnits="userSpaceOnUse" width="10" height="10">
        <line x1="0" y1="10" x2="10" y2="0" stroke="rgba(255,255,255,0.13)" stroke-width="0.75"/>
        <line x1="0" y1="0"  x2="10" y2="10" stroke="rgba(255,255,255,0.13)" stroke-width="0.75"/>
      </pattern>
    </defs>
    ${grid}
    <path d="${area}" fill="var(--accent,#e8a03a)" fill-opacity="0.14"/>
    <path d="${area}" fill="url(#term-hatch)"/>
    <path d="${path}" fill="none" stroke="var(--accent,#e8a03a)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    ${dots}
  </svg>`;

  const labelEvery = Math.max(1, Math.ceil(n / 11));
  const axisLabels = points.map((p, i) => i % labelEvery === 0 || i === n - 1
    ? { leftPct: (xAt(i) / W) * 100, text: fmtDate(p.expiry), pin: p.kind !== 'weekly' }
    : null).filter(Boolean);

  return { svg, axisLabels, gridLabels };
}

// Blend two [r,g,b] colors at t in [0,1].
function _lerpRgb(a, b, t) {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
}

// Builds the term-structure heat meter's gradient + marker position.
// Default: the current theme's --red/--green (same helper the GEX chart
// uses, so the two stay visually consistent) and c.termDiff (30D IV - 7D IV,
// vol points). Backwardation (negative) reads red, contango (positive)
// reads green, flat sits in an orange-ish blend of the two in the middle.
// If OPT_TERM_HEAT_KEY is set (user picked a custom/built-in colormap from
// the dropdown), the track uses that colormap's own gradient instead —
// same palettes as the backtester's liq/stop heatmaps, via
// window.CanoeHeatmapThemes.
function renderTermHeat(termDiff) {
  const track = document.getElementById('optTermHeat');
  const marker = document.getElementById('optTermHeatMarker');
  if (!track || !marker) return;
  const trackEl = track.querySelector('.opt-term-heat-track');
  const CHT = window.CanoeHeatmapThemes;
  if (OPT_TERM_HEAT_KEY && CHT && CHT.getStops(OPT_TERM_HEAT_KEY)) {
    trackEl.style.background = CHT.colormapGradientCss(OPT_TERM_HEAT_KEY);
  } else {
    _renderTermHeatDefaultTrack(trackEl);
  }
  // Clamp to ±8 vol points either side of flat — comfortably covers normal
  // term-structure moves without the marker pinning to an edge every session.
  const RANGE = 8;
  const t = Math.max(-1, Math.min(1, (termDiff || 0) / RANGE));
  const leftPct = 50 + t * 50;
  marker.style.left = `${leftPct.toFixed(1)}%`;
}

function _renderTermHeatDefaultTrack(trackEl) {
  const { green, red } = _themeGexColors();
  // Orange-ish middle = red/green blended and pushed toward the warm side
  // (more red, some green, little blue) rather than a flat 50/50 grey mix.
  const mid = [
    Math.round(red[0] * 0.55 + green[0] * 0.45),
    Math.round(red[1] * 0.35 + green[1] * 0.65),
    Math.round(red[2] * 0.15 + green[2] * 0.15)
  ];
  const stops = [
    `rgb(${red[0]},${red[1]},${red[2]}) 0%`,
    `rgb(${mid[0]},${mid[1]},${mid[2]}) 50%`,
    `rgb(${green[0]},${green[1]},${green[2]}) 100%`
  ];
  trackEl.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
}

/* ── Term-heat colorway dropdown ─────────────────────────────────
   Opened by clicking the gradient bar. Lists "Default (Red/Green)" plus
   every built-in/custom heatmap colormap from heatmap-theme-editor.js's
   shared picker, and a "Custom Heatmap…" row that opens the full editor
   scoped to this bar (via the target hook — see openEditor patch in
   heatmap-theme-editor.js) so it can never repoint the backtester's own
   heatmap. */
let _optTermHeatMenuEl = null;

function _closeTermHeatColorwayMenu() {
  if (_optTermHeatMenuEl) { _optTermHeatMenuEl.remove(); _optTermHeatMenuEl = null; }
  document.removeEventListener('pointerdown', _onTermHeatMenuOutsideClick, true);
}

function _onTermHeatMenuOutsideClick(e) {
  if (_optTermHeatMenuEl && !_optTermHeatMenuEl.contains(e.target)) _closeTermHeatColorwayMenu();
}

// The editor's live-preview/apply hook for this bar. Only ever touches
// OPT_TERM_HEAT_KEY + this panel's own render — never btState/BT_COLORMAPS.
function _termHeatApplyTarget() {
  return {
    getActive: () => OPT_TERM_HEAT_KEY,
    preview: (key) => _setOptTermHeatKey(key),
    applyId: (id) => _setOptTermHeatKey(id),
    restore: () => _setOptTermHeatKey(_optTermHeatMenuRestoreKey)
  };
}
let _optTermHeatMenuRestoreKey = null; // snapshot taken when the menu/editor opens, for cancel-without-picking

function openTermHeatColorwayMenu(barEl) {
  _closeTermHeatColorwayMenu();
  const CHT = window.CanoeHeatmapThemes;
  if (!CHT) return; // theme editor script not loaded — bar stays default-only

  _optTermHeatMenuRestoreKey = OPT_TERM_HEAT_KEY;

  const menu = document.createElement('div');
  menu.className = 'opt-term-heat-menu';

  // "Default (Red/Green)" row — not part of the shared picker's palette
  // list since that list only knows about colormaps, not this bar's
  // built-in backwardation/contango gauge.
  const defaultBtn = document.createElement('button');
  defaultBtn.type = 'button';
  defaultBtn.className = 'opt-term-heat-menu-opt' + (OPT_TERM_HEAT_KEY ? '' : ' active');
  defaultBtn.innerHTML = `<span class="opt-term-heat-menu-swatch" style="background:linear-gradient(90deg, var(--red,#ef5350), var(--accent,#e8a03a), var(--green,#26a69a));"></span><span>Default (Red/Green)</span>`;
  defaultBtn.addEventListener('click', () => { _setOptTermHeatKey(null); _closeTermHeatColorwayMenu(); });
  menu.appendChild(defaultBtn);

  const sep = document.createElement('div');
  sep.className = 'opt-term-heat-menu-sep';
  menu.appendChild(sep);

  const rowsContainer = document.createElement('div');
  menu.appendChild(rowsContainer);
  CHT.renderPickerRows(
    rowsContainer,
    OPT_TERM_HEAT_KEY,
    (key) => { _setOptTermHeatKey(key); _closeTermHeatColorwayMenu(); },
    () => { _closeTermHeatColorwayMenu(); CHT.openEditor(OPT_TERM_HEAT_KEY, _termHeatApplyTarget()); }
  );
  // renderPickerRows builds .bt-heatmap-theme-opt rows styled by the
  // backtester's own (unavailable here) CSS — reuse our own classnames on
  // top so the dropdown looks right regardless of what else is loaded.
  rowsContainer.querySelectorAll('.bt-heatmap-theme-opt').forEach(btn => btn.classList.add('opt-term-heat-menu-opt'));

  document.body.appendChild(menu);
  const rect = barEl.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.left;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  _optTermHeatMenuEl = menu;
  // Delay so the click that opened the menu doesn't immediately close it
  // via the same pointerdown bubbling to document.
  setTimeout(() => document.addEventListener('pointerdown', _onTermHeatMenuOutsideClick, true), 0);
}

function renderTermCurveChart() {
  const wrap = document.getElementById('optTermChart');
  const meta = document.getElementById('optTermMeta');
  if (!wrap) return;
  const ccy = OPT.currency;
  const c = OPT.chain[ccy];
  if (!c || !c.termCurve || c.termCurve.length < 2) {
    wrap.innerHTML = '<div class="opt-loading">Loading term structure…</div>';
    if (meta) meta.textContent = '';
    return;
  }
  renderTermHeat(c.termDiff);
  const { svg, axisLabels, gridLabels } = termCurveChartSvg(c.termCurve);
  const axisHtml = axisLabels.map((l, i) => {
    const edge = i === 0 ? 'edge-start' : (i === axisLabels.length - 1 ? 'edge-end' : '');
    return `<span class="opt-gex-axis-lbl ${l.pin ? 'opt-oi-axis-pin' : ''} ${edge}" style="left:${l.leftPct.toFixed(2)}%">${l.text}</span>`;
  }).join('');
  const gridHtml = (gridLabels || []).map(g => `<span class="opt-skew-ylbl" style="top:${g.topPct.toFixed(2)}%">${g.text}%</span>`).join('');
  wrap.innerHTML = `<div class="opt-gex-plot">${svg}${axisHtml}${gridHtml}</div>`;
  if (meta) meta.textContent = `${ccy} · ${c.termCurve.length} expiries · ${c.termStructure.toLowerCase()}`;
  wireGexHoverHandlers(wrap);
}

// Expiries table — one row per listed expiry, merging oiByExpiry (OI split,
// notional) with termCurve (ATM IV at that date) so a single table answers
// "what's on the board" without flipping between the two charts above.
// Same underlying data as the OI-by-expiry bars and the term structure
// line, just laid out for scanning/sorting rather than plotting.
function renderExpiryTable() {
  const wrap = document.getElementById('optExpiryTable');
  const meta = document.getElementById('optExpiryTableMeta');
  if (!wrap) return;
  const ccy = OPT.currency;
  const c = OPT.chain[ccy];
  if (!c || !c.oiByExpiry || !c.oiByExpiry.length) {
    wrap.innerHTML = '<div class="opt-loading">Loading expiries…</div>';
    if (meta) meta.textContent = '';
    return;
  }
  const ivByExpiry = {};
  (c.termCurve || []).forEach(pt => { ivByExpiry[pt.expiry] = pt.iv; });
  const rows = [...c.oiByExpiry].sort((a, b) => a.expiry - b.expiry);
  const trs = rows.map(r => {
    const iv = ivByExpiry[r.expiry];
    const pcRatio = r.callOi > 0 ? r.putOi / r.callOi : null;
    const kindLbl = r.kind === 'weekly' ? 'Weekly' : r.kind === 'monthly' ? 'Monthly' : 'Quarterly';
    const kindColor = r.kind === 'weekly' ? 'var(--text-dim)' : 'var(--accent,#e8a03a)';
    const pinned = (c.pinRiskExpiries || []).some(p => p.expiry === r.expiry);
    return `
      <tr>
        <td style="font-weight:700; color:var(--text);">${fmtDate(r.expiry)}${pinned ? ' <i class="opt-gex-dot" style="background:var(--accent,#e8a03a)" title="Pin risk"></i>' : ''}</td>
        <td>${Math.round(r.daysOut)}D</td>
        <td style="color:${kindColor};">${kindLbl}</td>
        <td>${iv != null ? iv.toFixed(1) + '%' : '—'}</td>
        <td style="color:var(--green,#26a69a);">${fmtNum(r.callOi, 0)}</td>
        <td style="color:var(--red,#ef5350);">${fmtNum(r.putOi, 0)}</td>
        <td class="opt-vi-val-cell">${fmtNum(r.totalOi, 0)}</td>
        <td>${pcRatio != null ? pcRatio.toFixed(2) : '—'}</td>
        <td class="opt-vi-val-cell">${fmtUsd(r.notional)}</td>
      </tr>`;
  }).join('');
  wrap.innerHTML = `
    <table class="opt-vi-table opt-expiry-table">
      <colgroup>
        <col class="opt-exp-col-expiry"><col class="opt-exp-col-dte"><col class="opt-exp-col-kind">
        <col class="opt-exp-col-iv"><col class="opt-exp-col-calloi"><col class="opt-exp-col-putoi">
        <col class="opt-exp-col-totaloi"><col class="opt-exp-col-pc"><col class="opt-exp-col-notional">
      </colgroup>
      <thead><tr>
        <th style="text-align:left;">Expiry</th><th style="text-align:left;">DTE</th><th style="text-align:left;">Kind</th>
        <th style="text-align:left;">ATM IV</th><th>Call OI</th><th>Put OI</th><th>Total OI</th><th>P/C</th><th>Notional</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>
  `;
  if (meta) meta.textContent = `${ccy} · ${rows.length} expiries`;
}

function ivSkewChartSvg(calls, puts, spot) {
  const allStrikes = [...new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)])].sort((a, b) => a - b);
  const n = allStrikes.length;
  if (!n) return { svg: '', axisLabels: [], spotLabel: null };

  const W = 1000, H = 210, padTop = 16, padBottom = 30, padL = 4, padR = 4;
  const plotH = H - padTop - padBottom;
  const minX = allStrikes[0], maxX = allStrikes[n - 1];
  const xRange = (maxX - minX) || 1;

  const allIv = [...calls.map(c => c.iv), ...puts.map(p => p.iv)];
  const minIv = Math.min(...allIv), maxIv = Math.max(...allIv);
  const ivPad = Math.max(1, (maxIv - minIv) * 0.12);
  const yMin = Math.max(0, minIv - ivPad), yMax = maxIv + ivPad;
  const yRange = (yMax - yMin) || 1;

  function xPos(strike) { return padL + ((strike - minX) / xRange) * (W - padL - padR); }
  function yPos(iv) { return padTop + (1 - (iv - yMin) / yRange) * plotH; }

  function linePath(points) {
    if (!points.length) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(p.strike).toFixed(1)},${yPos(p.iv).toFixed(1)}`).join(' ');
  }
  function dots(points, color, label) {
    return points.map(p =>
      `<circle cx="${xPos(p.strike).toFixed(1)}" cy="${yPos(p.iv).toFixed(1)}" r="2.6" fill="${color}" data-gex-tip="${label} ${fmtStrikeShort(p.strike)} · IV ${p.iv.toFixed(1)}%"/>`
    ).join('');
  }

  const callColor = 'var(--green,#26a69a)';
  const putColor = 'var(--red,#ef5350)';
  const callLine = `<path d="${linePath(calls)}" fill="none" stroke="${callColor}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
  const putLine  = `<path d="${linePath(puts)}"  fill="none" stroke="${putColor}"  stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
  const callDots = dots(calls, callColor, 'Call');
  const putDots  = dots(puts, putColor, 'Put');

  let spotMarker = '';
  if (spot != null && spot >= minX && spot <= maxX) {
    const xi = xPos(spot);
    spotMarker = `<line x1="${xi.toFixed(1)}" y1="${padTop}" x2="${xi.toFixed(1)}" y2="${padTop + plotH}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3,3" opacity="0.55" vector-effect="non-scaling-stroke"/>`;
  }

  // A few horizontal gridlines with IV value labels (SVG text avoided for
  // the same non-uniform-stretch reason noted on the GEX chart — these are
  // just faint reference lines, real labels are HTML below).
  const gridN = 4;
  let grid = '';
  const gridLabels = [];
  for (let i = 0; i <= gridN; i++) {
    const iv = yMin + (yRange * i / gridN);
    const y = yPos(iv);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.4" vector-effect="non-scaling-stroke"/>`;
    gridLabels.push({ topPct: (y / H) * 100, text: iv.toFixed(0) });
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="opt-gex-svg">
    ${grid}
    ${spotMarker}
    ${callLine}
    ${putLine}
    ${callDots}
    ${putDots}
  </svg>`;

  const labelEvery = Math.max(1, Math.ceil(n / 11));
  const axisLabels = allStrikes.map((s, i) => i % labelEvery === 0
    ? { leftPct: (xPos(s) / W) * 100, text: fmtStrikeShort(s) }
    : null).filter(Boolean);
  const spotLabel = (spot != null && spot >= minX && spot <= maxX) ? { leftPct: (xPos(spot) / W) * 100 } : null;

  return { svg, axisLabels, spotLabel, gridLabels };
}

function renderIvSkewChart() {
  const wrap = document.getElementById('optSkewChart');
  const meta = document.getElementById('optSkewMeta');
  if (!wrap) return;
  const ccy = OPT.currency;
  const c = OPT.chain[ccy];
  if (!c || !c.ivSkew || (!c.ivSkew.calls.length && !c.ivSkew.puts.length)) {
    wrap.innerHTML = '<div class="opt-loading">Loading IV skew…</div>';
    if (meta) meta.textContent = '';
    return;
  }
  const spot = c.spot;
  // Same legibility band as GEX: keep to strikes within ~35% of spot so a
  // handful of deep-wing illiquid quotes don't stretch the axis thin.
  const band = spot * 0.35;
  let calls = c.ivSkew.calls.filter(p => Math.abs(p.strike - spot) <= band);
  let puts  = c.ivSkew.puts.filter(p => Math.abs(p.strike - spot) <= band);
  if (calls.length + puts.length < 6) { calls = c.ivSkew.calls; puts = c.ivSkew.puts; }

  const { svg, axisLabels, spotLabel, gridLabels } = ivSkewChartSvg(calls, puts, spot);
  const axisHtml = axisLabels.map(l => `<span class="opt-gex-axis-lbl" style="left:${l.leftPct.toFixed(2)}%">${l.text}</span>`).join('');
  const spotHtml = spotLabel ? `<span class="opt-gex-spot-lbl" style="left:${spotLabel.leftPct.toFixed(2)}%">SPOT</span>` : '';
  const gridHtml = (gridLabels || []).map(g => `<span class="opt-skew-ylbl" style="top:${g.topPct.toFixed(2)}%">${g.text}%</span>`).join('');

  wrap.innerHTML = `<div class="opt-gex-plot">${svg}${axisHtml}${spotHtml}${gridHtml}</div>`;
  if (meta) meta.textContent = `${ccy} · ${fmtDate(c.ivSkew.expiry)} · ${calls.length}C / ${puts.length}P`;
  wireGexHoverHandlers(wrap);
}


/* ---- Custom hover tooltip for the GEX/skew charts (bars, lines, markers)
   — a single shared floating element, positioned to the cursor, shown/hidden per
   [data-gex-tip] element. Faster and better-styled than relying on native
   SVG <title> popups. ---- */
let gexTooltipEl = null;

function ensureGexTooltip() {
  if (!gexTooltipEl || !document.body.contains(gexTooltipEl)) {
    gexTooltipEl = document.createElement('div');
    gexTooltipEl.className = 'opt-gex-tooltip';
    document.body.appendChild(gexTooltipEl);
  }
  return gexTooltipEl;
}

function positionGexTooltip(evt) {
  if (!gexTooltipEl) return;
  const pad = 14;
  const rect = gexTooltipEl.getBoundingClientRect();
  let left = evt.clientX + pad;
  let top = evt.clientY - rect.height - pad;
  if (left + rect.width > window.innerWidth - 8) left = evt.clientX - rect.width - pad;
  if (top < 8) top = evt.clientY + pad;
  gexTooltipEl.style.left = left + 'px';
  gexTooltipEl.style.top = top + 'px';
}

function showGexTooltip(evt, text) {
  const el = ensureGexTooltip();
  el.textContent = text;
  el.style.display = 'block';
  positionGexTooltip(evt);
}

function hideGexTooltip() {
  if (gexTooltipEl) gexTooltipEl.style.display = 'none';
}

function wireGexHoverHandlers(wrap) {
  wrap.querySelectorAll('[data-gex-tip]').forEach(el => {
    el.addEventListener('mousemove', evt => showGexTooltip(evt, el.getAttribute('data-gex-tip')));
    el.addEventListener('mouseleave', hideGexTooltip);
  });
}

function renderOiByExpiryChart() {
  const wrap = document.getElementById('optOiExpiryChart');
  const meta = document.getElementById('optOiExpiryMeta');
  const flagsEl = document.getElementById('optOiExpiryFlags');
  if (!wrap) return;
  const ccy = OPT.currency;
  const c = OPT.chain[ccy];
  if (!c || !c.oiByExpiry || !c.oiByExpiry.length) {
    wrap.innerHTML = '<div class="opt-loading">Loading OI by expiry…</div>';
    if (meta) meta.textContent = '';
    if (flagsEl) flagsEl.innerHTML = '';
    return;
  }
  const useNotional = OPT.oiExpiryUnit === 'notional';
  const { svg, axisLabels } = oiByExpiryChartSvg(c.oiByExpiry, useNotional);
  const axisHtml = axisLabels.map(l =>
    `<span class="opt-gex-axis-lbl ${l.pin ? 'opt-oi-axis-pin' : ''}" style="left:${l.leftPct.toFixed(2)}%">${l.text}</span>`
  ).join('');
  wrap.innerHTML = `<div class="opt-gex-plot">${svg}${axisHtml}</div>`;
  if (meta) {
    const unitLbl = useNotional ? fmtUsd(c.totalOi * c.spot) + ' notional' : fmtNum(c.totalOi, 1) + ' contracts';
    meta.textContent = `${ccy} · ${c.oiByExpiry.length} expiries · ${unitLbl}`;
  }
  wireGexHoverHandlers(wrap);

  if (flagsEl) {
    const flags = c.pinRiskExpiries || [];
    if (flags.length) {
      flagsEl.innerHTML = flags.map(r => {
        const pct = c.totalOiAllExpiries > 0 ? Math.round((r.totalOi / c.totalOiAllExpiries) * 100) : 0;
        return `<span class="opt-pinrisk-chip"><i class="opt-gex-dot" style="background:var(--accent,#e8a03a)"></i>${r.kind.toUpperCase()} ${fmtDate(r.expiry)} · ${Math.round(r.daysOut)}D out · ${pct}% of OI</span>`;
      }).join('');
    } else {
      flagsEl.innerHTML = '<span class="opt-pinrisk-chip opt-pinrisk-none">No near-term monthly/quarterly pin risk flagged</span>';
    }
  }
}

function renderGexChart() {
  const wrap = document.getElementById('optGexChart');
  const meta = document.getElementById('optGexMeta');
  if (!wrap) return;
  const ccy = OPT.currency;
  const c = OPT.chain[ccy];
  if (!c || !c.gammaByStrike || !c.gammaByStrike.length) {
    wrap.innerHTML = '<div class="opt-loading">Loading gamma exposure…</div>';
    if (meta) meta.textContent = '';
    return;
  }
  // Keep the chart legible: strikes within ~35% of spot, where nearly all
  // listed OI concentrates for BTC/ETH — far wings are mostly empty/zero
  // bars that would just crowd the axis. Fall back to the full chain if
  // that band is too thin (e.g. a quiet ETH session).
  const spot = c.spot;
  const band = spot * 0.35;
  let rows = c.gammaByStrike.filter(r => Math.abs(r.strike - spot) <= band);
  if (rows.length < 6) rows = c.gammaByStrike;

  const { svg, axisLabels, spotLabel } = gexChartSvg(rows, spot, c.callWall.strike, c.putWall.strike, c.flipStrike);
  const axisHtml = axisLabels.map(l => `<span class="opt-gex-axis-lbl" style="left:${l.leftPct.toFixed(2)}%">${l.text}</span>`).join('');
  const spotHtml = spotLabel ? `<span class="opt-gex-spot-lbl" style="left:${spotLabel.leftPct.toFixed(2)}%">SPOT</span>` : '';

  wrap.innerHTML = `<div class="opt-gex-plot">${svg}${axisHtml}${spotHtml}</div>`;
  if (meta) meta.textContent = `${ccy} · ${rows.length} strikes · all expiries · flip ${fmtUsd(c.flipStrike, false)}`;
  wireGexHoverHandlers(wrap);
}

function fmtCandleAxisTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: '2-digit' }).toUpperCase() + ' ' +
    d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

/* ============================================================
   GEX Levels — canvas-based candlestick price chart with dashed
   Call Wall / Put Wall / Gamma Flip / Spot lines, free TradingView-
   style pan/zoom, and a right-side price scale + spot pill styled
   to match the terminal's main chart (see multi.js's mcDraw() for
   the reference pill/axis construction this mirrors: theme-color
   helpers, glow→backing→tint→border→text pill layering, right-side
   axis lane sized to label width).

   Levels come straight from the same processed chain (c.callWall /
   c.putWall / c.flipStrike) the GEX-by-strike chart and summary
   card already use, so all three always agree.
   ============================================================ */

// Per-currency view state: { offsetBars (0 = pinned to latest bar, grows
// as user pans left/back in time), barsVisible (zoom level), yScaleMult
// (1 = auto-fit price range; >1 zooms in vertically, <1 zooms out) }.
const OPT_LEVELS_VIEW = {};
function _optLevelsView(ccy) {
  // yOffset: manual vertical pan, in *price units*, added on top of the
  // auto-fit center. 0 = auto-fit (centered on visible candles+levels),
  // same as before this field existed.
  // yOffset: manual vertical pan, in *price units*, added on top of the
  // auto-fit center. 0 = auto-fit (centered on visible candles+levels),
  // same as before this field existed. baseMid/baseHalfRange: frozen
  // snapshot of the auto-fit box taken the moment the user first touches Y
  // (drag or zoom), so that once they've manually positioned the view it
  // stops being re-derived from whatever candles happen to be visible.
  if (!OPT_LEVELS_VIEW[ccy]) OPT_LEVELS_VIEW[ccy] = { offsetBars: 0, barsVisible: null, yScaleMult: 1, yOffset: 0, manualY: false, baseMid: null, baseHalfRange: null };
  return OPT_LEVELS_VIEW[ccy];
}
function resetGexLevelsView() {
  const v = _optLevelsView(OPT.currency);
  v.offsetBars = 0; v.barsVisible = null; v.yScaleMult = 1; v.yOffset = 0;
  v.manualY = false; v.baseMid = null; v.baseHalfRange = null;
  renderGexLevelsChart();
}

// Theme-color helpers — same names/fallbacks as multi.js's _mc* helpers,
// duplicated locally so options.js has no load-order dependency on multi.js.
function _optThemeColor(v, fb) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return val || fb;
}
function _optColGreen()    { return _optThemeColor('--green', '#26a69a'); }
function _optColRed()      { return _optThemeColor('--red', '#ef5350'); }
function _optColText()     { return _optThemeColor('--text', '#e6ede9'); }
function _optColTextDim()  { return _optThemeColor('--text-dim', '#8a9690'); }
function _optColBg()       { return _optThemeColor('--bg', '#0b1214'); }
function _optColBgPanel()  { return _optThemeColor('--bg-panel', '#111c21'); }
function _optColBorder()   { return _optThemeColor('--border', '#1e2c32'); }
function _optColAccent()   { return _optThemeColor('--accent', '#e8a03a'); }

function _optLevelsPriceLabel(p) {
  if (!Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

// Draws the full chart into the canvas using the given candle window +
// view transform. Pure render — all interaction state lives in OPT_LEVELS_VIEW
// and is read by the caller before this runs.
function _drawGexLevelsChart(canvas, candles, levels, view) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width, cssH = rect.height;
  if (!cssW || !cssH) return null;
  const W = Math.floor(cssW * dpr), H = Math.floor(cssH * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  const COL_BG = _optColBg(), COL_BGPANEL = _optColBgPanel(), COL_BORDER = _optColBorder();
  const COL_TEXT = _optColText(), COL_DIM = _optColTextDim();
  const COL_GREEN = _optColGreen(), COL_RED = _optColRed(), COL_ACCENT = _optColAccent();

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, cssW, cssH);

  const n = candles.length;
  if (!n) { ctx.restore(); return null; }

  // ── Layout ──────────────────────────────────────────────────
  const TOP_PAD = 8, BOT_PAD = 22;
  // Right price-scale lane holds price ticks + the Spot pill only now —
  // Call Wall / Gamma Flip / Put Wall pills moved onto the plot itself.
  ctx.font = `9px -apple-system, BlinkMacSystemFont, "Segoe UI", monospace`;
  const tickProbe = [levels.spot, ...candles.slice(-50).flatMap(c => [c.h, c.l])].filter(Number.isFinite);
  const tickLabelW = tickProbe.reduce((m, p) => Math.max(m, ctx.measureText(_optLevelsPriceLabel(p)).width), 0);
  const AXIS_W = Math.min(140, Math.max(48, Math.ceil(tickLabelW + 14)));

  const chartW = cssW - AXIS_W;
  const chartX0 = 0;
  const chartH = cssH - BOT_PAD;

  // ── Visible window (free pan/zoom) ─────────────────────────────
  // barsVisible: how many candles fit on screen (zoom level). offsetBars:
  // how many bars back from the latest we've panned (0 = pinned to "now",
  // matching TradingView's default right-anchored view).
  const DEFAULT_BARS = n; // fully zoomed out by default — the whole fetched window on screen
  const MIN_BARS = 20, MAX_BARS = Math.max(40, n);
  let barsVisible = view.barsVisible || Math.min(DEFAULT_BARS, n);
  barsVisible = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.round(barsVisible)));
  // Write the clamped value back so the interaction layer always has an
  // authoritative barsVisible — without this, a Y-scale drag (which only
  // changes yScaleMult and never sets barsVisible) leaves view.barsVisible
  // null, so every subsequent render resets to DEFAULT_BARS, dropping any
  // in-progress zoom level.
  view.barsVisible = barsVisible;
  // maxOffset (left/back-in-time limit) unchanged — you can't pan back
  // further than the data goes. But offsetBars used to be clamped to a
  // minimum of 0, meaning the newest candle could never be pulled left of
  // the chart's right edge — i.e. no empty space past "now" to drag into,
  // unlike TradingView which lets you pan a bit past the last bar. Allow a
  // negative offset (empty space on the right) down to a soft limit of
  // ~half the visible window, same ballpark TradingView uses.
  const minOffset = -Math.floor(barsVisible * 0.5);
  const maxOffset = Math.max(0, n - barsVisible);
  const offsetBars = Math.max(minOffset, Math.min(maxOffset, Math.round(view.offsetBars || 0)));
  // Also keep offsetBars in sync so the interaction layer's clamp matches.
  view.offsetBars = offsetBars;
  // When offsetBars is negative, the newest candle sits left of the chart's
  // right edge, leaving `-offsetBars` empty slots after it. Slicing candles
  // still only ever pulls up to the latest real bar (endIdx caps at n); the
  // gap is purely a slot-index shift applied in xForSlot below, not extra
  // (fake) candles.
  const endIdx = Math.min(n, n - offsetBars);  // exclusive
  const startIdx = Math.max(0, endIdx - barsVisible);
  const visCandles = candles.slice(startIdx, endIdx);
  const N = visCandles.length;
  if (!N) { ctx.restore(); return null; }

  const slotW = chartW / barsVisible; // fixed slot width for the zoom level, not just visCandles.length, so partial-window pans don't jitter candle width
  const bodyW = Math.max(1, slotW * 0.62);
  // Slot index is shifted left by however many bars we've panned past "now"
  // (negative offsetBars), so that gap actually renders as empty space on
  // the right of the last candle instead of being invisible/impossible.
  const slotShift = offsetBars < 0 ? -offsetBars : 0;
  const xForSlot = (i) => chartX0 + (i - slotShift) * slotW + slotW / 2;

  // ── Price range: visible candles + every level, y-zoom applied ──────
  let candleLo = Infinity, candleHi = -Infinity;
  for (const c of visCandles) {
    if (Number.isFinite(c.l) && c.l < candleLo) candleLo = c.l;
    if (Number.isFinite(c.h) && c.h > candleHi) candleHi = c.h;
  }
  if (!Number.isFinite(candleLo)) { ctx.restore(); return null; }
  let lo = candleLo, hi = candleHi;
  [levels.spot, levels.callWall, levels.putWall, levels.flipStrike].filter(Number.isFinite).forEach(v => {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  });
  // yOffset is a manual vertical-pan delta in price units, applied on top
  // of a *frozen* reference box once the user has touched Y (manualY).
  // Before that, the reference box tracks the live auto-fit (candles+levels)
  // every render, same as always. This is what makes the view free to drag
  // anywhere once zoomed in: previously mid/halfRange were rebuilt from
  // visCandles on every single render, so any horizontal pan (which changes
  // visCandles) silently re-centered the price axis back toward auto-fit,
  // making a "free" vertical drag snap back instead of staying put.
  if (!view.manualY) {
    view.baseMid = (lo + hi) / 2;
    view.baseHalfRange = ((hi - lo) / 2) * 1.08 || 1; // 8% margin, same as before
  }
  const mid = (view.baseMid || 0) + (view.yOffset || 0);
  let halfRange = (view.baseHalfRange || 1) / (view.yScaleMult || 1); // >1 = zoomed in (tighter range)
  lo = mid - halfRange; hi = mid + halfRange;
  const range = (hi - lo) || 1;
  const priceY = (p) => TOP_PAD + (1 - (p - lo) / range) * (chartH - TOP_PAD);

  // ── Grid + price-axis labels — pixel-spaced like multi.js ──────────
  const MIN_LABEL_PX = 34;
  const priceH = chartH - TOP_PAD;
  const gridN = Math.max(3, Math.floor(priceH / MIN_LABEL_PX));
  ctx.strokeStyle = COL_BORDER;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  for (let i = 0; i <= gridN; i++) {
    const y = TOP_PAD + (priceH / gridN) * i;
    ctx.moveTo(chartX0, y); ctx.lineTo(chartX0 + chartW, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ── Candles ──────────────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const c = visCandles[i];
    if (!Number.isFinite(c.o) || !Number.isFinite(c.h) || !Number.isFinite(c.l) || !Number.isFinite(c.c)) continue;
    const up = c.c >= c.o;
    const col = up ? COL_GREEN : COL_RED;
    const cx = xForSlot(i);
    const yO = priceY(c.o), yC = priceY(c.c), yH = priceY(c.h), yL = priceY(c.l);
    const bodyTop = Math.min(yO, yC), bodyH = Math.max(1, Math.abs(yC - yO));
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = slotW < 4 ? 0.75 : 1;
    ctx.beginPath();
    ctx.moveTo(cx, yH); ctx.lineTo(cx, yL);
    ctx.stroke();
    ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
  }

  // ── Level lines (Call Wall / Gamma Flip / Put Wall / Spot) — dashed ──
  function levelLine(price, color) {
    if (!Number.isFinite(price)) return;
    const y = priceY(price);
    if (y < TOP_PAD - 20 || y > chartH + 20) return; // skip fully offscreen
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(chartX0, y); ctx.lineTo(chartX0 + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  levelLine(levels.callWall, COL_ACCENT);
  levelLine(levels.flipStrike, COL_GREEN);
  levelLine(levels.putWall, COL_GREEN);
  levelLine(levels.spot, COL_TEXT);

  // ── Right axis background + border ──────────────────────────────
  ctx.fillStyle = COL_BGPANEL;
  ctx.fillRect(chartX0 + chartW, 0, AXIS_W, cssH);
  ctx.strokeStyle = COL_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartX0 + chartW, 0); ctx.lineTo(chartX0 + chartW, cssH);
  ctx.stroke();

  // ── Price-axis tick labels (right scale) ──────────────────────────
  ctx.fillStyle = COL_DIM;
  ctx.font = `9px -apple-system, BlinkMacSystemFont, "Segoe UI", monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= gridN; i++) {
    const y = TOP_PAD + (priceH / gridN) * i;
    const p = lo + range * (1 - (y - TOP_PAD) / priceH);
    ctx.fillText(_optLevelsPriceLabel(p), cssW - 6, y);
  }

  // ── Level pills for Call Wall / Gamma Flip / Put Wall — placed mid-chart
  //    directly on their line (not stacked on the crowded right axis, where
  //    the spot pill already lives) so they're readable at a glance and the
  //    spot marker isn't buried under them. Bumped up a size from the prior
  //    pass (was 8px/tight) since these were hard to read on screen, and
  //    nudged apart from each other when two levels sit close together so
  //    the boxes don't overlap into an unreadable stack.
  const _placedPillYs = [];
  function levelPill(price, name, color, txtColor) {
    if (!Number.isFinite(price)) return;
    let y = priceY(price);
    if (y < -14 || y > cssH + 14) return;
    ctx.save();
    const nameFont = `bold 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", monospace`;
    const priceFont = `bold 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", monospace`;
    const priceTxt = _optLevelsPriceLabel(price);
    ctx.font = nameFont;
    const nameW = ctx.measureText(`${name}:`).width;
    ctx.font = priceFont;
    const priceW = ctx.measureText(priceTxt).width;
    const padH = 7, lineH = 14, pillH = lineH * 2 + 4;
    // Nudge away from any pill already placed close by, so overlapping
    // levels (e.g. Call Wall sitting right on top of Gamma Flip) stack
    // instead of stacking illegibly on top of one another.
    for (const usedY of _placedPillYs) {
      if (Math.abs(y - usedY) < pillH + 3) {
        y = y < usedY ? usedY - (pillH + 3) : usedY + (pillH + 3);
      }
    }
    _placedPillYs.push(y);
    const pillW = Math.min(Math.max(nameW, priceW) + padH * 2, chartW - 8);
    const pillX = chartX0 + chartW / 2 - pillW / 2;
    const pillY0 = y - pillH / 2;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(pillX, pillY0, pillW, pillH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = txtColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = nameFont;
    ctx.fillText(`${name}:`, pillX + padH, pillY0 + lineH / 2 + 2, pillW - padH * 2);
    ctx.font = priceFont;
    ctx.fillText(priceTxt, pillX + padH, pillY0 + lineH + lineH / 2 + 2, pillW - padH * 2);
    ctx.restore();
  }
  levelPill(levels.callWall, 'Call Wall', COL_ACCENT, '#1a1200');
  levelPill(levels.flipStrike, 'Gamma Flip (Non-Corrected)', COL_GREEN, '#04211c');
  levelPill(levels.putWall, 'Put Wall', COL_GREEN, '#04211c');

  // ── Spot pill — main-chart style: dashed line → glow → backing → tint →
  //    border → centered text, on the RIGHT price scale. Scaled down (smaller
  //    font/padding than the wall pills) since it's a live marker sitting
  //    right on the axis, not a wide level readout.
  if (Number.isFinite(levels.spot)) {
    const spotY = priceY(levels.spot);
    const spotColor = COL_TEXT;

    // Dashed line across the plot at spot price.
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = spotColor;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(chartX0, spotY); ctx.lineTo(chartX0 + chartW, spotY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const spotLbl = `Spot ${_optLevelsPriceLabel(levels.spot)}`;
    ctx.save();
    ctx.font = `bold 7.5px -apple-system, BlinkMacSystemFont, "Segoe UI", monospace`;
    const lblW = ctx.measureText(spotLbl).width;
    const padH = 4, pillH = 12; // scaled down from the previous 6px/15px pill
    const pillW = Math.min(lblW + padH * 2, AXIS_W - 4);
    const pillX = chartX0 + chartW + 2;
    const pillY0 = spotY - pillH / 2;

    ctx.clearRect(pillX - 1, pillY0 - 2, Math.max(pillW, AXIS_W - 3), pillH + 4);
    ctx.shadowColor = spotColor + '99';
    ctx.shadowBlur = 6;
    ctx.fillStyle = COL_BG;
    ctx.fillRect(pillX, pillY0, pillW, pillH);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = spotColor;
    ctx.fillRect(pillX, pillY0, pillW, pillH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = spotColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(pillX + 0.5, pillY0 + 0.5, pillW - 1, pillH - 1);
    ctx.fillStyle = COL_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spotLbl, pillX + pillW / 2, pillY0 + pillH / 2, pillW - padH);
    ctx.restore();
  }

  // ── Time axis ──────────────────────────────────────────────────
  const timeY = chartH + 4;
  ctx.fillStyle = COL_DIM;
  ctx.font = `8px -apple-system, BlinkMacSystemFont, "Segoe UI", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const tickEvery = Math.max(1, Math.round(N / 6));
  for (let i = 0; i < N; i += tickEvery) {
    const c = visCandles[i];
    if (!c || !c.t) continue;
    ctx.fillText(fmtCandleAxisTime(c.t), xForSlot(i), timeY);
  }

  ctx.restore();

  // Layout info the interaction layer needs to convert pixels <-> data.
  return { chartW, chartH, chartX0, AXIS_W, TOP_PAD, priceH, lo, hi, range, barsVisible, offsetBars, slotW, n };
}

function renderGexLevelsChart() {
  const wrap = document.getElementById('optLevelsChart');
  const flipEl = document.getElementById('optLevelsFlipVal');
  const netEl = document.getElementById('optLevelsNetVal');
  const regimeEl = document.getElementById('optLevelsRegimeVal');
  if (!wrap) return;
  const ccy = OPT.currency;
  const c = OPT.chain[ccy];
  const candles = OPT.priceCandles[ccy];
  const canvas = document.getElementById('optLevelsCanvas');
  if (!c || !candles || !candles.length) {
    if (flipEl) flipEl.textContent = '—';
    if (netEl) netEl.textContent = '—';
    if (regimeEl) regimeEl.textContent = '—';
    // Paint an explicit loading/error state into the canvas instead of
    // leaving it blank — a silent early-return here previously left the
    // whole section looking broken with no indication why.
    if (canvas) _drawGexLevelsEmptyState(canvas, OPT.priceCandlesError[ccy]);
    return;
  }
  if (!canvas) return;
  const levels = { spot: c.spot, callWall: c.callWall.strike, putWall: c.putWall.strike, flipStrike: c.flipStrike };
  const view = _optLevelsView(ccy);
  const layout = _drawGexLevelsChart(canvas, candles, levels, view);
  if (layout) {
    OPT._levelsLayout = layout; // stashed for the interaction layer
    // The price-axis lane's width is dynamic (48–140px, sized to fit the
    // current price labels — see AXIS_W above) but the yscale/xscale hit-
    // zones were fixed at a hardcoded 56px in CSS. Whenever AXIS_W < 56
    // (narrow labels), that hardcoded box reached past the axis lane and
    // sat on top of the right-most, most-recently-drawn candles — exactly
    // where a user's pointer naturally lands to drag. Any drag started
    // there always resolved to a price-axis rescale, never a pan, no
    // matter how many times you tried. Keeping these in lockstep with the
    // real AXIS_W removes that dead zone entirely.
    const yZone = document.getElementById('optLevelsYScale');
    const xZone = document.getElementById('optLevelsXScale');
    if (yZone) yZone.style.width = layout.AXIS_W + 'px';
    if (xZone) xZone.style.right = layout.AXIS_W + 'px';
  }

  const longGamma = c.netGammaTotal >= 0;
  if (flipEl) flipEl.textContent = fmtUsd(c.flipStrike, false);
  if (netEl) { netEl.textContent = fmtUsd(c.netGammaTotal); netEl.style.color = longGamma ? 'var(--green,#26a69a)' : 'var(--red,#ef5350)'; }
  if (regimeEl) { regimeEl.textContent = longGamma ? 'Long Gamma' : 'Short Gamma'; regimeEl.style.color = longGamma ? 'var(--green,#26a69a)' : 'var(--red,#ef5350)'; }
}

// Paints "Loading…" or an error message centered in the canvas so the
// section never just sits blank while data is missing.
function _drawGexLevelsEmptyState(canvas, errMsg) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width, cssH = rect.height;
  if (!cssW || !cssH) return;
  const W = Math.floor(cssW * dpr), H = Math.floor(cssH * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = _optColBg();
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.fillStyle = _optColTextDim();
  ctx.font = `11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(errMsg ? `Price chart unavailable — ${errMsg}` : 'Loading price chart…', cssW / 2, cssH / 2);
  ctx.restore();
}

/* ---------------- free pan/zoom interaction ----------------
   TradingView-style: drag the chart body to pan (both axes' offset is
   bar-based, so panning is purely horizontal — dragging left/right moves
   through time); drag the right price-scale to zoom Y; drag the bottom
   time-scale to zoom X. Wheel also zooms X (scroll) since that's the
   most common expectation even without a dedicated scale-drag. All of
   this only touches OPT_LEVELS_VIEW[ccy] + triggers a re-render; it never
   refetches data. */
function _initGexLevelsInteraction() {
  const canvas = document.getElementById('optLevelsCanvas');
  const yZone = document.getElementById('optLevelsYScale');
  const xZone = document.getElementById('optLevelsXScale');
  const wrap = document.getElementById('optLevelsChart');
  if (!canvas || !yZone || !xZone || !wrap) return;

  let drag = null; // { mode: 'pan'|'zoomY'|'zoomX', startX, startY, startOffset, startBarsVisible, startYMult }

  function currentView() { return _optLevelsView(OPT.currency); }

  function onPointerDown(mode) {
    return (e) => {
      const layout = OPT._levelsLayout;
      if (!layout) return;
      const v = currentView();
      drag = {
        mode,
        startX: e.clientX, startY: e.clientY,
        startOffset: v.offsetBars,
        // Read barsVisible from the view (kept in sync by the render loop)
        // rather than the stale layout struct — the two diverge after a Y-scale
        // drag because yScaleMult changes trigger a re-render that updates
        // view.barsVisible, but OPT._levelsLayout is only replaced when the
        // draw call returns a non-null layout.
        startBarsVisible: v.barsVisible || layout.barsVisible,
        startYMult: v.yScaleMult || 1,
        // Pan needs its own fixed baseline too: slotW (and n) come from
        // OPT._levelsLayout, which is overwritten by every render — including
        // the render triggered at the end of each pointermove during this
        // very drag. The right-side price-axis lane resizes itself to fit
        // whatever price labels are currently on screen, so as you drag
        // through history and the visible price digits change width, slotW
        // silently drifts mid-gesture. Dividing a start-anchored dxPx by a
        // constantly-changing slotW is what made panning feel like it
        // fights you instead of tracking the cursor. Capture both once,
        // here, and use only these for the whole gesture.
        startSlotW: layout.slotW,
        startN: layout.n,
        // Same fixed-baseline reasoning as slotW above, but for the price
        // axis: `range` and `chartH` come from the same per-render layout
        // struct, so capture them once at drag start and use only these for
        // the whole gesture instead of the live (constantly recomputed)
        // layout — otherwise a vertical drag would fight itself, since
        // panning changes yOffset, which changes `mid`/`range` on the next
        // render, which would change the px<->price ratio mid-gesture.
        startRange: layout.range,
        startChartH: layout.chartH - layout.TOP_PAD,
        startYOffset: v.yOffset || 0
      };
      if (mode === 'pan') canvas.classList.add('panning');
      else wrap.classList.add(mode === 'zoomY' ? 'zoom-y' : 'zoom-x');
      e.preventDefault();
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };
  }

  function onPointerMove(e) {
    if (!drag) return;
    const layout = OPT._levelsLayout;
    if (!layout) return;
    const v = currentView();

    if (drag.mode === 'pan') {
      const dxPx = e.clientX - drag.startX;
      // Dragging right pulls older bars into view (pan back in time) — same
      // convention as TradingView: your hand drags the timeline right, which
      // moves the visible window left/backward, increasing offsetBars.
      // Uses the slotW/n/barsVisible captured at drag START (not the live
      // `layout` above, which mutates every frame) so the whole gesture maps
      // 1:1 to cursor movement instead of drifting as AXIS_W resizes.
      const barsShift = dxPx / drag.startSlotW;
      v.offsetBars = drag.startOffset + barsShift;
      const maxOffset = Math.max(0, drag.startN - drag.startBarsVisible);
      const minOffset = -Math.floor(drag.startBarsVisible * 0.5);
      v.offsetBars = Math.max(minOffset, Math.min(maxOffset, v.offsetBars));

      // Vertical component of the same drag: pans the price axis. Sign
      // flipped from the initial version per user feedback — dragging down
      // (dyPx > 0) now *increases* the price mid. Freezes the reference box
      // (manualY) so the view stays exactly where dragged instead of
      // snapping back to auto-fit on the next render (see manualY note above).
      const dyPx = e.clientY - drag.startY;
      const priceShift = (dyPx / drag.startChartH) * drag.startRange;
      v.yOffset = drag.startYOffset + priceShift;
      v.manualY = true;
    } else if (drag.mode === 'zoomX') {
      const dxPx = e.clientX - drag.startX;
      // Dragging right widens the visible window (zoom out); dragging left narrows it (zoom in) — matches TradingView's time-axis drag.
      const factor = Math.exp(dxPx / 180);
      v.barsVisible = drag.startBarsVisible * factor;
    } else if (drag.mode === 'zoomY') {
      // Axis-lane drag scales the price axis (TradingView behavior: grab the
      // axis and drag to stretch/compress the ruler — candles stay where
      // they are, only the price-per-pixel changes). This is NOT the same
      // as the chart-body pan's vertical component above: that translates
      // the whole view (yOffset), this only changes yScaleMult. Previous
      // version wrongly reused the translate logic here, which made
      // "scaling" the axis drag every candle up/down instead of stretching
      // the scale around a fixed point.
      const dyPx = e.clientY - drag.startY;
      const factor = Math.exp(-dyPx / 180);
      v.yScaleMult = Math.max(0.15, Math.min(20, drag.startYMult * factor));
      v.manualY = true;
    }
    renderGexLevelsChart();
  }

  function onPointerUp() {
    drag = null;
    canvas.classList.remove('panning');
    wrap.classList.remove('zoom-y', 'zoom-x');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  canvas.addEventListener('pointerdown', onPointerDown('pan'));
  yZone.addEventListener('pointerdown', onPointerDown('zoomY'));
  xZone.addEventListener('pointerdown', onPointerDown('zoomX'));

  // Wheel over the chart body zooms X around the cursor position — the
  // most common "free zoom" gesture on TradingView-style charts, additive
  // to (not a replacement for) the axis-drag zoom above.
  canvas.addEventListener('wheel', (e) => {
    const layout = OPT._levelsLayout;
    if (!layout) return;
    e.preventDefault();
    const v = currentView();
    const factor = Math.exp(e.deltaY * 0.001);
    const oldBars = layout.barsVisible;
    let newBars = oldBars * factor;
    v.barsVisible = newBars;
    // Keep the bar under the cursor roughly fixed while zooming, rather than
    // always zooming from the right edge.
    const rect = canvas.getBoundingClientRect();
    const cursorFracFromRight = (rect.right - e.clientX) / layout.chartW; // 0 at right edge, 1 at left edge of chart body
    const barsDelta = (newBars - oldBars) * cursorFracFromRight;
    v.offsetBars = Math.max(0, v.offsetBars + barsDelta);
    renderGexLevelsChart();
  }, { passive: false });

  // Redraw on container resize (canvas is CSS-sized; internal buffer must follow).
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => { if (OPT.built) renderGexLevelsChart(); });
    ro.observe(wrap);
  }
}

function renderOptionsPanel() {
  renderTopRow();
  renderSummaryCard();
  renderTermCurveChart();
  renderVolIndexStrip();
  renderGexChart();
  renderOiByExpiryChart();
  renderIvSkewChart();
  renderExpiryTable();
  renderGexLevelsChart();
}

/* ============================================================
   Public lifecycle — called from main.js's onPanelEnter()
   ============================================================ */

// GEX bar fills are baked to literal rgb() strings at render time (see
// _themeGexColors/gexRampColor) so they read the *current* theme, but only
// when renderGexChart() actually runs. Previously the only triggers were
// the 30s poll and panel entry, so flipping the theme while on the Options
// tab left stale colors on screen until one of those fired — in practice,
// until the user left and re-entered the panel. Watch for the same
// theme-editor mutation every CSS-var-driven element already picks up for
// free, and re-tint immediately.
let _optThemeObserver = null;
function _startOptThemeObserver() {
  if (_optThemeObserver || typeof MutationObserver === 'undefined') return;
  _optThemeObserver = new MutationObserver(() => {
    // Re-tint only — no need to refetch data for a palette change.
    if (!OPT.built) return;
    renderGexChart();
    renderGexLevelsChart(); // canvas also bakes theme colors at draw time
    const c = OPT.chain[OPT.currency];
    if (c && c.termCurve && c.termCurve.length >= 2) renderTermHeat(c.termDiff);
  });
  _optThemeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme']
  });
}
function _stopOptThemeObserver() {
  if (_optThemeObserver) { _optThemeObserver.disconnect(); _optThemeObserver = null; }
}

// Pause/resume the same two timers when the *browser tab* is backgrounded,
// independent of the in-app panel switch above. A user can leave the
// Options in-app panel active but switch to a different browser tab —
// document.hidden catches that case too, so we're not burning Deribit
// requests against a page nobody is looking at either way.
function _handleOptVisibilityChange() {
  if (document.hidden) {
    if (OPT.pollTimer) { clearInterval(OPT.pollTimer); OPT.pollTimer = null; }
    if (OPT.slowTimer) { clearInterval(OPT.slowTimer); OPT.slowTimer = null; }
  } else if (OPT.built) {
    // Catch up immediately, then resume normal cadence.
    refreshAll();
    refreshSlow();
    if (!OPT.pollTimer) OPT.pollTimer = setInterval(refreshAll, OPT_CHAIN_POLL_MS);
    if (!OPT.slowTimer) OPT.slowTimer = setInterval(refreshSlow, OPT_SLOW_POLL_MS);
  }
}

window.startOptionsPanel = function startOptionsPanel() {
  buildOptionsDom();
  refreshAll();
  refreshSlow();
  if (OPT.pollTimer) clearInterval(OPT.pollTimer);
  if (OPT.slowTimer) clearInterval(OPT.slowTimer);
  OPT.pollTimer = setInterval(refreshAll, OPT_CHAIN_POLL_MS);
  OPT.slowTimer = setInterval(refreshSlow, OPT_SLOW_POLL_MS);
  _startOptThemeObserver();
  document.addEventListener('visibilitychange', _handleOptVisibilityChange);
};

window.stopOptionsPanel = function stopOptionsPanel() {
  if (OPT.pollTimer) { clearInterval(OPT.pollTimer); OPT.pollTimer = null; }
  if (OPT.slowTimer) { clearInterval(OPT.slowTimer); OPT.slowTimer = null; }
  _stopOptThemeObserver();
  document.removeEventListener('visibilitychange', _handleOptVisibilityChange);
  hideGexTooltip();
};
