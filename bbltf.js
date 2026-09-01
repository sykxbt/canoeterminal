'use strict';

/* ============================================================
   bbltf.js — Canoe Terminal
   "BB LTF" — Detects breaker blocks (order block + FVG
   overlap, engulfed and not re-mitigated) on a set of LOWER
   timeframes (15M/30M/1H/2H/4H) and draws them as boxes on the
   base chart — the mirror image of bbhtf.js, which does the same
   thing on HIGHER timeframes.

     lookback          = 100   (bars, per-TF OB/FVG scan window)
     ob_min_overlap    = 50    (min FVG/OB overlap %, "General")
     fvg_strict_pct    = 25    (x2+ mitigation threshold %, "General")
     mid_col           = #7a808d
     show_mid          = false
     show_labels       = true
     border_col        = transparent (border effectively off)
     border_width      = 1
     show_current_only = false
     show_1h           = true 
   ============================================================ */

(function (global) {

  const TF_LIST = [
    { key: '15m', label: '15M' },
    { key: '30m', label: '30M' },
    { key: '1h',  label: '1H'  },
    { key: '2h',  label: '2H'  },
    { key: '4h',  label: '4H'  },
  ];

  function isBull(bars, i) { return bars[i].c > bars[i].o; }
  function isBear(bars, i) { return bars[i].c < bars[i].o; }

  const FVG_C1 = 2; 
  const MAX_BOXES = 500; 

  function computeBoxesForBars(bars, lookback, minOverlap, strictPct) {
    const n = bars.length;
    let active = [];   
    let pending = [];
    const boxes = []; 

    const die = (rec, rightT) => {
      boxes.push({
        top: rec.top, bot: rec.bot, mid: rec.mid, left: rec.left, right: rightT,
        isBear: rec.isBear, isPartial: rec.isPartial, fvgCnt: rec.fvgCnt, alive: false,
      });
    };

    for (let idx = 0; idx < n; idx++) {
      const c0 = bars[idx];
      const c1 = idx - 1 >= 0 ? bars[idx - 1] : null;
      const c2 = idx - 2 >= 0 ? bars[idx - 2] : null;

      if (pending.length) {
        const stillPending = [];
        for (let j = 0; j < pending.length; j++) {
          const p = pending[j];
          const effLevel = p.fvgCnt >= 2
            ? (p.isBear ? p.top - (p.top - p.bot) * (strictPct / 100) : p.bot + (p.top - p.bot) * (strictPct / 100))
            : p.mid;
          const bearFvg = (c2 && c0) ? c2.l > c0.h : false;
          const bullFvg = (c2 && c0) ? c2.h < c0.l : false;
          const c2Top = c1 ? Math.max(c1.o, c1.c) : null;
          const c2Bot = c1 ? Math.min(c1.o, c1.c) : null;
          const c2Crosses = c1 ? (c2Top >= effLevel && c2Bot <= effLevel) : false;
          const fvgExempt = (bearFvg || bullFvg) && c2Crosses;
          if (fvgExempt) {
            p.fvgCnt += 1;
            active.push(p);
          } else {
            die(p, c1 ? c1.t : c0.t);
          }
        }
        pending = stillPending;
      }

      if (active.length) {
        const stillActive = [];
        for (let i = 0; i < active.length; i++) {
          const a = active[i];
          const effLevel = a.fvgCnt >= 2
            ? (a.isBear ? a.top - (a.top - a.bot) * (strictPct / 100) : a.bot + (a.top - a.bot) * (strictPct / 100))
            : a.mid;
          const bodyTopNow = Math.max(c0.o, c0.c);
          const bodyBotNow = Math.min(c0.o, c0.c);
          const bodyCrosses = bodyTopNow >= effLevel && bodyBotNow <= effLevel;
          const wickCrosses = (c0.h >= effLevel && c0.l <= effLevel) && !bodyCrosses;
          if (wickCrosses) {
            die(a, c0.t);
          } else if (bodyCrosses) {
            pending.push(a);
          } else {
            stillActive.push(a);
          }
        }
        active = stillActive;
      }

      if (idx >= lookback + 3) {
        const b1 = bars[idx - FVG_C1];    
        const b3 = bars[idx];             
        const fvgBearTop = b1.l, fvgBearBot = b3.h;
        const validBearFvg = isBear(bars, idx - 1) && fvgBearTop > fvgBearBot;
        const fvgBullBot = b1.h, fvgBullTop = b3.l;
        const validBullFvg = isBull(bars, idx - 1) && fvgBullTop > fvgBullBot;

        if (validBearFvg || validBullFvg) {
          const fvgTop = validBearFvg ? fvgBearTop : fvgBullTop;
          const fvgBot = validBearFvg ? fvgBearBot : fvgBullBot;
          const lookingForBearOb = validBearFvg;

          const prefixLow = [];
          const prefixHigh = [];
          let runningLow = bars[idx - 3] ? bars[idx - 3].h : Infinity;
          let runningHigh = bars[idx - 3] ? bars[idx - 3].l : -Infinity;
          for (let k = FVG_C1 + 1; k <= lookback - 1; k++) {
            const bar = bars[idx - k];
            if (!bar) break;
            if (bar.l < runningLow) runningLow = bar.l;
            if (bar.h > runningHigh) runningHigh = bar.h;
            prefixLow.push(runningLow);
            prefixHigh.push(runningHigh);
          }

          for (let obI = FVG_C1 + 1; obI <= lookback - 1; obI++) {
            const obBar = bars[idx - obI];
            if (!obBar) break;
            const obEngulfOffset = obI - 1;
            const obEngulfBar = bars[idx - obEngulfOffset];
            if (!obEngulfBar) continue;

            const obColourMatch = lookingForBearOb ? isBear(bars, idx - obI) : isBull(bars, idx - obI);
            if (!obColourMatch) continue;

            const obBh = Math.max(obBar.o, obBar.c);
            const obBl = Math.min(obBar.o, obBar.c);
            const obMid = (obBh + obBl) / 2;
            const bIsOpposite = lookingForBearOb ? (obEngulfBar.c > obEngulfBar.o) : (obEngulfBar.c < obEngulfBar.o);
            const bClosesBeyond = lookingForBearOb ? obEngulfBar.c > obBh : obEngulfBar.c < obBl;
            if (!(bIsOpposite && bClosesBeyond)) continue;

            let mitigated = false;
            let deepestHigh = obBl;
            let deepestLow = obBh;
            const rangeEndIdx = obEngulfOffset - FVG_C1 - 2;
            if (obEngulfOffset >= FVG_C1 + 2 && rangeEndIdx >= 0 && rangeEndIdx < prefixLow.length) {
              const rangeLow = prefixLow[rangeEndIdx];
              const rangeHigh = prefixHigh[rangeEndIdx];
              if (rangeHigh > obBl && rangeLow < obBh) {
                if (lookingForBearOb) {
                  if (rangeLow <= obMid) mitigated = true;
                  else deepestLow = rangeLow;
                } else {
                  if (rangeHigh >= obMid) mitigated = true;
                  else deepestHigh = rangeHigh;
                }
              }
            }
            if (mitigated) continue;

            const overlapTop = Math.min(obBh, fvgTop);
            const overlapBot = Math.max(obBl, fvgBot);
            const overlapRange = overlapTop - overlapBot;
            const obRange = obBh - obBl;
            const overlapPct = obRange > 0 ? (overlapRange / obRange) * 100 : 0;
            if (overlapPct < minOverlap) continue;

            let drawTop = overlapTop, drawBot = overlapBot;
            if (lookingForBearOb) drawTop = Math.min(drawTop, deepestLow);
            else drawBot = Math.max(drawBot, deepestHigh);
            const drawMid = (drawTop + drawBot) / 2;
            const obTouched = lookingForBearOb ? deepestLow < obBh : deepestHigh > obBl;
            const isPartial = obTouched || overlapPct < 100;

            active.push({
              top: drawTop, bot: drawBot, mid: drawMid,
              left: obBar.t,
              isBear: lookingForBearOb,
              isPartial, fvgCnt: 1,
            });
          }
        }
      }
    }

    active.forEach(a => boxes.push({ top: a.top, bot: a.bot, mid: a.mid, left: a.left, right: null, isBear: a.isBear, isPartial: a.isPartial, fvgCnt: a.fvgCnt, alive: true }));
    pending.forEach(a => boxes.push({ top: a.top, bot: a.bot, mid: a.mid, left: a.left, right: null, isBear: a.isBear, isPartial: a.isPartial, fvgCnt: a.fvgCnt, alive: true }));

    return boxes;
  }

  function labelFor(tfLabel, box) {
    const prefix = box.isPartial ? 'p' : '';
    const base = tfLabel + ' ' + prefix + 'BB';
    return box.fvgCnt > 1 ? base + ' x' + box.fvgCnt : base;
  }


  let _lastCandlesByTf = null;
  let _lastSettingsKey = null;
  let _lastResult = null;

  function fingerprint(candlesByTf) {

    const parts = [];
    for (const tf of TF_LIST) {
      const arr = candlesByTf ? candlesByTf[tf.key] : null;
      if (!arr || !arr.length) { parts.push(tf.key + ':0'); continue; }
      const last = arr[arr.length - 1];
      parts.push(`${tf.key}:${arr.length}:${last.t}:${last.o}:${last.h}:${last.l}:${last.c}`);
    }
    return parts.join('|');
  }

  function compute(candlesByTf, settings) {
    const settingsKey = JSON.stringify(settings || {});
    const fp = fingerprint(candlesByTf);
    if (_lastResult && fp === _lastCandlesByTf && settingsKey === _lastSettingsKey) {
      return _lastResult;
    }
    const result = computeUncached(candlesByTf, settings);
    _lastCandlesByTf = fp;
    _lastSettingsKey = settingsKey;
    _lastResult = result;
    return result;
  }

  function computeUncached(candlesByTf, settings) {
    const S = settings || {};
    const lookback = Math.max(10, Math.min(500, Math.round(S.lookback ?? 100)));
    const minOverlap = Math.max(1, Math.min(100, Number.isFinite(S.minOverlap) ? S.minOverlap : 50));
    const strictPct = Math.max(1, Math.min(49, Number.isFinite(S.strictPct) ? S.strictPct : 25));
    const tfEnabled = S.timeframes || {};

    const byTf = {};
    if (!candlesByTf) return { byTf };

    let allBoxes = [];
    for (const tf of TF_LIST) {
      if (!tfEnabled[tf.key]) continue;
      const bars = candlesByTf[tf.key];
      if (!bars || bars.length < lookback + 4) { byTf[tf.label] = []; continue; }
      const boxes = computeBoxesForBars(bars, lookback, minOverlap, strictPct);
      boxes.forEach(b => { b.tfLabel = tf.label; b.label = labelFor(tf.label, b); });
      byTf[tf.label] = boxes;
      allBoxes = allBoxes.concat(boxes);
    }

    if (allBoxes.length > MAX_BOXES) {
      allBoxes.sort((a, b) => b.left - a.left);
      const keep = new Set(allBoxes.slice(0, MAX_BOXES));
      for (const label in byTf) {
        byTf[label] = byTf[label].filter(b => keep.has(b));
      }
    }

    return { byTf };
  }

  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const num = parseInt(full.slice(0, 6), 16) || 0;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function pickColor(colors, fvgCnt) {
    if (fvgCnt <= 1) return colors[0];
    if (fvgCnt === 2) return colors[1];
    if (fvgCnt === 3) return colors[2];
    return colors[3];
  }

  function drawOverlay(ctx, result, tsToX, yFor, opts) {
    if (!result || !result.byTf) return;
    const O = opts || {};
    const colors = O.colors || ['#ffffff', '#ffffff', '#ffffff', '#ffffff'];
    const opacity = Number.isFinite(O.opacity) ? O.opacity : 0.25;
    const midColor = O.midColor || '#7a808d';
    const midOpacity = Number.isFinite(O.midOpacity) ? O.midOpacity : 0.8;
    const showMid = O.showMid === true;
    const showLabels = O.showLabels !== false;
    const borderColor = O.borderColor || '#000000';
    const borderOpacity = Number.isFinite(O.borderOpacity) ? O.borderOpacity : 0;
    const borderWidth = Number.isFinite(O.borderWidth) ? O.borderWidth : 1;
    const labelColor = O.labelColor || '#7a808d';
    const showCurrentTfOnly = O.showCurrentTfOnly === true;
    const currentTfLabel = O.currentTfLabel || null;
    const rightEdgeX = Number.isFinite(O.rightEdgeX) ? O.rightEdgeX : null;
    const clipLeft = Number.isFinite(O.clipLeft) ? O.clipLeft : -Infinity;
    const clipRight = Number.isFinite(O.clipRight) ? O.clipRight : Infinity;

    const colorRgb = colors.map(hexToRgb);
    const [mR, mG, mB] = hexToRgb(midColor);
    const [bR, bG, bB] = hexToRgb(borderColor);

    ctx.save();

    for (const tfLabel in result.byTf) {
      if (showCurrentTfOnly && currentTfLabel && tfLabel !== currentTfLabel) continue;
      const boxes = result.byTf[tfLabel];
      if (!boxes || !boxes.length) continue;

      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        let x1 = tsToX(box.left);
        let x2 = box.alive ? (rightEdgeX != null ? rightEdgeX : tsToX(box.left)) : tsToX(box.right);
        if (x2 < x1) { const t = x1; x1 = x2; x2 = t; }
        if (x2 < clipLeft || x1 > clipRight) continue;
        x1 = Math.max(x1, clipLeft);
        x2 = Math.min(x2, clipRight);
        if (x2 - x1 < 0.5) continue;

        const yTop = yFor(box.top);
        const yBot = yFor(box.bot);
        const rectY = Math.min(yTop, yBot);
        const rectH = Math.max(1, Math.abs(yBot - yTop));

        const [r, g, b] = pickColor(colorRgb, box.fvgCnt);

        if (opacity > 0) {
          ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
          ctx.fillRect(x1, rectY, x2 - x1, rectH);
        }

        if (borderOpacity > 0 && borderWidth > 0) {
          ctx.strokeStyle = `rgba(${bR},${bG},${bB},${borderOpacity})`;
          ctx.lineWidth = borderWidth;
          ctx.strokeRect(x1, rectY, x2 - x1, rectH);
        }

        if (showMid) {
          const yMid = yFor(box.mid);
          ctx.strokeStyle = `rgba(${mR},${mG},${mB},${midOpacity})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x1, yMid);
          ctx.lineTo(x2, yMid);
          ctx.stroke();
        }

        if (showLabels && (x2 - x1) > 24) {
          const fontSize = Math.max(8, Math.min(11, Math.round((x2 - x1) / 9)));
          ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
          ctx.fillStyle = labelColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const yMid = (rectY + rectY + rectH) / 2;
          const cx = (x1 + x2) / 2;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x1, rectY, x2 - x1, rectH);
          ctx.clip();
          ctx.fillText(box.label, cx, yMid);
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }

  global.BbLtf = {
    compute,
    drawOverlay,
    TF_LIST,
  };

})(window);
