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

function startServer(port, upstream) {
  return spawn(process.execPath, ['server.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port),
      DEEPSEEK_BASE_URL: upstream, DEEPSEEK_API_KEY: 'verify-key',
      OPENCLAW_URL: upstream, AI_TIMEOUT_MS: '3000', CACHE_TTL_MS: '0'
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
const ai = await waitUp(PORT_AI);
const off = await waitUp(PORT_OFF);
const api = (base, p, body) => fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);

try {
  console.log('【1】/health 版本号');
  const h = await (await fetch(ai + '/health')).json();
  ok(h.schemaVersion === '1.0', `schemaVersion = ${h.schemaVersion}`);
  ok(h.formulaVersion === '1.0', `formulaVersion = ${h.formulaVersion}`);

  console.log('【2】静态模块可加载');
  const s1 = await fetch(ai + '/kz-schema.js');
  const s2 = await fetch(ai + '/kz-calc.js');
  ok(s1.status === 200 && /javascript/.test(s1.headers.get('content-type') || ''), 'kz-schema.js 200 + js');
  ok(s2.status === 200 && /javascript/.test(s2.headers.get('content-type') || ''), 'kz-calc.js 200 + js');

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
} catch (e) {
  fail++; console.log('  ❌ 异常: ' + (e && e.message));
} finally {
  childAI.kill('SIGTERM'); childOff.kill('SIGTERM'); mock.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
