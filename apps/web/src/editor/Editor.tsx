import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { Spinner, Button } from '../components/ui';
import TopBar from './TopBar';
import SideToolbar from './SideToolbar';
import PanelHost from './panels/PanelHost';
import PreviewPanel from './PreviewPanel';
import Inspector from './Inspector';
import Timeline from './timeline/Timeline';
import { useShortcuts } from './useShortcuts';

export default function Editor() {
  const { sequenceId } = useParams<{ sequenceId: string }>();
  const loaded = useEditorStore((s) => s.loaded);
  const loadError = useEditorStore((s) => s.loadError);
  const hasSeq = useEditorStore((s) => s.sequence !== null);
  const load = useEditorStore((s) => s.load);
  const reset = useEditorStore((s) => s.reset);

  useEffect(() => {
    if (sequenceId) load(sequenceId);
    return () => reset();
  }, [sequenceId, load, reset]);

  useShortcuts();

  if (!loaded) {
    return (
      <div className="h-screen flex items-center justify-center gap-2 text-ink-2 text-sm">
        <Spinner /> Loading sequence…
      </div>
    );
  }

  if (loadError || !hasSeq) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-sm">
        <AlertCircle size={22} className="text-[#f0a5a8]" />
        <div className="text-ink-2 max-w-sm text-center">{loadError ?? 'Sequence not found'}</div>
        <div className="flex gap-2">
          <Button onClick={() => sequenceId && load(sequenceId)}>Retry</Button>
          <Link to="/">
            <Button variant="ghost">Back to projects</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen grid overflow-hidden select-none"
      style={{
        gridTemplateRows: '40px 1fr 280px',
        gridTemplateColumns: '48px 300px 1fr 280px',
        gridTemplateAreas: `
          "top top top top"
          "rail panel preview inspector"
          "timeline timeline timeline timeline"
        `,
      }}
    >
      <div style={{ gridArea: 'top' }} className="min-h-0">
        <TopBar />
      </div>
      <div style={{ gridArea: 'rail' }} className="min-h-0">
        <SideToolbar />
      </div>
      <div style={{ gridArea: 'panel' }} className="min-h-0 min-w-0">
        <PanelHost />
      </div>
      <div style={{ gridArea: 'preview' }} className="min-h-0 min-w-0">
        <PreviewPanel />
      </div>
      <div style={{ gridArea: 'inspector' }} className="min-h-0 min-w-0">
        <Inspector />
      </div>
      <div style={{ gridArea: 'timeline' }} className="min-h-0 min-w-0">
        <Timeline />
      </div>
    </div>
  );
}
