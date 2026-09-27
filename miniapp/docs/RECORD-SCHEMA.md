# 活记 · ParsedRecord 数据契约（Single Source of Truth）

> 文档状态：**契约已落盘（T1 验收通过）**
> 交付物：`utils/record-model.js`（CommonJS，纯 JS、无 `wx` 依赖）
> 维护者：dev（huoji-dev）
> 配套约定：本契约是 UI 组件与后端接口之间的**唯一数据真相源**。`index.js` / `detail.js` / `import.js` / `api.js` 任何读取记录的地方，最终都应先过 `normalizeRecord()` 再渲染。

---

## 0. 一句话原则

- **情绪真相**是 `mood = { label, tone, intensity }`，`emotion` / `moodColor` 只是它的**派生字段**，不要把它们当成独立存储。
- **所有来源的记录对象**（后端列表、详情、创建/语音返回、导入预览）形状各不相同，**渲染前统一 `normalizeRecord(raw)`**。
- `normalizeRecord` **永不抛错**：任意异常都回退到默认规范记录。

---

## 1. ParsedRecord 字段表（UI 对齐依据）

> 类别说明：`core` = 后端既有真相字段；`new` = 本轮新增收纳字段；`derived` = 由其它字段派生。
> 必填列指「契约强约束」，绝大多数字段允许空值（见 §3 兜底规则）。

| 字段 | 类型 | 必填 | 类别 | 说明 |
|------|------|------|------|------|
| `id` | `string \| null` | 否 | core | 后端记录 ID；未保存（导入预览 / 语音待识别）时为 `null` |
| `type` | `string` | 否 | new | 来源类型：`'voice' \| 'text' \| 'import' \| 'image' \| 'manual'` |
| `transcript` | `string` | 否 | new | 原始转录文本（STT 原文 / 用户粘贴原文），未被 AI 改写 |
| `content` | `string` | 否 | core | 正文（创建时提交的文本；语音记录等同 transcript）；**UI 渲染主文本** |
| `text` | `string` | 否 | derived | `content` 的别名，便于不同来源统一读取 |
| `summary` | `string` | 否 | core | AI 摘要，时间线卡片标题 |
| `tags` | `string[]` | 否 | core | 标签数组（字符串） |
| `people` | `string[]` | 否 | core | 涉及人物数组（字符串；导入页 / 详情页均使用） |
| `numericInfo` | `object` | 否 | core | 键值数值，如 `{ 金额: "12", 数量: "3" }` |
| `mood` | `object \| null` | 否 | core | 情绪真相：`{ label:string, tone:'positive'\|'negative'\|'neutral', intensity:1-5 }` |
| `emotion` | `string` | 否 | derived | `= mood ? mood.tone : 'neutral'`，UI 快捷情绪键 |
| `moodColor` | `string` | 否 | derived | `= MOOD_COLOR_MAP[emotion]` 十六进制色 |
| `status` | `string \| null` | 否 | core | 处理状态：`'待办' \| '已完成' \| '待跟进' \| null` |
| `todos` | `object[]` | 否 | new | 待办列表 `[{ title:string, due:string\|null, done:boolean }]` |
| `events` | `object[]` | 否 | new | 日程/事件 `[{ title:string, start:string\|null, end:string\|null }]` |
| `remindAt` | `string \| null` | 否 | core | 提醒时间（ISO 字符串）；无提醒为 `null` |
| `groupId` | `string \| null` | 否 | core | 所属分组 ID；未分组为 `null` |
| `suggestedGroupName` | `string \| null` | 否 | new | AI 建议分组名（导入预览用，仅 UI 高亮提示，不入库到 `groupId`） |
| `isPinned` | `boolean` | 否 | core | 是否置顶 |
| `attachments` | `string[]` | 否 | core | 附件 URL 数组，如 `["/uploads/voice/x.wav"]` |
| `confidence` | `number` | 否 | new | AI 解析置信度 `0-1`（`mock` / 后端填充） |
| `source` | `string` | 否 | new | 来源标识：`'voice'\|'text'\|'import'\|'image'\|'manual'\|'mock'` |
| `createdAt` | `string` | 否 | core | 创建时间（ISO） |
| `updatedAt` | `string` | 否 | core | 最后更新时间（ISO） |
| `recordedAt` | `string \| null` | 否 | core | 事件实际发生时间（ISO）；用于时间线分组 / 日历热力 |

**字段总数：23**。完整程序化清单见 `utils/record-model.js` 导出的 `PARSERECORD_FIELDS`（含每项 `key/type/required/kind/desc`），UI Designer 可直接据此生成类型定义 / TS interface。

---

## 2. MOOD_COLOR_MAP 取值（派生色）

| emotion (`mood.tone`) | moodColor（十六进制） | 语义 |
|------------------------|------------------------|------|
| `positive` | `#3FA66A` | 正向情绪 |
| `negative` | `#E06B5A` | 负向情绪 |
| `neutral` | `#8A93A6` | 中性 / 无情绪 |

> 现有 UI 用 `moodToneClass(mood)` 返回 CSS 类名（`positive`/`negative`/`neutral`）驱动 `app.wxss` 里的色板。
> **建议**：`moodColor` 仅作为「内联取色兜底」（如分享卡片、动态染色场景），常态仍用 `moodToneClass` 的 CSS 类，避免与现有设计 token 重复。
>
> 旧格式纯文本心情（5 种）→ 规范 mood 映射（与 `index.js` / `detail.js` 的 `legacyMap` 完全一致）：
> `开心→{positive,3}`、`平静→{neutral,2}`、`疲惫→{negative,3}`、`压力→{有压力,negative,3}`、`生气→{negative,4}`。

---

## 3. normalizeRecord 兜底规则（防御性映射）

输入任意形状，输出规范 ParsedRecord；**任何异常都回退默认值，绝不抛错**。

1. **非对象输入**（`undefined` / `null` / 非 object）→ 返回默认规范记录（全部空值 + 当前时间戳）。
2. **`id`**：存在则 `String(id)`，否则 `null`。
3. **来源判定**：按 `source`/`type` → `transcript&&!content` → `attachments` 含 `/uploads/voice/` 顺序推断；兜底 `manual`。
4. **文本**：`transcript = raw.transcript || ''`；`content = raw.content || raw.text || transcript`；`text` 镜像 `content`。
5. **数组字段**（`tags`/`people`/`attachments`）：非数组 → `[]`，元素 `String()` 化。
6. **`numericInfo`**：非纯对象 → `{}`。
7. **`mood`**：经 `parseMood()` 统一收口——兼容「对象 / JSON 字符串 / 旧格式纯文本」三种来源，输出 `{label, tone, intensity}` 或 `null`；`tone` 非法→`neutral`，`intensity` 非 1-5→夹取到 2-5。
8. **`emotion` / `moodColor`**：由 `mood.tone` 派生。
9. **`status`**：不在 `['待办','已完成','待跟进']` 且非 `null` → 尝试英文别名映射（`done→已完成` 等），否则 `null`。
10. **`todos` / `events`**：非数组 → `[]`；字符串元素自动包成 `{title, due:null, done:false}` / `{title, start:null, end:null}`。
11. **时间字段**（`remindAt`/`createdAt`/`updatedAt`/`recordedAt`）：存在则 `String()`，否则保留默认/空。
12. **`confidence`**：非 `0-1` 数值 → 默认 `0.5`。
13. **`suggestedGroupName`**：支持 `raw.suggestedGroupName` 或 `raw.suggestedGroup.name`。
14. 全程 `try/catch`，异常时 `console.warn` 并返回已填充的默认记录。

---

## 4. 响应信封不统一（接后端前必读）

> ⚠️ **关键不一致**：不同接口的「记录对象」外层包装不同，前端各调用点当前已分别适配，但接 `record-model` 时必须统一。

| 接口（`utils/api.js`） | HTTP | 入参 | 出参形状 | 备注 |
|------------------------|------|------|----------|------|
| `createRecord(content, recordedAt, attachments)` | POST `/records` | `{content, recordedAt?, attachments?}` | **裸记录**（后端 AI 解析补全） | 入参只有 `content`，**无 summary/tags** |
| `createBatch(...)` | POST `/records/batch` | `{content, recordedAt?, attachments?}` | `{ records:[...], isBatch }` | |
| `createRecordFromVoice(filePath)` | POST `/records/voice`（multipart, 字段 `audio`） | 文件 | **裸记录** 或 `{ records:[...], isBatch }` | 无 `.data` 包装 |
| `importPreview(content)` | POST `/records/import/preview` | `{content}` | `{ documentSummary, records:[轻量], isImage }` | 预览记录无 `id`/`content` |
| `importUpload(filePath)` | POST `/records/import/preview/file`（字段 `file`） | 文件 | 同上 | index.js 只用 `documentSummary` / `records[].summary` |
| `importSave(data)` | POST `/records/import/save` | `{documentSummary, records, fileName}` | `{ savedCount, autoCompletedCount }` | |
| `getRecords(params)` | GET `/records?page&limit&status&date&groupId` | query | **`{ data:[...], total }`** | ⚠️ 带 `.data` 信封 |
| `getRecordDetail(id)` | GET `/records/:id` | — | **单条裸记录** | |
| `updateRecord(id, data)` | PATCH `/records/:id` | 见详情 | 记录 | `data` 支持 `summary/tags/people/numericInfo/status/mood(JSON串)/isPinned/remindAt` |

**结论 / 接入约定**：
- 列表接口（`getRecords`）返回 `{ data, total }`，取 `res.data` 才是记录数组；其余创建/语音/详情是**裸记录**。
- **统一做法**：无论记录来自哪个接口，渲染前一律 `normalizeRecord(raw)`，不要假设外层包装。
- 导入预览记录是「轻量对象」（缺 `id`/`content`），入库后必须后端补全 `content`（见 §6 提案 B）。

---

## 5. 现网隐患（已在 T1 回报，本轮不修改）

1. **导入预览 → 入库后缺 `content`**：`import.js` 审核项只有 `summary/tags/people/numericInfo/status/mood/recordedAt/suggestedGroupName`，**无 `id`、无 `content`**。若后端 `createRecord` 不回填 `content`，`index.js:593`（`r.content || ''`）、`detail.js:627`（`record.content`）会落空，卡片正文 / 分享文案降级。→ 提案 B 修复。
2. **mood 双重格式**：`import.js:327` 保存时 `JSON.stringify(mood)`，`detail.js` 编辑时 `JSON.parse`；`index.js:611` 用 `parseMood` 兼容「对象/JSON 串/旧纯文本」。一致的前提是**后端原样存 JSON 串**；一旦存成纯文本 `"开心"` 会触发 legacy 映射，丢失标签/强度。→ 提案 A 把 `parseMood` 收口到 `record-model.js` 消除三处重复逻辑。
3. **`recordedAt` 空值守卫缺口**：`index.js:557` 已守卫（`r.recordedAt && r.recordedAt.slice(...)` 安全），但 `index.js:586` `util.formatTime(r.recordedAt)` **未守卫**——若 `util.formatTime` 不处理 `null` 会出 `Invalid Date`。属隐患，留待后续对 `recordedAt` 兜底（不在本轮）。
4. **类型不一致**：`import.js` 的 `records` 是「轻量预览对象」，`index.js` 的 `records` 是「完整后端对象」，字段集不同——正是 `normalizeRecord` 要统一的目标。

---

## 6. 后续改动提案（研究性质 · 本轮未执行，仅提案）

> **状态：待用户授权。** 以下改动涉及 §0 禁止文件（`index.js` / `detail.js` / `api.js` 暂未触碰），**仅在此文档描述精确改法**，不修改任何代码。

### 提案 A：index.js / detail.js 复用 `record-model.js` 的 `parseMood` 去重

**为什么安全**：`record-model.parseMood` 与现有两处 `parseMood` 逻辑完全等价（含 `legacyMap` 5 种映射），且额外做了「非法 tone 回退 neutral、intensity 夹取 1-5」的兜底。替换为调用统一模块后行为一致，纯函数无副作用。

**A-1 · `pages/index/index.js`**
- 当前写法：
  - `index.js:18` `function parseMood(raw) { ... }`（含 `legacyMap` 5 条）
  - `index.js:37` `function moodToneClass(mood) { ... }`（保留，CSS 类名仍由它产出）
  - `index.js:611` `var moodObj = parseMood(r.mood);`
- 改成：
  1. 在文件顶部 `require` 引入：`var recordModel = require('../../utils/record-model.js');`
  2. **删除** `index.js:18-34` 的 `parseMood` 函数定义（含 `legacyMap`）。
  3. `index.js:611` 改为 `var moodObj = recordModel.parseMood(r.mood);`
- 影响面：仅 `_enrichRecord` 内的一处调用；`moodToneClass` 保留不动。

**A-2 · `pages/detail/detail.js`**
- 当前写法：
  - `detail.js:11` `function parseMood(raw) { ... }`（含 `legacyMap` 5 条）
  - 调用点：`detail.js:126` `var moodObj = parseMood(record.mood);`、以及 `detail.js:504` `var moodObj = parseMood(parsed.mood);`
- 改成：
  1. 顶部 `require` 引入：`var recordModel = require('../../utils/record-model.js');`
  2. **删除** `detail.js:11-26` 的 `parseMood` 函数定义。
  3. 两处调用改为 `recordModel.parseMood(...)`。
- 影响面：2 处调用，均为纯函数替换。

---

### 提案 B：后端 `createRecord` 始终回填 `content`

**为什么安全**：`content` 已是规范字段（`index.js` / `detail.js` 都读它）。若后端在 AI 解析后把 `content` 置为原始提交文本（= 语音 transcript / 用户粘贴文本），则入库记录自带 `content`，消除 §5-隐患 1。这是**后端契约补充**，前端 `api.js` 无需改调用，仅需在接口文档中明确「`createRecord` 响应必须包含 `content`」。

**B-1 · `utils/api.js`（`createRecord` 文档化补全，可选前端侧提示）**
- 当前写法：`api.js:86-92`
  ```js
  createRecord: function (content, recordedAt, attachments) {
    return api.post('/records', {
      content: content,
      recordedAt: recordedAt || undefined,
      attachments: attachments || undefined,
    });
  },
  ```
- 建议（**文档约定，非强制改代码**）：在注释中明确——返回的裸记录**必须**包含 `content` 字段（等于入参 `content`）。若后端目前未回填，则需在后端 `POST /records` 处理器里补 `record.content = req.body.content`。
- 前端侧可选增强（非必须）：在 `index.js` 渲染前对「列表记录」做一次 `normalizeRecord`，其中 `content` 兜底为 `transcript`（已是 `normalizeRecord` 的默认行为），这样即便后端漏填也不会让卡片正文完全空白。

---

## 7. 验证记录（T1）

- `node --check utils/record-model.js` → 通过。
- node 冒烟测试：
  - `mockParse('今天拜访了客户老王，谈妥报价12万。明天要跟进合同，还要记得联系物流。有点累但顺利。#记工')` → 正确抽出 `tags:["记工"]`、`todos`（含 `due:2026-07-18`）、`numericInfo:{"金额(万)":"12"}`、`status:'待办'`、`confidence:0.65`。
  - `normalizeRecord({id,content,mood:'开心',status:'待办',...})` → `mood={label:'开心',tone:'positive',intensity:3}`、`emotion:'positive'`、`type:'voice'`（附件命中 `/uploads/voice/`）。
  - `normalizeRecord(undefined)` → 不抛错，返回默认规范记录。
  - `validateRecord({content:'x', confidence:2, ...})` → `{ok:false, errors:[...]}` 正确拦截非法 `confidence` / `status`。

---

## 8. 任务归属

- 任务清单 **#4「收口 ParsedRecord schema 契约（数据真相源）」**：已完成（T1 验收通过）。
- 本轮：仅新建本文档 `docs/RECORD-SCHEMA.md`，未触碰任何既有文件。提案 A / B 待用户授权后执行。
