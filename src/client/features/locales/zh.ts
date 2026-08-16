/**
 * Chinese dictionary — the key source of truth for dsh-md-notes UI copy.
 * Every key must also exist in `en.ts` (enforced by its mapped type).
 * @module dsh-md-notes/client/locales/zh
 */

export const zh = {
  'sidebar.entry': 'MD 笔记',
  'sidebar.label': '笔记',
  'action.tooltip': '发送到笔记',
  'manager.title': 'MD 笔记',
  'manager.subtitle': '保存于工作区 .dsh-notes/',
  'manager.close': '关闭',
  'manager.untitled': '未命名笔记 {date}',
  'manager.newPlaceholder': '新笔记标题…',
  'manager.new': '新建',
  'manager.creating': '创建中…',
  'manager.empty': '还没有笔记，输入标题后点“新建”',
  'manager.delete': '删除',
  'manager.deleteConfirm': '删除笔记 {name} ？',
  'manager.editorEmpty': '← 选择左侧笔记，或新建一篇',
  'manager.tabEdit': '编辑',
  'manager.tabPreview': '预览',
  'manager.save': '保存',
  'manager.saved': '已保存',
  'manager.saveFailed': '保存失败',
  'manager.created': '已创建 ✓',
  'manager.createFailed': '创建失败',
  'picker.title': '记入笔记',
  'picker.close': '关闭',
  'picker.empty': '还没有笔记，先在下方新建一篇',
  'picker.newPlaceholder': '新建笔记标题…',
  'picker.new': '新建',
  'picker.writing': '写入中…',
  'picker.write': '写入笔记',
  'picker.written': '已写入 ✓',
  'picker.writeFailed': '写入失败: {error}',
  'picker.needSelect': '请先选择或新建一篇笔记',
  'picker.createFailed': '创建失败',
} as const
