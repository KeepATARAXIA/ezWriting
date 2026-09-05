// Only presentation is changed. Media references and content structure stay intact.
const SOURCE_STYLE_ATTRIBUTE = 'data-ez-source-decoration'
const PRESENTATION = /^(?:color|background(?:-.+)?|border(?:-.+)?|outline(?:-.+)?|box-shadow|text-shadow|font(?:-.+)?|line-height|text-align|text-decoration(?:-.+)?)$/

export function prepareSourceStyles(document: Document, policy?: 'preserve' | 'theme'): void {
  document.body.querySelectorAll<HTMLElement>('*').forEach(element => {
    element.removeAttribute(SOURCE_STYLE_ATTRIBUTE)
    const original = document.createElement('span').style
    Array.from(element.style).filter(property => PRESENTATION.test(property)).forEach(property => {
      original.setProperty(property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property))
      if (policy === 'theme') element.style.removeProperty(property)
    })
    if (policy === 'theme') {
      element.removeAttribute('color')
      element.removeAttribute('bgcolor')
      element.removeAttribute('face')
    } else if (policy === 'preserve' && original.cssText) {
      element.setAttribute(SOURCE_STYLE_ATTRIBUTE, original.cssText)
    }
  })
}

export function restoreSourceStyles(document: Document, keepMarkers = false): void {
  document.body.querySelectorAll<HTMLElement>(`[${SOURCE_STYLE_ATTRIBUTE}]`).forEach(element => {
    const original = document.createElement('span').style
    original.cssText = element.getAttribute(SOURCE_STYLE_ATTRIBUTE) || ''
    Array.from(original).filter(property => PRESENTATION.test(property)).forEach(property => {
      element.style.setProperty(property, original.getPropertyValue(property), original.getPropertyPriority(property))
    })
    if (!keepMarkers) element.removeAttribute(SOURCE_STYLE_ATTRIBUTE)
  })
}
