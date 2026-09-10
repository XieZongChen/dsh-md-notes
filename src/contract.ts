/**
 * The single wire contract shared by the backend (src/) and the frontend
 * (src/client/): the API's entity types plus the per-method request/response
 * shapes of `POST <route>` (`{ method, ...args }`). Pure types — no runtime,
 * no dsh imports — so both tsc programs compile it independently (the two
 * programs cannot merge: host dsh-session and browser dsh-client-runtime
 * declare conflicting `Context.sessions` shapes; see architecture.md §5).
 *
 * Rule (coding-standards §3): a wire entity is defined ONCE here; host domain
 * modules and client features import it — never re-declare a second copy.
 * @module dsh-md-notes/contract
 */

// ---- entities ----

/** One note summary as listed (host `notes.ts` builds it; client lists render it). */
export interface NoteSummary {
  name: string
  title: string
  updatedAt: number
}

/** One workspace group in the `list` response. */
export interface WorkspaceNotes {
  workspaceId: string
  name: string
  /** Absolute notes directory (`<ws>/.dsh-notes`) — used to build reference paths. */
  notesDir: string
  notes: NoteSummary[]
}

/** One matched source line in a `search` result (offsets are line-relative, 0-based). */
export interface SearchHit {
  /** 1-based source line number (over the EOL-normalized content). */
  line: number
  /** The EOL-normalized line text, prefix-truncated for display (≤160 chars + '…'). */
  text: string
  /** Token occurrence ranges within `text` (client-side `<mark>` highlight). */
  ranges: Array<{ start: number; end: number }>
}

/** One note's `search` result. */
export interface NoteHits {
  workspaceId: string
  workspaceName: string
  name: string
  title: string
  /** Every token matched the title (the note surfaces even with no body hits). */
  titleMatch: boolean
  /** Total matched lines in the body (uncapped; `hits` is capped per note). */
  totalHits: number
  /** The first matched lines, in source order. */
  hits: SearchHit[]
}

/** One repo's git status view (display copy; `remote` is credential-redacted). */
export interface GitStatusData {
  repoDir?: string
  /** In-repo subdir for this workspace ('' = repo root). */
  subdir?: string
  branch?: string
  uncommitted?: number
  /** Notes whose local state differs from the repo target (not yet pushed). */
  unpushed?: number
  /** Number of remote commits ahead of the local clone, scoped to this subdir. */
  remoteAhead?: number
  lastCommit?: string
  remote?: string
  error?: string
}

/** Git mode: 'off' / 'shared' / 'own' ('on' is a legacy value normalized on read). */
export type GitMode = 'off' | 'on' | 'shared' | 'own'

/** Per-repo record: URL + branch + in-repo subpath. */
export interface RepoSettings {
  /** Git remote URL (the repo is identified by URL; plugin manages the local clone). */
  remote?: string
  /** Branch to push/pull on (default 'main'). */
  branch?: string
  /** In-repo subpath holding this workspace's notes ('' = repo root). */
  subpath?: string
}

/** Shared (central) repo settings — `gitMode: 'shared'`. */
export interface CentralSettings {
  /** Git remote URL of the shared repo. */
  remote?: string
  /** Branch to push/pull on (default 'main'). */
  branch?: string
}

/** The user-level (L3) settings section (the settings form edits this shape). */
export interface MdNotesSettings {
  /** 'off' = no git; 'shared' = shared repo for all workspaces; 'own' = per-workspace repos. */
  gitMode?: GitMode
  gitCentral?: CentralSettings
  gitRepos?: Record<string, RepoSettings>
  gitAutoPull?: boolean
  gitAuthorName?: string
  gitAuthorEmail?: string
}

/** Client-side alias: the settings/config forms' view of {@link MdNotesSettings}. */
export type GitSettingsData = MdNotesSettings

/** npm update-check result. */
export interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
}

/** Outcome of the legacy-session repair sweep (`repairSessions`). */
export interface SessionRepairReport {
  /** Session log files examined. */
  scanned: number
  /** Files rewritten (contained legacy `md-notes` message sources). */
  repaired: number
  /** Message-source objects rewritten to the official `plugin` form. */
  events: number
  /** Files that failed to decompress/rewrite (left untouched; backup kept when made). */
  failed: number
  /** Other source kinds found in repaired files that dsh's migration whitelist may still refuse (deduped). */
  stillBlocked: string[]
}

/** Localized section labels for `appendConversation` (client sends; host renders). */
export interface AppendLabels {
  user?: string
  assistant?: string
  empty?: string
  image?: string
}

// ---- envelope ----

/** The failure branch every method shares (`code` drives the client's localized copy). */
export interface ApiError {
  ok: false
  error: string
  code?: string
  changed?: string[]
}

/** The success branch is method-specific (`T`); the failure branch is shared. */
export type ApiResult<T extends object = object> = ({ ok: true } & T) | ApiError

// ---- per-method contract ----

/** The `{ method, ...args }` API surface: one entry per method name. */
export interface ApiContract {
  /** Notes domain. */
  list: {
    /** `sessionId` scopes the list to that session's workspace (empty when it resolves none). */
    req: { sessionId?: string }
    res: ApiResult<{ workspaces: WorkspaceNotes[]; noWorkspaces?: boolean }>
  }
  read: {
    req: { name: string; workspaceId?: string }
    res: ApiResult<{ name: string; content: string }>
  }
  write: {
    req: { name: string; content: string; workspaceId?: string }
    res: ApiResult<{ name: string }>
  }
  create: {
    req: { title: string; name?: string; workspaceId?: string }
    res: ApiResult<{ name: string }>
  }
  delete: {
    req: { name: string; workspaceId?: string }
    res: ApiResult<{ name: string }>
  }
  appendConversation: {
    req: {
      noteName: string
      questionText: string
      answerText: string
      sessionTitle?: string
      labels?: AppendLabels
      workspaceId?: string
    }
    res: ApiResult<{ name: string }>
  }
  /**
   * One-shot maintenance sweep over `~/.dsh/sessions`: rewrite legacy
   * `source.kind === 'md-notes'` message sources (written by plugin ≤0.12.0 on
   * dsh ≤0.1.3) to the official `plugin` variant so dsh ≥0.1.5's V0→V3 session
   * migration accepts the log again. Originals are backed up beside each file.
   */
  repairSessions: {
    req: Record<string, never>
    res: ApiResult<SessionRepairReport>
  }
  /**
   * Full-text search across every workspace's notes (the manager search box).
   * Matching: whitespace-split tokens, AND semantics, case-insensitive
   * substring over title + body; see `host/notes.ts` `searchNotes` for the caps.
   */
  search: {
    req: { query: string }
    res: ApiResult<{ results: NoteHits[]; truncated: boolean }>
  }

  /** Git domain. */
  gitStatus: {
    req: { workspaceId?: string }
    res: ApiResult<{ status: GitStatusData }>
  }
  gitInit: {
    req: object
    res: ApiResult
  }
  gitPush: {
    req: { workspaceId?: string; message?: string; overwrite?: boolean }
    res: ApiResult
  }
  gitPull: {
    req: { workspaceId?: string; force?: boolean; manual?: boolean }
    res: ApiResult<{ skipped?: number; changed?: string[] }>
  }
  gitSync: {
    req: { workspaceId?: string }
    res: ApiResult
  }
  gitSettings: {
    req: object
    res: ApiResult<{ settings: GitSettingsData }>
  }
  gitConfig: {
    /** Whitelisted keys only — the host drops everything else (see `handleApi`). */
    req: Partial<Pick<MdNotesSettings, 'gitMode' | 'gitAutoPull' | 'gitAuthorName' | 'gitAuthorEmail'>> & {
      gitCentral?: CentralSettings
      gitRepos?: Record<string, RepoSettings>
    }
    res: ApiResult
  }
  checkUpdate: {
    req: object
    res: ApiResult<{ update: UpdateInfo }>
  }
}
