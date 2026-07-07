# WordHint - 英语疑难词翻译助手

一个 Chrome 浏览器扩展，在阅读英文网页时自动标注疑难单词的中文释义。

## 🎯 产品定位

WordHint 不做全文翻译，只挑出网页中的**疑难英文单词**，将中文释义以 ruby 振假名样式标注在单词正上方，帮助用户：
- 降低英文阅读障碍
- 在上下文中学习词汇
- 个性化管理生词本

## ✨ 核心功能

### 1. 智能疑难词识别
- **两步筛选机制**：本地词表初筛 → 大模型上下文释义
- **多级难度档位**：高考/四级/六级/考研/雅思/托福/GRE
- **白名单过滤**：已掌握的单词不再标注

### 2. 悬浮注音标注
- 使用 HTML `<ruby>` 标签，中文释义紧贴单词上方
- 悬停/点击显示详细解释浮层
- 支持「我认识」（加入白名单）和「收藏」（加入学习名单）操作

### 3. 生词本管理
- **白名单**：标记为"认识"的词，后续不再标注
- **学习名单**：收藏的疑难词，支持导出 CSV
- 数据本地存储（`chrome.storage.local`），不上传任何服务器

### 4. 划词翻译
- 选中任意英文文本，弹出翻译浮层
- 支持单词释义和句子翻译
- 可直接加入收藏学习名单

## 📦 安装使用

### 环境准备
1. Chrome 浏览器（支持 Manifest V3）
2. 本地 vLLM 服务（OpenAI 兼容格式）

### 配置大模型
复制 `wordhint/config.template.js` 为 `wordhint/config.js` 并填写你的配置：

```js
// wordhint/config.js
export const LLM_CONFIG = {
  // vLLM API 基础地址（不含模型名称）
  BASE_URL: 'http://your-server:port',
  
  // 模型名称
  MODEL: 'your-model-name',
  
  // API Key
  API_KEY: 'your-api-key',
  
  // 关闭思维链（必须为 false，否则请求会超时）
  ENABLE_THINKING: false,
  
  // 温度参数
  TEMPERATURE: 0,
  
  // 释义请求最大 token 数
  MAX_TOKENS: 500,
  
  // 划词翻译最大 token 数
  MAX_TOKENS_SELECTION: 600
};
```

> ⚠️ 注意：`config.js` 已加入 `.gitignore`，可安全存储敏感信息。提交代码时只会提交 `config.template.js` 模板文件。

### 加载扩展
1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `wordhint/` 目录

### 使用方式
1. 访问任意英文网页
2. 点击扩展图标打开设置面板
3. 选择需要的词库难度（可多选）
4. 疑难词会自动标注中文释义

## 📦 打包发布

### 方法一：Chrome 浏览器打包（推荐）

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「打包扩展程序」
4. 扩展程序根目录填写：`wordhint/` 的完整路径
5. 点击「打包扩展程序」
6. 生成 `.crx`（扩展文件）和 `.pem`（私钥，请妥善保管！）

### 方法二：命令行打包（macOS）

```bash
# 使用内置脚本（自动调用 Chrome）
cd wordhint
./scripts/pack-simple.sh

# 或使用 Node.js 脚本（需要 Node 环境）
npm install
npm run pack
```

打包产物位于 `build/` 目录：
- `wordhint.crx` - 可扩展文件
- `wordhint.pem` - 私钥（首次生成，丢失后无法重新发布同一扩展）

### 方法三：ZIP 压缩包（用于源码分发）

```bash
cd wordhint
zip -r ../wordhint.zip \
  background.js content.js popup.html popup.js styles.css manifest.json \
  config.js data/ icons/ wordlists/
```

> ⚠️ 注意：`.crx` 文件和 `.pem` 私钥已加入 `.gitignore`，不应提交到 Git。

## 🏗️ 项目结构

```
study/
├── wordhint/              # Chrome 扩展主目录
│   ├── background.js      # 服务 worker：词库加载、过滤逻辑、LLM 调用
│   ├── content.js         # 内容脚本：单词提取、注音注入、交互处理
│   ├── popup.html/js      # 设置面板 UI
│   ├── styles.css         # 样式文件
│   ├── manifest.json      # 扩展清单
│   ├── config.js          # LLM 配置（本地，.gitignore）
│   ├── config.template.js # LLM 配置模板（可提交）
│   ├── data/              # 词库数据
│   │   ├── word_dict.json       # 单词→中文释义字典
│   │   ├── word_library.json    # 单词→词库归属映射
│   │   ├── compulsory.json      # 义务教育词库
│   │   ├── gaokao_diff.json     # 高考疑难词
│   │   ├── cet4_diff.json       # 四级疑难词
│   │   ├── cet6_diff.json       # 六级疑难词
│   │   ├── postgrad_diff.json   # 考研疑难词
│   │   ├── ielts_diff.json      # 雅思疑难词
│   │   ├── toefl_diff.json      # 托福疑难词
│   │   └── gre_diff.json        # GRE 疑难词
│   └── wordlists/         # 原始词表文本
├── GOAL.md                # 产品需求文档
├── CLAUDE.md              # AI 助手开发指南
├── .env.example           # 环境变量模板（可选）
├── .gitignore             # Git 忽略规则
└── README.md              # 本文件
```

## 🧪 测试

测试位于 `wordhint/test/`，使用 Node.js 运行（ES 模块，无测试框架）：

```bash
# 单元测试 - 纯逻辑检查，无需浏览器
node test/unit.mjs

# 验证测试 - 需要 puppeteer-core 和 Chrome
node test/verify.mjs

# E2E 测试 - 需要 Chrome 开启远程调试端口 9223
node test/e2e.mjs
```

## 📝 技术架构

### 注解流程
1. `content.js` 提取页面单词 → 发送 `FILTER_WORDS` 消息
2. `background.js` 执行优先级过滤：
   - 缩写词跳过 → 学习名单强制翻译 → 白名单跳过 → 选中词库匹配 → 其余跳过
3. 有本地释义的词立即标注，未知词批量调用 LLM
4. 结果以 `<ruby><rt>` 形式渲染到页面

### 数据存储
全部使用 `chrome.storage.local` 本地存储：
- `selectedLibs`: 选中的词库列表
- `enabled`: 扩展启用状态
- `fontSize`: 注音字体大小
- `whitelist`: 白名单单词
- `wordbook`: 学习名单（含释义、来源句、时间戳）

### LLM 接口规范
```json
POST {BASE_URL}/{MODEL}/v1/chat/completions
{
  "model": "{MODEL}",
  "messages": [
    {"role":"system","content":"你是英语词汇助手..."},
    {"role":"user","content":"句子：...\n难词：word1, word2"}
  ],
  "temperature": 0,
  "chat_template_kwargs": {"enable_thinking": false}
}
```

## License  许可协议

Business Source License 1.1 (BSL-1.1)
- [商业源代码许可协议 1.1 (BSL-1.1)](LICENCE.MD)

Personal / academic / non-profit use: free and unrestricted
Commercial use: requires a separate license — contact @扶摇Sun on 小红书
Change date: 2029-03-16 — after which the code converts to Apache 2.0

## 🙏 致谢

感谢所有贡献公开词表的开发者和教育工作者。
# WordHint-
