import { describe, expect, it } from 'vitest'
import {
  CHROME_WEB_STORE_URL,
  WECHATSYNC_PACKAGE_URL,
  detectExtensionBrowser,
  getBrowserExtensionGuide,
} from './browser-extension-install'

describe('browser extension installation guide', () => {
  it('keeps Microsoft Edge off the Chrome store by default', () => {
    const guide = getBrowserExtensionGuide('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0')

    expect(guide.browser).toBe('edge')
    expect(guide.steps[1].detail).toContain('edge://extensions')
    expect(guide.primaryUrl).toBe(WECHATSYNC_PACKAGE_URL)
    expect(guide.secondaryUrl).toBe(CHROME_WEB_STORE_URL)
  })

  it('keeps Chrome on the official web store', () => {
    const guide = getBrowserExtensionGuide('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36')

    expect(guide.browser).toBe('chrome')
    expect(guide.primaryUrl).toBe(CHROME_WEB_STORE_URL)
    expect(guide.primaryLabel).toContain('Chrome')
  })

  it('uses the official package for other Chromium browsers', () => {
    const guide = getBrowserExtensionGuide('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0')

    expect(guide.browser).toBe('chromium')
    expect(guide.primaryUrl).toBe(WECHATSYNC_PACKAGE_URL)
    expect(guide.steps[1].detail).toContain('加载已解压的扩展')
  })

  it('marks Firefox and mobile browsers as unsupported', () => {
    expect(detectExtensionBrowser('Mozilla/5.0 Firefox/129.0')).toBe('unsupported')
    expect(detectExtensionBrowser('Mozilla/5.0 (Linux; Android 15) Chrome/128.0.0.0 Mobile Safari/537.36')).toBe('unsupported')
  })
})
