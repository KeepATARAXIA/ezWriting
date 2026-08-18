# Known Issues / 已知问题

Last reviewed / 最近核对：2026-08-18

This page records behavior that users may encounter in the current public MVP. Platform adapters are maintained by Wechatsync and can change independently of EZWRITING.

本页记录当前公开 MVP 中可能遇到的问题。平台适配器由 Wechatsync 维护，可能独立于 EZWRITING 发生变化。

## Publishing bridge / 发布桥接

### WeChat error `200040` / 微信公众号错误 `200040`

WeChat draft creation may fail with error `200040` even when the browser session appears valid. The same behavior is tracked in [Wechatsync Issue #217](https://github.com/wechatsync/Wechatsync/issues/217), which was still open when this page was reviewed.

即使浏览器登录状态看似有效，微信公众号草稿仍可能返回 `200040`。相同行为已记录在 [Wechatsync Issue #217](https://github.com/wechatsync/Wechatsync/issues/217)，本页核对时该 Issue 仍为 Open。

Workaround / 临时方案：copy the generated WeChat-formatted content and paste it into the official editor for final review. / 复制 EZWRITING 生成的公众号格式，粘贴到公众号编辑器后人工检查。

### X Article eligibility / X Article 账号权限

X Article draft creation depends on the account's current long-form publishing eligibility. The dedicated preview and copy workflow work without that eligibility, but automated draft delivery has not been broadly verified with eligible accounts.

X Article 草稿创建取决于账号当前是否具备长文发布权限。专属预览和复制流程不依赖该权限，但自动草稿同步仍缺少足够的真实账号验证。

### Xiaohongshu draft verification / 小红书草稿核验

Image-card generation and local PNG/ZIP export are verified. A real Xiaohongshu draft has been observed through the bridge, but stable draft-detail verification is incomplete and an extra empty draft may be created by upstream behavior.

小红书卡片生成和本地 PNG/ZIP 导出已经验证。桥接曾观察到真实草稿进入平台，但草稿详情的稳定核验尚未完成，上游行为也可能额外生成空草稿。

### Bilibili custom cover / 哔哩哔哩自定义封面

Title, body, and body images have reached a real Bilibili draft, but the custom cover was not mapped in the observed test.

标题、正文和正文图片曾成功进入真实哔哩哔哩草稿，但自定义封面在测试中没有正确映射。

### Generic Wechatsync destinations / 通用 Wechatsync 平台

EZWRITING can display destinations reported by Wechatsync and send a generic article payload, but platforms without a dedicated EZWRITING preview are not continuously verified. A successful bridge response must still be checked in the platform's draft editor.

EZWRITING 可以显示 Wechatsync 返回的平台，并发送通用文章数据；但没有专属 EZWRITING 预览的平台不会持续逐一验证。桥接返回成功后，仍需进入平台草稿编辑器人工核对。

## Local data / 本地数据

### Browser and domain isolation / 浏览器与域名隔离

IndexedDB data belongs to the current browser profile and site origin. Opening EZWRITING under a new domain or browser can look like an empty library even though the original data still exists elsewhere.

IndexedDB 数据属于当前浏览器配置和网站域名。更换域名或浏览器后，稿件库可能看起来为空，但原数据仍保存在旧环境中。

Workaround / 临时方案：export a complete `.ezwriting-backup.json` archive before changing browsers, clearing site data, or moving to another domain. / 更换浏览器、清理网站数据或迁移域名前，先导出完整 `.ezwriting-backup.json` 备份。

## Reporting a new issue / 报告新问题

Use the repository's Bug Report form and include the browser version, Wechatsync version, target platform, input format, reproduction steps, and sanitized error message. Never include cookies, tokens, or private article content.

请使用仓库的 Bug Report 表单，提供浏览器版本、Wechatsync 版本、目标平台、输入格式、复现步骤和脱敏后的错误信息。不要提交 Cookie、Token 或私密正文。
