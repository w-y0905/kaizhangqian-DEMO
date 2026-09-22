/* 开张前 · 方案对比测试  [P1-04] */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const C = require(path.join(__dirname, '..', 'kz-compare.js'));
const KZCalc = require(path.join(__dirname, '..', 'kz-calc.js'));

const P = (name, values) => ({ name, scene: { label: '测试', unit: '份' }, values });

test('对比两个方案：指标与 calc 一致', () => {
  const v1 = { price: 10, raw: 4, pack: 0, loss: 0, fee: 0, sales: 10, days: 20, rent: 0, other: 0, investment: 0, life: 24, hours: 2, wage: 0 };
  const v2 = { ...v1, raw: 8 };
  const res = C.comparePlans([P('A', v1), P('B', v2)]);
  assert.strictEqual(res.count, 2);
  assert.strictEqual(res.rows[0].metrics.cash, KZCalc.calc(v1, 1).cash);
  assert.strictEqual(res.rows[1].metrics.cash, KZCalc.calc(v2, 1).cash);
});

test('最优方案识别（cash / profit / hourly）', () => {
  const good = { price: 10, raw: 3, pack: 0, loss: 0, fee: 0, sales: 20, days: 20, rent: 0, other: 0, investment: 0, life: 24, hours: 2, wage: 0 };
  const bad = { ...good, raw: 9 };
  const res = C.comparePlans([P('好', good), P('差', bad)]);
  assert.strictEqual(res.best.cash, 0);
  assert.strictEqual(res.best.profit, 0);
  assert.strictEqual(res.best.hourly, 0);
  assert.deepStrictEqual(res.ranking, [0, 1]);
});

test('兼容 inputs 字段（新快照）', () => {
  const v = { price: 8, raw: 3, pack: 0.5, loss: 10, fee: 0, sales: 30, days: 20, rent: 500, other: 200, investment: 2000, life: 24, hours: 3, wage: 20 };
  const res = C.comparePlans([{ name: '柠檬茶', inputs: v }]);
  assert.strictEqual(res.rows[0].metrics.cash, KZCalc.calc(v, 1).cash);
});

test('空输入与上限（最多 8 个）', () => {
  assert.strictEqual(C.comparePlans([]).count, 0);
  const many = Array.from({ length: 12 }, (_, i) => P('P' + i, { price: 10, raw: 4, sales: 10, days: 20, hours: 2, life: 24 }));
  assert.strictEqual(C.comparePlans(many).count, 8);
});
