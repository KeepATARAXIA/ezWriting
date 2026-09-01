<div align="right">
  <strong>简体中文</strong> · <a href="./README.md">English</a>
</div>

<div align="center">

# EZWRITING

**本地优先的多平台内容准备、排版与导出工作台**

把一份 Markdown、HTML 或 ZIP 稿件带进浏览器，在同一个页面完成编辑、素材整理、平台预览、图片导出和草稿分发。

[在线体验](https://ezwriting.online/) · [功能导览](#功能导览) · [快速开始](#快速开始) · [平台支持](./docs/PLATFORM_SUPPORT.md) · [路线图](./ROADMAP.md) · [English](./README.md)

[![CI](https://github.com/KeepATARAXIA/ezWriting/actions/workflows/ci.yml/badge.svg)](https://github.com/KeepATARAXIA/ezWriting/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.2.0-2457FF)](./CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827)](./LICENSE)

</div>

> [!IMPORTANT]
> EZWRITING 当前处于公开 MVP 阶段，推荐使用桌面端 Chrome、Edge 或其他 Chromium 浏览器。导入、编辑、预览、备份和结果导出不需要登录；通过 [文章同步助手 Wechatsync](https://github.com/wechatsync/Wechatsync) 进行的草稿同步属于实验性增强，并依赖目标平台的登录状态。

当前版本：**v0.2.0 可靠性版本**。测试草稿同步前，请先查看带核对日期的[平台支持矩阵](./docs/PLATFORM_SUPPORT.md)和[已知问题](./docs/KNOWN_ISSUES.md)。平台页面、账号权限和扩展行为可能独立于 EZWRITING 发生变化。

## EZWRITING 解决什么问题

长文写完以后，通常还要为公众号重新排版、为小红书拆成图文卡片、为 X 调整阅读节奏，再重复上传图片、复制正文和检查草稿。平台越多，版本越容易分叉。

EZWRITING 把这段流程收进一个本地优先的网页工作台：只维护一份主稿，由不同预览层生成适合各平台的呈现，最后由用户人工复核并决定是否进入平台草稿箱。

~~~mermaid
flowchart LR
    A["Markdown / HTML / ZIP / 文件夹"] --> B["浏览器本地解析与安全过滤"]
    B --> C["一份可编辑主稿"]
    C --> D["公众号长文"]
    C --> E["小红书图文卡片"]
    C --> F["X Article"]
    D --> G["复制格式 / 草稿同步"]
    E --> H["PNG / ZIP / 草稿同步"]
    F --> I["长文预览 / 草稿同步"]
~~~

## 功能总览

| 环节 | 当前能力 |
| --- | --- |
| 起稿 | 空白文档、公众号长文、小红书图文和 X 长文模板 |
| 导入 | Markdown、HTML、ZIP 内容包，以及包含正文与素材的文件夹 |
| 编辑 | Markdown 主稿、常用格式工具、语法显示切换、图片与本地视频、撤销与重做 |
| 资源 | 集中查看正文图片、补齐缺图、批量选择图片或文件夹、替换和删除素材 |
| 公众号 | 26 套完整文章主题、字体/字号/行距/配色、电脑与手机预览、复制公众号格式 |
| 小红书 | 自动拆分 3:4 卡片、20 套长文页型、80 套专属配色、7 组模板字体、PNG 与 ZIP 导出 |
| X Article | 长文版式、字体/字号/行距/强调色、电脑与手机预览 |
| 本地数据 | IndexedDB 自动保存、历史稿件、软删除撤销、整库备份与恢复 |
| 诊断 | 导出不含正文、文件名和账号信息的脱敏可靠性报告 |
| 草稿同步（Beta） | 检测 Wechatsync、读取已登录平台、多选平台、显示进度/失败原因/草稿入口 |
| 安全 | HTML 净化、ZIP 数量与体积限制、路径穿越拒绝、草稿默认不公开发布 |

## 功能导览

### 1. 从空白、模板或已有文件开始

![主页、起稿模板与文件导入](./docs/readme-assets/home-import.png)

首页提供三种入口：

- 点击“开始创作”创建空白稿件。
- 使用公众号长文、小红书图文或 X 长文模板快速起稿。
- 拖入文件，或选择 Markdown、HTML、ZIP 和文章文件夹。

主页同时显示本地稿件数量、已连接平台和最近文档。文件解析默认在浏览器本地完成，导入后直接进入编辑工作台。

### 2. 一份主稿，左右同步编辑与预览

![Markdown 编辑器与公众号实时预览](./docs/readme-assets/product-workbench-overview.png)

工作台左侧维护唯一正文，右侧显示当前平台效果。顶部可以切换公众号、小红书和 X，也可以选择仅编辑、左右分栏或仅预览。

编辑端包含：

- 标题和 Markdown 正文编辑。
- 标题、列表、引用、代码、链接、高亮、图片等常用工具。
- “显示/隐藏语法”模式：隐藏时更接近排版编辑，光标所在行仍可查看原始 Markdown。
- 至少保留最近 100 个独立编辑事件的撤销历史，并显示当前撤销/重做深度。
- 本地图片的插入、替换、删除和说明编辑。
- 本地 MP4 / WebM 视频插入与播放，单文件上限 50 MiB；视频只在左侧编辑器中播放，右侧平台预览使用稳定的静态画面，需要平台原生上传时会给出人工处理提示。
- 点击右侧正文定位左侧源码，左侧编辑会实时更新右侧预览。

编辑区内的“导入”还支持两种模式：追加到当前内容，或用新文件替换当前稿件。

### 3. 集中整理文章图片和缺失资源

![文档资源管理](./docs/readme-assets/asset-management.png)

“资源”页会把正文图片集中列出，并标明素材序号与状态。可以：

- 点击素材定位到右侧文章上下文。
- 一次选择多张图片，或选择整个素材文件夹。
- 对缺失图片重新关联本地文件。
- 替换、删除正文素材，并继续保留统一的主稿结构。

单独导入 Markdown 时，浏览器无法自动读取文件旁边的本地图片。推荐选择完整文章文件夹，或使用包含正文和素材的 ZIP 内容包。

### 4. 微信公众号：主题、排版与格式复制

![微信公众号主题与排版设置](./docs/readme-assets/wechat-themes.png)

公众号预览面向完整长文排版：

- 26 套图形主题卡，覆盖简约、书卷、杂志、商务、科技、活力等方向。
- 主题选择器用紧凑图形展示每套方案的色彩、标题、引用和阅读节奏，点击即可应用。
- 每套主题同时处理标题、正文、引用、列表、分隔线、代码等结构。
- 字体、字号、正文行距和主题配色可分别调整，多组设置可以同时展开。
- 支持电脑预览与手机效果预览。
- “复制公众号格式”会生成带内联样式的正文，用于粘贴到公众号编辑器。

复制后仍建议在公众号后台完成一次最终检查，因为平台可能再次清洗样式。

### 5. 小红书：自动分页、视觉模板与图片导出

![小红书卡片整体预览与模板面板](./docs/readme-assets/multi-platform-output.png)

小红书预览会把长文自动拆成 3:4 图文卡片：

- 20 套长文页型，按灵感、杂志、纸感、信息和构成分类。
- 模板库使用紧凑的三段式图形预览，同时展示封面、正文和图片页的构成逻辑。
- 每套模板提供 4 套专属色板，共 80 套配色；切换色板会整套更新背景、正文、标题、强调色、边框和辅助色。
- 7 组模板字体会随页型自动变化，也可以手动改为通用黑体或宋体。
- 排版、字体、间距和颜色分区独立展开；模板只负责版式，专属色板统一在“颜色”区切换。
- 支持单页、双页和整体预览，并可跳转到指定页。
- 可以放大检查单页、调整正文图片的通栏/左右图文布局和宽度。
- 单张导出为 1080 × 1440 PNG；全部卡片可打包为 ZIP。
- 页码、底部署名和输出信息可以独立设置。

![小红书模板字体与专属色板](./docs/readme-assets/xiaohongshu-styles.png)

模板、字体、色板、实际预览、分页和图片导出使用同一套样式结果，选择后可以直接在单页画面中检查最终效果。

这条流程不依赖发布扩展，适合把导出的图片交给小红书或其他图文平台人工发布。

### 6. X Article：面向长文阅读的独立预览

![X Article 长文预览与排版设置](./docs/readme-assets/x-article-preview.png)

X 预览按照 Article 长文结构组织标题、作者和正文，并提供：

- 简洁、刊物和强调三种版式方向。
- 字体、字号、行距与强调色设置。
- 电脑和手机效果预览。
- 与主稿同步的标题、图片、代码和长文结构。

自动创建 X Article 草稿取决于账号是否具备对应权限，以及平台当时的页面行为；请以[平台支持矩阵](./docs/PLATFORM_SUPPORT.md)中的实测状态为准。

### 7. 本地历史、自动保存、备份与诊断

![本地稿件、自动保存与备份入口](./docs/readme-assets/local-first-workspace.png)

稿件、图片、视频引用和排版设置默认保存在当前浏览器的 IndexedDB 中。侧栏会显示稿件标题、类型、更新时间和保存状态。

- 编辑后自动保存，无需手动提交到 EZWRITING 服务器。
- 支持切换历史稿件、修改“图文/长文”类型、软删除以及短时间内撤销删除。
- 导出完整 <code>.ezwriting-backup.json</code>，可在另一个浏览器或新域名中恢复。
- 导出脱敏诊断报告，包含应用/浏览器状态和近期导入计时，但不包含正文、文件名或账号信息。

清理网站数据、切换浏览器或更换域名前，请先导出备份。

### 8. 可选的多平台草稿同步

![选择多个平台并创建草稿](./docs/readme-assets/draft-delivery.png)

安装 Wechatsync 并在同一 Chromium 浏览器登录目标平台后，EZWRITING 可以读取可用账号并打开发布抽屉：

- 同时选择多个平台。
- 发布前检查本地稿件、发布引擎和平台选择状态。
- 分平台显示等待、处理、成功和失败结果。
- 保留失败原因、人工核对提示和扩展返回的草稿入口。
- 默认只创建草稿，不会无人值守地公开发布。

EZWRITING 不要求填写平台用户名或密码；执行器使用浏览器里已经存在的登录会话。草稿同步是可替换的增强功能，本地导入、编辑、预览和导出不依赖它。

## 支持的内容格式

| 输入 | 说明 |
| --- | --- |
| Markdown | <code>.md</code>、<code>.markdown</code>；支持 YAML front matter、标准图片语法和 Obsidian 图片引用 |
| HTML | <code>.html</code>、<code>.htm</code>；导入后转换为适合继续编辑的 Markdown，并对派生 HTML 做安全过滤 |
| ZIP | 一份 Markdown 或 HTML 正文，加相对路径引用的图片素材 |
| 文件夹 | 直接选择包含正文和图片的目录，不必先手动压缩 |

推荐的 ZIP 或文件夹结构：

~~~text
article/
├── article.md
└── assets/
    ├── image-01.jpg
    └── image-02.jpg
~~~

Markdown 可以使用标准图片引用或 Obsidian 图片引用：

~~~markdown
![图片说明](assets/image-01.jpg)
![[assets/image-01.jpg]]
~~~

ZIP 安全限制：压缩包最大 20 MB、最多 120 个文件、单文件解压后最大 8 MB、总解压大小最大 30 MB，并拒绝绝对路径、<code>../</code> 等路径穿越内容。

## 快速开始

### 直接使用在线版本

打开 [EZWRITING 公开测试版](https://ezwriting.online/)：

1. 新建文档，或导入文章文件/内容包。
2. 在左侧编辑正文，在“资源”页补齐图片。
3. 在右侧检查公众号、小红书或 X 预览。
4. 复制公众号格式、导出小红书图片，或保留整理后的长文。
5. 如需同步草稿，再安装 Wechatsync 并登录目标平台。

本地工作流不需要账号，也不要求安装发布扩展。

可以直接下载[纯 Markdown 示例](./examples/sample-article.md)或[轻量图片内容包](./examples/content-package-image-test-lite.zip)测试导入。

### 在本地运行

环境要求：Node.js 24.15 或更高版本。

~~~bash
git clone https://github.com/KeepATARAXIA/ezWriting.git
cd ezWriting
npm install
npm run dev
~~~

需要调试 Wechatsync 桥接时，请使用终端输出的 <code>http://127.0.0.1</code> 地址打开页面，并在同一浏览器中启用扩展。

验证命令：

~~~bash
npm test
npm run typecheck
npm run build
npm run test:browser
npm run verify
~~~

<code>npm run verify</code> 会执行单元/组件测试、生产构建和浏览器可靠性门禁。

## 本地数据与隐私

- 当前版本没有 EZWRITING 账号系统，也不会把本地稿件同步到 EZWRITING 服务器。
- 文章、图片、视频引用、历史记录和排版设置默认只保存在当前浏览器。
- 远程图片仍可能被浏览器或目标平台请求。
- 只有用户主动发起草稿同步后，所选内容才会交给发布扩展和目标平台。
- 诊断报告不包含正文、文件名、Cookie、Token 或账号详情。
- 公开反馈问题前，仍请检查截图和日志中是否包含私人草稿链接或未发布内容。

## 技术结构

项目使用 React、TypeScript 和 Vite。文件处理、文章模型、编辑预览、本地存储与发布桥接保持分层，UI 不直接依赖 Wechatsync 的私有适配器结构。

| 层级 | 主要职责 | 位置 |
| --- | --- | --- |
| 文章模型 | 统一稿件结构、排版与保存状态 | <code>src/domain/</code> |
| 文件处理 | Markdown / HTML / ZIP 解析、兼容与缺图处理 | <code>src/lib/file-parser.ts</code>、<code>src/lib/markdown-compatibility.ts</code> |
| 编辑与预览 | Markdown 编辑器、三平台预览和卡片导出 | <code>src/components/</code> |
| 本地存储 | IndexedDB 稿件仓库、自动保存和整库备份 | <code>src/services/</code> |
| 发布桥接 | 可替换的 Wechatsync 网页桥接 | <code>src/lib/wechatsync-bridge.ts</code> |
| 静态托管 | Cloudflare Worker 健康检查与静态资源 | <code>cloudflare/worker/</code> |

## 当前限制

- 当前重点适配桌面端 Chromium 浏览器；Firefox、Safari 和移动浏览器无法完成相同的扩展发布流程。
- X Article 草稿能力取决于账号权限和平台规则，仍需更多真实账号验证。
- 小红书和其他图文平台优先使用 PNG / ZIP 导出；平台草稿能力以 Wechatsync 实际返回为准。
- 本地视频可在编辑器与适用预览中播放，但目标平台的原生媒体上传仍需逐平台处理。
- 默认保存为草稿，不提供无人值守发布。
- 暂不包含账号、云同步、定时发布、数据看板、DOCX / PDF 导入或 AI 改写。
- 项目仍处于 MVP 阶段，平台页面变化可能影响扩展桥接结果。

当前验证状态请查看[平台支持矩阵](./docs/PLATFORM_SUPPORT.md)和[已知问题](./docs/KNOWN_ISSUES.md)。计划工作记录在公开[路线图](./ROADMAP.md)中，重要变更记录在[更新日志](./CHANGELOG.md)中。

## 参与贡献

欢迎提交范围明确的问题和小型 Pull Request。提交前请阅读[贡献指南](./CONTRIBUTING.md)，并从日志或截图中删除 Cookie、Token、账号名、私密草稿链接和未公开正文。

## 致谢

EZWRITING 的多平台发布执行能力建立在开源项目 [文章同步助手 Wechatsync](https://github.com/wechatsync/Wechatsync) 之上。该项目由 [fun](https://github.com/lljxx1) 创建并采用 GPL-3.0 许可证。

EZWRITING 负责文件导入、编辑、资源整理、平台预览、本地历史和发布反馈；Wechatsync 负责平台适配与最终同步。两者保持边界清晰，发布执行器可以被替换。

## 许可证

EZWRITING 使用 [MIT License](./LICENSE) 发布。第三方代码及其原始许可证记录在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 中。
