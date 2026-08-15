/** Shared styles for the dsh-md-notes browser half. */
export const css = `.notesRow {
  order: -1; /* top row of the sidebar bottom area */
  flex: 1 0 100%;
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 4px 6px 0;
}

.entry {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  height: 38px;
  padding: 0 10px 0 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #222);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  overflow: hidden;
}

.entry:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15)));
}

.entryIcon { font-size: 15px; flex: none; }
.entryLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.entryRail {
  width: 36px;
  height: 36px;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
}

.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary, #888);
  font-size: 14px;
  padding: 4px 6px;
  border-radius: 6px;
  line-height: 1;
}

.action:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15));
  color: var(--dsw-alias-label-primary, #222);
}

.actionIcon { font-size: 13px; }

.mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  font-family: inherit;
}

.dialog {
  width: 420px;
  max-width: 92vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-overlay, #fff);
  border: 1px solid var(--dsw-alias-border-l1, #ddd);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.dialogHead, .managerHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #ddd);
  background: var(--dsw-alias-bg-layer-1, #fafafa);
}

.dialogTitle { font-weight: 600; font-size: 14px; flex: 1; color: var(--dsw-alias-label-primary, #222); }
.dialogBody { padding: 12px 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.dialogFoot { padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1, #ddd); display: flex; justify-content: flex-end; }

.pickList { max-height: 240px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1, #ddd); border-radius: 8px; }
.pickItem { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; font-size: 13px; color: var(--dsw-alias-label-primary, #222); }
.pickItem:hover { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12)); }
.pickItemActive { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.18)); }
.pickRadio { color: var(--dsw-alias-brand-primary, #4a7bff); font-size: 11px; }
.newRow { display: flex; gap: 8px; }
.status { font-size: 12px; color: var(--dsw-alias-label-secondary, #888); min-height: 16px; }

.manager {
  width: min(980px, 94vw);
  height: min(660px, 88vh);
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l1, #ddd);
  border-radius: 12px;
  box-shadow: 0 16px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.managerTitle { font-weight: 700; font-size: 15px; color: var(--dsw-alias-label-primary, #222); }
.managerSub { font-size: 11px; color: var(--dsw-alias-label-secondary, #888); flex: 1; }
.managerBody { display: flex; flex: 1; min-height: 0; }

.list { width: 240px; border-right: 1px solid var(--dsw-alias-border-l1, #ddd); display: flex; flex-direction: column; min-height: 0; }
.listHead { display: flex; gap: 6px; padding: 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ddd); }
.listItems { flex: 1; overflow: auto; padding: 6px; }

.noteItem { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 8px; cursor: pointer; margin-bottom: 2px; }
.noteItem:hover { background: var(--dsw-alias-bg-layer-1, #f5f5f5); }
.noteItemActive { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15)); }
.noteMain { flex: 1; min-width: 0; }
.noteTitle { font-size: 13px; color: var(--dsw-alias-label-primary, #222); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.noteTime { font-size: 11px; color: var(--dsw-alias-label-secondary, #888); }
.noteDel { border: none; background: transparent; cursor: pointer; font-size: 12px; opacity: 0.6; padding: 2px; }
.noteDel:hover { opacity: 1; }

.editor { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.editorEmpty { flex: 1; display: flex; align-items: center; justify-content: center; }
.editorHead { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ddd); }
.editorName { font-size: 11px; color: var(--dsw-alias-label-secondary, #888); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flash { font-size: 12px; color: var(--dsw-alias-state-success-primary, #2e8b57); min-width: 44px; }

.tab { border: none; background: transparent; cursor: pointer; font-size: 12px; padding: 4px 10px; border-radius: 6px; color: var(--dsw-alias-label-secondary, #888); }
.tabActive { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.18)); color: var(--dsw-alias-label-primary, #222); font-weight: 600; }

.textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  padding: 14px 16px;
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--dsw-alias-label-primary, #222);
  background: transparent;
}

.preview { flex: 1; overflow: auto; padding: 14px 18px; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-primary, #222); }
.preview h1 { font-size: 20px; }
.preview h2 { font-size: 17px; }
.preview h3 { font-size: 15px; }
.preview pre { background: var(--dsw-alias-bg-layer-1, #f5f5f5); padding: 10px 12px; border-radius: 8px; overflow: auto; }
.preview code { background: var(--dsw-alias-bg-layer-1, #f5f5f5); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.preview pre code { background: transparent; padding: 0; }
.preview blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--dsw-alias-border-l2, #ccc); color: var(--dsw-alias-label-secondary, #666); }
.preview a { color: var(--dsw-alias-brand-primary, #4a7bff); }

.btn {
  border: 1px solid var(--dsw-alias-border-l1, #ddd);
  background: var(--dsw-alias-bg-layer-1, #fafafa);
  color: var(--dsw-alias-label-primary, #222);
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 7px;
  cursor: pointer;
}
.btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15)); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btnPrimary { background: var(--dsw-alias-brand-primary, #4a7bff); border-color: transparent; color: #fff; }
.btnPrimary:hover { filter: brightness(1.08); background: var(--dsw-alias-brand-primary, #4a7bff); }

.iconBtn { border: none; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #888); font-size: 13px; padding: 4px 8px; border-radius: 6px; }
.iconBtn:hover { background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15)); color: var(--dsw-alias-label-primary, #222); }

.input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l1, #ddd);
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #222);
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 7px;
  outline: none;
}
.input:focus { border-color: var(--dsw-alias-brand-primary, #4a7bff); }

.empty { padding: 16px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }
`
