/*!
 * 开张前 · 标准化数据合同 (canonical schema) v1.0   [P0-2 / P0-3]
 *
 * 职责：把自然语言 / AI 候选字段，规整为唯一口径，并保证：
 *   1) 每个字段都有统一的 unit、sourceType、sourceText、confidence、needsConfirmation；
 *   2) 无法换算的单位（如「每周 4 天」但缺少每月周数）必须 blocked，不能静默进入计算；
 *   3) wage（时间机会成本）只有原文出现明确证据时才允许进入经济盈余；
 *   4) sourceText 必须能在原文中找到，否则标记为「AI 推断」，不把推断当事实。
 *
 * 兼容 Node（server.cjs require）与浏览器（index.html <script src>），无外部依赖。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KZSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = '1.0';

  // 统一口径。前端显示单位可以变化，但计算引擎只接受下面的语义单位。
  var CANONICAL = {
    price:      { label: '单个交易单位销售价格', unit: '元/交易单位', min: 0, max: null, integer: false, group: 'core' },
    raw:        { label: '单位直接原料 / 进货成本（损耗前）', unit: '元/交易单位', min: 0, max: null, integer: false, group: 'cost' },
    pack:       { label: '单位包装 / 交付耗材', unit: '元/交易单位', min: 0, max: null, integer: false, group: 'cost' },
    loss:       { label: '采购 / 交付损耗率', unit: '%', min: 0, max: 100, maxExclusive: true, integer: false, group: 'cost' },
    fee:        { label: '平台 / 支付 / 佣金费用率', unit: '%', min: 0, max: 100, integer: false, group: 'cost' },
    sales:      { label: '每营业日交易量', unit: '交易单位/天', min: 0, max: null, integer: false, group: 'core' },
    days:       { label: '每月实际营业天数', unit: '天/月', min: 1, max: 31, integer: true, group: 'core' },
    rent:       { label: '月固定场地 / 摊位支出', unit: '元/月', min: 0, max: null, integer: false, group: 'fixed' },
    other:      { label: '其他月固定现金支出', unit: '元/月', min: 0, max: null, integer: false, group: 'fixed' },
    investment: { label: '一次性启动设备 / 工具投入', unit: '元', min: 0, max: null, integer: false, group: 'fixed' },
    life:       { label: '设备 / 投入折旧期间', unit: '月', min: 0, max: null, minExclusive: true, integer: false, group: 'fixed' },
    hours:      { label: '每日投入总工时', unit: '小时/天', min: 0, max: 24, minExclusive: true, integer: false, group: 'core' },
    wage:       { label: '时间参考机会成本', unit: '元/小时', min: 0, max: null, integer: false, group: 'economic' }
  };
  var FIELD_KEYS = Object.keys(CANONICAL);

  var SOURCE_LABELS = {
    ai: 'AI 识别',
    rules: '规则识别',
    user: '用户填写',
    inferred: 'AI 推断 · 待核对',
    converted: '单位换算 · 待核对',
    default: '默认假设 · 待核对',
    blocked: '待补充 · 单位无法换算'
  };

  // 机会成本只有在原文出现明确证据时才允许进入经济盈余计算（T-01）
  var WAGE_EVIDENCE = /(参考时薪|兼职时薪|机会成本|参考工资|时薪参考|人工成本|自己.{0,4}时薪|计时工资)/;

  var WEEKLY_DAYS_RE = /每周\s*(?:授课|服务|工作|上课|营业|接单|出摊|开张|经营|安排)?\s*(\d+(?:\.\d+)?)\s*天/;
  var WEEKS_PER_MONTH_RE = /每月\s*(?:授课|服务|工作|上课|营业|接单|出摊|开张|经营|安排)?\s*(\d+(?:\.\d+)?)\s*周/;

  function isNum(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }

  function weeklyDaysPerWeek(text) {
    var m = String(text || '').match(WEEKLY_DAYS_RE);
    return m ? Number(m[1]) : null;
  }
  function weeksPerMonth(text) {
    var m = String(text || '').match(WEEKS_PER_MONTH_RE);
    return m ? Number(m[1]) : null;
  }
  // 每周量 ÷ 每周营业天数 = 每日量
  function dailyFromWeekly(weeklyValue, daysPerWeek) {
    if (!isNum(weeklyValue) || !isNum(daysPerWeek) || daysPerWeek <= 0) return null;
    return round2(weeklyValue / daysPerWeek);
  }
  // 每周天数 × 每月周数 = 每月天数
  function daysPerMonthFromWeekly(perWeek, weeksPerMonthValue) {
    if (!isNum(perWeek) || perWeek <= 0 || perWeek > 7) return null;
    if (!isNum(weeksPerMonthValue) || weeksPerMonthValue <= 0) return null;
    return Math.round(perWeek * weeksPerMonthValue);
  }
  function wageHasEvidence(text, sourceText) {
    return WAGE_EVIDENCE.test(String(sourceText || '')) || WAGE_EVIDENCE.test(String(text || ''));
  }

  function validateValue(key, value) {
    var spec = CANONICAL[key];
    if (!spec) return { ok: false, reason: 'unknown-field' };
    if (!isNum(value)) return { ok: false, reason: 'not-a-number' };
    if (spec.minExclusive && value <= spec.min) return { ok: false, reason: 'must-be-positive' };
    if (!spec.minExclusive && value < spec.min) return { ok: false, reason: 'below-min' };
    if (spec.max != null) {
      if (spec.maxExclusive && value >= spec.max) return { ok: false, reason: 'above-max-exclusive' };
      if (!spec.maxExclusive && value > spec.max) return { ok: false, reason: 'above-max' };
    }
    if (spec.integer && Math.round(value) !== value) return { ok: false, reason: 'not-integer' };
    return { ok: true };
  }

  function validateAll(fields) {
    var errors = [];
    FIELD_KEYS.forEach(function (k) {
      var it = fields[k];
      if (!it || it.blocked) return;
      var r = validateValue(k, it.value);
      if (!r.ok) errors.push({ key: k, reason: r.reason, value: it.value });
    });
    return { ok: errors.length === 0, errors: errors };
  }

  // 从各种写法里抽出「交易单位」：杯 / 双 / 小时 / 份 ……
  function semanticUnit(unit) {
    var s = String(unit || '').trim();
    if (!s) return '';
    if (/^[\p{L}]{1,8}$/u.test(s)) return s;
    var drop = { '元': 1, '块': 1, '块钱': 1, '天': 1, '周': 1, '月': 1 };
    var parts = s.split(/[\/／]/).map(function (p) { return p.trim(); }).filter(Boolean);
    var cands = parts.filter(function (p) { return !drop[p]; });
    return cands.length ? cands[0] : '';
  }

  // 显示单位：price/raw/pack/sales 带上交易单位（杯、双、小时…），其余用统一口径
  function displayUnit(key, unit) {
    var semantic = semanticUnit(unit);
    if (!semantic) return CANONICAL[key].unit;
    if (key === 'price' || key === 'raw' || key === 'pack') return '元/' + semantic;
    if (key === 'sales') return semantic + '/天';
    return CANONICAL[key].unit;
  }

  /**
   * canonicalize(rawFields, text, opts) -> { fields, blocked, questions, assumptions }
   * rawFields: { key: {value, unit, sourceText, confidence, explicitZero?} }
   * opts: { mode: 'ai'|'rules'|'user'|'default', unit: 交易单位 }
   */
  function canonicalize(rawFields, text, opts) {
    opts = opts || {};
    var mode = String(opts.mode || 'ai').indexOf('rules') === 0 ? 'rules' : (opts.mode === 'user' ? 'user' : (opts.mode === 'default' ? 'default' : 'ai'));
    var src = rawFields || {};
    var fields = {};
    var blocked = [];
    var questions = [];
    var assumptions = [];
    var textNorm = norm(text);

    FIELD_KEYS.forEach(function (k) {
      var it = src[k];
      if (!it) return;
      var value = (typeof it === 'object') ? it.value : it;
      if (!isNum(value)) return;
      var sourceText = String((it && it.sourceText) || '');
      var explicitZero = !!(it && it.explicitZero);
      // 0 占位且无来源 → 视为「未识别」，归入待补充，不进计算
      if (value === 0 && !sourceText.trim() && !explicitZero) return;
      fields[k] = {
        value: value,
        unit: displayUnit(k, (it && it.unit) || opts.unit),
        sourceType: mode,
        sourceText: sourceText.slice(0, 120),
        confidence: (it && typeof it.confidence === 'number' && isFinite(it.confidence)) ? Math.max(0, Math.min(1, it.confidence)) : null,
        needsConfirmation: true
      };
      // 来源核验：来源短句必须能在原文找到，否则标记为 AI 推断
      if (!sourceText) fields[k].sourceType = 'inferred';
      else if (textNorm.indexOf(norm(sourceText)) < 0) fields[k].sourceType = 'inferred';
    });

    var pd = weeklyDaysPerWeek(text);
    var wpm = weeksPerMonth(text);
    var rawUnit = {};
    FIELD_KEYS.forEach(function (k) { rawUnit[k] = String((src[k] && src[k].unit) || ''); });

    // ── days：每周 → 天/月 ──
    if (fields.days) {
      var d = fields.days;
      var srcD = src.days || {};
      // 单位本身就是「/周」，或来源是模型直接给的「每周 N 天」且尚未换算过（不含 ×／÷ 标记）
      var perWeekMode = /周/.test(rawUnit.days) ||
        (/每周/.test(d.sourceText) && !/[×÷]/.test(d.sourceText) && d.value <= 7 && !!pd);
      var perWeek = isNum(Number(srcD.value)) ? Number(srcD.value) : pd;
      if (perWeekMode) {
        var conv = daysPerMonthFromWeekly(perWeek, wpm);
        if (conv != null) {
          d.value = conv;
          d.sourceType = 'converted';
          d.sourceText = '每周 ' + perWeek + ' 天 × 每月 ' + wpm + ' 周';
        } else {
          d.blocked = true;
          d.value = null;
          d.sourceType = 'blocked';
          blocked.push('days');
          questions.push('「每周营业 N 天」需要配合「每月营业几周」才能换算成月天数，请补充每月实际营业天数。');
        }
      }
    }

    // ── sales：每周 → 每天 ──
    if (fields.sales) {
      var s = fields.sales;
      var srcS = String((src.sales && src.sales.sourceText) || '');
      var weeklySales = /周/.test(rawUnit.sales) ||
        (/每周/.test(srcS) && !/每天|每日/.test(srcS) && !/[×÷]/.test(srcS));
      if (weeklySales) {
        var daily = dailyFromWeekly(Number(src.sales.value), pd);
        if (daily != null) {
          s.value = daily;
          s.sourceType = 'converted';
          s.sourceText = '每周 ' + src.sales.value + ' ÷ 每周 ' + pd + ' 天';
        } else {
          s.blocked = true;
          s.value = null;
          s.sourceType = 'blocked';
          blocked.push('sales');
          questions.push('「每周数量」需要先知道每周实际营业几天才能换算成每日交付量。');
        }
      }
    }

    // ── wage 证据门（T-01）──
    if (fields.wage && !wageHasEvidence(text, fields.wage.sourceText)) {
      delete fields.wage;
      questions.push('时间机会成本（元/小时）只有在明确提供时才计入经济盈余；不需要可留空。');
    }

    // ── 取值范围校验 ──
    FIELD_KEYS.forEach(function (k) {
      var f = fields[k];
      if (!f || f.blocked) return;
      var r = validateValue(k, f.value);
      if (!r.ok) {
        f.blocked = true;
        f.invalidReason = r.reason;
        if (blocked.indexOf(k) < 0) blocked.push(k);
      }
    });

    return { fields: fields, blocked: blocked, questions: questions, assumptions: assumptions };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    CANONICAL: CANONICAL,
    FIELD_KEYS: FIELD_KEYS,
    SOURCE_LABELS: SOURCE_LABELS,
    isNum: isNum,
    round2: round2,
    normalise: norm,
    weeklyDaysPerWeek: weeklyDaysPerWeek,
    weeksPerMonth: weeksPerMonth,
    dailyFromWeekly: dailyFromWeekly,
    daysPerMonthFromWeekly: daysPerMonthFromWeekly,
    wageHasEvidence: wageHasEvidence,
    displayUnit: displayUnit,
    semanticUnit: semanticUnit,
    validateValue: validateValue,
    validateAll: validateAll,
    canonicalize: canonicalize
  };
});
