import { useEditorStore } from '../../state/editorStore';
import MediaPanel from './MediaPanel';
import AudioPanel from './AudioPanel';
import TextPanel from './TextPanel';
import CaptionsPanel from './CaptionsPanel';
import BrollPanel from './BrollPanel';
import TransitionsPanel from './TransitionsPanel';
import AIPanel from './AIPanel';
import TranscriptPanel from './TranscriptPanel';

const TITLES: Record<string, string> = {
  media: 'Media',
  audio: 'Audio',
  text: 'Text',
  captions: 'Captions',
  broll: 'B-roll',
  transitions: 'Transitions',
  ai: 'AI',
  transcript: 'Transcript',
};

export default function PanelHost() {
  const active = useEditorStore((s) => s.activePanel);
  return (
    <div className="h-full bg-bg-2 border-r border-line flex flex-col min-h-0">
      <div className="h-8 shrink-0 flex items-center px-3 border-b border-line text-sm font-semibold">
        {TITLES[active]}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {active === 'media' && <MediaPanel />}
        {active === 'audio' && <AudioPanel />}
        {active === 'text' && <TextPanel />}
        {active === 'captions' && <CaptionsPanel />}
        {active === 'broll' && <BrollPanel />}
        {active === 'transitions' && <TransitionsPanel />}
        {active === 'ai' && <AIPanel />}
        {active === 'transcript' && <TranscriptPanel />}
      </div>
    </div>
  );
}
