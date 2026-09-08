'use strict';

const PF_THEME_SENTINEL = '__theme_accent__';
const PF_DEFAULTS = {
  zigzagLength: 8,                      
  zigzagDepth: 55,
  zigzagConfigs: [
    { enabled: true,  length: 8,  depth: 55 },
    { enabled: false, length: 13, depth: 34 },
    { enabled: false, length: 21, depth: 21 },
    { enabled: false, length: 34, depth: 13 },
  ],
  numberOfPivots: 5,      
  errorThreshold: 20.0,   
  flatThreshold: 20.0,    
  checkBarRatio: true,
  barRatioLimit: 0.382,
  avoidOverlap: false,
  singleColorValue: '',
  maxPatterns: 20,
  showPivotLabels: false,
  lineWidth: 2,
  lineStyle: 'solid', 
  opacity: 1.0,
  textScale: 1.0,   
  textOpacity: 1.0, 
  allowedPatterns: new Array(14).fill(true),
  allowedLastPivotDirections: new Array(14).fill(0),
};

const _pfStateByChart = new Map();
function _pfGetState(chartId) {
  let s = _pfStateByChart.get(chartId);
  if (!s) {
    s = { lastScanKey: null, patterns: [] };
    _pfStateByChart.set(chartId, s);
  }
  return s;
}

function _pfInvalidate(chartId) {
  if (chartId === undefined) {
    _pfStateByChart.forEach(s => { s.lastScanKey = null; });
  } else {
    _pfGetState(chartId).lastScanKey = null;
  }
}

const _pf = (() => {

  
  const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function pivotCandleAt(candles, idx, length) {
    const start = Math.max(0, idx - length + 1);
    let pHigh = -Infinity, pLow = Infinity, pHighBar = 0, pLowBar = 0;
    for (let i = idx; i >= start; i--) {
      const h = candles[i].h, l = candles[i].l;
      if (h > pHigh) { pHigh = h; pHighBar = idx - i; }
      if (l < pLow)  { pLow  = l; pLowBar  = idx - i; }
    }
    return { pHigh, pLow, pHighBar, pLowBar };
  }

  function computeZigzag(candles, length) {
    const pivots = []; 
                        
    let pDir = 1;

    for (let idx = 0; idx < candles.length; idx++) {
      const cndl = pivotCandleAt(candles, idx, length);
      const lastPivot = pivots.length ? pivots[pivots.length - 1] : null;
      const llastPivot = pivots.length > 1 ? pivots[pivots.length - 2] : null;

      if (lastPivot) pDir = sign(lastPivot.dir);

      const distanceFromLastPivot = lastPivot ? idx - lastPivot.index : 0;
      const overflow = lastPivot ? distanceFromLastPivot >= length : false;

      let forceDoublePivot = false;
      if (llastPivot) {
        forceDoublePivot = pDir === 1 && cndl.pLowBar === 0
          ? cndl.pLow < llastPivot.price
          : pDir === -1 && cndl.pHighBar === 0
            ? cndl.pHigh > llastPivot.price
            : false;
      }

      let newPivotThisBar = false;

      const addPivot = (index, price, dir) => {
        const pivot = { index, price, dir, time: candles[index].t };
        
        
        if (pivots.length >= 1) {
          const lp = pivots[pivots.length - 1];
          const d = sign(dir);
          if (pivots.length >= 2) {
            const llp = pivots[pivots.length - 2];
            const newDir = d * price > d * llp.price ? d * 2 : d;
            pivot.dir = newDir;
          }
        }
        pivots.push(pivot);
      };

      
      if (lastPivot && ((pDir === 1 && cndl.pHighBar === 0) || (pDir === -1 && cndl.pLowBar === 0))) {
        const value = pDir === 1 ? cndl.pHigh : cndl.pLow;
        const removeOld = value * lastPivot.dir >= lastPivot.price * lastPivot.dir;
        if (removeOld) {
          pivots.pop();
          addPivot(idx, value, pDir);
          newPivotThisBar = true;
        }
      }

      
      if (((pDir === 1 && cndl.pLowBar === 0) || (pDir === -1 && cndl.pHighBar === 0)) &&
          (!newPivotThisBar || forceDoublePivot)) {
        const value = pDir === 1 ? cndl.pLow : cndl.pHigh;
        addPivot(idx, value, -pDir);
        newPivotThisBar = true;
      }

      
      
      if (overflow && !newPivotThisBar) {
        const ipivot = pDir === 1 ? cndl.pLow : cndl.pHigh;
        const ipivotbar = pDir === 1 ? (idx - cndl.pLowBar) : (idx - cndl.pHighBar);
        addPivot(ipivotbar, ipivot, -pDir);
      }
    }
    return pivots;
  }

  function nextLevelPivots(zigzagPivots) {
    const nextLevel = []; 
    let tempBullish = null;
    let tempBearish = null;

    const addNewPivot = (arr, pivot) => {
      if (arr.length >= 2) {
        const d = sign(pivot.dir);
        const llastP = arr[arr.length - 2]; 
        pivot.dir = d * pivot.price > d * llastP.price ? d * 2 : d;
      }
      arr.push(pivot);
    };

    for (const src of zigzagPivots) {
      const lPivot = { ...src };
      const dir = lPivot.dir;
      const newDir = sign(dir);
      const value = lPivot.price;

      if (nextLevel.length > 0) {
        const lastPivot = nextLevel[nextLevel.length - 1];
        const lastDir = sign(lastPivot.dir);
        const lastValue = lastPivot.price;

        if (Math.abs(dir) === 2) {
          let skipRest = false;
          if (lastDir === newDir) {
            if (dir * lastValue < dir * value) {
              nextLevel.pop();
            } else {
              const tempPivot = newDir > 0 ? tempBearish : tempBullish;
              if (tempPivot) {
                addNewPivot(nextLevel, { ...tempPivot });
              } else {
                skipRest = true;
              }
            }
          } else {
            const tempFirst = newDir > 0 ? tempBullish : tempBearish;
            const tempSecond = newDir > 0 ? tempBearish : tempBullish;
            if (tempFirst && tempSecond) {
              if (newDir * tempFirst.price > newDir * value) {
                addNewPivot(nextLevel, { ...tempFirst });
                addNewPivot(nextLevel, { ...tempSecond });
              }
            }
          }
          if (!skipRest) {
            addNewPivot(nextLevel, lPivot);
            tempBullish = null;
            tempBearish = null;
          }
        } else {
          
          
          const tempPivot = newDir > 0 ? tempBullish : tempBearish;
          if (tempPivot) {
            if (value * dir > tempPivot.price * dir) {
              if (newDir > 0) tempBullish = lPivot; else tempBearish = lPivot;
            }
          } else if (newDir > 0) tempBullish = lPivot; else tempBearish = lPivot;
        }
      } else if (Math.abs(dir) === 2) {
        addNewPivot(nextLevel, lPivot);
      }
    }

    
    if (nextLevel.length >= zigzagPivots.length) return [];
    return nextLevel;
  }

  
  
  
  function makeLine(p1, p2) {
    return {
      p1, p2,
      getPrice(bar) {
        const stepPerBar = (p2.price - p1.price) / (p2.index - p1.index);
        return p1.price + (bar - p1.index) * stepPerBar;
      },
    };
  }

  function lineInspect(line, candles, startBar, endBar, otherBar, direction, errorRatio = 0.2) {
    let valid = true;
    let score = 0, total = 0;
    for (let barIndex = startBar; barIndex <= endBar; barIndex++) {
      total++;
      const bar = candles[barIndex];
      if (!bar) { valid = false; break; }
      const barPrice = direction > 0 ? bar.h : bar.l;
      const barOutPrice = direction > 0 ? bar.l : bar.h;
      const linePrice = line.getPrice(barIndex);
      if (linePrice * direction < Math.min(bar.o * direction, bar.c * direction)) {
        valid = false; break;
      }
      if (linePrice * direction >= barOutPrice * direction && linePrice * direction <= barPrice * direction) {
        score++;
      } else if (barIndex === otherBar) {
        valid = false; break;
      }
    }
    return { valid: valid && (score / total) < errorRatio, score };
  }

  function inspectPoints(points, startBar, endBar, direction, candles, errorRatio = 0.2) {
    if (points.length === 3) {
      const l1 = makeLine(points[0], points[2]);
      const r1 = lineInspect(l1, candles, startBar, endBar, points[1].index, direction, errorRatio);

      const l2 = makeLine(points[0], points[1]);
      const r2 = lineInspect(l2, candles, startBar, endBar, points[2].index, direction, errorRatio);

      const l3 = makeLine(points[1], points[2]);
      const r3 = lineInspect(l3, candles, startBar, endBar, points[0].index, direction, errorRatio);

      
      let best = 1;
      if (r1.valid && r1.score > Math.max(r2.score, r3.score)) best = 1;
      else if (r2.valid && r2.score > Math.max(r1.score, r3.score)) best = 2;
      else best = 3;

      if (best === 1) return { valid: r1.valid, line: l1 };
      if (best === 2) return { valid: r2.valid, line: l2 };
      return { valid: r3.valid, line: l3 };
    }
    const line = makeLine(points[0], points[points.length - 1]);
    const r = lineInspect(line, candles, startBar, endBar, points[0].index, direction, errorRatio);
    return { valid: r.valid, line };
  }

  function checkBarRatio(p1, p2, p3, props) {
    const r = Math.abs(p3.index - p2.index) / Math.abs(p2.index - p1.index);
    if (!props.checkBarRatio) return true;
    return r >= props.barRatioLimit && r <= (1 / props.barRatioLimit);
  }

  function getRatioDiff(p1, p2, p3) {
    const firstRatio = (p2.price - p1.price) / (p2.index - p1.index);
    const secondRatio = (p3.price - p2.price) / (p3.index - p2.index);
    return Math.abs(firstRatio - secondRatio);
  }

  function resolvePatternType(pattern, props) {
    const t1p1 = pattern.trendLine1.p1.price;
    const t1p2 = pattern.trendLine1.p2.price;
    const t2p1 = pattern.trendLine2.p1.price;
    const t2p2 = pattern.trendLine2.p2.price;

    const upperAngle = t1p1 > t2p1
      ? (t1p2 - Math.min(t2p1, t2p2)) / (t1p1 - Math.min(t2p1, t2p2))
      : (t2p2 - Math.min(t1p1, t1p2)) / (t2p1 - Math.min(t1p1, t1p2));
    const lowerAngle = t1p1 > t2p1
      ? (t2p2 - Math.max(t1p1, t1p2)) / (t2p1 - Math.max(t1p1, t1p2))
      : (t1p2 - Math.max(t2p1, t2p2)) / (t1p1 - Math.max(t2p1, t2p2));

    const upperLineDir = upperAngle > 1 + props.flatRatio ? 1 : upperAngle < 1 - props.flatRatio ? -1 : 0;
    const lowerLineDir = lowerAngle > 1 + props.flatRatio ? -1 : lowerAngle < 1 - props.flatRatio ? 1 : 0;

    const startDiff = Math.abs(t1p1 - t2p1);
    const endDiff = Math.abs(t1p2 - t2p2);
    const minDiff = Math.min(startDiff, endDiff);
    const barDiff = pattern.trendLine1.p2.index - pattern.trendLine2.p1.index;
    const priceDiff = Math.abs(startDiff - endDiff) / barDiff;
    const probableConvergingBars = minDiff / priceDiff;

    const isExpanding = Math.abs(t1p2 - t2p2) > Math.abs(t1p1 - t2p1);
    const isContracting = Math.abs(t1p2 - t2p2) < Math.abs(t1p1 - t2p1);

    const isChannel = probableConvergingBars > 2 * barDiff ||
      (!isExpanding && !isContracting) ||
      (upperLineDir === 0 && lowerLineDir === 0);

    const invalid = sign(t1p1 - t2p1) !== sign(t1p2 - t2p2);

    let type;
    if (invalid) {
      type = 0;
    } else if (isChannel) {
      type = (upperLineDir > 0 && lowerLineDir > 0) ? 1
           : (upperLineDir < 0 && lowerLineDir < 0) ? 2
           : (upperLineDir === 0 && lowerLineDir === 0) ? 3
           : 3;
    } else if (isExpanding) {
      type = (upperLineDir > 0 && lowerLineDir > 0) ? 4
           : (upperLineDir < 0 && lowerLineDir < 0) ? 5
           : (upperLineDir > 0 && lowerLineDir < 0) ? 6
           : (upperLineDir > 0 && lowerLineDir === 0) ? 7
           : (upperLineDir === 0 && lowerLineDir < 0) ? 8
           : -2;
    } else if (isContracting) {
      type = (upperLineDir > 0 && lowerLineDir > 0) ? 9
           : (upperLineDir < 0 && lowerLineDir < 0) ? 10
           : (upperLineDir < 0 && lowerLineDir > 0) ? 11
           : (lowerLineDir === 0) ? (upperLineDir < 0 ? 12 : 1)
           : (upperLineDir === 0) ? (lowerLineDir > 0 ? 13 : 2)
           : -3;
    } else {
      type = -4;
    }

    return type < 0 ? 0 : type;
  }

  function resolvePattern(pattern, props) {
    const firstIndex = pattern.points[0].index;
    const lastIndex = pattern.points[pattern.points.length - 1].index;

    pattern.trendLine1.p1 = { index: firstIndex, price: pattern.trendLine1.getPrice(firstIndex) };
    pattern.trendLine1.p2 = { index: lastIndex, price: pattern.trendLine1.getPrice(lastIndex) };
    pattern.trendLine1 = makeLine(pattern.trendLine1.p1, pattern.trendLine1.p2);

    pattern.trendLine2.p1 = { index: firstIndex, price: pattern.trendLine2.getPrice(firstIndex) };
    pattern.trendLine2.p2 = { index: lastIndex, price: pattern.trendLine2.getPrice(lastIndex) };
    pattern.trendLine2 = makeLine(pattern.trendLine2.p1, pattern.trendLine2.p2);

    pattern.points.forEach((point, i) => {
      const line = (i % 2 === 1) ? pattern.trendLine2 : pattern.trendLine1;
      point.price = line.getPrice(point.index);
    });

    pattern.patternType = resolvePatternType(pattern, props);
    return pattern;
  }

  function findPattern(points, props, candles, colorState) {
    const dbg = typeof window !== 'undefined' && window.tsDebug;
    const validBarRatio = props.numberOfPivots === 6
      ? checkBarRatio(points[1], points[3], points[5], props) && checkBarRatio(points[0], points[2], points[4], props)
      : checkBarRatio(points[0], points[2], points[4], props);
    if (!validBarRatio) {
      if (dbg) console.log(`[pattern finder debug] reject bars ${points[0].index}-${points[points.length-1].index}: bar ratio`);
      return null;
    }

    const trendPointArray1 = [points[0], points[2], points[4]];
    const trendPointArray2 = props.numberOfPivots === 6 ? [points[1], points[3], points[5]] : [points[1], points[3]];

    const firstIndex = points[0].index;
    const lastIndex = points[points.length - 1].index;
    const firstDirection = points[0].price > points[1].price ? 1 : -1;

    const r1 = inspectPoints(trendPointArray1, firstIndex, lastIndex, sign(firstDirection), candles, props.errorRatio);
    const r2 = inspectPoints(trendPointArray2, firstIndex, lastIndex, sign(-firstDirection), candles, props.errorRatio);
    if (!r1.valid || !r2.valid) {
      if (dbg) console.log(`[pattern finder debug] reject bars ${firstIndex}-${lastIndex}: trend-line inspect failed (line1=${r1.valid}, line2=${r2.valid})`);
      return null;
    }

    const patternColor = colorState.next();

    const pattern = {
      dir: sign(points[points.length - 1].price - points[points.length - 2].price),
      points: points.map(p => ({ ...p })),
      trendLine1: r1.line,
      trendLine2: r2.line,
      patternColor,
      ratioDiff: props.numberOfPivots === 6
        ? getRatioDiff(points[1], points[3], points[5])
        : getRatioDiff(points[0], points[2], points[4]),
    };
    resolvePattern(pattern, props);

    if (pattern.patternType === 0) {
      if (dbg) console.log(`[pattern finder debug] reject bars ${firstIndex}-${lastIndex}: invalid geometry (patternType 0)`);
      return null;
    }
    if (!props.allowedPatterns[pattern.patternType]) {
      if (dbg) console.log(`[pattern finder debug] reject bars ${firstIndex}-${lastIndex}: pattern type ${pattern.patternType} disabled in settings`);
      return null;
    }

    
    
    const allowedLastDir = props.allowedLastPivotDirections[pattern.patternType] ?? 0;
    if (allowedLastDir !== 0 && allowedLastDir !== pattern.dir) {
      if (dbg) console.log(`[pattern finder debug] reject bars ${firstIndex}-${lastIndex}: pattern type ${pattern.patternType} last-pivot-direction filter (need ${allowedLastDir}, got ${pattern.dir})`);
      return null;
    }

    return pattern;
  }

  function scanZigzagForPatterns(pivots, props, candles, colorState, patterns) {
    const need = props.numberOfPivots;
    if (pivots.length < need) return;
    for (let end = need; end <= pivots.length; end++) {
      const window = pivots.slice(end - need, end);
      const currentStartBar = window[0].index;
      const currentLastBar = window[window.length - 1].index;
      let ignorePattern = false;
      let existingPattern = false;
      for (const p of patterns) {
        const startBar = p.points[0].index;
        const endBar = p.points[p.points.length - 1].index;
        if (props.avoidOverlap && currentStartBar > startBar && currentStartBar < endBar) {
          ignorePattern = true;
          break;
        }

        let match = true;
        for (let i = 0; i < props.numberOfPivots - 1; i++) {
          if (window[i].index !== p.points[i].index) { match = false; break; }
        }
        if (match) { existingPattern = true; break; }
      }
      if (ignorePattern || existingPattern) continue;

      const pattern = findPattern(window, props, candles, colorState);
      if (pattern) patterns.push(pattern);
    }
  }

  function makeColorCycler(fixedColor) {
    return { next() { return fixedColor; } };
  }

  function scan(rawCandles, settings) {
    const candles = rawCandles.map(c => ({
      ...c,
      o: +c.o, h: +c.h, l: +c.l, c: +c.c,
    }));

    const props = {
      numberOfPivots: settings.numberOfPivots === 6 ? 6 : 5,
      errorRatio: settings.errorThreshold / 100,
      flatRatio: settings.flatThreshold / 100,
      checkBarRatio: settings.checkBarRatio !== false,
      barRatioLimit: settings.barRatioLimit ?? 0.382,
      avoidOverlap: !!settings.avoidOverlap,
      allowedPatterns: settings.allowedPatterns || PF_DEFAULTS.allowedPatterns,
      allowedLastPivotDirections: settings.allowedLastPivotDirections || PF_DEFAULTS.allowedLastPivotDirections,
    };

    const configs = (settings.zigzagConfigs && settings.zigzagConfigs.length)
      ? settings.zigzagConfigs
      : [{ enabled: true, length: settings.zigzagLength || 8 }];

    const fixedColor = settings.singleColorValue || PF_THEME_SENTINEL;
    const colorState = makeColorCycler(fixedColor);
    const patterns = [];

    configs.forEach(cfg => {
      if (!cfg.enabled) return;
      try {
        let levelPivots = computeZigzag(candles, cfg.length || 8);
        let guard = 0; 
                        
        while (levelPivots.length >= 6 && guard < 50) {
          
          
          
          
          
          if (typeof window !== 'undefined' && window.tsDebug) {
            console.log(`[pattern finder debug] scale=${cfg.length} level=${guard} pivots=${levelPivots.length}`);
            console.table(levelPivots.map((p, i) => ({
              n: i,
              barIndex: p.index,
              time: new Date(p.time).toISOString(),
              price: p.price,
              dir: p.dir,
              dirLabel: p.dir === 2 ? 'HH' : p.dir === 1 ? 'LH' : p.dir === -1 ? 'HL' : p.dir === -2 ? 'LL' : '?',
            })));
          }
          scanZigzagForPatterns(levelPivots, props, candles, colorState, patterns);
          levelPivots = nextLevelPivots(levelPivots);
          guard++;
        }
      } catch (e) {
        console.error(`[pattern finder] scale length=${cfg.length} failed — ` +
          `keeping ${patterns.length} pattern(s) already found on other scales:`, e);
      }
    });

    
    
    
    if (typeof window !== 'undefined' && window.tsDebug && patterns.length) {
      console.log(`[pattern finder debug] ${patterns.length} pattern(s) found this scan:`);
      patterns.forEach((p, i) => {
        console.log(`  [${i}] type ${p.patternType}, dir ${p.dir}`);
        console.table(p.points.map((pt, n) => ({
          n: n + 1,
          barIndex: pt.index,
          time: new Date(candles[pt.index]?.t ?? 0).toISOString(),
          price: pt.price,
        })));
        console.log('    trendLine1:', p.trendLine1.p1, '->', p.trendLine1.p2);
        console.log('    trendLine2:', p.trendLine2.p1, '->', p.trendLine2.p2);
      });
    }

    
    
    const max = Math.max(1, settings.maxPatterns ?? 20);
    if (candles.length) {
      const c0 = candles[0];
      const shapeOk = ['o', 'h', 'l', 'c'].every(k => typeof c0[k] === 'number' && Number.isFinite(c0[k]));
      if (!shapeOk) {
        
        
        
        
        console.error('[pattern finder] ⚠ candle[0] o/h/l/c did not coerce to finite numbers — pivot math will be garbage:', c0, 'raw:', rawCandles[0]);
      }
    }
    console.log('[PATTERN FINDER SCAN]', {
      candles: candles.length,
      enabledScales: configs.filter(c => c.enabled).map(c => c.length),
      numberOfPivots: props.numberOfPivots,
      totalPatternsFound: patterns.length,
      returned: Math.min(patterns.length, max),
      sampleCandle: candles[0],
    });
    return patterns.slice(-max);
  }

  return { scan, computeZigzag, nextLevelPivots, cssVar };
})();

function _pfRgbToHex(rgb) {
  
  if (!rgb) return '#4a9ff5';
  if (rgb.startsWith('#')) return rgb;
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return '#4a9ff5';
  return '#' + m.slice(0, 3).map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
}
function _pfHexToRgb(hex) {
  if (!hex || !hex.startsWith('#')) return hex || 'rgb(74, 159, 245)';
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function cssVarSafe(name) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  catch (_) { return ''; }
}

function _pfDrawPatterns(ctx, candles, xForSlot, yFor, n, padL, padR, padT, plotH, cssW, cssH, chartId) {
  const settings = (typeof state !== 'undefined' && state.chart && state.chart.patternFinderSettings)
    ? state.chart.patternFinderSettings : PF_DEFAULTS;
  const op = Math.max(0, Math.min(1, settings.opacity ?? 1.0));
  if (op <= 0) return;

  const tsState = _pfGetState(chartId);

  
  
  
  const scanKey = `${n}|${candles.length ? candles[0].t : 0}|${candles.length ? candles[n - 1].t : 0}|` +
    `${JSON.stringify(settings.zigzagConfigs || settings.zigzagLength)}|${settings.numberOfPivots}|${settings.errorThreshold}|${settings.flatThreshold}|` +
    `${settings.checkBarRatio}|${settings.barRatioLimit}|${settings.avoidOverlap}|${settings.maxPatterns}`;
  if (tsState.lastScanKey !== scanKey) {
    try {
      tsState.patterns = _pf.scan(candles, settings);
    } catch (e) {
      console.error('[pattern finder] scan() threw — patterns cleared:', e);
      tsState.patterns = [];
    }
    tsState.lastScanKey = scanKey;
  }

  const patterns = tsState.patterns;
  if (!patterns.length) return;

  
  
  
  const xFor = (idx) => xForSlot(Math.max(0, Math.min(n - 1, idx)));

  ctx.save();
  ctx.globalAlpha = op;
  ctx.beginPath();
  ctx.rect(padL, padT, cssW - padL - padR, plotH);
  ctx.clip();

  const lw = Math.max(1, settings.lineWidth ?? 2);
  
  
  const dashFor = (style) => {
    if (style === 'dashed') return [lw * 3, lw * 2];
    if (style === 'dotted') return [lw, lw * 1.6];
    return [];
  };
  const lineDash = dashFor(settings.lineStyle);

  patterns.forEach(pattern => {
    const color = pattern.patternColor === PF_THEME_SENTINEL
      ? (_pf.cssVar('--accent') || 'rgb(38, 166, 91)')
      : pattern.patternColor;

    
    [pattern.trendLine1, pattern.trendLine2].forEach(line => {
      const x1 = xFor(line.p1.index), y1 = yFor(line.p1.price);
      const x2 = xFor(line.p2.index), y2 = yFor(line.p2.price);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.setLineDash(lineDash);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    
    
    
    
    if (false) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.globalAlpha = op * 0.8;
      ctx.beginPath();
      pattern.points.forEach((pt, i) => {
        const x = xFor(pt.index), y = yFor(pt.price);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = op;
    }

    
    
    const textScale = Math.max(0.1, settings.textScale ?? 1.0);
    const textOp = Math.max(0, Math.min(1, settings.textOpacity ?? 1.0));

    
    if (settings.showPivotLabels) {
      const fontPx = Math.round(9 * textScale);
      ctx.font = `bold ${fontPx}px monospace`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = op * textOp;
      
      
      ctx.fillStyle = _pf.cssVar('--text') || color;
      pattern.points.forEach((pt, i) => {
        const x = xFor(pt.index), y = yFor(pt.price);
        ctx.fillText(String(i + 1), x, y - 6 * textScale);
      });
      ctx.globalAlpha = op;
    }
  });

  ctx.restore();
}

function drawPatternFinderOverlay(ctx, candles, xForSlot, yFor, n, slotW, padL, padR, padT, plotH, cssW, cssH, chartId = 'main') {
  if (typeof state === 'undefined') return;
  if (!state.chart.indicators.patternFinder) return;
  _pfDrawPatterns(ctx, candles, xForSlot, yFor, n, padL, padR, padT, plotH, cssW, cssH, chartId);
}

function injectPatternFinderSettingsSection() {
  const popout = document.getElementById('indPopout');
  if (!popout) { setTimeout(injectPatternFinderSettingsSection, 200); return; }
  
  
  
  
  const colR = popout.querySelector('#ipopGrpTrend')
    || popout.querySelector('#indPopoutColM2')
    || popout.querySelector('#indPopoutColR')
    || popout.querySelector('#indPopoutColL');
  if (!colR) { setTimeout(injectPatternFinderSettingsSection, 200); return; }
  if (popout.querySelector('#patternFinderSection')) return;

  const S = (typeof state !== 'undefined' && state.chart && state.chart.patternFinderSettings)
    ? state.chart.patternFinderSettings : PF_DEFAULTS;

  const section = document.createElement('div');
  section.className = 'ipop-section';
  section.id = 'patternFinderSection';

  section.innerHTML = `
    <div class="ipop-title">Pattern Finder</div>
    <div style="display:none;">
      <!-- Zigzag scale controls (length/depth/enabled per config) still
           drive pattern-detection sensitivity under the hood — kept alive
           here, off-screen, purely so the existing wiring/sync/apply code
           below (#tsZg[i]On/Len/Depth) keeps working unchanged. Never
           shown in the settings UI. -->
      ${(S.zigzagConfigs || PF_DEFAULTS.zigzagConfigs).map((c, i) => `
      <button class="ipop-toggle${c.enabled ? ' on' : ''}" id="tsZg${i}On">${c.enabled ? 'On' : 'Off'}</button>
      <input type="text" id="tsZg${i}Len" value="${c.length}">
      <input type="text" id="tsZg${i}Depth" value="${c.depth}">
      `).join('')}
    </div>
    <div class="ipop-row">
      <label>Number of pivots</label>
      <select id="tsNumberOfPivots" style="width:60px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:5px;font-size:12px;padding:3px 5px;">
        <option value="5"${(S.numberOfPivots??5)===5?' selected':''}>5</option>
        <option value="6"${(S.numberOfPivots??5)===6?' selected':''}>6</option>
      </select>
    </div>
    <div class="ipop-row"><label>Error threshold (%)</label><input type="text" id="tsErrorThreshold" value="${S.errorThreshold ?? 20}" style="width:52px;"></div>
    <div class="ipop-row"><label>Flat threshold (%)</label><input type="text" id="tsFlatThreshold" value="${S.flatThreshold ?? 20}" style="width:52px;"></div>
    <div class="ipop-row"><label>Check bar ratio</label><button class="ipop-toggle${S.checkBarRatio!==false?' on':''}" id="tsCheckBarRatio">${S.checkBarRatio!==false?'On':'Off'}</button></div>
    <div class="ipop-row"><label>Bar ratio limit</label><input type="text" id="tsBarRatioLimit" value="${S.barRatioLimit ?? 0.382}" style="width:52px;"></div>
    <div class="ipop-row"><label>Avoid overlap</label><button class="ipop-toggle${S.avoidOverlap?' on':''}" id="tsAvoidOverlap">${S.avoidOverlap?'On':'Off'}</button></div>
    <div class="ipop-row" id="tsSingleColorPickerRow">
      <label>Line color</label>
      <input type="color" id="tsSingleColorValue" value="${_pfRgbToHex(S.singleColorValue || cssVarSafe('--accent') || 'rgb(38,166,91)')}" style="width:52px;height:26px;padding:2px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;">
      <button class="ipop-toggle" id="tsSingleColorReset" title="Follow theme accent color" style="margin-left:6px;font-size:10px;padding:3px 8px;">Reset</button>
    </div>
    <div class="ipop-row"><label>Max patterns shown</label><input type="text" id="tsMaxPatterns" value="${S.maxPatterns ?? 20}" style="width:52px;"></div>
    <div class="ipop-row"><label>Show pivot labels</label><button class="ipop-toggle${S.showPivotLabels?' on':''}" id="tsShowPivotLabels">${S.showPivotLabels?'On':'Off'}</button></div>
    <div class="ipop-row"><label>Line width</label><input type="text" id="tsLineWidth" value="${S.lineWidth ?? 2}" style="width:52px;"></div>
    <div class="ipop-row">
      <label>Line style</label>
      <select id="tsLineStyle" style="width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:5px;font-size:12px;padding:3px 5px;">
        <option value="solid"${(S.lineStyle??'solid')==='solid'?' selected':''}>Solid</option>
        <option value="dashed"${S.lineStyle==='dashed'?' selected':''}>Dashed</option>
        <option value="dotted"${S.lineStyle==='dotted'?' selected':''}>Dotted</option>
      </select>
    </div>
    <div class="ipop-row"><label>Opacity (0-1)</label><input type="text" id="tsOpacity" value="${S.opacity ?? 1.0}" style="width:52px;"></div>
    <div class="ipop-row"><label>Text scale</label><input type="text" id="tsTextScale" value="${S.textScale ?? 1.0}" style="width:52px;"></div>
    <div class="ipop-row"><label>Text opacity (0-1)</label><input type="text" id="tsTextOpacity" value="${S.textOpacity ?? 1.0}" style="width:52px;"></div>
  `;
  colR.appendChild(section);

  ['tsCheckBarRatio', 'tsAvoidOverlap', 'tsShowPivotLabels',
   'tsZg0On', 'tsZg1On', 'tsZg2On', 'tsZg3On'].forEach(id => {
    const btn = section.querySelector(`#${id}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      btn.classList.toggle('on');
      btn.textContent = btn.classList.contains('on') ? 'On' : 'Off';
    });
  });

  const scResetBtn = section.querySelector('#tsSingleColorReset');
  if (scResetBtn) {
    scResetBtn.addEventListener('click', () => {
      const el = section.querySelector('#tsSingleColorValue');
      if (el) {
        el.value = _pfRgbToHex(cssVarSafe('--accent') || 'rgb(38,166,91)');
        el.dataset.followTheme = '1'; 
      }
    });
  }
  const scvInputEl = section.querySelector('#tsSingleColorValue');
  if (scvInputEl) {
    scvInputEl.addEventListener('input', () => { delete scvInputEl.dataset.followTheme; });
  }

  const applyBtn = popout.querySelector('#ipopApply');
  if (applyBtn) applyBtn.addEventListener('click', applyPatternFinderSettings, { capture: false });
}

function syncPatternFinderInputsFromState() {
  const section = document.getElementById('patternFinderSection');
  if (!section) return;
  const S = (typeof state !== 'undefined' && state.chart && state.chart.patternFinderSettings)
    ? state.chart.patternFinderSettings : PF_DEFAULTS;

  const setToggle = (id, on) => {
    const btn = section.querySelector(`#${id}`);
    if (!btn) return;
    btn.classList.toggle('on', !!on);
    btn.textContent = on ? 'On' : 'Off';
  };
  const setVal = (id, v) => {
    const el = section.querySelector(`#${id}`);
    if (el) el.value = v;
  };

  (S.zigzagConfigs || PF_DEFAULTS.zigzagConfigs).forEach((c, i) => {
    setToggle(`tsZg${i}On`, c.enabled);
    setVal(`tsZg${i}Len`, c.length);
    setVal(`tsZg${i}Depth`, c.depth);
  });
  setVal('tsNumberOfPivots', (S.numberOfPivots ?? 5) === 6 ? 6 : 5);
  setVal('tsErrorThreshold', S.errorThreshold ?? 20);
  setVal('tsFlatThreshold', S.flatThreshold ?? 20);
  setToggle('tsCheckBarRatio', S.checkBarRatio !== false);
  setVal('tsBarRatioLimit', S.barRatioLimit ?? 0.382);
  setToggle('tsAvoidOverlap', !!S.avoidOverlap);
  const scvEl = section.querySelector('#tsSingleColorValue');
  if (scvEl) {
    scvEl.value = _pfRgbToHex(S.singleColorValue || cssVarSafe('--accent') || 'rgb(38,166,91)');
    if (!S.singleColorValue) scvEl.dataset.followTheme = '1'; else delete scvEl.dataset.followTheme;
  }
  setVal('tsMaxPatterns', S.maxPatterns ?? 20);
  setToggle('tsShowPivotLabels', !!S.showPivotLabels);
  setVal('tsLineWidth', S.lineWidth ?? 2);
  setVal('tsLineStyle', ['solid', 'dashed', 'dotted'].includes(S.lineStyle) ? S.lineStyle : 'solid');
  setVal('tsOpacity', S.opacity ?? 1.0);
  setVal('tsTextScale', S.textScale ?? 1.0);
  setVal('tsTextOpacity', S.textOpacity ?? 1.0);
}

function applyPatternFinderSettings() {
  if (typeof state === 'undefined' || !state.chart) return;
  const section = document.getElementById('patternFinderSection');
  if (!section) return;

  const S = state.chart.patternFinderSettings;
  const clampInt = (v, def, min = 1) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= min ? n : def; };
  const clampF = (v, def) => { const n = parseFloat(v); return Number.isFinite(n) ? n : def; };

  const prevConfigs = S.zigzagConfigs || PF_DEFAULTS.zigzagConfigs;
  S.zigzagConfigs = prevConfigs.map((c, i) => ({
    enabled: section.querySelector(`#tsZg${i}On`)?.classList.contains('on') ?? c.enabled,
    length: clampInt(section.querySelector(`#tsZg${i}Len`)?.value, c.length, 1),
    depth: clampInt(section.querySelector(`#tsZg${i}Depth`)?.value, c.depth, 1),
  }));
  S.zigzagLength = S.zigzagConfigs[0]?.length ?? S.zigzagLength; 
  const pivEl = section.querySelector('#tsNumberOfPivots');
  if (pivEl) S.numberOfPivots = parseInt(pivEl.value, 10) === 6 ? 6 : 5;
  S.errorThreshold = clampF(section.querySelector('#tsErrorThreshold')?.value, S.errorThreshold);
  S.flatThreshold = clampF(section.querySelector('#tsFlatThreshold')?.value, S.flatThreshold);
  S.checkBarRatio = section.querySelector('#tsCheckBarRatio')?.classList.contains('on') ?? true;
  S.barRatioLimit = clampF(section.querySelector('#tsBarRatioLimit')?.value, S.barRatioLimit);
  S.avoidOverlap = section.querySelector('#tsAvoidOverlap')?.classList.contains('on') ?? false;
  const scvApplyEl = section.querySelector('#tsSingleColorValue');
  if (scvApplyEl) {
    
    
    S.singleColorValue = scvApplyEl.dataset.followTheme ? '' : _pfHexToRgb(scvApplyEl.value);
  }
  S.maxPatterns = clampInt(section.querySelector('#tsMaxPatterns')?.value, S.maxPatterns, 1);
  S.showPivotLabels = section.querySelector('#tsShowPivotLabels')?.classList.contains('on') ?? false;
  S.lineWidth = clampInt(section.querySelector('#tsLineWidth')?.value, S.lineWidth, 1);
  const lsEl = section.querySelector('#tsLineStyle');
  if (lsEl) S.lineStyle = ['solid', 'dashed', 'dotted'].includes(lsEl.value) ? lsEl.value : 'solid';
  S.opacity = Math.max(0, Math.min(1, clampF(section.querySelector('#tsOpacity')?.value, S.opacity)));
  S.textScale = Math.max(0.1, clampF(section.querySelector('#tsTextScale')?.value, S.textScale ?? 1.0));
  S.textOpacity = Math.max(0, Math.min(1, clampF(section.querySelector('#tsTextOpacity')?.value, S.textOpacity ?? 1.0)));

  _pfInvalidate(); 

  if (typeof saveChartPrefs === 'function') saveChartPrefs();
  if (typeof state !== 'undefined' && state.chartData?.candles?.length &&
      typeof drawStandardCandles === 'function') {
    drawStandardCandles(state.chartData.candles);
  }
}

(function bootPatternFinder() {
  function attachState() {
    if (typeof state === 'undefined' || !state.chart) { setTimeout(attachState, 50); return; }

    if (!state.chart.patternFinderSettings) {
      state.chart.patternFinderSettings = {
        ...PF_DEFAULTS,
        allowedPatterns: [...PF_DEFAULTS.allowedPatterns],
        allowedLastPivotDirections: [...PF_DEFAULTS.allowedLastPivotDirections],
        zigzagConfigs: PF_DEFAULTS.zigzagConfigs.map(c => ({ ...c })),
        singleColorValue: PF_DEFAULTS.singleColorValue,
      };
    }
    
    
    if (window._patternFinderPrefsPending) {
      const pending = window._patternFinderPrefsPending;
      delete window._patternFinderPrefsPending;
      Object.assign(state.chart.patternFinderSettings, pending);
      if (Array.isArray(pending.allowedPatterns)) {
        state.chart.patternFinderSettings.allowedPatterns = [...pending.allowedPatterns];
      }
      if (Array.isArray(pending.allowedLastPivotDirections)) {
        state.chart.patternFinderSettings.allowedLastPivotDirections = [...pending.allowedLastPivotDirections];
      }
      if (Array.isArray(pending.zigzagConfigs)) {
        state.chart.patternFinderSettings.zigzagConfigs = pending.zigzagConfigs.map(c => ({ ...c }));
      }
    }
    if (state.chart.indicators.patternFinder === undefined) {
      state.chart.indicators.patternFinder = false;
    }

    const btn = document.getElementById('indPatternFinder');
    if (btn) {
      btn.classList.toggle('active', !!state.chart.indicators.patternFinder);
      btn.addEventListener('click', () => {
        const nowOn = !state.chart.indicators.patternFinder;
        state.chart.indicators.patternFinder = nowOn;
        btn.classList.toggle('active', nowOn);
        if (nowOn) _pfInvalidate(); 
        if (state.chartData?.candles?.length && typeof drawStandardCandles === 'function') {
          drawStandardCandles(state.chartData.candles);
        }
        if (typeof saveChartPrefs === 'function') saveChartPrefs();
      });
    }

    injectPatternFinderSettingsSection();
    patchPatternFinderPrefs();

    
    
    
    const popoutEl = document.getElementById('indPopout');
    if (popoutEl && !popoutEl.__pfOpenObserved) {
      let wasOpen = popoutEl.classList.contains('ind-open');
      const mo = new MutationObserver(() => {
        const isOpen = popoutEl.classList.contains('ind-open');
        if (isOpen && !wasOpen) syncPatternFinderInputsFromState();
        wasOpen = isOpen;
      });
      mo.observe(popoutEl, { attributes: true, attributeFilter: ['class'] });
      popoutEl.__pfOpenObserved = true;
    }
  }

  function patchSaveChartPrefs() {
    if (typeof saveChartPrefs !== 'function') return;
    if (window.saveChartPrefs.__pfPatched) return;
    const _orig = saveChartPrefs;
    const write = () => {
      if (typeof state === 'undefined' || !state.chart.patternFinderSettings) return;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ patternFinderSettings: { ...state.chart.patternFinderSettings } });
      }
    };
    window.saveChartPrefs = function () { _orig.apply(this, arguments); write(); };
    window.saveChartPrefs.__pfPatched = true;
  }

  function patchPatternFinderPrefs() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('patternFinderSettings', (res) => {
        const saved = res.patternFinderSettings;
        if (saved && typeof saved === 'object' && typeof state !== 'undefined') {
          Object.assign(state.chart.patternFinderSettings, saved);
          const btn = document.getElementById('indPatternFinder');
          if (btn) btn.classList.toggle('active', !!state.chart.indicators.patternFinder);
          _pfInvalidate();
          if (state.chart.indicators.patternFinder && state.chartData?.candles?.length &&
              typeof drawStandardCandles === 'function') {
            drawStandardCandles(state.chartData.candles);
          }
        }
      });
    }
    patchSaveChartPrefs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachState);
  } else {
    attachState();
  }

  
  function hookDrawStandardCandles() {
    if (typeof drawStandardCandles !== 'function') { setTimeout(hookDrawStandardCandles, 300); return; }
    if (window.drawStandardCandles.__pfPatched) return;
    const _origDraw = drawStandardCandles;
    const wrapped = function (candles) {
      _origDraw.apply(this, arguments);
      if (typeof state === 'undefined') return;
      if (!state.chart.indicators.patternFinder) return;
      if (!state.chartData?.candles?.length) return;

      const canvas = document.getElementById('chartCanvas');
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const geom = state.chart._geom;
      let padL, padR, padT, plotH, cssW, cssH, min, max, n, slotW;

      if (geom && geom.n === candles.length) {
        ({ padL, padR, padT, plotH, cssW, cssH, min, max, n, slotW } = geom);
      } else {
        
        const wrap = canvas.parentElement;
        cssW = wrap.clientWidth; cssH = wrap.clientHeight;
        padL = 8; padR = 64; padT = 12;
        const padAxisB = 18;
        n = candles.length;
        plotH = Math.max(80, cssH - padT - padAxisB);
        slotW = (cssW - padL - padR) / n;
        min = Infinity; max = -Infinity;
        candles.forEach(c => {
          const lo = parseFloat(c.l), hi = parseFloat(c.h);
          if (lo < min) min = lo;
          if (hi > max) max = hi;
        });
        if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) { min -= 1; max += 1; }
        const rangePad = (max - min) * 0.06;
        min -= rangePad; max += rangePad;
      }

      const yFor = (price) => padT + plotH - ((price - min) / (max - min)) * plotH;
      const xForSlot = (slot) => padL + slot * slotW + slotW / 2;

      drawPatternFinderOverlay(ctx, candles, xForSlot, yFor, n, slotW, padL, padR, padT, plotH, cssW, cssH);
    };
    wrapped.__pfPatched = true;
    window.drawStandardCandles = wrapped;
  }

  setTimeout(hookDrawStandardCandles, 400);
})();
