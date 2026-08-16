export const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/%E6%96%87%E7%AB%A0%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B/hchobocdmclopcbnibdnoafilagadion'
export const WECHATSYNC_PACKAGE_URL = 'https://wpics.oss-cn-shanghai.aliyuncs.com/wechatsync-2.0.9.zip?date=20260324'
export const WECHATSYNC_SUPPORT_URL = 'https://github.com/wechatsync/Wechatsync#%E5%AE%89%E8%A3%85%E6%96%B9%E5%BC%8F'

export type ExtensionBrowser = 'chrome' | 'edge' | 'chromium' | 'unsupported'

interface InstallStep {
  title: string
  detail: string
}

export interface BrowserExtensionGuide {
  browser: ExtensionBrowser
  heading: string
  copy: string
  steps: [InstallStep, InstallStep, InstallStep]
  primaryUrl: string
  primaryLabel: string
  secondaryUrl?: string
  secondaryLabel?: string
  compatibilityNote: string
}

export function detectExtensionBrowser(userAgent: string): ExtensionBrowser {
  const normalized = userAgent.toLocaleLowerCase()
  if (/android|iphone|ipad|ipod|mobile/.test(normalized)) return 'unsupported'
  if (/edg(?:e|a|ios)?\//.test(normalized)) return 'edge'
  if (/(?:chrome|crios)\//.test(normalized) && !/opr\//.test(normalized)) return 'chrome'
  if (/chromium|opr\/|opera|vivaldi|yabrowser|qqbrowser|360(?:se|ee)|huaweibrowser/.test(normalized)) return 'chromium'
  return 'unsupported'
}

export function getBrowserExtensionGuide(userAgent: string): BrowserExtensionGuide {
  const browser = detectExtensionBrowser(userAgent)

  if (browser === 'edge') {
    return {
      browser,
      heading: '在 Edge 中安装发布引擎',
      copy: 'Edge 可以运行 Wechatsync。为避免 Chrome 商店无法访问，优先使用官方安装包。',
      steps: [
        { title: '下载安装包', detail: '下载官方压缩包并解压到固定目录' },
        { title: '加载扩展', detail: '打开 edge://extensions，开启开发者模式并加载已解压的扩展' },
        { title: '回到这里', detail: '页面会自动重连并读取可用草稿箱' },
      ],
      primaryUrl: WECHATSYNC_PACKAGE_URL,
      primaryLabel: '下载 Edge 兼容安装包',
      secondaryUrl: CHROME_WEB_STORE_URL,
      secondaryLabel: '也可从 Chrome 扩展商店安装',
      compatibilityNote: 'Microsoft Edge 官方支持安装 Chrome 扩展',
    }
  }

  if (browser === 'chrome') {
    return {
      browser,
      heading: '在 Chrome 中安装发布引擎',
      copy: '安装一次即可让 Wechatsync 读取当前浏览器的平台登录态并写入草稿。',
      steps: [
        { title: '打开扩展商店', detail: '进入 Wechatsync 官方 Chrome 应用商店页面' },
        { title: '添加扩展', detail: '点击“添加至 Chrome”并确认扩展权限' },
        { title: '回到这里', detail: '页面会自动重连并读取可用草稿箱' },
      ],
      primaryUrl: CHROME_WEB_STORE_URL,
      primaryLabel: '打开 Chrome 扩展商店',
      secondaryUrl: WECHATSYNC_PACKAGE_URL,
      secondaryLabel: '商店打不开？下载官方安装包',
      compatibilityNote: '扩展只在当前浏览器内运行',
    }
  }

  if (browser === 'chromium') {
    return {
      browser,
      heading: '在当前浏览器安装发布引擎',
      copy: '当前浏览器使用 Chromium 内核，建议下载 Wechatsync 官方安装包后手动加载。',
      steps: [
        { title: '下载安装包', detail: '下载最新版扩展压缩包并解压到固定目录' },
        { title: '加载扩展', detail: '在扩展管理页开启开发者模式，选择“加载已解压的扩展”' },
        { title: '回到这里', detail: '页面会自动重连并读取可用草稿箱' },
      ],
      primaryUrl: WECHATSYNC_PACKAGE_URL,
      primaryLabel: '下载官方安装包',
      secondaryUrl: CHROME_WEB_STORE_URL,
      secondaryLabel: '尝试打开 Chrome 扩展商店',
      compatibilityNote: 'Wechatsync 官方支持 Edge、360、QQ 等 Chromium 浏览器',
    }
  }

  return {
    browser,
    heading: '请使用桌面版 Chrome 或 Edge',
    copy: '当前浏览器不支持这套发布扩展。稿件仍保留在本地，可以换用支持的浏览器继续。',
    steps: [
      { title: '打开支持的浏览器', detail: '使用桌面版 Chrome、Edge 或其他 Chromium 浏览器' },
      { title: '重新打开工作台', detail: '稿件保存在当前设备；需要时可重新导入文件' },
      { title: '安装发布引擎', detail: '按对应浏览器的提示安装 Wechatsync' },
    ],
    primaryUrl: WECHATSYNC_SUPPORT_URL,
    primaryLabel: '查看支持的浏览器与安装说明',
    compatibilityNote: 'Firefox、Safari 和移动浏览器暂不支持发布引擎',
  }
}
