import type { Sequence } from './types';
import { applyCommand, type EditorCommand } from './commands';

export interface HistoryEntry {
  label: string;
  before: Sequence;
}

/**
 * Snapshot-based undo history. Sequences are immutable and structurally
 * shared, so snapshots are cheap. Every command — manual or AI — records
 * an entry, which makes AI batch edits fully recoverable.
 */
export class EditorHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  constructor(private limit = 200) {}

  /** Apply a command (or batch) and record an undo entry. */
  apply(seq: Sequence, commands: EditorCommand | EditorCommand[], label: string): Sequence {
    const list = Array.isArray(commands) ? commands : [commands];
    let next = seq;
    for (const cmd of list) next = applyCommand(next, cmd);
    if (next !== seq) {
      this.past.push({ label, before: seq });
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    return next;
  }

  undo(current: Sequence): Sequence | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ label: entry.label, before: current });
    return entry.before;
  }

  redo(current: Sequence): Sequence | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ label: entry.label, before: current });
    return entry.before;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }
  clear(): void {
    this.past = [];
    this.future = [];
  }
}
