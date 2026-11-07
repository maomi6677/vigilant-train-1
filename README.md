# 苹果入库数据看板

自动跟踪**全国主产区苹果冷库入库量**：定时搜索公开资讯 → 抽取钢联 / 卓创口径数据 → 生成静态看板，部署在 GitHub Pages。

不用服务器，电脑关机也照常更新，打开网址就是最新一期。

## 页面里有什么

- **最新一期**：钢联、卓创两个口径的库存量、同比百分比、同比增减
- **两口径差额**：同一日期两个口径相差多少（主要分歧在山东入库统计）
- **同比对比**：本期 vs 去年同期的横向条形
- **趋势图**：数据积累 2 期后自动出现
- **历史表格**：每期两个口径 + 差值
- **数据来源**：每条数据对应的原文链接，可点回去核对

## 数据从哪来

东方财富的公开资讯搜索接口（无需 API key）→ 抓正文 → 规则抽取。

只认「全国主产区苹果冷库库存量为 XXX 万吨」这类表述，并识别句子里提到的「钢联 / Mysteel」和「卓创」，所以同一篇文章可以拆出两个口径。

拿不到付费终端里的原始周报，只能等机构研报、财经媒体把数字写进公开文章里。入库高峰期（10 月底到 11 月）公开报道最密集，覆盖最好。

## 5 分钟部署

1. 新建一个 **public** 仓库（私有仓库用 Pages 需要付费账户）。
2. 把本目录所有文件上传上去。
3. **Settings → Actions → General → Workflow permissions** 选 **Read and write**，保存。
4. **Settings → Pages**：Source 选 **Deploy from a branch**，Branch 选 **main**，目录选 **/docs**，保存。
5. **Actions → 更新苹果入库数据 → Run workflow** 手动跑一次。
6. 等 1～2 分钟，打开 `https://<用户名>.github.io/<仓库名>/`。

之后每天北京时间 09:30、17:30 自动更新。

## 配置

编辑 [`config/sources.json`](./config/sources.json)：

| 字段 | 说明 |
| --- | --- |
| `queries` | 搜索关键词，默认「苹果 冷库库存」「苹果 入库量」 |
| `pagesPerRun` | 每组关键词翻几页，默认 4（约几百条资讯） |
| `maxAgeDays` | 只看最近多少天的文章，默认 14 |
| `maxArticles` | 每次最多抓多少篇正文，默认 40 |
| `providers` | 页面上显示的口径名称 |

## 手工补录

自动抽取不到时（比如数字只在 PDF 研报里，或文章没被搜索到），直接编辑 [`config/manual-data.json`](./config/manual-data.json)：

```json
[
  {
    "date": "2026-11-05",
    "provider": "sci99",
    "total": 1001.28,
    "yoyDelta": 318.54,
    "sourceTitle": "苹果周报：冷库入库量大增 苹果期货触底反弹",
    "sourceMedia": "银河期货 · 新浪财经研报",
    "sourceUrl": "https://stock.finance.sina.com.cn/stock/go.php/vReport_Show/kind/11/rptid/847335987679/index.phtml",
    "note": "手工补录"
  }
]
```

- `provider` 可选 `mysteel`、`sci99`、`unknown`。
- 手工数据优先级最高，页面上会标「手工补录」。
- 如果只填 `total` 和 `yoyDelta`，看板会自动反推去年同期和同比百分比。

## 口径说明

- **钢联（Mysteel）** 与 **卓创（Sci99）** 统计的冷库总容量、产区覆盖不同，绝对值不能直接混用。
- 本期（2026-11-05）钢联 894.07 万吨、卓创 1001.28 万吨，相差 107.21 万吨，主要分歧在山东入库量。
- 入库仍在进行，11 月上旬的数字不是最终峰值，后续几周仍会上调。

## 已知限制

- 只覆盖公开资讯里出现的数字；卓创 / 钢联终端里的原始周报拿不到。
- 抽取是规则匹配，遇到新表述可能漏。漏了可以手工补录，或改 `scripts/lib/extract.mjs` 里的正则。
- 历史绝对值主要集中在入库高峰期，更早的周报往往只有定性描述（「入库量增加」）而没有具体吨数。
- 本页只做数据整理，不构成投资建议。

## 本地运行

需要 Node.js 20 以上，零依赖。

```bash
node scripts/collect.mjs   # 抓取并写入 docs/data/
node scripts/serve.mjs     # 预览 http://127.0.0.1:4180
```

想回填更多历史数据：

```bash
node scripts/collect.mjs --pages=45 --max-age=400 --max-articles=150
```

## 目录结构

```
apple-inventory/
├─ config/
│  ├─ sources.json          # 搜索关键词和采集参数
│  └─ manual-data.json      # 手工补录的数据点
├─ scripts/
│  ├─ collect.mjs           # 搜索 → 抓正文 → 抽取 → 合并 → 写 JSON
│  ├─ serve.mjs             # 本地静态服务器
│  └─ lib/
│     ├─ search.mjs         # 东财资讯搜索、正文抓取
│     ├─ extract.mjs        # 库存数字与口径抽取
│     └─ util.mjs           # HTML 清洗等
├─ docs/                    # GitHub Pages 根目录
│  ├─ index.html
│  ├─ app.js / styles.css
│  └─ data/
│     ├─ points.json        # 数据点（看板主数据）
│     ├─ articles.json      # 来源文章
│     └─ meta.json          # 采集状态
└─ .github/workflows/update.yml
```

## 和 cloud-digest 的区别

`cloud-digest` 是通用新闻摘要工具，适合「每天扫一遍资讯」；`apple-inventory` 是专用数据看板，适合「每周盯一个数字」。两者可以同时部署，互不影响。
