'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Copyright, Loader2 } from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import { usePlaybackEngine } from '@/hooks/usePlayback';
import { useShortcuts } from '@/hooks/useShortcuts';
import { api } from '@/lib/api-client';
import { TopBar } from './TopBar';
import { SideRail, type RailId } from './SideRail';
import { VideoCanvas } from './VideoCanvas';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { Storyboard } from './Storyboard';
import { ExportDialog } from './ExportDialog';
import { CreditsDialog } from './CreditsDialog';
import { MediaPanel } from './panels/MediaPanel';
import { BrollPanel } from './panels/BrollPanel';
import { TextPanel } from './panels/TextPanel';
import { AudioPanel } from './panels/AudioPanel';
import { AIPanel } from './panels/AIPanel';
import { EffectsPanel } from './panels/EffectsPanel';
import { TransitionsPanel } from './panels/TransitionsPanel';
import { CaptionsPanel } from './panels/CaptionsPanel';
import { Button } from '@/components/ui';

/**
 * Editor layout: rail + panel on the left, program monitor in the centre,
 * inspector on the right, timeline across the bottom.
 */
export function EditorShell({
  projectId,
  initialPrompt,
  initialDuration,
}: {
  projectId: string;
  initialPrompt?: string;
  initialDuration?: number;
}) {
  const load = useEditorStore((state) => state.load);
  const loaded = useEditorStore((state) => state.loaded);
  const loadError = useEditorStore((state) => state.loadError);
  const setCapabilities = useEditorStore((state) => state.setCapabilities);

  const [rail, setRail] = useState<RailId>(initialPrompt ? 'ai' : 'media');
  const [exportOpen, setExportOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);

  const { engine, attach } = usePlaybackEngine();
  useShortcuts();

  useEffect(() => {
    void load(projectId);
    api
      .config()
      .then(({ capabilities }) => setCapabilities(capabilities))
      .catch(() => undefined);
  }, [load, projectId, setCapabilities]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      const status = useEditorStore.getState().saveStatus;
      if (status === 'dirty' || status === 'saving') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 bg-bg-0 text-sm text-ink-2">
        <Loader2 size={16} className="animate-spin" /> Loading project…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg-0 px-6 text-center">
        <AlertTriangle size={22} className="text-warn" />
        <p className="text-sm font-medium text-ink-0">Could not open this project</p>
        <p className="max-w-[46ch] text-xs leading-relaxed text-ink-2">{loadError}</p>
        <Link href="/">
          <Button size="sm">Back to projects</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-0">
      <TopBar onExport={() => setExportOpen(true)} />

      <div className="relative flex min-h-0 flex-1">
        <SideRail active={rail} onSelect={setRail} />

        <div className="hidden w-[320px] shrink-0 flex-col border-r border-line bg-bg-1 md:flex">
          <div className="min-h-0 flex-1 overflow-hidden">
            {rail === 'media' ? <MediaPanel /> : null}
            {rail === 'broll' ? <BrollPanel /> : null}
            {rail === 'ai' ? <AIPanel initialPrompt={initialPrompt} initialDuration={initialDuration} /> : null}
            {rail === 'text' ? <TextPanel /> : null}
            {rail === 'captions' ? <CaptionsPanel /> : null}
            {rail === 'audio' ? <AudioPanel /> : null}
            {rail === 'effects' ? <EffectsPanel /> : null}
            {rail === 'transitions' ? <TransitionsPanel /> : null}
          </div>
          <button
            type="button"
            onClick={() => setCreditsOpen(true)}
            className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-2xs text-ink-3 transition-colors hover:text-ink-1"
          >
            <Copyright size={11} /> Project credits
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <VideoCanvas engine={engine} attach={attach} />
          </div>
          <div className="h-[38%] min-h-[200px] shrink-0 border-t border-line">
            <Timeline />
          </div>
        </div>

        <div className="hidden lg:flex">
          <Inspector />
        </div>

        <Storyboard />
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} engine={engine} />
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />

      <div className="border-t border-line bg-bg-1 px-3 py-2 text-2xs text-ink-3 md:hidden">
        The timeline needs a larger screen. Open this project on a laptop or desktop to edit — you can still preview
        here.
      </div>
    </div>
  );
}
