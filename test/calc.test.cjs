/* 开张前 · 确定性计算引擎测试  [P0-4]
 * 运行：node --test test/
 * 覆盖报告 C-01/C-05/C-06/C-07/C-08 与边界用例。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const KZCalc = require(path.join(__dirname, '..', 'kz-calc.js'));
const KZSchema = require(path.join(__dirname, '..', 'kz-schema.js'));
const calc = KZCalc.calc;

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const base = { price: 0, raw: 0, pack: 0, loss: 0, fee: 0, sales: 0, days: 20, rent: 0, other: 0, investment: 0, life: 24, hours: 0, wage: 0 };

test('C-01 完整饮品输入：结果与人工公式一致', () => {
  const x = { ...base, price: 8, raw: 3, pack: 0.5, loss: 10, fee: 0, sales: 30, days: 20, rent: 500, other: 200, investment: 2000, life: 24, hours: 3, wage: 20 };
  const r = calc(x, 1);
  near(r.q, 600);
  near(r.v, 3 / 0.9 + 0.5);            // 3.8333…
  near(r.margin, 8 - (3 / 0.9 + 0.5));
  near(r.fixed, 700);
  near(r.revenue, 4800);
  near(r.cash, 1800);
  near(r.dep, 2000 / 24);
  near(r.profit, 1800 - 2000 / 24);
  near(r.breakeven, 9.4);
  near(r.payback, 2000 / 1800);
  near(r.hourly, (1800 - 2000 / 24) / 60);
  near(r.economic, (1800 - 2000 / 24) - 60 * 20);
});

test('情景系数：0.8 / 1.2 线性缩放月交付量', () => {
  const x = { ...base, price: 8, raw: 3, sales: 30, days: 20, hours: 3 };
  near(calc(x, 0.8).q, 30 * 0.8 * 20);
  near(calc(x, 1.2).q, 30 * 1.2 * 20);
});

test('C-06 原料成本大于售价：单位边际为负，禁止保本/回本结论', () => {
  const x = { ...base, price: 3, raw: 8, sales: 10, days: 20 };
  const r = calc(x, 1);
  assert.ok(r.margin < 0, 'margin 应为负');
  assert.strictEqual(r.breakeven, null);
  assert.strictEqual(r.payback, null);
});

test('C-07 损耗率 0% 正常计算', () => {
  const x = { ...base, price: 10, raw: 4, loss: 0, sales: 10, days: 20 };
  near(calc(x, 1).v, 4);
  near(calc(x, 1).margin, 6);
});

test('C-07 损耗率 99%：成本被放大但不出现 Infinity/NaN', () => {
  const x = { ...base, price: 500, raw: 4, loss: 99, sales: 10, days: 20 };
  const r = calc(x, 1);
  assert.ok(Number.isFinite(r.v));
  near(r.v, 400, 1e-6);
});

test('C-08 折旧月数为 0 必须被 schema 拦截，不能产生 Infinity', () => {
  const bad = KZSchema.validateValue('life', 0);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'must-be-positive');
  const good = KZSchema.validateValue('life', 24);
  assert.strictEqual(good.ok, true);
});

test('C-08 设备投入为 0：可计算且折旧为 0', () => {
  const x = { ...base, price: 10, raw: 4, sales: 10, days: 20, investment: 0, life: 24 };
  const r = calc(x, 1);
  near(r.dep, 0);
  assert.strictEqual(r.payback, 0); // 投入 0、现金结余为正 → 0/1200 = 0
});

test('现金结余为负时回收期为 null（无法回本）', () => {
  const x = { ...base, price: 5, raw: 5, sales: 10, days: 20, rent: 1000 };
  const r = calc(x, 1);
  assert.ok(r.cash < 0);
  assert.strictEqual(r.payback, null);
});

test('工时大于 0 时折合时薪 = 扣折旧盈余 ÷ 总工时', () => {
  const x = { ...base, price: 10, raw: 4, sales: 10, days: 20, hours: 5 };
  const r = calc(x, 1);
  near(r.hours === undefined ? 5 * 20 : x.hours * x.days, 100);
  near(r.hourly, r.profit / 100);
});

test('经济盈余 = 扣折旧盈余 − 总工时 × 机会成本时薪', () => {
  const x = { ...base, price: 10, raw: 4, sales: 10, days: 20, hours: 5, wage: 30 };
  const r = calc(x, 1);
  near(r.economic, r.profit - 100 * 30);
});
