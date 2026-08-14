import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clapperboard, Undo2, Redo2, ChevronRight, Download, Check, CloudOff, Loader2 } from 'lucide-react';
import type { AspectRatio } from '@ave/editor-core';
import { useEditorStore } from '../state/editorStore';
import { api } from '../lib/api';
import { IconButton, Select, Button, EditableLabel } from '../components/ui';
import { toast } from '../state/toastStore';
import ExportDialog from './ExportDialog';

const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5', '4:3'];

export default function TopBar() {
  const projectName = useEditorStore((s) => s.projectName);
  const projectId = useEditorStore((s) => s.projectId);
  const seqName = useEditorStore((s) => s.sequence?.name ?? '');
  const aspect = useEditorStore((s) => s.sequence?.aspect ?? '16:9');
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const apply = useEditorStore((s) => s.apply);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  useEditorStore((s) => s.historyTick);
  const history = useEditorStore((s) => s.history);
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="h-10 bg-bg-2 border-b border-line flex items-center px-2.5 gap-2">
      <Link to="/" title="Back to projects" className="flex items-center gap-1.5 hover:opacity-80">
        <div className="w-5 h-5 rounded bg-accent flex items-center justify-center">
          <Clapperboard size={12} className="text-white" />
        </div>
      </Link>

      <div className="flex items-center gap-0.5 text-sm min-w-0">
        <EditableLabel
          value={projectName || 'Project'}
          onChange={async (name) => {
            if (!projectId) return;
            try {
              await api.renameProject(projectId, name);
              useEditorStore.setState({ projectName: name });
            } catch (e: any) {
              toast.error(`Rename failed: ${e.message}`);
            }
          }}
          className="text-ink-2 max-w-[140px]"
        />
        <ChevronRight size={12} className="text-ink-3 shrink-0" />
        <EditableLabel
          value={seqName}
          onChange={(name) => apply({ type: 'RENAME_SEQUENCE', name }, 'Rename sequence')}
          className="font-medium max-w-[180px]"
        />
      </div>

      <div className="w-px h-5 bg-line mx-1" />

      <IconButton onClick={undo} disabled={!history.canUndo} title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}>
        <Undo2 size={14} />
      </IconButton>
      <IconButton onClick={redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={14} />
      </IconButton>

      <SaveIndicator status={saveStatus} />

      <div className="flex-1" />

      <label className="flex items-center gap-1.5 text-xs text-ink-2">
        Aspect
        <Select
          value={aspect}
          onChange={(e) => apply({ type: 'CHANGE_ASPECT_RATIO', aspect: e.target.value as AspectRatio }, `Aspect ${e.target.value}`)}
          className="w-[70px]"
          title="Sequence aspect ratio"
        >
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </label>

      <Button variant="primary" onClick={() => setExportOpen(true)} title="Export video">
        <Download size={13} /> Export
      </Button>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

function SaveIndicator({ status }: { status: string }) {
  if (status === 'saving' || status === 'dirty')
    return (
      <span className="flex items-center gap-1 text-xs text-ink-3 ml-1">
        <Loader2 size={11} className="animate-spin" /> Saving…
      </span>
    );
  if (status === 'saved')
    return (
      <span className="flex items-center gap-1 text-xs text-[#6ee7a0] ml-1">
        <Check size={11} /> Saved
      </span>
    );
  if (status === 'failed')
    return (
      <span className="flex items-center gap-1 text-xs text-[#f0a5a8] ml-1" title="Autosave failed — check API connection">
        <CloudOff size={11} /> Save failed
      </span>
    );
  return null;
}
