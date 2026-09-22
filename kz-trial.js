/*!
 * 开张前 · 试卖对照与验证报告 (trial variance) v1.0   [P0-5 / T-06 / C-10]
 *
 * 把「试卖实测」与「测算假设」按统一口径对比，输出：
 *   实际单位成本、实际单位边际、实际边际时薪、销量偏差，以及下一轮调整建议。
 * 纯函数，无 DOM 依赖；Node（测试）与浏览器（index.html）共用同一实现。
 *
 * 口径：
 *   基准单位变动成本 = raw ÷ (1 − loss%) + pack + price × fee%
 *   基准单位边际     = price − 基准单位变动成本
 *   基准边际时薪     = 基准单位边际 × 基准日销量 ÷ 基准日工时
 *   实际单位成本     = Σ实测成本 ÷ Σ实测销量          （实测「成本」= 直接变动成本）
 *   实际单位售价     = Σ实测收入 ÷ Σ实测销量
 *   实际单位边际     = 实际单位售价 − 实际单位成本
 *   实际边际时薪     = (Σ实测收入 − Σ实测成本) ÷ Σ实测工时
 *   *偏差            = (实际 − 基准) ÷ 基准
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KZTrial = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMULA_VERSION = '1.0';

  function isNum(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }
  function pct(a, b) { return (b && isFinite(b)) ? (a - b) / b : null; }
  function pctText(p) { return p == null ? '—' : (p >= 0 ? '+' : '') + (p * 100).toFixed(1) + '%'; }

  function baselineUnitCost(b) {
    return b.raw / (1 - b.loss / 100) + b.pack + b.price * b.fee / 100;
  }

  /**
   * trialVariance(baseline, trials) -> { days, actual, baseline, variance, advice, pctText }
   * baseline: { price, raw, pack, loss, fee, sales, hours }
   * trials:   [{ sales, revenue, cost, hours, date?, note? }]
   */
  function trialVariance(baseline, trials) {
    var rows = (trials || []).filter(function (t) {
      return t && isNum(+t.sales) && isNum(+t.revenue) && isNum(+t.cost) && isNum(+t.hours);
    }).map(function (t) {
      return { sales: +t.sales, revenue: +t.revenue, cost: +t.cost, hours: +t.hours, date: t.date, note: t.note };
    });
    var days = rows.length;
    var sum = function (k) { return rows.reduce(function (a, r) { return a + r[k]; }, 0); };
    var sSales = sum('sales'), sRev = sum('revenue'), sCost = sum('cost'), sHours = sum('hours');

    var actual = {
      days: days,
      salesTotal: sSales, revenueTotal: sRev, costTotal: sCost, hoursTotal: sHours,
      salesAvg: days ? sSales / days : 0,
      unitPrice: sSales ? sRev / sSales : 0,
      unitCost: sSales ? sCost / sSales : 0,
      unitMargin: sSales ? (sRev - sCost) / sSales : 0,
      marginTotal: sRev - sCost,
      hourly: sHours ? (sRev - sCost) / sHours : 0
    };

    var bUnitCost = baselineUnitCost(baseline);
    var bUnitMargin = baseline.price - bUnitCost;
    var bHourly = baseline.hours > 0 ? (bUnitMargin * baseline.sales) / baseline.hours : 0;
    var base = { unitCost: bUnitCost, unitMargin: bUnitMargin, salesAvg: baseline.sales, hourly: bHourly };

    var variance = {
      salesPct: pct(actual.salesAvg, base.salesAvg),
      unitCostPct: pct(actual.unitCost, base.unitCost),
      unitMarginPct: pct(actual.unitMargin, base.unitMargin),
      hourlyPct: pct(actual.hourly, base.hourly)
    };

    var advice = [];
    if (days === 0) {
      advice.push('还没有实测记录：建议连续记录至少 3 天真实销量、收入、变动成本和工时。');
    } else {
      var TOL = 0.10;
      if (variance.unitCostPct != null && variance.unitCostPct > TOL) {
        advice.push('实际单位成本比假设高 ' + pctText(variance.unitCostPct) + '，请复核原料/进货价与损耗率（raw、loss），按实测重新核定。');
      } else if (variance.unitCostPct != null && variance.unitCostPct < -TOL) {
        advice.push('实际单位成本比假设低 ' + pctText(variance.unitCostPct) + '，可下调 raw 或 loss，测算结果会更高。');
      }
      if (variance.salesPct != null && variance.salesPct < -0.20) {
        advice.push('实际日均销量比假设低 ' + pctText(variance.salesPct) + '，先下调 sales 或扩大客源，再评估是否投入。');
      } else if (variance.salesPct != null && variance.salesPct > 0.20) {
        advice.push('实际日均销量比假设高 ' + pctText(variance.salesPct) + '，可上调 sales 并复核产能与备货。');
      }
      if (variance.hourlyPct != null && variance.hourlyPct < -0.20) {
        advice.push('实际单位时间回报比假设低 ' + pctText(variance.hourlyPct) + '，考虑提价、缩短工时或提高客单价。');
      }
      var within = [variance.salesPct, variance.unitCostPct, variance.hourlyPct].every(function (p) { return p == null || Math.abs(p) <= TOL; });
      if (within) advice.push('实际与假设偏差在 ±10% 内，当前测算口径基本可信，可继续按此假设推演。');
    }

    return {
      days: days,
      actual: actual,
      baseline: base,
      variance: variance,
      advice: advice,
      pctText: pctText
    };
  }

  // 验证报告（可导出 JSON，作为「假设—实际—偏差—下一次调整」的证据）
  function buildVerificationReport(baseline, trials, meta) {
    meta = meta || {};
    var v = trialVariance(baseline, trials);
    return {
      product: '开张前',
      schemaVersion: '1.0',
      formulaVersion: FORMULA_VERSION,
      reportType: 'trial-verification',
      generatedAt: new Date().toISOString(),
      scene: meta.scene || null,
      idea: meta.idea || '',
      baselineInputs: {
        price: baseline.price, raw: baseline.raw, pack: baseline.pack, loss: baseline.loss,
        fee: baseline.fee, sales: baseline.sales, hours: baseline.hours, days: baseline.days
      },
      records: (trials || []).map(function (t) {
        return { date: t.date, sales: +t.sales, revenue: +t.revenue, cost: +t.cost, hours: +t.hours, note: t.note || '' };
      }),
      comparison: {
        unitCost: { baseline: v.baseline.unitCost, actual: v.actual.unitCost, variance: v.variance.unitCostPct },
        unitMargin: { baseline: v.baseline.unitMargin, actual: v.actual.unitMargin, variance: v.variance.unitMarginPct },
        salesAvg: { baseline: v.baseline.salesAvg, actual: v.actual.salesAvg, variance: v.variance.salesPct },
        hourly: { baseline: v.baseline.hourly, actual: v.actual.hourly, variance: v.variance.hourlyPct }
      },
      advice: v.advice
    };
  }

  return {
    FORMULA_VERSION: FORMULA_VERSION,
    baselineUnitCost: baselineUnitCost,
    trialVariance: trialVariance,
    buildVerificationReport: buildVerificationReport,
    pctText: pctText
  };
});
