const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const KZSchema = require('./kz-schema.js');
const KZCalc = require('./kz-calc.js');

const PORT = Number(process.env.PORT || 8768);
const OPENCLAW_BASE = process.env.OPENCLAW_URL || 'http://127.0.0.1:18789';
const OPENCLAW_URL = OPENCLAW_BASE + '/v1/chat/completions';
const AGENT_ID = process.env.OPENCLAW_AGENT || 'kaizhang-extract';
const MODEL_FIELD = 'openclaw/' + AGENT_ID;
// OpenClaw may need several seconds to start an agent run; allow enough time
// for a real DeepSeek response before falling back to deterministic rules.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 25000);

// 读取网关 token：优先环境变量，否则读本机 openclaw.json（不落日志、不下发前端）
function readGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN.trim();
  try {
    const cfg = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf8'));
    return (cfg.gateway && cfg.gateway.auth && cfg.gateway.auth.token) || '';
  } catch { return ''; }
}
const TOKEN = readGatewayToken();

// 读取 DeepSeek 配置：优先环境变量，否则读本机 openclaw.json（key 不落日志、不下发前端）
function readDeepSeekCfg() {
  const base = (process.env.DEEPSEEK_BASE_URL || '').replace(/\/$/, '');
  if (process.env.DEEPSEEK_API_KEY) {
    return { key: process.env.DEEPSEEK_API_KEY.trim(), base: base || 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf8'));
    const p = cfg.models && cfg.models.providers && cfg.models.providers.deepseek;
    if (p && p.apiKey) return {
      key: String(p.apiKey).trim(),
      base: base || String(p.baseUrl || 'https://api.deepseek.com').replace(/\/$/, ''),
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
    };
  } catch {}
  return { key: '', base: base || 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
}
const DEEPSEEK = readDeepSeekCfg();

const SCENE_DEFS = {
  beverage: { label: '饮品 / 食品', unit: '杯', kind: 'product' },
  retail: { label: '零售 / 电商', unit: '份', kind: 'product' },
  skill: { label: '技能 / 教学服务', unit: '小时', kind: 'service' },
  creative: { label: '创意 / 到店服务', unit: '单', kind: 'service' },
  other: { label: '其他经营场景', unit: '单', kind: 'other' }
};

// A work-hour mention is not a transaction unit. Read only explicit pricing
// and completed/sold quantity phrases, with longer unit names matched first.
const TRANSACTION_UNITS = '人次|平方米|公斤|小时|课时|双|杯|份|件|条|张|页|套|单|次|人|个|瓶|盒|包|盘|斤|米|场|节|亩|天|根|串|只|支';
function inferTransactionUnit(text = '') {
  const s = String(text);
  const priceUnit = s.match(new RegExp('(?:每|一)(' + TRANSACTION_UNITS + ')(?:平均)?\\s*(?:收费|售价|价格|卖价|卖|收|收入|服务价)?\\s*(?:为|是|约|大约)?\\s*\\d+(?:\\.\\d+)?\\s*元')) ||
    s.match(new RegExp('元\\s*[/／]\\s*(' + TRANSACTION_UNITS + ')'));
  if (priceUnit) return priceUnit[1];
  const salesUnit = s.match(new RegExp('(?:每天|每日|一天|每周|日均)(?:预计|大概|平均|大约)?\\s*(?:能|可)?\\s*(?:卖出|售出|销售|交付|完成|清洗|洗|接|服务|授课|卖)?\\s*\\d+(?:\\.\\d+)?\\s*(' + TRANSACTION_UNITS + ')'));
  return salesUnit ? salesUnit[1] : '';
}

function inferScene(text = '') {
  const s = String(text).toLowerCase();
  if (/(家教|辅导|陪练|课程|授课|教学|培训|咨询|翻译|代写|跑腿|代取|服务费|每小时|课时)/.test(s)) {
    return { key: 'skill', ...SCENE_DEFS.skill };
  }
  if (/(摄影|证件照|毕业照|写真|修图|设计|美甲|理发|洗鞋|维修|打印|相框|装裱|到店)/.test(s)) {
    return { key: 'creative', ...SCENE_DEFS.creative };
  }
  if (/(零食|盲盒|二手|闲置|电商|微商|进货|代购|礼包|网店|商品|卖货)/.test(s)) {
    return { key: 'retail', ...SCENE_DEFS.retail };
  }
  if (/(奶茶|柠檬茶|饮料|咖啡|甜品|蛋糕|小吃|餐|摆摊|每杯|原料)/.test(s)) {
    return { key: 'beverage', ...SCENE_DEFS.beverage };
  }
  return { key: 'other', ...SCENE_DEFS.other };
}

function normalizeScene(scene, text = '') {
  const fallback = inferScene(text);
  const rawKey = typeof scene === 'string' ? scene : (scene && (scene.key || scene.type));
  const key = Object.prototype.hasOwnProperty.call(SCENE_DEFS, rawKey) ? rawKey : fallback.key;
  const explicitUnit = inferTransactionUnit(text);
  return { key, ...SCENE_DEFS[key], ...(explicitUnit ? { unit: explicitUnit } : {}) };
}

function sceneQuestions(scene) {
  const key = scene && scene.key;
  if (key === 'skill') return [
    '每周实际可授课或服务多少小时？是否存在空档取消？',
    '是否需要交通、教材、平台或获客成本？',
    '一次服务从准备到交付总共耗时多少小时？',
    '客户从哪里来，平台是否收取佣金？'
  ];
  if (key === 'creative') return [
    '每单耗材、打印、清洁或包装成本是多少？',
    '一次订单从沟通到交付总共耗时多少小时？',
    '设备投入和维护费用是否已经计入？',
    '客源来自平台、社群还是线下，是否有抽成？'
  ];
  if (key === 'retail') return [
    '进货成本之外，是否有快递、包装、损耗或滞销？',
    '预计每天能卖出多少份，旺季和淡季是否不同？',
    '是否需要平台佣金、推广费或仓储费？',
    '库存占用资金多久可以周转回来？'
  ];
  if (key === 'beverage') return [
    '杯子、吸管、封口膜等包装耗材是否单独计入？',
    '鲜果、冰块和备料的实际损耗率大约是多少？',
    '摊位、平台、支付或校园准入费用是否遗漏？',
    '每天从备料到收摊需要投入多少工时？'
  ];
  return [
    '每件交付的直接成本是什么，如何按单分摊？',
    '一次交付需要多少工时，是否有交通或平台费用？',
    '预计每天或每周能完成多少单？',
    '是否需要设备、许可或一次性启动投入？'
  ];
}

function normalizeSkillFields(fields, text = '') {
  const source = String(text || '');
  const weeklyMatch = source.match(/每周(?:预计|平均)?\s*(?:接|授课|服务|上课)?\s*(\d+(?:\.\d+)?)\s*小时/);
  const weeklyDays = source.match(/每周\s*(?:授课|服务|工作|上课|营业|接单)?\s*(\d+(?:\.\d+)?)\s*天/);
  const monthWeeks = source.match(/每月\s*(?:授课|服务|工作|上课|营业|接单)?\s*(\d+(?:\.\d+)?)\s*周/);
  const monthDays = source.match(/每月\s*(?:授课|服务|工作|上课|营业|接单)?\s*(\d+(?:\.\d+)?)\s*天/);
  const dailyHours = source.match(/(?:每天|每日|日均)\s*(?:接|授课|服务|上课)?\s*(\d+(?:\.\d+)?)\s*小时/);
  const daysPerWeek = weeklyDays ? Number(weeklyDays[1]) : (monthDays && monthWeeks ? Number(monthDays[1]) / Number(monthWeeks[1]) : 0);
  const field = (value, unit, sourceText, old = {}) => ({ ...old, value, unit, sourceText, confidence: 0.9, needsConfirmation: true });
  if (weeklyMatch && !dailyHours) {
    if (daysPerWeek > 0 && daysPerWeek <= 7) {
      fields.sales = field(Number(weeklyMatch[1]) / daysPerWeek, '小时/天', `${weeklyMatch[0]} ÷ 每周服务 ${daysPerWeek} 天`, fields.sales);
    } else {
      // Do not silently invent a four-day working week.
      delete fields.sales;
    }
  }
  if (monthDays) {
    fields.days = field(Number(monthDays[1]), '天/月', monthDays[0], fields.days);
  } else if (monthWeeks) {
    if (daysPerWeek > 0 && daysPerWeek <= 7) {
      fields.days = field(Number(monthWeeks[1]) * daysPerWeek, '天/月', `${monthWeeks[0]} × 每周服务 ${daysPerWeek} 天`, fields.days);
    } else {
      delete fields.days;
    }
  }
  return fields;
}

function normalizeServiceCosts(fields, scene, text = '') {
  if (scene.kind !== 'service') return;
  if (!fields.raw && !fields.pack) {
    const combined = String(text).match(/(?:清洁剂和包装|耗材和包装|材料和包装)(?:成本|费用)?\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)\s*(?:元|块)/);
    const direct = String(text).match(/(?:清洁剂|耗材|材料|相纸和打印|打印)(?:成本|费用)?\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)\s*(?:元|块)/);
    const match = combined || direct;
    if (match) fields.raw = { value: Number(match[1]), unit: '', sourceText: match[0], confidence: 0.9, needsConfirmation: true };
  }
  const raw = fields.raw, pack = fields.pack;
  if (pack && !raw) {
    fields.raw = pack;
    delete fields.pack;
  } else if (raw && pack && raw.value === pack.value) {
    const a = String(raw.sourceText || '').replace(/\s/g, '');
    const b = String(pack.sourceText || '').replace(/\s/g, '');
    // Shared source spans are one cost; distinct materials and packaging stay
    // separate even when the amounts happen to be equal.
    const separateCosts = /(?:原料|耗材|清洁剂|打印|相纸)[^，。；\d]{0,8}\d+(?:\.\d+)?[^。\n]{0,12}(?:包装|相框|装裱)[^，。；\d]{0,8}\d/.test(text) ||
      /(?:包装|相框|装裱)[^，。；\d]{0,8}\d+(?:\.\d+)?[^。\n]{0,12}(?:原料|耗材|清洁剂|打印|相纸)[^，。；\d]{0,8}\d/.test(text);
    if (!separateCosts && a && b && (a === b || a.includes(b) || b.includes(a))) delete fields.pack;
  }
}

function conversionQuestions(fields, text = '') {
  const questions = [];
  if (/每周[^，。；\n]*小时/.test(text) && !fields.sales) questions.push('每周实际服务几天？请补充后把每周课时换算成每日服务量。');
  if (/每月[^，。；\n]*周/.test(text) && !fields.days) questions.push('每周实际服务几天？每月服务周数需与每周天数一起换算。');
  return questions;
}

// ── 规则回退（保留原有实现）──
function extractFields(text) {
  const scene = normalizeScene(null, text);
  const rules = [
    ['price', new RegExp('(?:(?:每|一)(?:' + TRANSACTION_UNITS + ')(?:平均)?\\s*(?:收费|售价|价格|卖价|卖|收|收入)?|售价|卖价|收费|客单价)\\s*(?:为|是|约|大约)?\\s*(\\d+(?:\\.\\d+)?)')],
    ['raw', /(?:一杯成本|进货成本|进价|相纸和打印成本|(?:原料|耗材|相纸|打印|清洁剂)(?:成本)?)\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)/],
    ['sales', /(?:每天|每日|日均|一天|预计卖)\s*(?:大概|预计|平均|大约)?\s*(?:能|可)?\s*(?:卖出|售出|交付|完成|清洗|洗|授课|服务|卖|接)?\s*(\d+(?:\.\d+)?)/],
    ['days', /(?:每月|一个月)\s*(?:营业|出摊|授课|服务|工作|上课|接单)?\s*(\d+(?:\.\d+)?)\s*天/],
    ['rent', /(?:摊位费|场地费|租金)\s*(?:每月|一个月)?\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)/],
    ['pack', /(?:清洁剂和包装成本|包装|相框|装裱)\s*(?:成本|费)?\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)/],
    ['fee', /(?:平台抽成|抽成|佣金|手续费)\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)\s*[%％]/],
    ['investment', /(?:设备投入|设备花费|设备投资|相机投入)\s*(\d+(?:\.\d+)?)/],
    ['hours', /(?:每天工作|每日工时|每天投入总工时|每天投入|每日工作)\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)/],
    ['other', /(?:推广费|交通和打印|其他支出)\s*(?:每月)?\s*(\d+(?:\.\d+)?)/],
    ['loss', /(?:损耗率|损耗|返工率)\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)\s*[%％]/],
    ['life', /(?:折旧年限|折旧期限|折旧|使用年限)\s*(?:为|是|约|按)?\s*(\d+(?:\.\d+)?)\s*(?:个月|月|年)/],
    ['wage', /(?:参考时薪|兼职时薪|时薪|参考工资)\s*(?:为|是|约)?\s*(\d+(?:\.\d+)?)/]
  ];
  const fields = {};
  for (const [key, re] of rules) {
    const m = String(text || '').match(re);
    if (m) fields[key] = { value: Number(m[1]), unit: '', sourceText: m[0], confidence: 0.7, needsConfirmation: true };
  }
  const noRent = String(text).match(/没有(?:场地费|摊位费|租金)|无(?:场地费|摊位费|租金)|免租|不需要(?:场地费|租金)/);
  if (noRent) fields.rent = { value: 0, unit: '元/月', sourceText: noRent[0], confidence: 0.9, needsConfirmation: true };
  if (fields.life && /\d\s*年$/.test(fields.life.sourceText)) fields.life.value *= 12;
  if (fields.life) fields.life.unit = '月';
  if (fields.price) fields.price.unit = `元/${scene.unit}`;
  if (fields.sales) fields.sales.unit = `${scene.unit}/天`;
  // Service businesses usually describe cleaning/material/consumable spend as
  // one per-order delivery cost. Keep that value in the visible direct-cost
  // field so it cannot disappear inside the product-oriented packaging field.
  normalizeServiceCosts(fields, scene, text);
  if (scene.key === 'skill') normalizeSkillFields(fields, text);
  const unit = inferTransactionUnit(text);
  const canon = KZSchema.canonicalize(fields, text, { mode: 'rules', unit });
  return {
    mode: 'rules',
    schemaVersion: KZSchema.SCHEMA_VERSION,
    formulaVersion: KZCalc.FORMULA_VERSION,
    scene,
    fields: canon.fields,
    blocked: canon.blocked,
    missing: FIELD_KEYS.filter(k => !(k in canon.fields) || canon.fields[k].blocked),
    questions: [...canon.questions, ...conversionQuestions(canon.fields, text), ...sceneQuestions(scene)].slice(0, 5),
    assumptions: ['未填写的数字不会被 AI 猜测；请在确认前补充或修改。']
  };
}

const FIELD_KEYS = ['price', 'raw', 'pack', 'loss', 'fee', 'sales', 'days', 'rent', 'other', 'investment', 'life', 'hours', 'wage'];
const isNum = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// 严格校验并规整模型输出；非法字段一律丢弃
function sanitize(obj, text = '') {
  const out = { mode: 'openclaw-' + AGENT_ID, scene: normalizeScene(obj && obj.scene, text), fields: {}, missing: [], questions: [], assumptions: [], recommendation: '' };
  const src = (obj && obj.fields) || {};
  for (const k of FIELD_KEYS) {
    const it = src[k];
    if (it && typeof it === 'object' && isNum(it.value)) {
      // 直接调 DeepSeek 时模型会把没提到的字段也填成 0 占位（sourceText 为空）——
      // 这类占位不算“已识别”，归入 missing 由用户核对。
      if (it.value === 0 && !String(it.sourceText || '').trim()) continue;
      out.fields[k] = {
        value: it.value,
        unit: String(it.unit || ''),
        sourceText: String(it.sourceText || '').slice(0, 120),
        confidence: Number.isFinite(it.confidence) ? Math.max(0, Math.min(1, it.confidence)) : null,
        needsConfirmation: true
      };
    }
  }
  normalizeServiceCosts(out.fields, out.scene, text);
  if (out.scene.key === 'skill') normalizeSkillFields(out.fields, text);
  // Gateway agents may retain a generic unit such as 份 in otherwise valid
  // extraction. Explicit transaction wording is the authoritative unit.
  const explicitUnit = inferTransactionUnit(text);
  if (explicitUnit) {
    for (const k of ['price', 'raw', 'pack']) if (out.fields[k]) out.fields[k].unit = `元/${explicitUnit}`;
    if (out.fields.sales) out.fields.sales.unit = `${explicitUnit}/天`;
  }
  // ── 标准化数据合同：统一单位 / 来源核验 / wage 证据门 / 越界拦截（P0-2、P0-3）──
  const canon = KZSchema.canonicalize(out.fields, text, { mode: out.mode, unit: explicitUnit });
  out.fields = canon.fields;
  out.blocked = canon.blocked;
  out.schemaVersion = KZSchema.SCHEMA_VERSION;
  out.formulaVersion = KZCalc.FORMULA_VERSION;
  out.missing = FIELD_KEYS.filter(k => !(k in out.fields) || out.fields[k].blocked);
  out.questions = Array.isArray(obj && obj.questions) ? obj.questions.slice(0, 5).map(String) : [];
  out.assumptions = Array.isArray(obj && obj.assumptions) ? obj.assumptions.slice(0, 5).map(String) : [];
  out.recommendation = typeof (obj && obj.recommendation) === 'string' ? obj.recommendation.slice(0, 240) : '';
  // AI 识别的经营场景简称（用于自定义输入时的标题）；含引号/换行一律过滤
  out.title = typeof (obj && obj.title) === 'string'
    ? obj.title.replace(/["'\n\r]/g, '').trim().slice(0, 16)
    : '';
  // AI 标注的“这门生意实际可能涉及”的字段（供前端筛缺项）
  if (!out.questions.length) out.questions = sceneQuestions(out.scene);
  out.questions = [...canon.questions, ...conversionQuestions(out.fields, text), ...out.questions].slice(0, 5);
  // AI 标注的“这门生意实际可能涉及”的字段（供前端筛缺项），再与追问里提到的成本项对齐
  out.relevant = Array.isArray(obj && obj.relevant)
    ? obj.relevant.map(k => String(k).trim()).filter(k => FIELD_KEYS.includes(k))
    : [];
  for (const k of inferRelevantFromQuestions(out.questions)) {
    if (!out.relevant.includes(k)) out.relevant.push(k);
  }
  return out;
}

// 从 AI 追问文本里推出涉及的成本字段，避免“追问问了但缺项清单不列”的不一致
const RELEVANT_HINTS = {
  pack: /包装|耗材|竹签|纸袋|塑料袋|餐具|相纸|清洁剂/,
  loss: /损耗|变质|破损|返工|报废|滞销/,
  fee: /抽成|佣金|平台费|手续费/,
  rent: /摊位费|场地费|房租|租金|工作室|仓储/,
  investment: /设备|初始投入|购置|机器|推车|制冰机|封口机|工具/,
  fixed: /其他.{0,6}支出|燃气|运输|卫生费|推广|水电/,
  hours: /工时|小时|出摊时间/,
  wage: /时薪|人工|工资|劳动报酬/,
  days: /营业天数|出摊天数|经营天数/
};
function inferRelevantFromQuestions(questions) {
  const t = (questions || []).join(' ');
  const out = [];
  for (const [k, re] of Object.entries(RELEVANT_HINTS)) {
    if (re.test(t)) out.push(k === 'fixed' ? 'other' : k);
  }
  return out;
}

function buildPrompt(text) {
  return `请解析下面这段大学生创业描述，并只输出一个 JSON 对象，不要 Markdown：
{
  "title": "",
  "relevant": [],
  "scene": {"key":"beverage|retail|skill|creative|other"},
  "fields": {
    "price":{"value":0,"unit":"","sourceText":"","confidence":0},
    "raw":{"value":0,"unit":"","sourceText":"","confidence":0},
    "pack":{"value":0,"unit":"","sourceText":"","confidence":0},
    "loss":{"value":0,"unit":"%","sourceText":"","confidence":0},
    "fee":{"value":0,"unit":"%","sourceText":"","confidence":0},
    "sales":{"value":0,"unit":"","sourceText":"","confidence":0},
    "days":{"value":0,"unit":"天/月","sourceText":"","confidence":0},
    "rent":{"value":0,"unit":"元/月","sourceText":"","confidence":0},
    "other":{"value":0,"unit":"元/月","sourceText":"","confidence":0},
    "investment":{"value":0,"unit":"元","sourceText":"","confidence":0},
    "life":{"value":0,"unit":"月","sourceText":"","confidence":0},
    "hours":{"value":0,"unit":"小时/天","sourceText":"","confidence":0},
    "wage":{"value":0,"unit":"元/小时","sourceText":"","confidence":0}
  },
  "missing": [],
  "questions": [],
  "assumptions": [],
  "recommendation": ""
}
规则：title 是根据用户描述概括出的 4-10 字经营场景简称（如"宠物代遛""快递代取""宿舍美甲"），**必须填写，不得留空**；relevant 用字段名列出这门生意**实际可能涉及**的项（供前端提示缺项用），取值范围：price/raw/pack/loss/fee/sales/days/rent/other/investment/life/hours/wage，**宁可多列不要漏**（如室内宿舍生意勿列 rent，无线上渠道勿列 fee），price 和 sales 必须包含，**且 questions 里提到的成本项必须包含在 relevant 里**；只填写原文明确给出的非负数字；未知字段不要猜，放入 missing；scene.key 必须从五个枚举中选择；**若无法确定属于哪一类（非典型生意，如遛狗、代取快递），scene.key 选 other，不要硬塞到不匹配的类别**；questions 必须围绕该场景的成本和工作方式。price、raw、pack 按一次计价单位填写，sales 是每营业日的交付量，hours 是每日总工作小时。严格区分双、杯、条、单与工时；不要一律使用份。每周量需要实际每周营业天数才能转换；缺少因素时不要猜。raw 和 pack 不得重复计入同一笔耗材。
经营描述：${text}`;
}

// 把模型返回的文本解析成规整结果
function parseModelContent(content, text, mode) {
  let c = String(content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = c.indexOf('{'), e = c.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('NO_JSON');
  const parsed = JSON.parse(c.slice(s, e + 1));
  const out = sanitize(parsed, text);
  if (mode) out.mode = mode;
  if (Object.keys(out.fields).length === 0) throw new Error('NO_FIELDS');
  return out;
}

// 直连 DeepSeek（主路径，延迟最低）
async function callDirect(text) {
  if (!DEEPSEEK.key) throw new Error('NO_DEEPSEEK_KEY');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch(DEEPSEEK.base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + DEEPSEEK.key },
      body: JSON.stringify({
        model: DEEPSEEK.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildPrompt(text) }]
      })
    });
    if (!r.ok) throw new Error('UPSTREAM_' + r.status);
    const j = await r.json();
    const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('EMPTY_CONTENT');
    return parseModelContent(content, text, 'deepseek-direct');
  } finally {
    clearTimeout(timer);
  }
}

// 备用路径：仍可走 OpenClaw 网关（直连失败时自动回退）
async function callViaGateway(text) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch(OPENCLAW_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ model: MODEL_FIELD, temperature: 0, messages: [{ role: 'user', content: buildPrompt(text) }] })
    });
    if (!r.ok) throw new Error('UPSTREAM_' + r.status);
    const j = await r.json();
    const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('EMPTY_CONTENT');
    return parseModelContent(content, text);
  } finally {
    clearTimeout(timer);
  }
}

// 依次尝试：直连 DeepSeek → OpenClaw 网关；都已失败则由上层回退规则引擎
async function callAI(text) {
  try {
    return await callDirect(text);
  } catch (err1) {
    console.error('[extract] 直连 DeepSeek 失败，尝试网关：' + (err1 && err1.message ? err1.message : 'unknown'));
    return await callViaGateway(text);
  }
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}


// ── 智能多轮追问/补充细节规则回退解析引擎 ──
function fallbackClarify(reply, currentFields = {}) {
  const updated = {};
  const explanations = [];

  // 1. 多套餐/多SKU组合定价与单量折算
  // 例如：“8单里大概6单是证件照35元，2单是毕业照套餐128元” 或 “6单35元，2单128元”
  const itemPairs = [];
  const pairRegex = /(\d+(?:\.\d+)?)\s*(?:单|份|杯|小时|件)[^0-9\n]{0,25}(\d+(?:\.\d+)?)\s*(?:元|块)/g;
  let match;
  while ((match = pairRegex.exec(reply)) !== null) {
    itemPairs.push({ q: parseFloat(match[1]), p: parseFloat(match[2]) });
  }

  if (itemPairs.length >= 2) {
    let relevantPairs = itemPairs;
    if (itemPairs.length >= 3 && Math.abs(itemPairs[0].q - (itemPairs[1].q + itemPairs[2].q)) < 0.01) {
      relevantPairs = itemPairs.slice(1);
    }
    let totalRevenue = 0, totalQty = 0;
    const parts = [];
    for (const item of relevantPairs) {
      totalRevenue += item.q * item.p;
      totalQty += item.q;
      parts.push(`${item.q}单×${item.p}元`);
    }
    if (totalQty > 0) {
      const blendedPrice = Math.round((totalRevenue / totalQty) * 100) / 100;
      updated.price = {
        value: blendedPrice,
        sourceText: `AI加权折算：(${parts.join(' + ')}) ÷ ${totalQty} = ${blendedPrice}元/单`
      };
      explanations.push(`已为您智能加权折算多套餐：${parts.join(' + ')}，综合加权平均客单价为 <strong>${blendedPrice} 元/单</strong>，已自动填入售价参数！`);
      if (totalQty > 0 && (!currentFields.sales || Math.abs(currentFields.sales - totalQty) > 0.01)) {
        updated.sales = {
          value: totalQty,
          sourceText: `套餐合计日单量：${totalQty}单`
        };
      }
    }
  } else {
    // 单一售价提取
    const pMatch = reply.match(/(?:均价|平均|客单价|售价|定价|每单收费|收费为|卖)[^0-9\n]{0,10}(\d+(?:\.\d+)?)\s*(?:元|块)?/);
    if (pMatch) {
      const p = parseFloat(pMatch[1]);
      if (p > 0) {
        updated.price = { value: p, sourceText: `补充定价：${p}元` };
        explanations.push(`已将单件售价更新为 <strong>${p} 元</strong>。`);
      }
    }
  }

  // 2. 原料/耗材成本
  const rawMatch = reply.match(/(?:耗材|原料|进价|打印|相纸|成本)[^0-9\n]{0,12}(\d+(?:\.\d+)?)\s*(?:元|块)/);
  if (rawMatch && !reply.includes('售价') && !reply.includes('收费')) {
    const r = parseFloat(rawMatch[1]);
    updated.raw = { value: r, sourceText: `补充耗材：${r}元` };
    explanations.push(`已将单件原料/耗材成本更新为 <strong>${r} 元</strong>。`);
  }

  // 3. 包装成本
  const packMatch = reply.match(/(?:包装|杯子|吸管|袋子|相框|装裱|包装盒)[^0-9\n]{0,10}(\d+(?:\.\d+)?)\s*(?:元|块)/);
  if (packMatch) {
    const pk = parseFloat(packMatch[1]);
    updated.pack = { value: pk, sourceText: `补充包装：${pk}元` };
    explanations.push(`已计入单件包装/相框成本 <strong>${pk} 元</strong>。`);
  }

  // 4. 工时
  const hourMatch = reply.match(/(?:工时|工作|修图|拍摄|服务|出摊)[^0-9\n]{0,10}(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
  if (hourMatch) {
    const hr = parseFloat(hourMatch[1]);
    updated.hours = { value: hr, sourceText: `补充工时：${hr}小时` };
    explanations.push(`已更新每日工时为 <strong>${hr} 小时</strong>。`);
  }

  // 5. 损耗率
  const lossMatch = reply.match(/(?:损耗|废品|坏果|损耗率)[^0-9\n]{0,10}(\d+(?:\.\d+)?)\s*%/);
  if (lossMatch) {
    const ls = parseFloat(lossMatch[1]);
    updated.loss = { value: ls, sourceText: `补充损耗率：${ls}%` };
    explanations.push(`已更新损耗率为 <strong>${ls}%</strong>。`);
  }

  // 6. 平台抽成
  const feeMatch = reply.match(/(?:抽成|手续费|佣金|平台费)[^0-9\n]{0,10}(\d+(?:\.\d+)?)\s*%/);
  if (feeMatch) {
    const fe = parseFloat(feeMatch[1]);
    updated.fee = { value: fe, sourceText: `补充抽成：${fe}%` };
    explanations.push(`已更新平台抽成为 <strong>${fe}%</strong>。`);
  }

  // 7. 固定场地租金
  if (/(?:没有场地费|无场地费|免租|场地费0|租金0|不需要场地|宿舍)/.test(reply)) {
    updated.rent = { value: 0, sourceText: `补充无场地费` };
    explanations.push(`已确认无固定场地租金（设为 <strong>0 元</strong>）。`);
  } else {
    const rentMatch = reply.match(/(?:场地费|租金|摊位费)[^0-9\n]{0,10}(\d+(?:\.\d+)?)\s*(?:元|块)/);
    if (rentMatch) {
      const rt = parseFloat(rentMatch[1]);
      updated.rent = { value: rt, sourceText: `补充场地费：${rt}元` };
      explanations.push(`已更新月固定租金为 <strong>${rt} 元</strong>。`);
    }
  }

  // 8. 初始设备投入
  const investMatch = reply.match(/(?:设备|相机|灯光|工具|投入|前期投入)[^0-9\n]{0,10}(\d+(?:\.\d+)?)\s*(?:元|块)/);
  if (investMatch) {
    const inv = parseFloat(investMatch[1]);
    updated.investment = { value: inv, sourceText: `补充设备投入：${inv}元` };
    explanations.push(`已更新初始设备投入为 <strong>${inv} 元</strong>。`);
  }

  return {
    mode: 'rules-clarify',
    success: Object.keys(updated).length > 0,
    explanation: explanations.join(' ') || '已成功记录您的补充信息，由于未检测到具体数字变动，未调整现有参数。',
    updatedFields: updated
  };
}

async function callAIClarify({ idea, question, reply, currentFields }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  const prompt = `你是一个经验丰富的大学生微型创业财务精算CFO。
用户正在为其创业想法进行参数精算与成本校对。
【商业想法】：${idea || '未填写'}
【AI提问/盲区】：${question || '请根据用户回答调整参数'}
【当前经营参数】：${JSON.stringify(currentFields || {})}
【用户对追问的回答/补充细节】：
"${reply}"

【任务要求】：
1. 深入理解用户的回答。重点关注：如果用户描述了多套餐或多商品（例如多种不同价格的服务及单量），必须计算综合加权平均客单价 (Blended ARPU) 并更新到 price。
   计算公式：加权平均客单价 = (单量1 × 价格1 + 单量2 × 价格2 + ...) ÷ 总单量。
2. 识别用户提及的耗材(raw)、包装(pack)、损耗(loss)、抽成(fee)、工时(hours)、租金(rent)、设备投入(investment)等任何变动。
3. 请以严格的 JSON 格式输出，Schema如下：
{
  "explanation": "简短通俗的话（1-2句），告知用户你如何理解、写明折算算式，并说明已更新哪些参数",
  "updatedFields": {
    "字段名(如 price, raw, hours 等)": {
      "value": 数值(非负float/int),
      "sourceText": "简短说明，如加权折算(6单@35+2单@128)"
    }
  }
}`;

  try {
    const r = await fetch(OPENCLAW_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ model: MODEL_FIELD, temperature: 0, messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) throw new Error('UPSTREAM_' + r.status);
    const j = await r.json();
    let content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('EMPTY_CONTENT');
    content = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const s = content.indexOf('{'), e = content.lastIndexOf('}');
    if (s < 0 || e < 0) throw new Error('NO_JSON');
    const parsed = JSON.parse(content.slice(s, e + 1));
    return {
      mode: 'openclaw-deepseek',
      success: true,
      explanation: parsed.explanation || '已根据您的回答智能更新参数。',
      updatedFields: parsed.updatedFields || {}
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── 提取结果缓存：同一段描述直接复用（含启动预热），降低响应延迟 ──
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const CACHE_MAX = Number(process.env.CACHE_MAX || 300);
const aiCache = new Map();
const cacheKey = t => String(t || '').replace(/\s+/g, ' ').trim();
function cacheGet(k) {
  const e = aiCache.get(k);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) { aiCache.delete(k); return null; }
  aiCache.delete(k); aiCache.set(k, e); // LRU 触达
  return e.value;
}
function cacheSet(k, v) {
  aiCache.set(k, { at: Date.now(), value: v });
  while (aiCache.size > CACHE_MAX) aiCache.delete(aiCache.keys().next().value);
}
// 首页内置的 5 个样例场景描述（启动时预热，让现场演示点击即出结果）
const PRESET_TEXTS = [
  '我想在校园摆摊卖柠檬茶，一杯卖8元，原料成本3元，每天卖30杯，每月营业20天，摊位费每月500元。',
  '我想在宿舍卖零食礼包，每份卖15元，进货成本8元，每天预计卖20份，每月营业18天。',
  '我想做大学生家教，每小时收费80元，每周接6小时，每周授课2天，每月授课4周，没有场地费。',
  '我想在校园做证件照和毕业照摄影，每单平均收费60元，相纸和打印成本8元，每天接8单，每月服务22天，设备投入6000元，每天工作5小时。',
  '我想在宿舍做洗鞋服务，每双收费25元，每天接12双，每月服务22天，清洁剂和包装成本5元，设备投入1500元，每天工作4小时。'
];

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

    // ── POST /api/clarify 智能追问回答与参数修正接口 ──
  if (req.method === 'POST' && (pathname === '/api/clarify' || pathname === '/kaizhangqian/api/clarify')) {
    let body = '';
    let tooBig = false;
    req.on('data', c => { body += c; if (body.length > 20000) { tooBig = true; req.destroy(); } });
    req.on('end', async () => {
      if (tooBig) return sendJSON(res, 413, { error: { code: 'BODY_TOO_LARGE', message: '请求体过大' } });
      let p = {};
      try { p = JSON.parse(body); } catch {}
      const reply = typeof p.reply === 'string' ? p.reply.trim() : '';
      if (!reply) return sendJSON(res, 400, { error: { code: 'INVALID_REQUEST', message: '缺少 reply 字段' } });

      try {
        const ai = await callAIClarify(p);
        return sendJSON(res, 200, ai);
      } catch (err) {
        console.error('[clarify] AI 不可用，回退规则：' + (err && err.message ? err.message : 'unknown'));
        return sendJSON(res, 200, fallbackClarify(reply, p.currentFields || {}));
      }
    });
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/extract' || pathname === '/kaizhangqian/api/extract')) {
    let body = '';
    let tooBig = false;
    req.on('data', c => {
      if (tooBig) return; // 超限后不再累积，但继续接收亜量，保证能回响应
      body += c;
      if (body.length > 20000) { tooBig = true; body = ''; }
    });
    req.on('end', async () => {
      if (tooBig) return sendJSON(res, 413, { error: { code: 'BODY_TOO_LARGE', message: '请求体过大' } });
      let text = '';
      try { const p = JSON.parse(body); text = typeof p.text === 'string' ? p.text.trim() : ''; } catch {}
      if (!text) return sendJSON(res, 400, { error: { code: 'INVALID_REQUEST', message: '缺少 text 字段' } });

      const ck = cacheKey(text);
      const hit = cacheGet(ck);
      if (hit) {
        res.setHeader('X-KZ-Cache', 'hit');
        return sendJSON(res, 200, hit);
      }
      try {
        const ai = await callAI(text);
        if (ai && typeof ai.mode === 'string' && !ai.mode.startsWith('rules')) cacheSet(ck, ai);
        return sendJSON(res, 200, ai);
      } catch (err) {
        // 不记录用户原文与密钥
        console.error('[extract] AI 不可用，回退规则：' + (err && err.message ? err.message : 'unknown'));
        return sendJSON(res, 200, extractFields(text));
      }
    });
    return;
  }

  // 静态资源：标准化模块与计算引擎（页面与测试共用同一实现）
  if (req.method === 'GET' && (pathname === '/kz-schema.js' || pathname === '/kz-calc.js' || pathname === '/kz-trial.js')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return fs.readFile(path.join(__dirname, pathname.slice(1)), (e, c) => {
      if (e) { res.writeHead(404).end('Not found'); return; }
      res.end(c);
    });
  }

  if (req.method !== 'GET' || !['/', '/index.html', '/health'].includes(pathname)) {
    res.writeHead(404).end('Not found');
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/health') {
    return sendJSON(res, 200, {
      status: 'ok',
      extraction: 'deepseek-direct-with-gateway-fallback',
      schemaVersion: KZSchema.SCHEMA_VERSION,
      formulaVersion: KZCalc.FORMULA_VERSION,
      aiConfigured: Boolean(TOKEN),
      agent: AGENT_ID,
      api: '/api/extract'
    });
  }

  fs.readFile(path.join(__dirname, 'index.html'), (e, c) => {
    if (e) { res.writeHead(500).end('Unable to load page'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(c);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.error('[server] port in use'); process.exit(1); }
  else process.exit(1);
});
server.on('listening', () => console.log('http://127.0.0.1:' + server.address().port));
server.listen(PORT, '127.0.0.1');

// 启动预热：后台把 5 个样例场景跑一遍写进缓存（不阻塞服务）
(async () => {
  let ok = 0;
  for (const t of PRESET_TEXTS) {
    try {
      const v = await callAI(t);
      if (v && typeof v.mode === 'string' && !v.mode.startsWith('rules')) { cacheSet(cacheKey(t), v); ok++; }
    } catch { /* 预热失败不影响服务 */ }
  }
  console.log('[cache] prewarmed ' + ok + '/' + PRESET_TEXTS.length + ' preset scenarios');
})();
