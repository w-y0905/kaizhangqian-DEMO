#!/usr/bin/env node
/*
 * 开张前 · P0 修复验证脚本  (node scripts/verify-p0.mjs)
 *
 * 无需真实 API：内置 mock 上游返回固定模型输出，另起一个「上游不可达」的实例验证离线回退。
 * 覆盖：
 *   1) /health 暴露 schemaVersion / formulaVersion
 *   2) kz-schema.js / kz-calc.js 可被前端加载（HTTP 200）
 *   3) 离线回退（upstream 不可达）→ rules，字段仍带 sourceType
 *   4) T-02「每周 4 天」缺每月周数 → days blocked
 *   5) T-02「每周 4 天 + 每月 4 周」→ 换算 16 天/月
 *   6) T-01 wage 证据门：无证据丢弃，有证据保留
 * 全过退出码 0，否则 1。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT_AI = 8797;      // 上游=mock
const PORT_OFF = 8796;     // 上游不可达 → rules 回退
const PORT_DEMO = 8795;    // 演示模式（不调在线 AI）
const PORT_LIMIT = 8794;   // 限流（小阀值）
const MOCK = 8798;
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

// ── mock 上游：模拟模型返回「每周工作4天」的字段 ──
const MODEL = JSON.stringify({
  title: '宠物代遛',
  relevant: ['price', 'sales', 'raw', 'hours'],
  scene: { key: 'other' },
  fields: {
    price: { value: 15, unit: '元/次', sourceText: '每次收费15元', confidence: 0.9 },
    days: { value: 4, unit: '天/周', sourceText: '每周工作4天', confidence: 0.8 },
    wage: { value: 15, unit: '元/小时', sourceText: '每次收费15元', confidence: 0.4 }
  },
  questions: [], assumptions: [], recommendation: ''
});
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: MODEL } }] }));
  });
});
await new Promise(r => mock.listen(MOCK, '127.0.0.1', r));

function startServer(port, upstream, extraEnv) {
  return spawn(process.execPath, ['server.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port),
      DEEPSEEK_BASE_URL: upstream, DEEPSEEK_API_KEY: 'verify-key',
      OPENCLAW_URL: upstream, AI_TIMEOUT_MS: '3000', CACHE_TTL_MS: '0',
      ...(extraEnv || {})
    },
    stdio: 'ignore'
  });
}
async function waitUp(port) {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/health'); if (r.ok) return base; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return base;
}

const childAI = startServer(PORT_AI, `http://127.0.0.1:${MOCK}`);
const childOff = startServer(PORT_OFF, 'http://127.0.0.1:9');
const childDemo = startServer(PORT_DEMO, `http://127.0.0.1:${MOCK}`, { DEMO_MODE: '1' });
const childLimit = startServer(PORT_LIMIT, 'http://127.0.0.1:9', { RATE_LIMIT_PER_IP: '2', RATE_LIMIT_WINDOW_MS: '60000', RATE_LIMIT_GLOBAL: '1000' });
const ai = await waitUp(PORT_AI);
const off = await waitUp(PORT_OFF);
const demo = await waitUp(PORT_DEMO);
const limit = await waitUp(PORT_LIMIT);
const api = (base, p, body) => fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);

try {
  console.log('【1】/health 版本号');
  const h = await (await fetch(ai + '/health')).json();
  ok(h.schemaVersion === '1.0', `schemaVersion = ${h.schemaVersion}`);
  ok(h.formulaVersion === '1.0', `formulaVersion = ${h.formulaVersion}`);
  ok(h.kbVersion === '1.0', `kbVersion = ${h.kbVersion}`);

  console.log('【2】静态模块可加载');
  const s1 = await fetch(ai + '/kz-schema.js');
  const s2 = await fetch(ai + '/kz-calc.js');
  const s3 = await fetch(ai + '/kz-trial.js');
  const s4 = await fetch(ai + '/kz-compare.js');
  ok(s1.status === 200 && /javascript/.test(s1.headers.get('content-type') || ''), 'kz-schema.js 200 + js');
  ok(s2.status === 200 && /javascript/.test(s2.headers.get('content-type') || ''), 'kz-calc.js 200 + js');
  ok(s3.status === 200 && /javascript/.test(s3.headers.get('content-type') || ''), 'kz-trial.js 200 + js');
  ok(s4.status === 200 && /javascript/.test(s4.headers.get('content-type') || ''), 'kz-compare.js 200 + js');

  console.log('【3】离线回退（上游不可达 → rules）');
  const rr = await (await api(off, '/api/extract', { text: '我想在宿舍帮人遛狗，每次收费15元，每天接3单。' })).json();
  ok(rr.mode === 'rules', `mode = ${rr.mode}`);
  ok(rr.fields?.price?.sourceType === 'rules', '字段带 sourceType=rules');
  ok(rr.schemaVersion === '1.0' && rr.formulaVersion === '1.0', '响应带 schema/formula 版本');

  console.log('【4】T-02 每周 4 天、缺每月周数 → days blocked');
  const b1 = await (await api(ai, '/api/extract', { text: '我想在宿舍帮人遛狗，每次收费15元，每周工作4天，每天接3单。' })).json();
  ok((b1.blocked || []).includes('days'), 'blocked 含 days');
  ok(b1.fields?.days?.blocked === true && b1.fields?.days?.value === null, 'days 被拦截、值置空');
  ok((b1.missing || []).includes('days'), 'missing 含 days（要求用户补充）');

  console.log('【5】T-02 每周 4 天 + 每月 4 周 → 16 天/月');
  const b2 = await (await api(ai, '/api/extract', { text: '我想在宿舍帮人遛狗，每次收费15元，每周工作4天，每月4周，每天接3单。' })).json();
  ok(b2.fields?.days?.value === 16, `days = ${b2.fields?.days?.value}`);
  ok(b2.fields?.days?.sourceType === 'converted', `sourceType = ${b2.fields?.days?.sourceType}`);

  console.log('【6】T-01 wage 证据门');
  const w1 = await (await api(ai, '/api/extract', { text: '我想在宿舍帮人遛狗，每次收费15元，每周工作4天，每月4周。' })).json();
  ok(!('wage' in (w1.fields || {})), '无「时薪」证据 → wage 被丢弃');
  const w2 = await (await api(ai, '/api/extract', { text: '我想帮人遛狗，自己的兼职时薪按20元算，按这个算机会成本。' })).json();
  ok(w2.fields?.wage?.value === 15, '有「兼职时薪」证据 → wage 保留（mock 值 15）');

  console.log('【7】T-07 演示模式（DEMO_MODE=1，不调在线 AI）');
  const dh = await (await fetch(demo + '/health')).json();
  ok(dh.demoMode === true, `health.demoMode = ${dh.demoMode}`);
  const dr = await (await api(demo, '/api/extract', { text: '我想在宿舍做洗鞋服务，每双收费25元，每天接12双，每月服务22天，清洁剂和包装成本5元。' })).json();
  ok(/^demo-/.test(String(dr.mode)), `演示模式不走在线 AI（mode=${dr.mode}）`);
  ok(dr.fields && Object.keys(dr.fields).length > 0, '演示模式仍返回规范化字段');
  const d2 = await (await api(demo, '/api/extract', { text: '我想在校园摆摊卖柠檬茶，一杯卖8元，原料成本3元，每天卖30杯，每月营业20天，摊位费每月500元。' })).json();
  ok(d2.fields?.price?.value === 8, '演示模式预设场景可出字段');

  console.log('【8】T-10 限流（RATE_LIMIT_PER_IP=2）');
  const limitHit = async (text) => { const r = await api(limit, '/api/extract', { text }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  const l1 = await limitHit('限流测试文本一');
  const l2 = await limitHit('限流测试文本二');
  const l3 = await limitHit('限流测试文本三');
  ok(l1.status === 200 && l2.status === 200, `前 2 次放行（${l1.status}/${l2.status}）`);
  ok(l3.status === 429, `第 3 次返回 429（实际 ${l3.status}）`);
  ok(l3.json?.error?.code === 'RATE_LIMITED', '429 响应体带 RATE_LIMITED');

  console.log('【9】P1-03 场景知识库');
  const kbR = await (await api(ai, '/api/extract', { text: '我想在宿舍做洗鞋服务，每双收费25元，每天接12双，每月服务22天，清洁剂和包装成本5元。' })).json();
  ok(kbR.kb && kbR.kb.domain === 'wash', `kb.domain = ${kbR.kb && kbR.kb.domain}`);
  ok(kbR.kb && Array.isArray(kbR.kb.hints) && kbR.kb.hints.length > 0, '返回参考区间 hints');
  ok(kbR.kb && !('value' in (kbR.kb.hints[0] || {})), 'hints 不带 value（不会自动填入）');
} catch (e) {
  fail++; console.log('  ❌ 异常: ' + (e && e.message));
} finally {
  childAI.kill('SIGTERM'); childOff.kill('SIGTERM'); childDemo.kill('SIGTERM'); childLimit.kill('SIGTERM'); mock.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
