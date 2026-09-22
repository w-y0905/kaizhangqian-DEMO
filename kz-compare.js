/*!
 * 开张前 · 方案对比 (plan comparison) v1.0   [P1-04]
 *
 * 复用 kz-calc 的确定性口径，把 2–4 个已保存方案摊到同一张表上比较。
 * 纯函数，无 DOM；Node（server/测试）与浏览器共用。
 * 不修改 calc 口径。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kz-calc.js'));
  else root.KZCompare = factory(root.KZCalc);
})(typeof self !== 'undefined' ? self : this, function (KZCalc) {
  'use strict';

  var FORMULA_VERSION = '1.0';

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  // 从方案对象里取输入：兼容 {values} 与 {inputs} 两种快照
  function planValues(p) {
    return (p && (p.values || p.inputs)) || {};
  }

  function metricsOf(values) {
    var r = KZCalc.calc(values, 1);
    return {
      cash: r.cash,
      profit: r.profit,
      margin: r.margin,
      unitMargin: r.margin,
      breakeven: r.breakeven,
      payback: r.payback,
      hourly: r.hourly,
      economic: r.economic,
      marginPct: values.price > 0 ? r.margin / values.price : 0
    };
  }

  /**
   * comparePlans(plans) -> { count, rows, best, ranking }
   * plans: [{ name, scene:{label,unit}, values|inputs }]
   */
  function comparePlans(plans) {
    var list = (plans || []).filter(Boolean).slice(0, 8);
    var rows = list.map(function (p, i) {
      var values = planValues(p);
      return {
        index: i,
        name: (p && p.name) || ('方案 ' + (i + 1)),
        scene: (p && p.scene && (p.scene.label || p.scene)) || '',
        unit: (p && p.scene && p.scene.unit) || '',
        metrics: metricsOf(values)
      };
    });

    var best = { cash: -1, profit: -1, hourly: -1 };
    rows.forEach(function (row, i) {
      if (best.cash < 0 || row.metrics.cash > rows[best.cash].metrics.cash) best.cash = i;
      if (best.profit < 0 || row.metrics.profit > rows[best.profit].metrics.profit) best.profit = i;
      if (best.hourly < 0 || row.metrics.hourly > rows[best.hourly].metrics.hourly) best.hourly = i;
    });

    var ranking = rows.slice().sort(function (a, b) { return b.metrics.profit - a.metrics.profit; })
      .map(function (r) { return r.index; });

    return { count: rows.length, rows: rows, best: best, ranking: ranking };
  }

  return { FORMULA_VERSION: FORMULA_VERSION, comparePlans: comparePlans, metricsOf: metricsOf };
});
