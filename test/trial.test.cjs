/* 开张前 · 试卖对照测试  [P0-5 / T-06 / C-10]
 * 运行：node --test test/
 * 校准案例取自《开张前项目计划书》第五章表 8：乌梅小番茄 12 次出摊总账。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const T = require(path.join(__dirname, '..', 'kz-trial.js'));
const r2 = n => Math.round(n * 100) / 100;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('真实案例：乌梅小番茄 12 次出摊 → 实际单位成本 ≈ 2.47 元/盒', () => {
  // 12 次均摊口径（计划书未保留逐晚明细）：总销量 194、总收入 1281.27、食材成本 480、总工时 36
  const per = r => Array.from({ length: 12 }, () => ({ sales: 194 / 12, revenue: 1281.27 / 12, cost: 480 / 12, hours: 36 / 12 }));
  const v = T.trialVariance({ price: 6.6, raw: 2.47, pack: 0, loss: 0, fee: 0, sales: 16, hours: 3 }, per());
  near(r2(v.actual.unitCost), 2.47, 0.005);          // 与计划书「真实食材成本约 2.47 元/盒」对齐
  near(r2(v.actual.unitMargin), 4.13, 0.005);        // 单位边际 ≈ 4.13
  near(r2(v.actual.salesAvg), 16.17, 0.01);          // 次均 ≈ 16 盒
  assert.strictEqual(v.days, 12);
  // 成本估算准确时，实测与假设基本吻合 → 结论「口径可信」
  assert.ok(v.advice.some(a => /口径基本可信/.test(a)));
});

test('真实案例对照：新手自估 5 元/盒 → 实际成本被高估，模型会偏悲观', () => {
  const per = () => Array.from({ length: 12 }, () => ({ sales: 194 / 12, revenue: 1281.27 / 12, cost: 480 / 12, hours: 36 / 12 }));
  const v = T.trialVariance({ price: 6.6, raw: 5, pack: 0, loss: 0, fee: 0, sales: 16, hours: 3 }, per());
  // 基准 5 元 vs 实际 2.47 元 → 偏差约 -50%
  assert.ok(v.variance.unitCostPct < -0.4, `unitCostPct=${v.variance.unitCostPct}`);
  assert.ok(v.advice.some(a => /实际单位成本比假设低/.test(a)));
});

test('C-10 三天实测与假设一致（偏差 0）→ 结论「口径可信」', () => {
  const baseline = { price: 10, raw: 4, pack: 0, loss: 0, fee: 0, sales: 10, hours: 2 };
  const trials = [
    { sales: 10, revenue: 100, cost: 40, hours: 2 },
    { sales: 10, revenue: 100, cost: 40, hours: 2 },
    { sales: 10, revenue: 100, cost: 40, hours: 2 }
  ];
  const v = T.trialVariance(baseline, trials);
  assert.strictEqual(v.days, 3);
  near(v.actual.unitCost, 4);
  near(v.actual.unitMargin, 6);
  near(v.actual.hourly, 30);          // (300-120)/6
  near(v.baseline.hourly, 30);        // 6×10/2
  near(v.variance.unitCostPct, 0);
  near(v.variance.hourlyPct, 0);
  assert.ok(v.advice.some(a => /口径基本可信/.test(a)));
});

test('实际单位成本偏高 → 生成「复核原料/损耗」建议', () => {
  const baseline = { price: 10, raw: 4, pack: 0, loss: 0, fee: 0, sales: 10, hours: 2 };
  const trials = [{ sales: 10, revenue: 100, cost: 60, hours: 2 }];
  const v = T.trialVariance(baseline, trials);
  near(v.variance.unitCostPct, 0.5, 1e-9);
  assert.ok(v.advice.some(a => /实际单位成本比假设高/.test(a)));
});

test('实际销量偏低 → 生成「下调销量/扩大客源」建议', () => {
  const baseline = { price: 10, raw: 4, pack: 0, loss: 0, fee: 0, sales: 20, hours: 2 };
  const trials = [{ sales: 10, revenue: 100, cost: 40, hours: 2 }];
  const v = T.trialVariance(baseline, trials);
  near(v.variance.salesPct, -0.5, 1e-9);
  assert.ok(v.advice.some(a => /实际日均销量比假设低/.test(a)));
});

test('无实测记录 → 提示先记录 3 天', () => {
  const v = T.trialVariance({ price: 10, raw: 4, pack: 0, loss: 0, fee: 0, sales: 10, hours: 2 }, []);
  assert.strictEqual(v.days, 0);
  assert.ok(v.advice.some(a => /至少 3 天/.test(a)));
});

test('验证报告结构完整（可导出 JSON）', () => {
  const baseline = { price: 6.6, raw: 2.5, pack: 0.5, loss: 10, fee: 0, sales: 16, hours: 3, days: 6 };
  const trials = [{ date: '2025-03-31', sales: 60, revenue: 396, cost: 148, hours: 3, note: '首晚' }];
  const rep = T.buildVerificationReport(baseline, trials, { scene: { key: 'other', unit: '盒' }, idea: '乌梅小番茄' });
  assert.strictEqual(rep.reportType, 'trial-verification');
  assert.strictEqual(rep.formulaVersion, '1.0');
  assert.ok(rep.comparison.unitCost.baseline > 0);
  assert.ok(rep.comparison.unitCost.actual > 0);
  assert.strictEqual(rep.records.length, 1);
  assert.ok(Array.isArray(rep.advice));
  assert.ok(rep.generatedAt);
});
