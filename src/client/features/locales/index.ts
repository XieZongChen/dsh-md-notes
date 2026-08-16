/**
 * dsh-md-notes locale dictionaries + LocaleNamespaceMap declaration, so the
 * framework-injected `t` seat is typed to this feature's key union.
 * @module dsh-md-notes/client/locales
 */

import { zh } from './zh.ts'

export { zh } from './zh.ts'
export { en } from './en.ts'

/** Key union of this feature's dictionary (derived from the Chinese source). */
export type MdNotesKey = keyof typeof zh & string

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-md-notes UI copy (registered by the client plugin apply). */
    'md-notes': MdNotesKey
  }
}
