<div align="right">
  <strong>简体中文</strong> · <a href="./README_EN.md">English</a>
</div>

<div align="center">

# EZWRITING

**本地优先的多平台内容分发工作台**

把一份 Markdown、HTML 或 ZIP 稿件带进浏览器，在同一个页面完成编辑、图片整理、平台预览和草稿同步。

[在线体验](https://ezwriting-dev.a2976916992.workers.dev/) · [功能说明](#核心能力) · [本地开发](#本地开发) · [English](./README_EN.md)

</div>

![EZWRITING 产品工作台全景](./docs/readme-assets/product-workbench-overview.png)

> [!IMPORTANT]
> EZWRITING 当前处于公开 MVP 阶段，推荐使用桌面端 Chrome、Edge 或其他 Chromium 浏览器。导入、编辑、预览、备份和图片导出不需要登录；多平台草稿同步需要安装 [文章同步助手 Wechatsync](https://github.com/wechatsync/Wechatsync) 并提前登录目标平台。

## 为什么做 EZWRITING

一篇长文写完以后，发布工作通常才刚刚开始：公众号要重新检查排版，X Article 有自己的阅读节奏，小红书更适合分页卡片，其他平台又有不同的图片和草稿要求。不断复制、粘贴、上传图片和切换后台，不仅耗时，也容易让多个版本逐渐偏离最初的稿件。

EZWRITING 把这段流程收进一个网页：

```mermaid
flowchart LR
    A["Markdown / HTML / ZIP"] --> B["浏览器本地解析与安全过滤"]
    B --> C["一份可编辑稿件"]
    C --> D["公众号 / 小红书 / X 预览"]
    D --> E["Wechatsync 发布桥接"]
    E --> F["已登录平台的草稿箱"]
```

核心原则是“一份正文，多个平台呈现”。编辑器只维护一份 Markdown 主稿，公众号、小红书和 X 使用各自的预览与排版逻辑，避免三个版本越改越散。

## 核心能力

| 环节 | 能力 |
| --- | --- |
| 导入 | 支持 Markdown、HTML、ZIP 内容包和包含正文与配图的文件夹 |
| 整理 | 读取 front matter、标题、摘要、标签、封面及标准 Markdown / Obsidian 图片引用 |
| 编辑 | Markdown 文本编辑器，支持标题、列表、引用、Callout、代码、表格、链接、高亮、图片、快捷键与撤销重做 |
| 预览 | 微信公众号长文、小红书图文卡片和 X Article 三种独立预览 |
| 排版 | 主题、字体、字号、行距和强调色；编辑结果同步进入预览与发布稿 |
| 本地保存 | 稿件、图片和排版设置保存在当前浏览器的 IndexedDB 中，支持整库导入与导出 |
| 发布 | 检测 Wechatsync 与平台登录状态，选择多个平台、查看进度、错误和草稿入口 |
| 安全边界 | 外部 HTML 经过过滤；ZIP 限制文件数和解压体积，并拒绝路径穿越 |

## 从稿件到草稿箱

### 1. 新建或导入稿件

可以直接创建空白文档，也可以导入 `.md`、`.markdown`、`.html`、`.htm`、`.zip` 或文章文件夹。

### 2. 编辑唯一正文

左侧维护 Markdown 主稿，右侧实时生成当前平台的预览。点击右侧正文可以回到左侧对应位置，编辑后预览同步更新。

### 3. 整理文章图片

正文图片、封面和缺失资源集中显示在资源页。可以批量选择素材文件夹，也可以单独重链、替换或删除图片。

单独导入 Markdown 时，浏览器不能自动读取文件旁边的本地图片。建议选择包含正文与素材的整个文件夹，或使用 ZIP 内容包，让 EZWRITING 按相对路径自动补齐资源。

### 4. 检查平台预览

![一份正文生成多平台呈现](./docs/readme-assets/multi-platform-output.png)

#### 微信公众号

当前内置 26 套公众号主题，并提供字体、字号、行距和强调色控制。生成的内联样式正文可以直接复制到公众号编辑器，也会作为公众号发布稿的排版来源。

#### X Article

按照 X Article 的长文结构组织标题、作者、封面和正文，支持桌面与手机效果切换。自动写入 X Article 草稿仍受账号权限和平台规则限制，需要使用具备对应权限的真实账号验证。

#### 小红书图文

长文会自动拆分为 3:4 图文卡片。可以切换单页、双页或整体预览，调整模板与排版，放大检查单页，并下载当前 PNG 或全部卡片 ZIP。

### 5. 同步到平台草稿箱

安装 Wechatsync 并登录目标平台后，EZWRITING 会读取可用平台。同步默认只创建草稿，不会无人值守地公开发布；各平台的进度、失败原因和草稿入口分别保留。

## 快速开始

### 只使用本地功能

打开 [EZWRITING 公开测试版](https://ezwriting-dev.a2976916992.workers.dev/) 后即可：

1. 新建文档，或导入文章文件。
2. 在左侧编辑正文、补齐图片。
3. 在右侧切换公众号、小红书或 X 预览。
4. 复制公众号格式、导出小红书图片，或复制整理后的长文。

这部分不需要账号，也不要求安装发布扩展。

### 启用多平台草稿同步

1. 安装并启用 [文章同步助手 Wechatsync](https://github.com/wechatsync/Wechatsync)。
2. 在同一个 Chromium 浏览器中登录准备发布的平台。
3. 返回 EZWRITING，等待页面显示“发布引擎已就绪”。
4. 点击“发布”，选择平台并创建草稿。
5. 从结果区打开各平台草稿，完成最终人工检查。

EZWRITING 不要求填写平台账号或密码；发布执行器使用浏览器中已经存在的登录状态。

## 支持的内容格式

| 输入 | 说明 |
| --- | --- |
| Markdown | `.md`、`.markdown`；支持 YAML front matter、标准图片语法和 Obsidian 图片引用 |
| HTML | `.html`、`.htm`；导入后转换为更适合继续编辑的 Markdown，并对派生 HTML 做安全过滤 |
| ZIP | 一份 Markdown 或 HTML 正文，加相对路径引用的素材文件 |
| 文件夹 | 直接选择包含正文和图片的目录，不必先手动压缩 |

推荐的 ZIP 或文件夹结构：

```text
article/
├── article.md
└── assets/
    ├── cover.png
    └── image-01.jpg
```

Markdown 可以使用：

```markdown
![图片说明](assets/image-01.jpg)
![[assets/image-01.jpg]]
```

ZIP 安全限制：压缩包最大 20 MB、最多 120 个文件、单文件解压后最大 8 MB、总解压大小最大 30 MB，并拒绝绝对路径、`../` 等路径穿越内容。

## 本地数据与隐私

- 稿件、图片、历史记录和排版设置默认只保存在当前浏览器。
- 当前版本没有账号系统，也不会把稿件同步到 EZWRITING 服务器。
- 可以导出 `.ezwriting-backup.json` 整库备份，在其他浏览器或新域名中恢复。
- 清理网站数据、切换浏览器或更换域名前，请先导出备份。
- 远程图片仍可能被浏览器和目标平台访问；只有主动发起同步后，所选内容才会交给发布扩展和目标平台。

![本地优先的数据与备份闭环](./docs/readme-assets/local-first-workspace.png)

## 技术结构

项目使用 React、TypeScript 和 Vite。核心代码按职责分层，UI 不直接依赖 Wechatsync 的私有适配器结构。

| 层级 | 主要职责 | 位置 |
| --- | --- | --- |
| 文章模型 | 统一稿件结构、排版与保存状态 | `src/domain/` |
| 文件处理 | Markdown / HTML / ZIP 解析、兼容与缺图处理 | `src/lib/file-parser.ts`、`src/lib/markdown-compatibility.ts` |
| 编辑与预览 | Markdown 编辑器、三平台预览和卡片导出 | `src/components/` |
| 本地存储 | IndexedDB 稿件仓库、自动保存和整库备份 | `src/services/` |
| 发布桥接 | 可替换的 Wechatsync 网页桥接 | `src/lib/wechatsync-bridge.ts` |
| 静态托管 | Cloudflare Worker 健康检查与静态资源 | `cloudflare/worker/` |

## 本地开发

环境要求：Node.js 24.15 或更高版本。

```bash
git clone https://github.com/KeepATARAXIA/ezWriting.git
cd ezWriting
npm install
npm run dev
```

需要调试 Wechatsync 桥接时，请通过终端输出的 `http://127.0.0.1` 地址打开开发页面，并在同一浏览器中启用扩展。

验证命令：

```bash
npm test
npm run typecheck
npm run build
```

## 当前限制

- 当前重点适配桌面端 Chromium 浏览器；Firefox、Safari 和移动浏览器无法完成相同的扩展发布流程。
- X Article 草稿能力取决于账号权限和平台规则，仍需更多真实账号验证。
- 小红书图文和抖音图文主要通过卡片图片导出完成；平台草稿能力以 Wechatsync 实际返回为准。
- 默认保存为草稿，不提供无人值守发布。
- 暂不包含账号、云同步、定时发布、数据看板、DOCX / PDF 导入或 AI 改写。
- 项目仍处于 MVP 阶段，平台页面变化可能影响扩展桥接结果。

## 致谢

EZWRITING 的多平台发布执行能力建立在开源项目 [文章同步助手 Wechatsync](https://github.com/wechatsync/Wechatsync) 之上。该项目由 [fun](https://github.com/lljxx1) 创建并采用 GPL-3.0 许可证。EZWRITING 负责文件导入、编辑、预览、本地历史和发布反馈；平台适配与最终同步由 Wechatsync 执行。

## 许可证

本仓库目前尚未添加开源许可证。在正式许可证公布前，请勿默认仓库代码可以自由复制、修改或分发。
