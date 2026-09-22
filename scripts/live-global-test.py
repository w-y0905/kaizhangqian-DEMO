#!/usr/bin/env python3
# 开张前 · 线上全局功能测试
import json, urllib.request, urllib.error, sys

BASE = 'https://wyzyw.icu/kaizhangqian'
PASS = FAIL = 0
def ok(c, msg):
    global PASS, FAIL
    if c: PASS += 1; print('  ✅ ' + msg)
    else: FAIL += 1; print('  ❌ ' + msg)

def get(path):
    try:
        r = urllib.request.urlopen(BASE + path, timeout=30)
        return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)
    except Exception as e:
        return 0, str(e).encode(), {}

def post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode(), headers={'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=60)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read())
        except Exception: body = {}
        return e.code, body

print('【1】健康检查 / 版本')
st, body, _ = get('/health')
h = json.loads(body)
ok(st == 200, f'GET /health -> {st}')
ok(h.get('schemaVersion') == '1.0' and h.get('formulaVersion') == '1.0', 'schema/formula = 1.0')
ok(h.get('kbVersion') == '1.0', 'kbVersion = 1.0')
ok(h.get('rateLimit', {}).get('enabled') is True, '限流已开启')

print('【2】静态资源 / 页面')
for p in ['/', '/kz-schema.js', '/kz-calc.js', '/kz-trial.js', '/kz-compare.js']:
    st, body, hd = get(p)
    ok(st == 200, f'GET {p} -> {st}')
st, body, _ = get('/nonexistent-xyz')
ok(st == 404, f'未知路径 -> {st}（期望 404）')

print('【3】接口契约')
st, b = post('/api/extract', {})
ok(st == 400 and b.get('error', {}).get('code') == 'INVALID_REQUEST', f'缺 text -> {st} INVALID_REQUEST')
st, _, hd = 0, None, {}
try:
    req = urllib.request.Request(BASE + '/api/extract', data=json.dumps({'text': 'x' * 25000}).encode(), headers={'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=30); st = r.status
    except urllib.error.HTTPError as e: st = e.code
except Exception: st = 0
ok(st == 413, f'超大请求体 -> {st}（期望 413）')

print('【4】5 类预设置信（缓存命中）')
presets = {
    'lemon': ('我想在校园摆摊卖柠檬茶，一杯卖8元，原料成本3元，每天卖30杯，每月营业20天，摊位费每月500元。', {'price':8,'sales':30,'days':20,'raw':3}),
    'snack': ('我想在宿舍卖零食礼包，每份卖15元，进货成本8元，每天预计卖20份，每月营业18天。', {'price':15,'sales':20,'days':18,'raw':8}),
    'tutor': ('我想做大学生家教，每小时收费80元，每周接6小时，每周授课2天，每月授课4周，没有场地费。', {'price':80,'sales':3,'days':8}),
    'photo': ('我想在校园做证件照和毕业照摄影，每单平均收费60元，相纸和打印成本8元，每天接8单，每月服务22天，设备投入6000元，每天工作5小时。', {'price':60,'sales':8,'days':22,'raw':8}),
    'wash':  ('我想在宿舍做洗鞋服务，每双收费25元，每天接12双，每月服务22天，清洁剂和包装成本5元，设备投入1500元，每天工作4小时。', {'price':25,'sales':12,'days':22,'raw':5}),
}
for name, (text, exp) in presets.items():
    st, d = post('/api/extract', {'text': text})
    f = d.get('fields', {})
    bad = [k for k, v in exp.items() if (f.get(k) or {}).get('value') != v]
    ok(st == 200 and not bad, f'{name}: {exp}' + ('' if not bad else f' 不符 {bad}'))
# 家教 wage 不应被误填
_, d = post('/api/extract', {'text': presets['tutor'][0]})
ok('wage' not in d.get('fields', {}), '家教：wage 未被误填')

print('【5】边界用例（T-01/T-02）')
st, d = post('/api/extract', {'text': '我想在宿舍帮人遛狗，每次收费15元，每周工作4天，每天接3单。'})
ok('days' in (d.get('blocked') or []), '「每周4天」缺月周数 -> days blocked')
ok((d.get('fields', {}).get('days') or {}).get('value') is None, 'days 值被置空')
st, d = post('/api/extract', {'text': '我想在宿舍帮人遛狗，每次收费15元，每周工作4天，每月4周，每天接3单。'})
ok((d.get('fields', {}).get('days') or {}).get('value') == 16, '「每周4天×每月4周」-> 16 天/月')
st, d = post('/api/extract', {'text': '我想帮人遛狗，自己的兼职时薪按20元算，按这个算机会成本。'})
ok('wage' in d.get('fields', {}), '有「兼职时薪」证据 -> wage 保留')

print('【6】场景知识库（KB）')
st, d = post('/api/extract', {'text': presets['wash'][0]})
ok((d.get('kb') or {}).get('domain') == 'wash', '洗鞋 -> kb=wash')
ok(len((d.get('kb') or {}).get('hints', [])) > 0, '返回参考区间 hints')
ok(all('value' not in h for h in (d.get('kb') or {}).get('hints', [])), 'hints 不带 value（不自动填）')

print('【7】演示模式')
st, d = post('/api/extract', {'text': presets['lemon'][0], 'demo': True})
ok(st == 200 and str(d.get('mode')).startswith('demo-'), f'demo 请求 -> mode={d.get("mode")}')

print()
print(f'结果：{PASS} 通过 / {FAIL} 失败')
sys.exit(1 if FAIL else 0)
