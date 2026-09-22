# 开张前 —— 面向大学生微创业的智能成本测算平台

线上 Demo 的源码仓库。平台把模糊的创业想法转成**可确认的成本假设**，再交给**确定性财务模型**计算，
并支持用真实试卖数据回校预测，形成一条可复核的证据链：

```
自然语言  →  AI 理解层  →  标准化与校验层  →  用户确认层  →  确定性计算层  →  验证与输出层
```

## 目录结构

| 文件 | 说明 |
| --- | --- |
| `index.html` | 单页前端（输入、AI 追问、决策大盘、图表、保存 / 导出 / 试卖记录） |
| `server.cjs` | Node HTTP 服务：AI 提取（DeepSeek 直连 → 网关回退）、规则回退、缓存、静态资源 |
| `kz-schema.js` | **标准化数据合同**：统一单位、来源核验、wage 证据门、越界拦截（前后端 / 测试共用） |
| `kz-calc.js` | **确定性计算引擎**：纯函数，页面与测试共用同一实现 |
| `test/*.test.cjs` | 公式与合同测试（`node --test`） |
| `docs/API.md` | 接口与字段合同 |
| `docs/RELEASE-BASELINE.md` | 发布基线、校验值与回滚步骤 |

## 本地运行

```bash
node server.cjs            # 默认监听 127.0.0.1:8768
# 环境变量：
#   PORT                 监听端口
#   DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL   直连 DeepSeek
#   OPENCLAW_URL / OPENCLAW_GATEWAY_TOKEN / OPENCLAW_AGENT  网关回退
#   AI_TIMEOUT_MS        AI 超时（默认 25000）
```

关键接口：`POST /api/extract`（自然语言 → 规范化字段）、`POST /api/clarify`（追问回答 → 参数修正）、`GET /health`。

## 测试

```bash
node --test test/schema.test.cjs test/calc.test.cjs
# 或
npm test
```

覆盖：单位换算（每周↔每天↔每月）、wage 证据门、来源核验、取值范围边界、边际为负 / 极端损耗 /
折旧为 0 / 回收期无解等公式用例。

## 数据合同要点（详见 docs/API.md）

- 计算引擎只接受统一单位；`days` 一律「天/月」，`sales` 一律「交易单位/天」。
- **无法换算的单位必须 `blocked`**（例如只给了「每周 4 天」却没有「每月几周」），阻断测算并要求补充，绝不静默使用。
- 每个字段都带 `sourceType`（`ai` / `rules` / `converted` / `inferred` / `user` / `default`）与 `sourceText`；
  来源短句在原文找不到时标记为「AI 推断」，不把推断当事实。
- `wage`（时间机会成本）只有在原文出现明确证据时才进入经济盈余计算。

## 版本

- schemaVersion / formulaVersion：`1.0`
- 基线 commit：见 `docs/RELEASE-BASELINE.md`
