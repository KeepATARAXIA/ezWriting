export const XHS_CARD_TEMPLATES = [
  'clean',
  'focus',
  'index',
  'memo',
  'headline',
  'journal',
  'quote',
  'soft',
  'fresh',
  'editorial',
  'retro',
  'geometry',
  'doodle',
  'texture',
  'logic',
  'mono',
  'hero',
  'narrative',
  'dust',
  'topology',
] as const

export type XhsCardTemplate = typeof XHS_CARD_TEMPLATES[number]
export type XhsTemplateFontMode = 'template' | 'sans' | 'serif'
export type XhsFontPresetId = 'modern' | 'editorial' | 'rounded' | 'serif' | 'handwritten' | 'classical' | 'display-serif'

export interface XhsFontPreset {
  id: XhsFontPresetId
  label: string
  detail: string
  titleFamily: string
  bodyFamily: string
  titleWeight: number
  titleLetterSpacing: string
}

export interface XhsTemplatePalette {
  id: string
  label: string
  background: string
  surface: string
  ink: string
  heading: string
  accent: string
  secondary: string
  soft: string
  border: string
  muted: string
  inverse: string
}

export interface XhsTemplateStyle {
  fontPreset: XhsFontPresetId
  palettes: readonly XhsTemplatePalette[]
}

const SANS = '"MiSans", "HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif'
const SERIF = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", serif'
const KAI = '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif'
const ROUNDED = '"YouYuan", "Yuanti SC", "Microsoft YaHei UI", sans-serif'

export const XHS_FONT_PRESETS: Record<XhsFontPresetId, XhsFontPreset> = {
  modern: { id: 'modern', label: '现代黑体', detail: '清晰、稳定、适合长文阅读', titleFamily: SANS, bodyFamily: SANS, titleWeight: 900, titleLetterSpacing: '-0.045em' },
  editorial: { id: 'editorial', label: '杂志黑体', detail: '高字重标题与紧凑信息层级', titleFamily: SANS, bodyFamily: SANS, titleWeight: 950, titleLetterSpacing: '-0.06em' },
  rounded: { id: 'rounded', label: '轻圆体', detail: '柔和、明快、适合生活表达', titleFamily: ROUNDED, bodyFamily: SANS, titleWeight: 800, titleLetterSpacing: '-0.025em' },
  serif: { id: 'serif', label: '书卷宋体', detail: '典雅、克制、适合人文长文', titleFamily: SERIF, bodyFamily: SERIF, titleWeight: 720, titleLetterSpacing: '-0.02em' },
  handwritten: { id: 'handwritten', label: '手写楷体', detail: '松弛、有温度、保留手帐气质', titleFamily: KAI, bodyFamily: KAI, titleWeight: 760, titleLetterSpacing: '0.015em' },
  classical: { id: 'classical', label: '古典楷宋', detail: '竖排题签与札记式阅读', titleFamily: KAI, bodyFamily: SERIF, titleWeight: 680, titleLetterSpacing: '0.025em' },
  'display-serif': { id: 'display-serif', label: '展示衬线体', detail: '高对比标题与影像叙事', titleFamily: SERIF, bodyFamily: SANS, titleWeight: 780, titleLetterSpacing: '-0.025em' },
}

function palette(
  id: string,
  label: string,
  background: string,
  surface: string,
  ink: string,
  heading: string,
  accent: string,
  secondary: string,
  soft: string,
  border: string,
  muted: string,
  inverse = '#ffffff',
): XhsTemplatePalette {
  return { id, label, background, surface, ink, heading, accent, secondary, soft, border, muted, inverse }
}

export const XHS_TEMPLATE_STYLES: Record<XhsCardTemplate, XhsTemplateStyle> = {
  clean: {
    fontPreset: 'modern',
    palettes: [
      palette('paper', '纸白', '#ffffff', '#f5f6f7', '#263038', '#171d22', '#202830', '#7f8a93', '#eef1f3', '#d5dce1', '#737f88'),
      palette('mist', '雾蓝', '#f4f8fb', '#ffffff', '#263746', '#153b57', '#2b79a8', '#8eb7cf', '#e7f1f7', '#c8dce8', '#658296'),
      palette('oat', '燕麦', '#fbf8f1', '#ffffff', '#3d352c', '#2d251f', '#9d6b32', '#d4ae7c', '#f2e9dc', '#dfcfbb', '#806e5d'),
      palette('charcoal', '炭黑', '#25282a', '#303438', '#e9ecee', '#ffffff', '#8ecbff', '#91e6c1', '#353d43', '#4a5258', '#aeb8bf', '#111416'),
    ],
  },
  focus: {
    fontPreset: 'modern',
    palettes: [
      palette('cobalt', '钴蓝', '#f6f8ff', '#ffffff', '#273246', '#132764', '#1648ff', '#8fb0ff', '#e6ecff', '#bdcaff', '#65749a'),
      palette('vermilion', '朱红', '#fff8f6', '#ffffff', '#402d2a', '#6d211b', '#d9372c', '#f09a72', '#fde9e5', '#efc6bf', '#8c625d'),
      palette('pine', '松绿', '#f4faf7', '#ffffff', '#253b32', '#123f2d', '#0b9b60', '#87c9a8', '#dff3e9', '#b8dccb', '#5e7f70'),
      palette('amber', '琥珀', '#fffbf2', '#ffffff', '#423727', '#684414', '#e18b13', '#f3c369', '#fff0cf', '#efd9a9', '#8b7453'),
    ],
  },
  index: {
    fontPreset: 'editorial',
    palettes: [
      palette('signal-red', '信号红', '#fffdfc', '#ffffff', '#28292a', '#171819', '#d83129', '#f0aaa4', '#fae5e2', '#e8c4c0', '#7b7472'),
      palette('research-blue', '研究蓝', '#f8fbff', '#ffffff', '#253240', '#102f53', '#1268c4', '#8ebbe8', '#e5f0fb', '#c3d8ec', '#637b91'),
      palette('archive-brown', '档案棕', '#fdfaf5', '#ffffff', '#3d342c', '#4a2c16', '#a65b22', '#d8aa77', '#f2e5d6', '#dfc8af', '#7d6756'),
      palette('graphite', '石墨', '#f4f5f5', '#ffffff', '#2d3133', '#161819', '#4a555b', '#a8b0b4', '#e6e9ea', '#cbd0d2', '#727b80'),
    ],
  },
  memo: {
    fontPreset: 'modern',
    palettes: [
      palette('yellow-note', '黄标黑', '#2d2e2c', '#3a3b37', '#f2f0e9', '#fffdf3', '#f3d64e', '#d4ad19', '#3a3b37', '#62645d', '#bab9af', '#171816'),
      palette('blue-note', '蓝标黑', '#25292d', '#323940', '#edf3f7', '#ffffff', '#52b7ff', '#166ea9', '#303c45', '#4e5d67', '#a9bac5', '#101316'),
      palette('orange-note', '橙标黑', '#2d2926', '#3d352f', '#f5eee8', '#fffaf4', '#ff9b47', '#cf6121', '#44372f', '#685345', '#c2afa1', '#171411'),
      palette('paper-note', '浅色便笺', '#fffdf4', '#f5f0df', '#3e392c', '#242219', '#e1b720', '#91770e', '#f6edbd', '#ded19a', '#756e54', '#ffffff'),
    ],
  },
  headline: {
    fontPreset: 'editorial',
    palettes: [
      palette('neon-green', '荧光绿', '#ffffff', '#f1f2f1', '#202729', '#151b1e', '#00df91', '#171d20', '#dffbed', '#cbd7d1', '#66736d', '#ffffff'),
      palette('electric-blue', '电光蓝', '#ffffff', '#eff5fb', '#202931', '#13263b', '#168bff', '#17212b', '#dcebfa', '#c3d8ea', '#647889', '#ffffff'),
      palette('acid-yellow', '酸性黄', '#ffffff', '#f5f4ed', '#242820', '#1c2117', '#d9f53c', '#1c221b', '#eff7bf', '#d7ddae', '#6f7762', '#ffffff'),
      palette('hot-coral', '热珊瑚', '#fffdfc', '#f7efed', '#302726', '#211817', '#ff684f', '#241b1a', '#fde1dc', '#e6c9c3', '#7d6662', '#ffffff'),
    ],
  },
  journal: {
    fontPreset: 'handwritten',
    palettes: [
      palette('kraft', '牛皮纸', '#f1e5d1', '#fffaf0', '#463729', '#5b422a', '#9a6a35', '#d8b988', '#eee0c8', '#c5ad89', '#7a634b'),
      palette('sage', '鼠尾草', '#edf0df', '#fafbf2', '#354034', '#2e4d38', '#6f936e', '#b6c69a', '#e2e8d0', '#bdc8aa', '#687362'),
      palette('sky-journal', '晴空手帐', '#edf5fa', '#ffffff', '#314350', '#2d5c78', '#65a9cc', '#bfdbe8', '#deedf4', '#bfd4df', '#6c8594'),
      palette('rose-journal', '粉笺手帐', '#f7e9e6', '#fff9f7', '#493638', '#6a3d47', '#c87b8b', '#e7b7b4', '#f3dbd8', '#dcbcb8', '#80676a'),
    ],
  },
  quote: {
    fontPreset: 'rounded',
    palettes: [
      palette('lemon', '柠檬黄', '#fff58b', '#fffbd1', '#413b20', '#37321b', '#d0a916', '#f2c936', '#fff6aa', '#e2d567', '#8c7011'),
      palette('ocean', '海盐蓝', '#66baf0', '#dff2ff', '#18364a', '#102c40', '#0b72b5', '#9bd7fb', '#bfe5fb', '#68a9d2', '#37687f'),
      palette('mint', '薄荷绿', '#9cebb5', '#e6fbea', '#1d4530', '#123c27', '#249d59', '#c3f4d1', '#c8f3d5', '#83c99a', '#47745a'),
      palette('graphite-quote', '炭灰', '#30312f', '#41423d', '#f0efe7', '#fffdf2', '#f2d85a', '#878a81', '#3b3d39', '#5f6159', '#bebdb4', '#151614'),
    ],
  },
  soft: {
    fontPreset: 'rounded',
    palettes: [
      palette('blush', '柔粉', '#f9e3ed', '#fff7fa', '#49323d', '#563446', '#bd7796', '#f1bfd4', '#f8dce8', '#e9c3d4', '#93687a'),
      palette('lilac', '丁香紫', '#eee8fb', '#faf7ff', '#3d3650', '#4a3768', '#8a6cc7', '#cfc0ee', '#e7def8', '#d5c9ea', '#746786'),
      palette('apricot', '杏桃', '#fce8da', '#fff8f1', '#4a362d', '#613a2a', '#d57d53', '#f2b88e', '#f8d7c3', '#eac5ad', '#8b6a59'),
      palette('seafoam', '海沫绿', '#dff3ee', '#f5fcfa', '#29423d', '#255349', '#4f9e8d', '#a9d7ca', '#ceeae3', '#b8d7cf', '#607e76'),
    ],
  },
  fresh: {
    fontPreset: 'editorial',
    palettes: [
      palette('lime-blue', '青柠蓝', '#ffffff', '#f3f5f4', '#1c2327', '#171d20', '#d9ff56', '#8eb8ff', '#edf2d5', '#cdd7d4', '#5b6468'),
      palette('cyan-orange', '青橙', '#ffffff', '#f2f5f4', '#1d2928', '#132a28', '#51d9cf', '#ff9a55', '#dcf5f0', '#c4dcd7', '#5f7773'),
      palette('pink-blue', '粉蓝', '#fffefe', '#f5f1f4', '#29222a', '#231a25', '#ff91c6', '#8bc9ff', '#f8ddeb', '#e6c9d8', '#756572'),
      palette('mono-lime', '灰绿', '#f7f8f5', '#ecefea', '#252b25', '#181d18', '#a9d72d', '#535e50', '#e2ebca', '#cbd3c4', '#687062'),
    ],
  },
  editorial: {
    fontPreset: 'serif',
    palettes: [
      palette('ivory', '象牙白', '#fffaf1', '#f2eadc', '#302820', '#3b2b1d', '#9c8768', '#d0b994', '#f5ecdf', '#d9ccb9', '#806f59'),
      palette('lake', '湖蓝', '#f2f7f8', '#e4eef0', '#29383c', '#234e58', '#5b91a0', '#a7c6cc', '#dcebed', '#c3d7da', '#667f85'),
      palette('rosewood', '玫瑰木', '#fbf3f3', '#f2e4e5', '#433033', '#5f3038', '#a65c67', '#d7a5aa', '#f0dadc', '#dfc4c7', '#80656a'),
      palette('ink', '墨色', '#f4f3f0', '#e7e5e0', '#2c2d2b', '#181918', '#555a55', '#aeb2ab', '#e0e1dc', '#cbcfc8', '#747973'),
    ],
  },
  retro: {
    fontPreset: 'serif',
    palettes: [
      palette('archive', '旧档案', '#f3eee2', '#ebe3d4', '#302e29', '#443f36', '#9b6a22', '#c9a66f', '#e8decd', '#8b8476', '#746b5d'),
      palette('poster-red', '海报红', '#f8eee7', '#f1ded5', '#3f2f29', '#57281e', '#b84a32', '#dc8d75', '#efd7cc', '#c8a89c', '#82675e'),
      palette('navy', '复古海军蓝', '#e9eef1', '#dde5e9', '#27353e', '#17364a', '#356d8c', '#8aacbe', '#d5e1e6', '#aebfc8', '#657985'),
      palette('olive', '旧军绿', '#ececdf', '#e0e1d0', '#343a2c', '#36452a', '#728044', '#aeb785', '#d9dcc4', '#b9bda2', '#707661'),
    ],
  },
  geometry: {
    fontPreset: 'editorial',
    palettes: [
      palette('cobalt-cream', '钴蓝米白', '#f4f2ec', '#ffffff', '#20282f', '#18222a', '#1648ff', '#f0c24b', '#e5e3dc', '#c9cbc6', '#586167'),
      palette('coral-sand', '珊瑚沙', '#f8f0e8', '#fffaf5', '#392f2a', '#4b2b24', '#ed7158', '#e4b56f', '#f3ddd4', '#d8bfb4', '#7b665e'),
      palette('violet-mint', '紫薄荷', '#f0eff7', '#fafaff', '#302f43', '#392d58', '#7657ff', '#70d5b0', '#e3def7', '#c9c4df', '#6c6883'),
      palette('black-white', '黑白构成', '#f7f7f5', '#ffffff', '#252726', '#111312', '#242826', '#b9c1bd', '#e9ebe9', '#cdd1ce', '#686d6a'),
    ],
  },
  doodle: {
    fontPreset: 'handwritten',
    palettes: [
      palette('sky-marker', '天蓝马克', '#edfaff', '#ffffff', '#193756', '#16399b', '#27addd', '#bceeff', '#d7f4ff', '#b8dfed', '#4f819c'),
      palette('pink-marker', '粉色马克', '#fff0f7', '#ffffff', '#54283e', '#8a2356', '#ed63a2', '#ffc0df', '#fbd7e8', '#efbdd4', '#916077'),
      palette('yellow-marker', '黄色马克', '#fffbea', '#ffffff', '#473c23', '#71540e', '#e5b51d', '#ffe477', '#faefbd', '#ead99b', '#806f42'),
      palette('mint-marker', '薄荷马克', '#ebfbf6', '#ffffff', '#25483d', '#12634b', '#2fbd8a', '#a9efd4', '#d4f5e9', '#b5e2d2', '#527f70'),
    ],
  },
  texture: {
    fontPreset: 'serif',
    palettes: [
      palette('porcelain-blue', '瓷蓝', '#fbfdff', '#edf7fc', '#334b5d', '#1265c4', '#5fa8d3', '#a9d4ea', '#e5f3fa', '#c4deec', '#6d9bb6'),
      palette('wheat', '麦穗', '#fdf9ed', '#f6ecd2', '#4a412e', '#8b651f', '#c09336', '#e1c47f', '#f3e6bf', '#dfcc9f', '#877858'),
      palette('sage-texture', '青苔', '#f2f6ee', '#e8f0e2', '#354638', '#346348', '#6c9a72', '#b9d0aa', '#e0ead7', '#c5d3ba', '#687e6b'),
      palette('pink-texture', '雅粉', '#fdf7f8', '#f6e9ec', '#493b40', '#9b4e68', '#c97894', '#e7b6c6', '#f3dfe5', '#dec6ce', '#896d77'),
    ],
  },
  logic: {
    fontPreset: 'modern',
    palettes: [
      palette('logic-red', '逻辑红', '#fffdfd', '#fbf0f0', '#22272b', '#202428', '#e94b43', '#f6dede', '#faeeee', '#efc7c7', '#986e6b'),
      palette('logic-blue', '逻辑蓝', '#fafdff', '#eef6fb', '#24313a', '#19384d', '#3489bd', '#d8ecf7', '#e4f1f8', '#c4dce9', '#698393'),
      palette('logic-amber', '逻辑琥珀', '#fffdf8', '#fbf2df', '#393126', '#5d4218', '#d68b24', '#f5dfb2', '#f9ecd0', '#ead3a9', '#806f55'),
      palette('logic-violet', '逻辑紫', '#fcfaff', '#f2edfb', '#342f40', '#443166', '#8663c9', '#e2d8f5', '#ece5f8', '#d2c5e7', '#776b89'),
    ],
  },
  mono: {
    fontPreset: 'serif',
    palettes: [
      palette('warm-mono', '暖白棕字', '#fffaf6', '#ffffff', '#342b26', '#9e481d', '#9e481d', '#d3a17f', '#f4e5dc', '#d8c7bb', '#8c6953'),
      palette('pure-mono', '纯白黑字', '#ffffff', '#f4f4f3', '#292b2b', '#171818', '#3e4141', '#aeb1b0', '#eceeed', '#d4d6d5', '#747777'),
      palette('ink-blue', '墨蓝', '#f7f9fb', '#edf2f5', '#2e3942', '#153b57', '#315f7c', '#9bb4c5', '#e5edf2', '#c7d5de', '#6e8492'),
      palette('burgundy', '酒红', '#fbf6f5', '#f3e8e6', '#433032', '#721f2d', '#9d3448', '#d19aa5', '#f0dbdf', '#dbc1c6', '#80656b'),
    ],
  },
  hero: {
    fontPreset: 'display-serif',
    palettes: [
      palette('cinema', '电影黑金', '#171a1c', '#2b2d2e', '#e9e8e2', '#ffffff', '#e4c49a', '#9e7e55', '#2c2d2e', '#5e574f', '#b9b3a9', '#101214'),
      palette('midnight-blue', '午夜蓝', '#14202d', '#223244', '#eaf1f7', '#ffffff', '#79b7ea', '#3e6f98', '#243747', '#4e687e', '#abc0d1', '#0b1118'),
      palette('forest-night', '森林夜', '#17231f', '#26362f', '#e9f0ec', '#ffffff', '#8dc8a7', '#3e765b', '#293b33', '#4f6b5d', '#afc1b7', '#0c1310'),
      palette('plum-night', '梅子夜', '#251b24', '#392b37', '#f1e9ef', '#ffffff', '#d8a5c8', '#814f72', '#3d2d3a', '#684e61', '#c6b0bf', '#140e13'),
    ],
  },
  narrative: {
    fontPreset: 'modern',
    palettes: [
      palette('documentary-blue', '纪实蓝', '#f5f6f6', '#ffffff', '#26343b', '#11435a', '#39c9f4', '#143f54', '#e8f5f9', '#b7c7ce', '#607d8a'),
      palette('documentary-green', '纪实绿', '#f4f7f5', '#ffffff', '#293931', '#174c35', '#56c98a', '#275c43', '#e2f2e8', '#bad0c3', '#657e70'),
      palette('documentary-orange', '纪实橙', '#faf6f2', '#ffffff', '#3d332c', '#673b1f', '#f0a15e', '#7b4b2b', '#f7e6d8', '#ddc7b7', '#806c5e'),
      palette('documentary-gray', '纪实灰', '#f1f3f3', '#ffffff', '#30383b', '#202729', '#818d91', '#3d474b', '#e4e8e9', '#c8d0d2', '#727e82'),
    ],
  },
  dust: {
    fontPreset: 'classical',
    palettes: [
      palette('rice-paper', '宣纸', '#fffefa', '#f7f3eb', '#3a352e', '#332f2a', '#776b5b', '#b7aa97', '#f1ece3', '#d0c5b6', '#8a7d6b'),
      palette('celadon', '青瓷', '#f2f7f4', '#e7f0eb', '#35433c', '#2f5042', '#6f9885', '#b3cbbf', '#dde9e2', '#c1d2c9', '#6c8076'),
      palette('old-rose', '旧粉', '#fbf4f2', '#f2e7e3', '#463835', '#6a4442', '#a8716d', '#d4aaa3', '#efded9', '#dcc4be', '#806b66'),
      palette('indigo-dust', '靛蓝', '#f1f4f7', '#e6ebf0', '#303c48', '#284765', '#607f9d', '#aabecf', '#dce5ec', '#c2d0db', '#697e90'),
    ],
  },
  topology: {
    fontPreset: 'editorial',
    palettes: [
      palette('green-orange', '绿橙交叉', '#00dc87', '#ffffff', '#1c2522', '#18201e', '#00b978', '#ff7c38', '#00cfff', '#54ae89', '#275e4f', '#ffffff'),
      palette('blue-lime', '蓝绿交叉', '#40b9ff', '#ffffff', '#152b38', '#102330', '#168bcf', '#c7f13e', '#8ce7ff', '#71aecd', '#315f77', '#ffffff'),
      palette('violet-coral', '紫珊瑚', '#8767ff', '#ffffff', '#271f3f', '#201633', '#6b49df', '#ff805f', '#d9b7ff', '#9b83db', '#4c3f72', '#ffffff'),
      palette('sand-black', '沙黑构成', '#e4c89b', '#fffdf7', '#332b22', '#221d18', '#ba7d35', '#232724', '#f0dfbd', '#c6a875', '#6f5d48', '#ffffff'),
    ],
  },
}

export function getXhsTemplateStyle(template: XhsCardTemplate): XhsTemplateStyle {
  return XHS_TEMPLATE_STYLES[template]
}

export function getXhsDefaultPaletteId(template: XhsCardTemplate): string {
  return XHS_TEMPLATE_STYLES[template].palettes[0].id
}

export function normalizeXhsPaletteId(template: XhsCardTemplate, value: unknown): string {
  return typeof value === 'string' && XHS_TEMPLATE_STYLES[template].palettes.some(option => option.id === value)
    ? value
    : getXhsDefaultPaletteId(template)
}

export function getXhsTemplatePalette(template: XhsCardTemplate, paletteId: string): XhsTemplatePalette {
  const style = XHS_TEMPLATE_STYLES[template]
  return style.palettes.find(option => option.id === paletteId) ?? style.palettes[0]
}

export function getXhsFontPreset(template: XhsCardTemplate): XhsFontPreset {
  return XHS_FONT_PRESETS[XHS_TEMPLATE_STYLES[template].fontPreset]
}
