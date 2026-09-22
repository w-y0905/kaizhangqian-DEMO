/* 开张前 · 场景知识库测试  [P1-03] */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const KB = require(path.join(__dirname, '..', 'kz-scene-kb.js'));

test('关键词匹配到正确场景域', () => {
  assert.strictEqual(KB.matchDomain('我想在校园摆摊卖柠檬茶'), 'beverage');
  assert.strictEqual(KB.matchDomain('宿舍卖零食礼包'), 'retail');
  assert.strictEqual(KB.matchDomain('我想做大学生家教，每小时收费80元'), 'tutor');
  assert.strictEqual(KB.matchDomain('校园证件照摄影，修图交付'), 'photo');
  assert.strictEqual(KB.matchDomain('宿舍洗鞋服务'), 'wash');
  assert.strictEqual(KB.matchDomain('帮同学代取快递跑腿'), 'errand');
  assert.strictEqual(KB.matchDomain('宿舍美甲'), 'nail');
  assert.strictEqual(KB.matchDomain('摆摊卖烤肠和冰粉'), 'snack');
  assert.strictEqual(KB.matchDomain('宿舍楼下打印复印'), 'print');
  assert.strictEqual(KB.matchDomain('摆摊手机贴膜'), 'film');
  assert.strictEqual(KB.matchDomain('帮人代遛狗'), 'pet');
  assert.strictEqual(KB.matchDomain('校园摆摊卖乌梅夹小番茄'), 'snack');
  assert.strictEqual(KB.matchDomain('摆摊卖柠檬茶也会摆摊'), 'beverage');
});

test('匹配不到时回退 generic', () => {
  assert.strictEqual(KB.matchDomain('我想做一件没人听过的事'), 'generic');
  assert.strictEqual(KB.matchDomain(''), 'generic');
});

test('promptContext 含"仅供参考/禁止写入"约束，且 generic 返回空', () => {
  const ctx = KB.promptContext('我想摆摊卖柠檬茶');
  assert.ok(ctx.indexOf('柠檬') < 0); // 不把用户原文塞回去
  assert.ok(/参考/.test(ctx));
  assert.ok(/严禁把参考数字写入 fields/.test(ctx));
  assert.strictEqual(KB.promptContext('随便什么'), '');
});

test('promptContext 长度受控（< 400 字）', () => {
  Object.keys(KB.DOMAINS).forEach(k => {
    const ctx = KB.promptContext(KB.DOMAINS[k].keywords[0] || 'x');
    assert.ok(ctx.length < 400, k + ' 上下文过长: ' + ctx.length);
  });
});

test('每个域都有 label / questions / commonlyMissed', () => {
  Object.keys(KB.DOMAINS).forEach(k => {
    const d = KB.DOMAINS[k];
    assert.ok(d.label, k + ' 缺 label');
    assert.ok(Array.isArray(d.questions) && d.questions.length > 0, k + ' 缺 questions');
    assert.ok(Array.isArray(d.commonlyMissed), k + ' 缺 commonlyMissed');
  });
});

test('summary / fieldHints 结构正确', () => {
  const s = KB.summary('wash');
  assert.strictEqual(s.domain, 'wash');
  assert.ok(s.hints.length > 0);
  assert.ok(s.hints.every(h => h.range));
  assert.strictEqual(KB.summary('不存在').domain, 'generic');
});

test('知识库绝不包含可直接填入的字段对象（无 value 字段）', () => {
  Object.keys(KB.DOMAINS).forEach(k => {
    KB.DOMAINS[k].costItems.forEach(c => {
      assert.ok(!('value' in c), k + ' costItems 不应带 value');
    });
  });
});
