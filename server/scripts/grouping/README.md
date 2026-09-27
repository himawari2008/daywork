# 活记分组回归测试（grouping）

分组决策是活记的核心可靠性点。这里提供两类回归：

## 1. 单元测试（无需启动服务）— 推荐进 CI

`src/modules/ai/ai.grouping.spec.ts` 直接对 `AiService.matchKeywordGroup` 跑契约用例
（覆盖全部 24 个候选分组 + 易错消歧 + 无命中→null）。它锁定「分组决策契约」，
任何对 `GROUP_TAXONOMY` 或打分逻辑的改动只要改变映射就会失败。

```bash
npm run test:grouping
```

## 2. 实时集成测试（需启动后端 + Postgres）

对「正在运行的后端」做端到端回归。会用一个测试用户
（`GROUPING_USER_ID`，默认 `ci-grouping-verify`）创建/修改记录，**跑完自动清空该用户全部记录**。

| 脚本 | 内容 | 通过标准 |
| --- | --- | --- |
| `verify-group.js` | 核心 6 条消歧 + 再跑一遍稳定性 | 核心 6/6 + 稳定性 6/6 |
| `spot-check.js` | 15 条跨分组抽样 | 15/15 |
| `reclassify-check.js` | 错分修正 + 幂等 | 火锅→餐饮 被修正、瓷砖→采购·建材 保持 |

```bash
# 先启动后端（编译后的 dist 或 nest start）
npm run build && node dist/main &
# 再跑（可分别跑，也可用聚合脚本一次跑完）
npm run test:grouping:live
```

环境变量：

- `GROUPING_BASE_URL` 默认 `http://localhost:3000`
- `GROUPING_USER_ID` 测试用户，默认 `ci-grouping-verify`

## 决策规则（与代码一致）

1. 分组决策**只看正文**，AI 自带的 tags 不回灌关键词匹配；
2. 正文命中关键词即权威，覆盖 AI 任意分组建议；
3. 数组顺序即优先级：**理财投资 → 财务 → 客户跟进**（同分时靠前者胜）。

> 注：`semanticGroupMatch`（语义相似度兜底）仍会参考 tags 做向量召回，属有意设计；
> 上面「只看正文」仅约束关键词层（matchKeywordGroup / fallbackGroup / preferKeywordOverFlatAi）。
