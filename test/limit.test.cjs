/* 开张前 · 限流器测试  [P1-02 / T-10] */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { createLimiter } = require(path.join(__dirname, '..', 'kz-limit.js'));

test('窗口内达到上限后拒绝，并给出 retryAfterMs', () => {
  const l = createLimiter({ limit: 3, windowMs: 10000 });
  const t0 = 1000;
  assert.strictEqual(l.check('ip1', t0).allowed, true);
  assert.strictEqual(l.check('ip1', t0 + 1).allowed, true);
  const third = l.check('ip1', t0 + 2);
  assert.strictEqual(third.allowed, true);
  assert.strictEqual(third.remaining, 0);
  const fourth = l.check('ip1', t0 + 3);
  assert.strictEqual(fourth.allowed, false);
  assert.ok(fourth.retryAfterMs > 0 && fourth.retryAfterMs <= 10000);
});

test('窗口滑出后重新放行', () => {
  const l = createLimiter({ limit: 1, windowMs: 1000 });
  assert.strictEqual(l.check('ip', 0).allowed, true);
  assert.strictEqual(l.check('ip', 500).allowed, false);
  assert.strictEqual(l.check('ip', 1001).allowed, true); // 第一条已滑出窗口
});

test('不同 key 互不影响', () => {
  const l = createLimiter({ limit: 1, windowMs: 1000 });
  assert.strictEqual(l.check('a', 0).allowed, true);
  assert.strictEqual(l.check('b', 0).allowed, true);
  assert.strictEqual(l.check('a', 1).allowed, false);
});

test('peek 不计数', () => {
  const l = createLimiter({ limit: 2, windowMs: 1000 });
  l.check('k', 0);
  assert.strictEqual(l.peek('k', 1).used, 1);
  assert.strictEqual(l.peek('k', 1).used, 1); // 仍为 1，未增长
});

test('key 数量超 maxKeys 时淘汰最早的 key（内存有界）', () => {
  const l = createLimiter({ limit: 5, windowMs: 100000, maxKeys: 2 });
  l.check('a', 0); l.check('b', 1); l.check('c', 2);
  assert.strictEqual(l.size(), 2);
  assert.strictEqual(l.peek('a', 3).used, 0); // a 已被淘汰
});
