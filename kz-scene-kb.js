/*!
 * 开张前 · 场景成本知识库 (scene cost knowledge base) v1.0   [P1-03]
 *
 * 定位：只给「AI 追问 + 规则追问 + 前端参考区间提示」当燃料。
 * 铁律：**绝不把参考数字写进用户字段**——数值一律由用户提供/确认（守住"AI 不猜数字"）。
 * 数据来源：公开经验/新闻（口径不一），仅作参考，页面展示一律标注"仅供参考"。
 *
 * 兼容 Node（server.cjs / 测试）与浏览器（index.html）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KZKB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KB_VERSION = '1.0';

  function item(key, label, range, note) { return { key: key, label: label, range: range, note: note || '' }; }

  var DOMAINS = {
    beverage: {
      label: '饮品 / 手打茶', unit: '杯', pricing: '6–10 元/杯（校园）',
      keywords: ['柠檬茶', '奶茶', '茶饮', '咖啡', '饮品', '果汁', '手打', '果茶', '甜啦啦', '摆摊卖饮料'],
      costItems: [item('raw', '原料', '1–3 元/杯'), item('pack', '包装耗材', '0.5–1 元/杯'), item('rent', '摊位费', '0–600 元/月'), item('investment', '设备', '200–1500 元')],
      commonlyMissed: ['鲜果/茶汤损耗', '杯子吸管封口膜', '备料工时', '校园准入费'],
      questions: ['鲜果、冰块和备料的损耗率大概多少？', '杯子、吸管、封口膜等包装耗材是否单独算了？', '摊位费/校园准入费有没有遗漏？', '每天从备料到收摊要投入多少小时？']
    },
    retail: {
      label: '零售 / 宿舍零食', unit: '份', pricing: '视品类',
      keywords: ['零食', '小卖部', '便利店', '进货物', '礼包', '二手转卖', '闲置', '网店'],
      costItems: [item('raw', '进货成本', '约售价 60–70%'), item('pack', '履约包装', '0.2–1 元/单'), item('loss', '滞销/临期损耗', '5–10%'), item('other', '跑腿配送费', '0.5–2 元/单')],
      commonlyMissed: ['滞销/临期损耗', '包装袋', '囤货资金占用', '配送费'],
      questions: ['除了进货差价，有没有快递、包装或临期滞销损耗？', '预计每天能卖出多少份，旺季淡季是否不同？', '是否需要平台佣金或推广费？', '囤货占用的钱多久能周转回来？']
    },
    tutor: {
      label: '技能 / 家教', unit: '小时', pricing: '校园 50–120 元/时',
      keywords: ['家教', '辅导', '陪练', '授课', '上课', '课时', '培训', '翻译', '代写'],
      costItems: [item('raw', '交通/材料', '0–50 元/小时'), item('hours', '备课+通勤工时', '授课的 0.5–1 倍'), item('fee', '获客/平台抽成', '0–30%')],
      commonlyMissed: ['备课与通勤工时（最大盲区）', '交通费', '获客佣金', '空档取消'],
      questions: ['每周实际可授课多少小时？是否存在空档取消？', '客户从哪里来，平台是否收取佣金或需要交通费？', '一次服务从备课、通勤到交付总共多少小时？', '是否需要教材、教具或打印成本？']
    },
    photo: {
      label: '创意 / 摄影到店', unit: '单', pricing: '证件照 20–60 元/单',
      keywords: ['摄影', '证件照', '毕业照', '写真', '修图', '约拍', '跟拍'],
      costItems: [item('raw', '耗材/打印', '1–8 元/单'), item('investment', '设备', '数千元'), item('hours', '拍摄+修图工时', '交付的 2–3 倍')],
      commonlyMissed: ['修图工时（最大盲区）', '设备折旧与维护', '往返交通', '道具/服装损耗'],
      questions: ['每单耗材、打印或包装成本是多少？', '一次订单从沟通、拍摄到修图交付总共多少小时？', '设备投入和维护费用是否已计入折旧？', '客源来自平台还是线下，是否有抽成？']
    },
    wash: {
      label: '按单服务 / 洗鞋', unit: '双', pricing: '校园 10–25 元/双',
      keywords: ['洗鞋', '洗衣', '代洗', '清洁', '洗护'],
      costItems: [item('raw', '洗涤剂/耗材', '1–5 元/双'), item('pack', '收纳/包装', '0.5–2 元/双'), item('hours', '单双工时', '15–40 分钟/双')],
      commonlyMissed: ['收送往返工时', '耗材与包装混算', '返工率', '设备折旧'],
      questions: ['每双的清洁剂、耗材和包装成本一共多少？', '每双从收件到交付要多少小时（含收送）？', '返工/洗坏率大概多少？', '设备投入和维护费是否已计入？']
    },
    errand: {
      label: '校园跑腿 / 代取', unit: '单', pricing: '代取 1–8 元/件',
      keywords: ['跑腿', '代取', '快递', '代拿', '送餐', '代送', '帮取'],
      costItems: [item('raw', '电动车充电', '约 0.5 元/单'), item('hours', '单均耗时', '约 10 分钟/单'), item('other', '丢件赔付', '偶发')],
      commonlyMissed: ['等单/爬楼时间', '电动车折旧与充电', '雨天加价', '丢件赔付'],
      questions: ['每单大概要花多少分钟（含等单和爬楼）？', '电动车充电和折旧算进去了吗？', '有没有丢件、赔付或平台抽成的风险？', '一天大概能接多少单？']
    },
    nail: {
      label: '宿舍美甲 / 美发', unit: '次', pricing: '比校外低约 20 元',
      keywords: ['美甲', '美睫', '美发', '化妆', '接甲', '甲油'],
      costItems: [item('raw', '甲油胶/饰品', '5–20 元/次'), item('pack', '一次性用品', '1–5 元/次'), item('hours', '单次工时', '1–2 小时/次')],
      commonlyMissed: ['单次工时', '甲油胶/饰品损耗', '消毒用品', '返工重做'],
      questions: ['一次做甲大概要多少小时？', '甲油胶、饰品和一次性用品的损耗怎么算？', '有没有返工重做或免费补做的情况？', '客源和获客成本如何？']
    },
    snack: {
      label: '夜市小吃 / 摆摊', unit: '份', pricing: '烤肠 3–4 元/根',
      keywords: ['烤肠', '小吃', '冰粉', '关东煮', '炸串', '淀粉肠', '糖葫芦', '烤冷面', '乌梅', '小番茄', '果盒', '摆摊卖吃的'],
      costItems: [item('raw', '食材', '视品类'), item('other', '摊位费', '200–500 元/天（市集）'), item('investment', '设备+原料', '约 700 元起')],
      commonlyMissed: ['摊位费', '食材损耗/烤糊', '竹签盒袋耗材', '食品资质合规'],
      questions: ['食材成本大概占售价多少？有没有烤糊/报废损耗？', '摊位费、市集费或城管相关成本是多少？', '竹签、盒、袋等耗材算了吗？', '有没有食品经营相关的资质成本？']
    },
    print: {
      label: '打印 / 复印', unit: '张', pricing: '校园 0.08–0.2 元/张',
      keywords: ['打印', '复印', '复印店', '打印社', '论文打印', '快印'],
      costItems: [item('raw', '纸张', '0.03–0.1 元/张'), item('raw', '碳粉/硒鼓', '约 0.01–0.03 元/张'), item('investment', '打印机+硒鼓', '一次性')],
      commonlyMissed: ['设备折旧', '碳粉/硒鼓摊销', '废纸与卡纸损耗', '耗材补货'],
      questions: ['每张的纸张和碳粉成本大概多少？', '打印机等设备投入和折旧算了吗？', '有没有废纸、卡纸等损耗？', '每天大概能打印多少张？']
    },
    film: {
      label: '手机贴膜 / 数码', unit: '张', pricing: '10–60 元/张',
      keywords: ['贴膜', '手机膜', '钢化膜', '数据线', '手机配件'],
      costItems: [item('raw', '膜进价', '2–15 元/张'), item('raw', '配件进价', '视品类')],
      commonlyMissed: ['贴坏返工损耗', '膜库存滞销', '摊位/时间'],
      questions: ['一张膜的进价大概多少？', '有没有贴坏返工的损耗？', '库存卖不掉的比例大概多少？', '一天大概能贴多少张？']
    },
    pet: {
      label: '宠物代养 / 代遛', unit: '次', pricing: '上门喂养 20–55 元/次',
      keywords: ['遛狗', '代遛', '喂猫', '宠物', '代养', '上门喂养', '寄养'],
      costItems: [item('raw', '一次性手套鞋套', '约 1 元/次'), item('hours', '服务+往返', '单程约 1 小时'), item('fee', '平台抽成', '视平台')],
      commonlyMissed: ['往返通勤时间', '一次性防护用品', '平台抽成', '纠纷/赔付风险'],
      questions: ['每次上门（含往返）大概要多少时间？', '一次性手套、鞋套等耗材算了吗？', '平台是否抽成，比例多少？', '有没有宠物意外或赔付的风险成本？']
    },
    generic: {
      label: '通用经营场景', unit: '单', pricing: '',
      keywords: [],
      costItems: [],
      commonlyMissed: ['直接成本', '耗材损耗', '工时', '一次性投入折旧'],
      questions: ['每件交付的直接成本是什么，如何按单分摊？', '一次交付需要多少工时？', '预计每天或每周能完成多少单？', '是否需要设备或一次性启动投入？']
    }
  };

  var ORDER = Object.keys(DOMAINS).filter(function (k) { return k !== 'generic'; });

  function matchDomain(text) {
    var s = String(text || '');
    var best = 'generic', bestScore = 0;
    ORDER.forEach(function (key) {
      var hits = DOMAINS[key].keywords.reduce(function (n, kw) { return n + (s.indexOf(kw) >= 0 ? 1 : 0); }, 0);
      if (hits > bestScore) { bestScore = hits; best = key; }
    });
    return best;
  }

  function get(domain) { return DOMAINS[domain] || DOMAINS.generic; }

  function questions(domain) { return get(domain).questions.slice(); }

  // 注入提示词的精简上下文（控制长度；明确"仅供参考、禁止直接写入 fields"）
  function promptContext(text) {
    var key = matchDomain(text);
    if (key === 'generic') return '';
    var d = DOMAINS[key];
    var costs = d.costItems.map(function (c) { return c.label + (c.range ? '（约 ' + c.range + '）' : ''); }).join('、');
    return '【场景参考：' + d.label + '】常见成本项：' + (costs || '见通用') +
      '；常见易漏项：' + d.commonlyMissed.join('、') +
      '；常见定价：' + (d.pricing || '视情况') +
      '。以上仅为行业参考，用于生成更专业的追问与缺项提示，**严禁把参考数字写入 fields，数值必须来自用户原文或用户确认**。';
  }

  // 前端展示用的参考区间（非约束性）
  function fieldHints(domain) {
    var d = get(domain);
    return d.costItems.map(function (c) { return { key: c.key, label: c.label, range: c.range }; }).filter(function (h) { return h.range; });
  }

  function summary(domain) {
    var d = get(domain);
    return { domain: domain in DOMAINS ? domain : 'generic', label: d.label, pricing: d.pricing, oftenMissed: d.commonlyMissed.slice(), hints: fieldHints(domain) };
  }

  return {
    KB_VERSION: KB_VERSION,
    DOMAINS: DOMAINS,
    matchDomain: matchDomain,
    get: get,
    questions: questions,
    promptContext: promptContext,
    fieldHints: fieldHints,
    summary: summary
  };
});
