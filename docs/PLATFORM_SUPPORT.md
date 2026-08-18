# Platform Support / 平台支持矩阵

Last reviewed / 最近核对：2026-08-18

EZWRITING separates platform presentation from final delivery. A dedicated preview means EZWRITING renders a platform-specific result; draft delivery still depends on Wechatsync, an active platform session, and the target platform's current behavior.

EZWRITING 将平台化呈现与最终同步分开。专属预览表示 EZWRITING 会生成对应平台的结果；草稿同步仍依赖 Wechatsync、有效的平台登录状态和目标平台当前行为。

## Status definitions / 状态说明

- **Verified / 已验证**：repeatable local behavior or a confirmed real-platform result exists. / 本地行为可重复，或已有真实平台结果。
- **Experimental / 实验性**：the path exists but real-account or result-detail verification is incomplete. / 链路已存在，但真实账号或结果详情验证不足。
- **Upstream issue / 上游问题**：EZWRITING can prepare the content, but a known Wechatsync or platform issue blocks reliable delivery. / EZWRITING 可以准备内容，但已知的 Wechatsync 或平台问题影响可靠同步。
- **Not dedicated / 无专属适配**：available through the generic bridge only, without an EZWRITING-specific preview. / 仅通过通用桥接提供，没有 EZWRITING 专属预览。

## Matrix / 矩阵

| Destination / 目标 | Dedicated preview / 专属预览 | Local output / 本地输出 | Draft delivery / 草稿同步 | Current status / 当前状态 |
| --- | --- | --- | --- | --- |
| WeChat Official Account / 微信公众号 | Article preview with 26 themes / 26 套主题长文预览 | Copy inline-styled HTML / 复制内联样式正文 | Wechatsync bridge / Wechatsync 桥接 | **Upstream issue** — error `200040` may block drafts; manual copy remains available / **上游问题** — `200040` 可能阻断草稿，可使用人工复制 |
| Xiaohongshu / 小红书 | 3:4 paginated cards, single/spread/overview / 3:4 分页卡片、单页/双页/整体预览 | PNG and multi-card ZIP / PNG 与多卡片 ZIP | Wechatsync bridge / Wechatsync 桥接 | **Experimental** — export is verified; draft-detail verification remains incomplete / **实验性** — 导出已验证，草稿详情核验未完成 |
| X Article | Desktop and mobile long-form preview / 桌面与手机长文预览 | Copy prepared long-form content / 复制整理后的长文 | Wechatsync bridge / Wechatsync 桥接 | **Experimental** — account eligibility is required / **实验性** — 需要账号具备长文权限 |
| Bilibili column / 哔哩哔哩专栏 | Generic article only / 仅通用稿件 | None specific / 无专属输出 | Wechatsync bridge / Wechatsync 桥接 | **Experimental** — body reached a real draft; custom cover did not map / **实验性** — 正文曾进入真实草稿，自定义封面未映射 |
| Other destinations reported by Wechatsync / 其他 Wechatsync 平台 | None / 无 | None specific / 无专属输出 | Generic article bridge / 通用稿件桥接 | **Not dedicated** — inspect every returned draft manually / **无专属适配** — 每次都需人工核对草稿 |

## Input and browser support / 输入与浏览器支持

| Capability / 能力 | Status / 状态 | Notes / 说明 |
| --- | --- | --- |
| Markdown and Obsidian image references / Markdown 与 Obsidian 图片引用 | **Verified / 已验证** | Includes YAML front matter and relative local assets / 包含 YAML front matter 与相对路径素材 |
| HTML import / HTML 导入 | **Verified / 已验证** | Converted to editable Markdown; rendered HTML is sanitized / 转为可编辑 Markdown，渲染 HTML 经过安全过滤 |
| ZIP and article-folder import / ZIP 与文章文件夹导入 | **Verified / 已验证** | ZIP file-count, size, and path-traversal limits apply / ZIP 有文件数、体积和路径穿越限制 |
| Desktop Chrome, Edge, Chromium / 桌面 Chrome、Edge、Chromium | **Primary target / 主要目标** | Required for extension-based delivery / 扩展发布链路需要 Chromium |
| Firefox, Safari, mobile / Firefox、Safari、移动端 | **Local features only / 仅本地功能** | Extension-based delivery is unavailable or not equivalent / 无法提供等价的扩展发布能力 |

The matrix describes verified behavior, not a permanent promise. Platform editors and browser extensions can change without notice. See [Known Issues](./KNOWN_ISSUES.md) before reporting a publishing failure.

本矩阵记录已经验证的行为，不构成永久承诺。平台编辑器和浏览器扩展可能随时变化；报告发布问题前请先查看[已知问题](./KNOWN_ISSUES.md)。
