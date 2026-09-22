# 开张前 · 接口与数据合同

版本：schemaVersion `1.0` ／ formulaVersion `1.0`

## 1. 接口

### `POST /api/extract`
把一段自然语言经营描述解析成**规范化字段**。

请求：
```json
{ "text": "我想在宿舍做洗鞋服务，每双收费25元，每天接12双，每月服务22天，清洁剂和包装成本5元。" }
```

响应（节选）：
```json
{
  "mode": "deepseek-direct | openclaw-<agent> | rules",
  "schemaVersion": "1.0",
  "formulaVersion": "1.0",
  "scene": { "key": "creative", "unit": "双", "label": "创意 / 到店服务", "kind": "service" },
  "fields": {
    "price": { "value": 25, "unit": "元/双", "sourceType": "ai", "sourceText": "每双收费25元", "confidence": 0.9, "needsConfirmation": true },
    "days":  { "value": null, "unit": "天/月", "sourceType": "blocked", "sourceText": "每周工作4天", "blocked": true }
  },
  "blocked": ["days"],
  "missing": ["loss", "fee", "rent", "other", "investment", "life", "hours", "wage"],
  "questions": ["…"],
  "assumptions": ["…"],
  "relevant": ["price", "sales", "raw", "hours", "days"]
}
```

校验规则：请求体上限 20 KB（超出返回 `413 BODY_TOO_LARGE`）；缺少 `text` 返回 `400 INVALID_REQUEST`。

### `POST /api/clarify`
用户回答 AI 追问后修正参数。

请求：`{ "idea": "…", "question": "…", "reply": "…", "currentFields": { … } }`
响应：`{ "mode": "…", "success": true, "explanation": "…", "updatedFields": { "price": { "value": 35, "sourceText": "…" } } }`

### `GET /health`
```json
{ "status": "ok", "schemaVersion": "1.0", "formulaVersion": "1.0", "aiConfigured": true, "agent": "kaizhang-extract" }
```

## 2. 标准化字段（canonical schema）

计算引擎**只接受**下列统一单位。前端显示单位可以随场景变化，但进入 `calc()` 的口径固定。

| 字段 | 含义 | 统一单位 | 取值 |
| --- | --- | --- | --- |
| `price` | 单个交易单位售价 | 元/交易单位 | ≥ 0 |
| `raw` | 单位直接原料 / 进货成本（**损耗前**） | 元/交易单位 | ≥ 0 |
| `pack` | 单位包装 / 交付耗材 | 元/交易单位 | ≥ 0 |
| `loss` | 损耗率 | % | [0, 100) |
| `fee` | 平台 / 支付 / 佣金费用率 | % | [0, 100] |
| `sales` | 每营业日交易量 | 交易单位/天 | ≥ 0 |
| `days` | 每月实际营业天数 | 天/月 | 整数 [1, 31] |
| `rent` | 月固定场地 / 摊位支出 | 元/月 | ≥ 0 |
| `other` | 其他月固定现金支出 | 元/月 | ≥ 0 |
| `investment` | 一次性启动投入 | 元 | ≥ 0 |
| `life` | 折旧期间 | 月 | > 0 |
| `hours` | 每日投入总工时 | 小时/天 | (0, 24] |
| `wage` | 时间参考机会成本 | 元/小时 | ≥ 0（见第 4 节） |

每个字段同时带：
`value`、`unit`、`sourceType`、`sourceText`、`confidence`、`needsConfirmation`，越界或无法换算时带 `blocked: true`。

## 3. 单位换算

- **每周 → 每天**：`sales = 每周量 ÷ 每周营业天数`（每周营业天数必须能从描述中得到）。
- **每周 → 每月**：`days = 每周天数 × 每月周数`。
- 缺少换算所需的因子时，字段标记 `blocked`，并生成追问，**不进入计算**。

## 4. 来源与证据

- `sourceType` 取值：`ai`（AI 识别）｜`rules`（规则识别）｜`converted`（单位换算）｜`inferred`（AI 推断，来源短句在原文找不到）｜`user`（用户填写）｜`default`（默认假设）。
- `sourceText` 只是**证据短句**，不是模型准确性的证明；找不到即降级为 `inferred`。
- `wage` 只有原文出现「参考时薪 / 兼职时薪 / 机会成本 / 参考工资 / 人工成本」等明确证据时才保留，
  否则丢弃并生成追问（避免把「每小时收费 80 元」误当成机会成本时薪）。

## 5. 计算口径（formulaVersion 1.0）

```
q         = sales × 情景系数 × days            # 每月总交付量
v         = raw ÷ (1 − loss%) + pack + price × fee%   # 单位变动成本
margin    = price − v                          # 单位边际贡献
fixed     = rent + other
revenue   = q × price
cash      = q × margin − fixed                 # 月经营现金结余（未扣折旧）
dep       = investment ÷ life
profit    = cash − dep                         # 扣折旧后月盈余
breakeven = (fixed + dep) ÷ margin ÷ days      # margin ≤ 0 → null（无法保本）
hours     = hours × days
payback   = investment ÷ cash                  # cash ≤ 0 → null（无法回本）
hourly    = profit ÷ hours
economic  = profit − hours × wage              # 计入时间机会成本
```

`life = 0`、`loss ≥ 100%`、`hours` 越界等非法输入必须在上游被拦截，不能传入 `calc()`。
