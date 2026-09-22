/* 开张前 · 标准化数据合同测试  [P0-2 / P0-3]
 * 运行：node --test test/
 * 覆盖报告 T-01/T-02/T-04 与单位换算边界。 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const S = require(path.join(__dirname, '..', 'kz-schema.js'));

test('T-02 每周 4 天 + 每月 4 周 → 16 天/月', () => {
  const text = '我想在宿舍遛狗，每周工作 4 天，每月 4 周。';
  const out = S.canonicalize({ days: { value: 4, unit: '天/周', sourceText: '每周工作 4 天' } }, text, { mode: 'ai' });
  assert.strictEqual(out.fields.days.value, 16);
  assert.strictEqual(out.fields.days.unit, '天/月');
  assert.strictEqual(out.blocked.length, 0);
});

test('T-02 只有「每周 4 天」、缺每月周数 → blocked，不得静默按天/月使用', () => {
  const text = '我想在宿舍遛狗，每周工作 4 天。';
  const out = S.canonicalize({ days: { value: 4, unit: '天/周', sourceText: '每周工作 4 天' } }, text, { mode: 'ai' });
  assert.ok(out.blocked.includes('days'));
  assert.strictEqual(out.fields.days.blocked, true);
  assert.strictEqual(out.fields.days.value, null);
  assert.ok(out.questions.some(q => /每月/.test(q)));
});

test('T-02 正常「每月营业 20 天」不触发换算', () => {
  const text = '柠檬茶每天卖 30 杯，每月营业 20 天。';
  const out = S.canonicalize({ days: { value: 20, unit: '天/月', sourceText: '每月营业 20 天' } }, text, { mode: 'ai' });
  assert.strictEqual(out.fields.days.value, 20);
  assert.strictEqual(out.blocked.length, 0);
});

test('家教「每周 6 小时 / 每周 2 天」→ 3 小时/天', () => {
  const text = '大学生家教，每周接 6 小时，每周授课 2 天。';
  const out = S.canonicalize({ sales: { value: 6, unit: '小时/周', sourceText: '每周接 6 小时' } }, text, { mode: 'ai' });
  assert.strictEqual(out.fields.sales.value, 3);
  assert.strictEqual(out.fields.sales.unit, '小时/天');
});

test('已换算过的字段（含 ×／÷ 标记 + 天/月单位）不会被二次换算', () => {
  const text = '家教，每周接 6 小时，每周授课 2 天，每月授课 4 周。';
  const out = S.canonicalize({
    sales: { value: 3, unit: '小时/天', sourceText: '每周接 6 小时 ÷ 每周服务 2 天' },
    days: { value: 8, unit: '天/月', sourceText: '每月授课 4 周 × 每周服务 2 天' }
  }, text, { mode: 'ai' });
  assert.strictEqual(out.fields.sales.value, 3);
  assert.strictEqual(out.fields.days.value, 8);
});

test('T-01「每小时收费 80 元」不得自动填入 wage', () => {
  const text = '我想做大学生家教，每小时收费 80 元。';
  const out = S.canonicalize({
    price: { value: 80, unit: '元/小时', sourceText: '每小时收费 80 元' },
    wage: { value: 80, unit: '元/小时', sourceText: '每小时收费 80 元' }
  }, text, { mode: 'ai' });
  assert.ok(!('wage' in out.fields), 'wage 应被证据门丢弃');
  assert.strictEqual(out.fields.price.value, 80);
  assert.ok(out.questions.some(q => /机会成本/.test(q)));
});

test('T-01「兼职时薪 20 元」有明确证据 → 保留 wage', () => {
  const text = '我想做大学生家教，每小时收费 80 元，自己的兼职时薪按 20 元算。';
  const out = S.canonicalize({ wage: { value: 20, unit: '元/小时', sourceText: '兼职时薪按 20 元' } }, text, { mode: 'ai' });
  assert.strictEqual(out.fields.wage.value, 20);
});

test('T-04 来源短句能在原文找到 → AI 识别；找不到 → AI 推断', () => {
  const found = S.canonicalize({ price: { value: 8, sourceText: '一杯卖 8 元' } }, '校园柠檬茶一杯卖 8 元', { mode: 'ai' });
  assert.strictEqual(found.fields.price.sourceType, 'ai');
  const guessed = S.canonicalize({ price: { value: 8, sourceText: '售价 8 元' } }, '校园柠檬茶一杯 8 元', { mode: 'ai' });
  assert.strictEqual(guessed.fields.price.sourceType, 'inferred');
});

test('无来源短句的字段一律标记 AI 推断', () => {
  const out = S.canonicalize({ raw: { value: 3 } }, '柠檬茶成本 3 元', { mode: 'ai' });
  assert.strictEqual(out.fields.raw.sourceType, 'inferred');
});

test('0 占位且无来源 → 视为未识别，不进入字段', () => {
  const out = S.canonicalize({ rent: { value: 0, unit: '元/月', sourceText: '' } }, '宿舍摆摊', { mode: 'ai' });
  assert.ok(!('rent' in out.fields));
});

test('取值范围校验：损耗 100% / 工时 25 / 天数 4.5 / 天数 35 全部拦截', () => {
  assert.strictEqual(S.validateValue('loss', 100).ok, false);
  assert.strictEqual(S.validateValue('hours', 25).ok, false);
  assert.strictEqual(S.validateValue('days', 4.5).ok, false);
  assert.strictEqual(S.validateValue('days', 35).ok, false);
  assert.strictEqual(S.validateValue('fee', 101).ok, false);
  assert.strictEqual(S.validateValue('days', 20).ok, true);
  assert.strictEqual(S.validateValue('hours', 24).ok, true);
});

test('越界字段被 canonicalize 标记 blocked', () => {
  const out = S.canonicalize({ loss: { value: 100, sourceText: '损耗 100%' } }, '损耗 100%', { mode: 'ai' });
  assert.ok(out.blocked.includes('loss'));
  assert.strictEqual(out.fields.loss.blocked, true);
});

test('显示单位带上交易单位：杯 / 双 / 小时', () => {
  assert.strictEqual(S.displayUnit('price', '杯'), '元/杯');
  assert.strictEqual(S.displayUnit('sales', '双'), '双/天');
  assert.strictEqual(S.displayUnit('days', '杯'), '天/月');
  assert.strictEqual(S.displayUnit('price', ''), '元/交易单位');
});
