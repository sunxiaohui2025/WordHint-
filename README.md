# WordHint（语词）

WordHint 是一套面向中国英语学习者的跨端词汇学习系统。它由 Chrome 插件、原生 iOS App 和自建云服务组成：用户在网页真实语境中发现单词，在手机端通过间隔复习、听音、语境选词和 AI 短文继续学习。

项目采用 **local-first（本地优先）** 架构。Chrome 使用 `chrome.storage.local`，iOS 使用 SwiftData；没有网络时仍可阅读和学习，联网后再按账号进行双向同步。

## 核心能力

### Chrome 插件

- 基于多级本地词库识别网页中的疑难词。
- 以 `<ruby><rt>` 形式在英文单词上方显示中文释义。
- 支持悬停弹窗、划词翻译和上下文释义。
- “我认识”加入熟词清单，“加入学习名单”保存单词、释义、真实语境和时间。
- 支持陶土橙 Material Design UI 与操作 `+1` 反馈。
- 支持本地持久化、同步存储分片备份、JSON 导入导出和 CSV 导出。
- 支持账号注册、登录和云端手动双向同步。

### iOS App

- SwiftUI + SwiftData 原生应用，支持 iOS 17 及以上版本。
- 今日看板、学习计划、七天学习节奏和个人词库。
- SM-2 间隔重复：维护复习次数、间隔、难度因子、遗忘次数和下次复习时间。
- 混合练习：看词辨义、听音辨词、四选一语境填空。
- 答题后展示词义、词性、发音、补充解释和原始语境。
- AI 生成双语短文，支持主题、风格和难度设置。
- 系统美式发音、段落朗读和 Speech 跟读识别。
- 支持云同步、局域网直连和 JSON 文件导入。
- 本地词库和学习记录离线可用。

### WordHint Cloud

- FastAPI + SQLite，提供注册、登录、用户审批和停用。
- 按 `user_id + normalized_word` 隔离并去重用户数据。
- Chrome 与 iOS 双向同步完整词汇及 SM-2 学习参数。
- 管理员控制台提供用户管理、汇总统计和大模型配置。
- 代理 OpenAI 兼容的 vLLM 接口，模型密钥不下发到 iOS。
- 强制 `temperature = 0`、`enable_thinking = false` 并限制输出 token。

## 系统架构

```text
Chrome 插件（chrome.storage.local） ─┐
                                    ├── HTTPS ── WordHint API ── SQLite
iOS App（SwiftData） ────────────────┘                 ├── 管理员控制台
          │                                            └── vLLM 服务
          ├── 局域网 HTTP 同步（备用）
          └── JSON 文件导入（灾备）
```

云服务不是客户端的实时运行依赖：浏览器和手机不需要同时在线，也不需要位于同一个网络。服务器暂未部署公网时，可在 Mac 启动服务，并让手机与 Mac 连接同一局域网进行测试。

## 目录结构

```text
study/
├── wordhint/                 # Chrome Manifest V3 插件
│   ├── background.js         # 词库、筛选、存储、LLM 和消息处理
│   ├── content.js            # 网页分词、ruby 标注、悬浮与划词交互
│   ├── popup.html/js         # 设置、名单、账号和同步界面
│   ├── styles.css            # 插件 Material Design 样式
│   ├── config.template.js    # 插件 LLM 配置模板
│   ├── data/                 # 分级词库、释义字典和反向索引
│   └── test/                 # Node 单元、浏览器验证与 E2E 测试
├── WordHintIOS/
│   ├── WordHintIOS.xcodeproj # Xcode 工程
│   └── WordHintIOS/
│       ├── Models/           # SwiftData 与传输模型
│       ├── Services/         # 同步、导入、SM-2、LLM、音频
│       ├── Views/            # 今日、词库、练习、短文、同步、登录
│       ├── Theme/            # 陶土橙视觉主题
│       └── Resources/        # 随 App 打包的内置词库
├── server/                   # FastAPI 云服务与管理员控制台
│   ├── app/main.py
│   ├── requirements.txt
│   ├── start-local.sh
│   ├── Dockerfile
│   └── docker-compose.yml
├── GOAL.md                   # 产品目标与接口约束
├── CLOUD_ARCHITECTURE.md     # 云同步与安全边界
└── AGENTS.md                 # 仓库开发约定
```

## 快速开始

### 1. 启动本地云服务

需要 Python 3.11 或更高版本。首次运行先创建虚拟环境并安装依赖：

```bash
cd /Users/sun/Desktop/study/server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env.local
```

编辑 `.env.local`，至少设置以下内容：

```dotenv
WORDHINT_SECRET=请替换为足够长的随机字符串
WORDHINT_ADMIN_EMAIL=admin@example.com
WORDHINT_ADMIN_PASSWORD=请替换为强密码
WORDHINT_DATABASE=/Users/你的用户名/wordhint-data/wordhint.db
WORDHINT_LLM_BASE_URL=http://127.0.0.1:6018
WORDHINT_LLM_MODEL=你的模型名称
WORDHINT_LLM_API_KEY=你的API密钥
WORDHINT_PUBLIC_URL=http://127.0.0.1:8000
```

启动服务：

```bash
cd /Users/sun/Desktop/study/server
source .venv/bin/activate
./start-local.sh
```

常用入口：

- 健康检查：`http://127.0.0.1:8000/health`
- 管理员控制台：`http://127.0.0.1:8000/admin`
- OpenAPI 文档：`http://127.0.0.1:8000/docs`

局域网真机测试时，Chrome 和 iOS 中的服务器地址应填写 Mac 的局域网地址，例如 `http://192.168.x.x:8000`，不能填写手机自身的 `127.0.0.1`。可用以下命令查看 Mac Wi-Fi 地址：

```bash
ipconfig getifaddr en0
```

### 2. 加载 Chrome 插件

插件没有构建步骤：

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `/Users/sun/Desktop/study/wordhint`。
5. 打开插件，在云同步区域填写服务器地址并注册。
6. 管理员在 `/admin` 审批账号后，用户登录并点击“双向同步”。

插件也可独立使用。若需要插件直接调用 vLLM，将 `wordhint/config.template.js` 复制为 `wordhint/config.js` 并填写配置：

```bash
cd /Users/sun/Desktop/study/wordhint
cp config.template.js config.js
```

`config.js` 含敏感信息并已被 `.gitignore` 忽略。修改插件代码或配置后，需要在 `chrome://extensions/` 点击刷新，并刷新已打开的网页。

### 3. 运行 iOS App

1. 使用完整版 Xcode 打开 `/Users/sun/Desktop/study/WordHintIOS/WordHintIOS.xcodeproj`。
2. 选择 `WordHintIOS` target。
3. 在 **Signing & Capabilities** 中选择自己的 Apple Developer Team。
4. 选择 iOS 17+ 模拟器或已连接的 iPhone。
5. 点击 Run。首次真机运行时，按 iOS 提示信任开发者。
6. 在 App 登录页填写与 Chrome 相同的服务器地址和账号。
7. 在“同步”页点击“立即双向同步”。

模拟器可访问 Mac 的 `http://127.0.0.1:8000`；真机应使用 Mac 局域网 IP。开发环境允许本地 HTTP，生产环境必须使用 HTTPS。

## Docker 启动

服务器也可通过 Docker Compose 运行：

```bash
cd /Users/sun/Desktop/study/server
cp .env.example .env
# 修改密钥、管理员密码、数据库与模型配置
docker compose up -d --build
```

查看状态和日志：

```bash
docker compose ps
docker compose logs -f wordhint
```

Compose 默认只绑定 `127.0.0.1:8000`。若要直接供局域网设备测试，需要调整端口绑定；公网环境建议保持仅本机绑定，由 Caddy 或 Nginx 提供 HTTPS 反向代理。

## 数据与同步

### Chrome 本地结构

| Key | 类型 | 说明 |
|---|---|---|
| `selectedLibs` | `string[]` | 当前启用的词库 |
| `enabled` | `boolean` | 插件开关 |
| `fontSize` | `number` | 标注字号 |
| `whitelist` | `string[]` | 熟词清单 |
| `wordbook` | `object[]` | 学习名单 |

基础学习名单结构：

```json
{
  "word": "accurate",
  "meaning": "准确的",
  "sentence": "Built to be safe, accurate, and secure.",
  "time": "2026-07-13T16:53:33.925Z"
}
```

### iOS / 云端扩展字段

iOS 在基础字段上保存：

- 语言信息：`lemma`、`partOfSpeech`、`phonetic`、`englishDefinition`、`sourceURL`、`note`。
- 学习状态：`statusRaw`。
- SM-2：`repetitions`、`intervalDays`、`easeFactor`、`lapseCount`。
- 时间：`lastReviewedAt`、`nextReviewAt`、`updatedAt`。
- 同步：`deleted`。

服务端以 `user_id + lowercased normalized_word` 作为唯一键。客户端日常读取本地数据库；用户主动同步时提交本地数据、拉取远端数据并按标准化单词合并。iOS 手动同步当前采用完整对账，优先保证跨设备不漏词。

熟词在 iOS 中映射为 `ignored`，不会进入今日练习；学习名单默认作为新词进入复习计划。

### 备份策略

- Chrome：`chrome.storage.local` 为主存储，`chrome.storage.sync` 分片作为浏览器账号备份。
- 手动备份：插件可导出完整 JSON，iOS 可直接导入。
- 云端：生产环境应定期备份 SQLite 数据库或 Docker 数据卷。
- JSON 和局域网同步是云服务不可用时的备用迁移方式。

## 学习算法

WordHint 使用简化的 SM-2（SuperMemo 2）间隔重复算法。每次答题会更新：

```text
首次答对：1 天后复习
第二次答对：6 天后复习
后续答对：上次间隔 × easeFactor
答错：连续次数归零、间隔缩短为 1 天、遗忘次数 +1
```

难度因子采用经典公式并设置最低值 1.3：

```text
EF' = EF + 0.1 - (5-q) × (0.08 + (5-q) × 0.02)
```

今日练习优先顺序为“薄弱词 → 到期复习词 → 新词”。当前答对映射为质量 5、答错映射为质量 2，属于可运行的简化 SM-2；尚未加入答题耗时、多级主观难度和分钟级重学队列。

## LLM 接口

云服务代理 OpenAI 兼容的 vLLM Chat Completions 接口。核心约束：

```json
{
  "temperature": 0,
  "max_tokens": 5000,
  "chat_template_kwargs": {
    "enable_thinking": false
  }
}
```

- `enable_thinking` 必须为 `false`。
- iOS 只调用 WordHint 服务的 `/api/v1/llm/chat`，不保存 vLLM API Key。
- 插件独立模式可使用本地 `config.js` 直接调用模型。
- 管理员可以在 `/admin` 修改模型地址、模型名称、API Key 和最大输出长度。

## 测试与构建验证

### Chrome

在 `wordhint/` 目录执行：

```bash
cd /Users/sun/Desktop/study/wordhint
node --check background.js
node --check popup.js
node test/unit.mjs
```

浏览器验证测试需要 `puppeteer-core`：

```bash
node test/verify.mjs
node test/e2e.mjs
```

`e2e.mjs` 连接 `http://127.0.0.1:9223`，需要先以远程调试模式启动 Chrome。

### iOS

命令行模拟器构建：

```bash
cd /Users/sun/Desktop/study
xcodebuild \
  -project WordHintIOS/WordHintIOS.xcodeproj \
  -scheme WordHintIOS \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO build
```

真机构建和安装建议直接使用 Xcode，以便自动管理签名和开发者信任。

### 服务端

服务启动后检查：

```bash
curl http://127.0.0.1:8000/health
```

完整 API 可在 `/docs` 中交互测试。

## 公网部署建议

1. 使用 Linux 服务器运行 Docker Compose。
2. 使用 Caddy 或 Nginx 将域名 HTTPS 请求反向代理到 `127.0.0.1:8000`。
3. 防火墙只开放 80/443，不公开 SQLite、8000 和 vLLM 端口。
4. 替换默认管理员密码和 `WORDHINT_SECRET`。
5. 将 `WORDHINT_PUBLIC_URL`、Chrome 和 iOS 地址改为 `https://你的域名`。
6. 定期备份数据库；用户量增加后迁移到 PostgreSQL。
7. 不要将 `.env`、`.env.local`、`config.js`、数据库、Token 或模型密钥提交到仓库。

## 常见问题

### 手机无法连接本地服务器

- 手机与 Mac 必须连接同一网络。
- 手机中不能填写 `127.0.0.1`，应填写 Mac 的局域网 IP。
- 确认服务使用 `--host 0.0.0.0` 启动。
- 检查 macOS 防火墙是否阻止 Python/uvicorn。
- 使用手机 Safari 打开 `http://Mac-IP:8000/health` 验证网络。

### 云同步成功但首页没有新词

- 在 iOS“同步”页检查“学习词 / 熟词 / 本机总数”。
- 熟词会保存为“已忽略”，不会进入今日计划。
- 已掌握或尚未到复习时间的词不会作为今日新词出现。
- 确认 Chrome 和 iOS 登录的是同一账号、同一服务器地址。

### AI 请求被 ATS 拦截

本地调试可以使用工程已有的本地网络配置；正式部署应使用 HTTPS。不要在生产版本中依赖任意 HTTP 放行。

### 管理员登录后普通用户仍不能登录

新注册账号默认是 `pending`。管理员需要在 `/admin` 将用户状态批准为 `approved`。

### 修改代码后 Chrome 没变化

在 `chrome://extensions/` 刷新插件，并重新加载目标网页。Manifest V3 service worker 可能仍运行旧版本，必要时关闭后重新启用插件。

## 当前限制与路线图

- 同步目前以用户主动触发为主，尚未实现完整后台自动同步和失败重试。
- 删除墓碑和跨设备删除冲突仍需进一步完善。
- SQLite 适合当前规模，大规模多用户部署建议迁移 PostgreSQL。
- 账号系统尚可继续增加邮箱验证、密码找回、Token 撤销和设备管理。
- SM-2 当前使用二元质量评分，后续可加入“忘记/困难/熟悉/轻松”、答题耗时和当天重学。
- 管理员统计目前以汇总信息为主，可继续增加用户学习趋势和同步审计。

## 安全说明

- 密码使用 scrypt 加盐哈希，服务端不保存明文密码。
- 登录 Token 使用服务端密钥签名；iOS Token 保存于 Keychain。
- 用户词库按账号隔离。
- LLM API Key 只应保存在服务端环境变量或管理员配置中。
- 本项目仍处于开发阶段，公网开放前应完成 HTTPS、密钥轮换、备份恢复和安全审计。

## License

本项目使用 Business Source License 1.1。个人、学术和非营利用途可按许可证使用；商业用途需要单独授权。详细内容见 [LICENCE.md](./LICENCE.md)。
