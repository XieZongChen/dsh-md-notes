/**
 * English dictionary for dsh-md-notes UI copy. The mapped type guarantees
 * exactly the same key set as the Chinese source (`zh.ts`).
 * @module dsh-md-notes/client/locales/en
 */

import { zh } from './zh.ts'

/** English dictionary keyed identically to the Chinese source. */
export const en: { [K in keyof typeof zh]: string } = {
  'sidebar.entry': 'MD Notes',
  'sidebar.label': 'Notes',
  'action.tooltip': 'Add to note',
  'manager.title': 'MD Notes',
  'manager.subtitle': 'Saved in workspace .dsh-notes/',
  'manager.close': 'Close',
  'manager.untitled': 'Untitled note {date}',
  'manager.newPlaceholder': 'New note title…',
  'manager.new': 'New',
  'manager.creating': 'Creating…',
  'manager.empty': 'No notes yet — enter a title above and click "New"',
  'manager.delete': 'Delete',
  'manager.deleteConfirm': 'Delete note {name}?',
  'manager.editorEmpty': '← Select a note on the left, or create one',
  'manager.tabEdit': 'Edit',
  'manager.tabPreview': 'Preview',
  'manager.save': 'Save',
  'manager.saved': 'Saved',
  'manager.saveFailed': 'Save failed',
  'manager.created': 'Created ✓',
  'manager.createFailed': 'Create failed',
  'picker.title': 'Add to note',
  'picker.close': 'Close',
  'picker.empty': 'No notes yet — create one below',
  'picker.newPlaceholder': 'New note title…',
  'picker.new': 'New',
  'picker.writing': 'Writing…',
  'picker.write': 'Write to note',
  'picker.written': 'Written ✓',
  'picker.writeFailed': 'Write failed: {error}',
  'picker.needSelect': 'Select or create a note first',
  'picker.createFailed': 'Create failed',
}
