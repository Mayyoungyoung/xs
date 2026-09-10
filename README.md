# 墨脉 · AI 小说工作台

一个同时包含 Web 创作工作台和 Python CLI 的大模型小说创作系统。它把世界观、人物、世界线、主线、支线、文风与章节正文作为可编辑资产，并允许作者随时和模型讨论后重绘或重写。

## Web 工作台

```powershell
cd webapp
Copy-Item .env.example .env.local
# 编辑 .env.local，只在本机填入 DEEPSEEK_API_KEY
npm ci
npm run dev
```

浏览器打开 `http://localhost:5173`。Web 端目前提供：

- 以书架作为首页，创建、搜索、排序、导入和备份多本小说；点击书籍后进入独立编辑工作台。

- `deepseek-v4-flash`（默认）与 `deepseek-v4-pro` 模型选择。
- 从一句话扩展故事种子，并在右侧与模型持续共创。
- 普通网页、图书数据库与百科的组合检索，可查作品、题材、人物、作家与作品文风，并回看原始来源。
- TXT、Markdown、JSON 本地借鉴资料加载。
- 主线横向贯穿、支线从节点生长/交汇/回收的情节编排图。
- 通过自然语言要求模型添加支线并更新情节图。

借鉴功能只提取高层结构、人物功能和可描述的文风参数，不抓取或复刻小说正文。

### 密钥安全

- 密钥只从 `DEEPSEEK_API_KEY` 环境变量或未跟踪的 `webapp/.env.local` 读取。
- `.env`、`.env.*`、`*.key` 和 `*.pem` 已加入忽略规则。
- 仓库中只提供不含真实密钥的 `.env.example`。

## CLI 初版

当前已实现一个无外部依赖的 Python CLI 原型：

```powershell
python -m novel_agent --help
python -m novel_agent init
python -m novel_agent create-book "灵脉残卷" --genre "玄幻升级流" --premise "废柴少年发现母亲失踪与宗门禁地有关"
python -m novel_agent list-books
python -m novel_agent demo <book_id>
```

没有配置 API Key 时，系统会自动使用 mock 模式，用来验证多书籍沙盒、Agent 流程和闸口机制。

### 使用 DeepSeek

在 PowerShell 中设置环境变量后运行即可：

```powershell
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
python -m novel_agent world <book_id>
```

当前默认调用：

- base URL: `https://api.deepseek.com/chat/completions`
- model: `deepseek-v4-flash`

也可以使用 `--model deepseek-v4-pro` 临时切换：

```powershell
python -m novel_agent --model deepseek-v4-flash world <book_id>
```

### 当前命令

```text
init             创建本地 workspace 目录
create-book      创建一本新书
list-books       列出所有书籍
artifacts        列出一本书的产物
research         生成风向报告
style            根据样本文本生成 Style Prompt
reference        加入本地剧情、人物、文风或世界观借鉴资料
world            生成世界观白皮书
characters       生成深度人物卡
outline          生成分卷与章节大纲
draft            生成章节初稿、审查、润色与快照
demo             按顺序跑一遍最小闭环
```

每个核心产物都会进入闸口：

- `approve`：确认产物。
- `reject`：记录修改意见。
- `skip`：保留待确认。

产物会写入 `workspace/books/<book_id>`，每本书独立存储。

## 文档

产品与技术规格见：

- [docs/novel-agent-system-spec.md](docs/novel-agent-system-spec.md)
- [docs/implementation-roadmap.md](docs/implementation-roadmap.md)
