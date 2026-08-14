import { useState } from 'react';
import { Film, Search, Plus } from 'lucide-react';
import { useEditorStore, primaryAssetId } from '../../state/editorStore';
import { api, pollJob, type Suggestion } from '../../lib/api';
import { timecode, uid } from '../../lib/format';
import { Button, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { toast } from '../../state/toastStore';

export default function BrollPanel() {
  const apply = useEditorStore((s) => s.apply);
  const assets = useEditorStore((s) => s.assets);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [chosenAsset, setChosenAsset] = useState<string>('');

  const videoAssets = assets.filter((a) => a.kind === 'video' && a.status === 'ready');

  async function find() {
    setBusy(true);
    setStep('Looking for existing suggestions…');
    try {
      const state = useEditorStore.getState();
      const assetId = primaryAssetId(state);
      if (!assetId) throw new Error('No video asset in this project yet');
      let list = await api.getSuggestions(assetId, 'broll');
      if (!list || list.length === 0) {
        setStep('Analyzing video…');
        const { jobId } = await api.analyze(assetId);
        const job = await pollJob(jobId, (j) => setStep(`${j.step ?? 'Analyzing'}… ${Math.round(j.progress)}%`), 1500);
        if (job.status === 'error') throw new Error(job.error ?? 'Analysis failed');
        list = await api.getSuggestions(assetId, 'broll');
      }
      setSuggestions(list ?? []);
    } catch (e: any) {
      toast.error(e.message ?? 'B-roll analysis failed');
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  function insert(s: Suggestion) {
    const { sequence } = useEditorStore.getState();
    if (!sequence) return;
    const asset = videoAssets.find((a) => a.id === chosenAsset) ?? videoAssets[0];
    if (!asset) {
      toast.error('Upload a video asset to use as B-roll first');
      return;
    }
    const track =
      sequence.tracks.find((t) => t.kind === 'video' && /b-?roll/i.test(t.name) && !t.locked) ??
      sequence.tracks.filter((t) => t.kind === 'video' && !t.locked)[1] ??
      sequence.tracks.find((t) => t.kind === 'video' && !t.locked);
    if (!track) {
      toast.error('No video track available');
      return;
    }
    apply(
      {
        type: 'ADD_BROLL',
        trackId: track.id,
        clipId: uid('broll'),
        assetId: asset.id,
        start: s.start,
        duration: Math.max(0.5, Math.min(s.end - s.start, asset.duration ?? 5)),
        mode: 'cutaway',
        name: asset.name,
      },
      'Insert B-roll',
    );
    toast.success(`B-roll inserted at ${timecode(s.start)}`);
  }

  return (
    <div className="flex flex-col p-3 gap-3">
      <p className="text-xs text-ink-3">
        Analyzes the main video's transcript for moments where cutaway footage would help.
      </p>
      <Button variant="primary" onClick={find} disabled={busy} className="w-full">
        {busy ? <Spinner /> : <Search size={13} />}
        {busy ? (step ?? 'Analyzing…') : 'Find B-roll opportunities'}
      </Button>

      {videoAssets.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-2">B-roll source asset</span>
          <Select value={chosenAsset} onChange={(e) => setChosenAsset(e.target.value)}>
            {videoAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
      )}

      {suggestions !== null && suggestions.length === 0 && (
        <EmptyState
          icon={<Film size={20} />}
          title="No opportunities found"
          hint="The analysis didn't flag any moments. Try a longer video with narration."
        />
      )}

      <div className="flex flex-col gap-2">
        {suggestions?.map((s) => (
          <div key={s.id} className="border border-line rounded bg-bg-3 p-2.5">
            <div className="flex items-center gap-2 mb-1">
              <Badge color="indigo">{timecode(s.start)}</Badge>
              <span className="text-sm font-medium truncate flex-1">{s.title}</span>
            </div>
            <p className="text-xs text-ink-3 mb-2">{s.description}</p>
            {Array.isArray(s.payload?.keywords) && (
              <div className="flex flex-wrap gap-1 mb-2">
                {s.payload.keywords.map((k: string) => (
                  <Badge key={k}>{k}</Badge>
                ))}
              </div>
            )}
            <Button size="sm" onClick={() => insert(s)} title="Insert chosen asset at this time on the B-roll track">
              <Plus size={12} /> Insert B-roll
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
