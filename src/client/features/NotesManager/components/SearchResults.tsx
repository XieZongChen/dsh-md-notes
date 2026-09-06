/**
 * Search results list for the manager's left pane (docs/search.md §2): notes
 * grouped by workspace, each note row with its matched lines. Clicking a hit
 * row opens the note located on that line; clicking the note row locates the
 * first hit. Pure renderer — state lives in `useNoteSearch` + the manager.
 * @module dsh-md-notes/client/NotesManager/components/SearchResults
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NoteHits, SearchHit } from '../../api.ts'
import type { SearchPhase } from '../hooks/useNoteSearch.ts'
import { highlightSegments } from '../search.ts'
import shared from '../../styles.module.css'
import styles from './search.module.css'

interface SearchResultsProps {
  phase: SearchPhase
  results: NoteHits[]
  truncated: boolean
  t: TranslateNS<'md-notes'>
  /** Open the note; `hit` (when present) is the row to locate in the editor. */
  onOpenNote: (wsId: string, name: string, hit: SearchHit | undefined) => void
}

export function SearchResults({ phase, results, truncated, t, onOpenNote }: SearchResultsProps): React.ReactElement {
  /** Group hits by workspace, preserving the host's (registry) order. */
  const groups: Array<{ wsId: string; name: string; notes: NoteHits[] }> = []
  for (const note of results) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.wsId === note.workspaceId) {
      last.notes.push(note)
    } else {
      groups.push({ wsId: note.workspaceId, name: note.workspaceName, notes: [note] })
    }
  }

  return (
    <div className={styles.list}>
      <div className={`${styles.listItems} ${shared.scrollNarrow}`}>
        {phase === 'searching' && results.length === 0
          ? <div className={styles.hint}>{t('search.searching')}</div>
          : phase === 'error'
            ? <div className={styles.hint}>{t('search.error')}</div>
            : results.length === 0
              ? <div className={shared.empty}>{t('search.noResults')}</div>
              : groups.map((group) => (
                <div key={group.wsId} className={styles.group}>
                  <div className={styles.groupHead} title={group.name}>
                    <span className={styles.groupFolder}><IconFolderOpen16 /></span>
                    <span className={styles.groupTitle}>{group.name}</span>
                    <span className={styles.groupCount}>{group.notes.length}</span>
                  </div>
                  {group.notes.map((note) => {
                    const first = note.hits[0]
                    return (
                      <div key={`${note.workspaceId}/${note.name}`} className={styles.note}>
                        <div className={styles.noteHead} onClick={() => onOpenNote(note.workspaceId, note.name, first)}>
                          <span className={styles.noteTitle} title={note.title}>{note.title}</span>
                          {note.titleMatch && <span className={styles.titleHit}>{t('search.titleHit')}</span>}
                          <span className={styles.hitCount}>{t('search.hits', { count: note.totalHits })}</span>
                        </div>
                        {note.hits.map((hit) => (
                          <div
                            key={hit.line}
                            className={styles.hitRow}
                            onClick={() => onOpenNote(note.workspaceId, note.name, hit)}
                          >
                            <span className={styles.hitLine}>{`L${hit.line}`}</span>
                            <span className={styles.hitText}>
                              {highlightSegments(hit.text, hit.ranges).map((seg, i) => (
                                seg.mark
                                  ? <mark key={i} className={styles.mark}>{seg.text}</mark>
                                  : <React.Fragment key={i}>{seg.text}</React.Fragment>
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))}
        {truncated && results.length > 0 && (
          <div className={styles.hint}>{t('search.truncated', { count: results.length })}</div>
        )}
      </div>
    </div>
  )
}
