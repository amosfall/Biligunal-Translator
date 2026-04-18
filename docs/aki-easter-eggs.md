# AKI 译文彩蛋格式说明

本文档描述高校彩蛋与旧版关键词的**触发规则**与**输出格式**。高校数据在 **`lib/uniEasterData.ts`**，逻辑在 **`lib/akiEasterEggs.ts`**。

## 何时触发

1. 顶栏 **译成** 选择 **AKI 码**。
2. 正文某一**整段**（一个段落）在规范化后与表中 **`match` 字符串完全一致**。
3. 规范化规则见 `normalizeEasterInput()`：去首尾空白、换行统一、连续空白压成单空格、全角 `＋` 转为半角、`+` 两侧可留空格，最终会规范成 `学校A + 学校B` 这种形式（与表中联合校名一致即可命中）。

联合校名示例：用户输入 `华中师范大学+武汉理工大学` 或带空格的 `华中师范大学 + 武汉理工大学`，规范化后与表内 `华中师范大学 + 武汉理工大学` 一致即可命中。

## 输出长什么样（无 UI 标签）

彩蛋**不**输出「（中文）」「（English）」前缀，结构为：

```text
【aki码】<第一行密文>

<中文正文>

<英文正文>
```

- **第一行密文**：对**当前随机选中的那条** `{ zh, en }` 里的 **`zh`** 做 `encodeAki` 后再加 `【aki码】` 前缀。彩蛋路径在 `customCipher` 里使用 **`wrapAkiDisplay`**（该段始终带前缀）；普通编码使用 `wrapAkiDisplayIfFirst`，仅第一段带前缀。
- **中文正文**：当前选中的 **`zh`**。
- **英文正文**：当前选中的 **`en`**。

若中文与英文完全相同会合并为一行（旧版关键词偶发；高校类一般为两句）。

### 高校类（`lib/uniEasterData.ts` 中 `UNIVERSITY_ROWS`）

| 字段 | 含义 |
|------|------|
| `match` | 用户须整段输入的原文，与规范化后逐字相等。 |
| `variations` | `{ zh: string; en: string }[]`，每条为一组中英文梗。 |
| **随机** | 构建译文时 **`Math.random()` 任选一条** `variation`；多条梗不会同时展示。 |

表中 **compound**（两校用 `+`）的条目写在数组前部，便于维护（当前为全表顺序精确匹配）。

### 旧版关键词（`lib/akiEasterEggs.ts` 中 `EASTER_TRIPLE`）

| `kind` | 触发（规范化后） | `cipherSource` | 中文 `zh` | 英文 `en` |
|--------|------------------|----------------|-----------|-----------|
| `hku` | `hku`（大小写不敏感） | `HKU` | 固定文案 | 固定文案 |
| `i_love_you` | `i love you` | `i love you` | 固定文案 | 固定文案 |
| `aki_name` | `aki` | `aki` | 固定文案 | 固定文案 |

## 代码入口

- **匹配**：`matchAkiEasterEggSource(raw: string): AkiEasterMatch | null`
- **生成译文栏字符串**：`buildAkiEasterEgg(match, { encodeAki, wrapAkiDisplay })`
- **被调用**：`lib/customCipher.ts` 中 `encodeSourceParagraphToAkiColumn` / `applyAkiEncodingToPairs`

## 新增一条高校彩蛋

在 **`lib/uniEasterData.ts`** 的 `UNIVERSITY_ROWS` 中追加一项，例如：

```typescript
{
  match: "某某大学",
  variations: [
    { zh: "第一条中文梗", en: "First English line." },
    { zh: "第二条中文梗", en: "Second English line." },
  ],
},
```

保存后执行 `npm run lint` 确认类型无误即可。每次翻译会在 `variations` 里**随机**展示一条。
