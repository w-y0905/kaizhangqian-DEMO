/*!
 * 开张前 · 确定性计算引擎 (deterministic financial model) v1.0   [P0-4]
 *
 * 纯函数，无 DOM 依赖，无副作用。Node（server.cjs / 测试）与浏览器（index.html）共用同一实现，
 * 保证「测试通过的公式」与「页面展示的公式」逐字一致。
 *
 * 口径：
 *   q        = 日交付量 × 情景系数 × 月营业天数            （每月总交付量）
 *   v        = raw ÷ (1 − loss%) + pack + price × fee%      （单位变动成本，含损耗与抽成）
 *   margin   = price − v                                    （单位边际贡献）
 *   fixed    = rent + other                                 （月固定现金支出）
 *   revenue  = q × price
 *   cash     = q × margin − fixed                           （月经营现金结余，未扣折旧）
 *   dep      = investment ÷ life                            （月折旧）
 *   profit   = cash − dep                                   （扣折旧后月盈余）
 *   breakeven= (fixed + dep) ÷ margin ÷ days （margin>0；否则 null＝无法保本）
 *   hours    = hours × days
 *   payback  = investment ÷ cash （cash>0；否则 null＝无法回本）
 *   hourly   = profit ÷ hours
 *   economic = profit − hours × wage                        （计入时间机会成本后的经济盈余）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KZCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMULA_VERSION = '1.0';

  function calc(x, f) {
    if (f == null) f = 1;
    var q = x.sales * f * x.days;
    var v = x.raw / (1 - x.loss / 100) + x.pack + x.price * x.fee / 100;
    var margin = x.price - v;
    var fixed = x.rent + x.other;
    var revenue = q * x.price;
    var cash = q * margin - fixed;
    var dep = x.investment / x.life;
    var profit = cash - dep;
    var breakeven = margin > 0 ? (fixed + dep) / margin / x.days : null;
    var hours = x.hours * x.days;
    return {
      q: q,
      v: v,
      margin: margin,
      fixed: fixed,
      revenue: revenue,
      cash: cash,
      dep: dep,
      profit: profit,
      breakeven: breakeven,
      payback: cash > 0 ? x.investment / cash : null,
      hourly: hours > 0 ? profit / hours : 0,
      economic: profit - hours * x.wage
    };
  }

  return { FORMULA_VERSION: FORMULA_VERSION, calc: calc };
});
