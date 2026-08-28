/**
 * Client-side mirror of the host's note-name sanitation, used to predict the
 * file name a `create` request will produce so the create dialog can reject a
 * duplicate before submitting. Keep `sanitizeFileName` in sync with
 * `sanitizeName` in `src/host/notes.ts` — the two live in separate tsc
 * programs (host vs client bundle), so the logic is duplicated deliberately.
 * @module dsh-md-notes/client/sanitize
 */

/** Normalize a user-supplied note name into a safe `.md` basename (host mirror). */
export function sanitizeFileName(input: string): string {
  const base = String(input ?? '').trim().replace(/\.md$/i, '')
  const slug = base
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'note'}.md`
}

/**
 * A case-insensitive, `.md`-stripped key for comparing two file names. Used to
 * detect duplicates regardless of the `.md` suffix or letter case (macOS file
 * systems are case-insensitive, so `Foo.md` and `foo.md` must be treated as the
 * same file).
 */
export function fileNameKey(name: string): string {
  return sanitizeFileName(name).replace(/\.md$/i, '').toLowerCase()
}
