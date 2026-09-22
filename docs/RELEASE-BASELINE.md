# 发布基线与 P0 改造记录

## 一、当前线上基线（2026-09-22 记录）

| 项目 | 值 |
| --- | --- |
| 线上目录 | `/var/www/kaizhangqian/` |
| Git 仓库 | `git@github.com:w-y0905/kaizhangqian-DEMO.git` |
| 基线 commit | `45fa909c1a27af04e44234eb7bdf05b13a0f0b2f`（= origin/main，工作树干净） |
| Commit 摘要 | `feat: 兼职机会成本为负时增加人话解释（仅在负值时显示，不影响其他逻辑）` |
| server.cjs sha256 | `f40bd44d649249075cf5ada37b95229aa81bc777eab812d359bac40db3573682` |
| index.html sha256 | `bfefb8f58a65489c76d1cd19e9a72d82ee0894dec1f96fa01cee9f9d5838a2b7` |
| 运行进程 | PM2 `kaizhangqian-demo`，脚本 `/var/www/kaizhangqian/server.cjs` |
| 监听 | `127.0.0.1:8768`（Node v22.22.2） |
| 运行指标 | 历史重启 55 次；HTTP P95 约 5315 ms；错误日志出现过 2 次 `NO_FIELDS`（随后规则回退） |

### 回滚步骤

```bash
cd /var/www/kaizhangqian
git stash                      # 或 git checkout -- . 丢弃未提交改动
git checkout 45fa909           # 回到基线
pm2 restart kaizhangqian-demo
curl -s http://127.0.0.1:8768/health
```

> 目录内的 `index.html.bak-*` / `server.pre-v03.cjs` / `backups/` 为历史备份，未纳入 Git 跟踪。

## 二、P0 改造（分支 `p0-hardening`，基线之上）

已在本地工作副本 `/root/kz-p0` 完成，**尚未部署**。

| 编号 | 问题 | 处理 | 代码位置 |
| --- | --- | --- | --- |
| P0-2 / T-02 | 「每周 4 天」被当成「天/月」，月收入 / 保本量算错 | `days` 统一换算为天/月；缺「每月周数」时 **blocked**，阻断测算并追问 | `kz-schema.js` `canonicalize` |
| P0-3 / T-01 | 「每小时收费 80 元」被同时填成 `price` 和 `wage` | 增加 **wage 证据门**：无「时薪 / 机会成本」等证据即丢弃并追问 | `kz-schema.js` `wageHasEvidence` |
| P0-3 / T-04 | AI 来源短句无核验，易被当成原文事实 | 每个字段带 `sourceType`；来源短句在原文找不到 → `inferred`（AI 推断） | `kz-schema.js` `canonicalize` + `index.html srcLabel` |
| P0-4 | `calc` 混在页面里，无测试 | 抽出 `kz-calc.js` 纯函数（页面与测试共用），新增 `test/` 共 23 个用例 | `kz-calc.js`、`test/` |
| P0-4 / T-03 | 服务类合并成本（清洁剂和包装）可能漏计 | 保留并复用 `normalizeServiceCosts`，合并成本进入可见直接耗材字段 | `server.cjs` |
| P0-5 / T-06 | 试卖记录只显示平均销量，无法证明模型被校准 | 新增 `kz-trial.js`：实际单位成本/单位边际/边际时薪/销量偏差 + 调整建议 + 导出验证报告 | `kz-trial.js`、`index.html` |
| P0-5 / T-05 | 保存 / 导出只有 confirmed 数值，无法复现 | 新增 `buildSnapshot()`：带 schemaVersion、formulaVersion、来源、默认假设、metrics | `index.html` |
| P0-6 / T-08 | AI 追问用 `innerHTML` 拼接，存在注入风险 | 追问与假设清单统一走 `safeText()` 转义 | `index.html` |
| P0-6 | 超时 / 回退 / 隐私边界 | 保留超时与回退提示；新增数据流向与敏感信息提示 | `index.html` |
| P0-2 | 无法换算的字段仍被默认值静默填充 | `blocked` 字段不参与结构默认值补齐，交给用户填写 | `index.html` extract 处理 |

### 新增 / 改动文件

- 新增：`kz-schema.js`、`kz-calc.js`、`kz-trial.js`、`test/schema.test.cjs`、`test/calc.test.cjs`、`test/trial.test.cjs`、`README.md`、`docs/API.md`、`docs/P0-修复清单.md`、`docs/RELEASE-BASELINE.md`、`scripts/verify-p0.*`
- 修改：`server.cjs`（引入 schema、`/health` 版本号、静态资源 `/kz-schema.js` `/kz-calc.js`）、`index.html`（引入模块、转义、blocked 处理、快照、隐私提示）

### 验收

- `node --test test/schema.test.cjs test/calc.test.cjs` → 23 / 23 通过
- 本地 `PORT=8794 node server.cjs`：`/health` 返回 schemaVersion 1.0；页面渲染关键值（月现金结余 1800.00、保本量 9.4）与人工复算一致
- AI 路径模拟「遛狗 每周工作 4 天」→ `days` 返回 `blocked`；补上「每月 4 周」→ 换算为 16 天/月

## 三、部署记录

| 项 | 值 |
| --- | --- |
| 部署时间 | 2026-09-22 17:44 (Asia/Shanghai) |
| 部署 commit | `a1a044e`（分支 `p0-hardening` 快进合并到 `main`） |
| 线上 commit | main @ `a1a044e`（已 push 到 origin） |
| 上线前文件备份 | `server.cjs.bak-p0-20260922-174403`、`index.html.bak-p0-20260922-174403` |
| 操作 | `git merge --ff-only p0-hardening` → `pm2 restart kaizhangqian-demo` |
| 线上验证 | `/health` 返回 schema 1.0/formula 1.0；`/kaizhangqian/kz-*.js` 均 200；真实 AI 提取「遛狗 每周 4 天」→ `blocked:['days']`、`wage` 被证据门丢弃；页面 KZSchema/KZCalc/KZTrial 均加载，calc 月现金结余 1800.00 |

### 回滚

```bash
cd /var/www/kaizhangqian
git checkout 45fa909            # 回到基线
pm2 restart kaizhangqian-demo
# 或用备份覆盖：
# cp server.cjs.bak-p0-20260922-174403 server.cjs
# cp index.html.bak-p0-20260922-174403 index.html
# pm2 restart kaizhangqian-demo
```

## 四、待办（需决策）

- **P0-7 冻结演示版本**：选定标杆案例（校园柠檬茶）+ 迁移案例（家教 / 洗鞋），冻结版本号与材料数字
  - 已定：标杆案例 = **乌梅小番茄（真实案例）**；试卖口径 = 12 次均摊；T-03 洗鞋合并成本 = 直接计入不拆分
  - 迁移案例：待确认是否需要
