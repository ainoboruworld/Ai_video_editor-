'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronLeft,
  Clapperboard,
  CloudOff,
  Download,
  LayoutGrid,
  Loader2,
  Redo2,
  Save,
  Scissors,
  Undo2,
} from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { Badge, Button, IconButton, Input } from '@/components/ui';
import { cn } from '@/lib/cn';

export function TopBar({ onExport }: { onExport: () => void }) {
  const name = useEditorStore((state) => state.name);
  const rename = useEditorStore((state) => state.rename);
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const saveError = useEditorStore((state) => state.saveError);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const history = useEditorStore((state) => state.history);
  useEditorStore((state) => state.historyTick); // re-render when history changes
  const capabilities = useEditorStore((state) => state.capabilities);
  const saveNow = useEditorStore((state) => state.saveNow);

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(name);

  const commitName = () => {
    setEditingName(false);
    const next = draftName.trim();
    if (next && next !== name) rename(next);
    else setDraftName(name);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg-1 px-2">
      <Link
        href="/"
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-ink-2 transition-colors hover:bg-bg-3 hover:text-ink-0"
        title="All projects"
      >
        <ChevronLeft size={14} />
        <span className="flex h-5 w-5 items-center justify-center rounded bg-accent text-white">
          <Clapperboard size={11} />
        </span>
      </Link>

      <div className="flex min-w-0 items-center gap-2">
        {editingName ? (
          <Input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName();
              if (event.key === 'Escape') {
                setDraftName(name);
                setEditingName(false);
              }
            }}
            className="h-7 w-56"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftName(name);
              setEditingName(true);
            }}
            className="truncate rounded px-1.5 py-1 text-sm font-medium text-ink-0 hover:bg-bg-3"
            title="Rename project"
          >
            {name || 'Untitled project'}
          </button>
        )}
        <SaveIndicator status={saveStatus} error={saveError} onRetry={() => void saveNow()} />
      </div>

      <div className="mx-2 h-5 w-px bg-line" />

      <IconButton onClick={undo} disabled={!history.canUndo} title="Undo (⌘Z)">
        <Undo2 size={14} />
      </IconButton>
      <IconButton onClick={redo} disabled={!history.canRedo} title="Redo (⌘⇧Z)">
        <Redo2 size={14} />
      </IconButton>
      <IconButton onClick={() => void saveNow()} title="Save (⌘S)">
        <Save size={14} />
      </IconButton>

      <div className="ml-auto flex items-center gap-2">
        {capabilities && !capabilities.database.durable ? (
          <Badge tone="warn" className="hidden md:inline-flex">
            <CloudOff size={10} /> Temporary storage
          </Badge>
        ) : null}

        <Button size="sm" variant="primary" icon={<Download size={13} />} onClick={onExport}>
          Export
        </Button>
      </div>
    </header>
  );
}

function SaveIndicator({
  status,
  error,
  onRetry,
}: {
  status: string;
  error: string | null;
  onRetry: () => void;
}) {
  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={error ?? 'Save failed'}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-danger hover:bg-danger/10"
      >
        <CloudOff size={11} /> Save failed — retry
      </button>
    );
  }
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-2xs transition-opacity',
        status === 'idle' ? 'opacity-0' : 'text-ink-3',
      )}
    >
      {status === 'saving' ? (
        <>
          <Loader2 size={10} className="animate-spin" /> Saving
        </>
      ) : status === 'saved' ? (
        <>
          <Check size={10} className="text-ok" /> Saved
        </>
      ) : (
        <>
          <Scissors size={10} /> Unsaved
        </>
      )}
    </span>
  );
}
