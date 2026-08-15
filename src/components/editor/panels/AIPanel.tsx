'use client';

import { useEffect, useState } from 'react';
import {
  Captions,
  Hash,
  LayoutGrid,
  Lightbulb,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useEditorStore } from '@/state/editorStore';
import {
  applyStoryboardToTimeline,
  findBrollForScenes,
  generateCaptionsFromScript,
  generateStoryboard,
  timelineSummary,
} from '@/features/ai/actions';
import { useStoryboardStore } from '@/state/storyboardStore';
import { api, ApiClientError } from '@/lib/api-client';
import { Badge, Button, Field, Input, PanelHeader, Select, Textarea } from '@/components/ui';
import { toast } from '@/state/toastStore';

const TONES = ['punchy', 'warm', 'informative', 'cinematic', 'playful', 'premium'];

/** Prompt → script → storyboard → B-roll → captions, all from one panel. */
export function AIPanel({ initialPrompt, initialDuration }: { initialPrompt?: string; initialDuration?: number }) {
  const storyboard = useEditorStore((state) => state.storyboard);
  const capabilities = useEditorStore((state) => state.capabilities);
  const setStoryboardOpen = useEditorStore((state) => state.setStoryboardOpen);
  const setRecommendations = useStoryboardStore((state) => state.setRecommendations);

  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [duration, setDuration] = useState(initialDuration ?? 30);
  const [tone, setTone] = useState('punchy');
  const [sceneCount, setSceneCount] = useState<number | ''>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ title: string; detail: string; severity: string }[]>([]);
  const [titles, setTitles] = useState<{ titles: string[]; description: string; hashtags: string[] } | null>(null);

  // Auto-run the generation the home screen asked for.
  const [autoRan, setAutoRan] = useState(false);
  useEffect(() => {
    if (autoRan || !initialPrompt || storyboard) return;
    setAutoRan(true);
    void run('script', async () => {
      await generateStoryboard({ prompt: initialPrompt, durationSeconds: initialDuration ?? 30, tone: 'punchy' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRan, initialPrompt, storyboard]);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    try {
      await task();
    } catch (error) {
      toast.error(
        'AI request failed',
        error instanceof ApiClientError || error instanceof Error ? error.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  const aiReady = capabilities?.ai.available ?? false;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="AI"
        description="Turn a brief into a script, storyboard and matched B-roll."
        action={
          capabilities ? (
            <Badge tone={aiReady ? 'accent' : 'warn'}>
              {aiReady ? capabilities.ai.active : 'draft mode'}
            </Badge>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto p-2.5">
        <Field label="Brief">
          <Textarea
            rows={4}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Create a 30-second Instagram Reel about morning productivity."
          />
        </Field>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <Field label="Length">
            <Input
              type="number"
              min={5}
              max={600}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </Field>
          <Field label="Tone">
            <Select value={tone} onChange={(event) => setTone(event.target.value)} className="w-full">
              {TONES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Scenes" hint="auto">
            <Input
              type="number"
              min={2}
              max={20}
              value={sceneCount}
              placeholder="auto"
              onChange={(event) => setSceneCount(event.target.value === '' ? '' : Number(event.target.value))}
            />
          </Field>
        </div>

        <Button
          className="mt-3 w-full"
          variant="primary"
          icon={<Sparkles size={13} />}
          loading={busy === 'script'}
          disabled={prompt.trim().length < 4}
          onClick={() =>
            void run('script', () =>
              generateStoryboard({
                prompt: prompt.trim(),
                durationSeconds: duration,
                tone,
                sceneCount: sceneCount === '' ? undefined : sceneCount,
              }),
            )
          }
        >
          {storyboard ? 'Regenerate storyboard' : 'Generate script & storyboard'}
        </Button>

        {!aiReady ? (
          <p className="mt-2 text-2xs leading-relaxed text-ink-3">
            No AI key detected. You will get a labelled structural draft with real stock queries — add a free{' '}
            <code className="font-mono">GEMINI_API_KEY</code> or <code className="font-mono">GROQ_API_KEY</code> for
            written scripts.
          </p>
        ) : null}

        {storyboard ? (
          <div className="mt-4 space-y-1.5 border-t border-line pt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-ink-1">{storyboard.title}</p>
              <Badge>{storyboard.scenes.length} scenes</Badge>
            </div>

            <Button
              size="sm"
              className="w-full justify-start"
              icon={<LayoutGrid size={12} />}
              onClick={() => setStoryboardOpen(true)}
            >
              Open storyboard
            </Button>

            <Button
              size="sm"
              className="w-full justify-start"
              icon={<Search size={12} />}
              loading={busy === 'broll'}
              onClick={() =>
                void run('broll', async () => {
                  const scenes = useEditorStore.getState().storyboard?.scenes ?? [];
                  const found = await findBrollForScenes(scenes);
                  setRecommendations(found);
                  setStoryboardOpen(true);
                  const total = Object.values(found).reduce((sum, entry) => sum + entry.items.length, 0);
                  toast.success(`Found ${total} B-roll options`, 'Review and approve them in the storyboard.');
                })
              }
            >
              Find B-roll for all scenes
            </Button>

            <Button
              size="sm"
              className="w-full justify-start"
              icon={<Wand2 size={12} />}
              onClick={() => applyStoryboardToTimeline()}
            >
              Assemble on timeline
            </Button>

            <Button
              size="sm"
              className="w-full justify-start"
              icon={<Captions size={12} />}
              loading={busy === 'captions'}
              onClick={() =>
                void run('captions', async () => {
                  await generateCaptionsFromScript();
                  toast.success('Captions generated from the script');
                })
              }
            >
              Generate captions from script
            </Button>

            <Button
              size="sm"
              className="w-full justify-start"
              icon={<Hash size={12} />}
              loading={busy === 'titles'}
              disabled={!aiReady}
              onClick={() =>
                void run('titles', async () => {
                  const script = storyboard.scenes.map((scene) => scene.script).join(' ');
                  const { payload } = await api.generateTitles(storyboard.title, script);
                  setTitles(payload);
                })
              }
            >
              Titles & hashtags
            </Button>

            <Button
              size="sm"
              className="w-full justify-start"
              icon={<Lightbulb size={12} />}
              loading={busy === 'suggest'}
              disabled={!aiReady}
              onClick={() =>
                void run('suggest', async () => {
                  const { suggestions: notes } = await api.suggestEdits(timelineSummary());
                  setSuggestions(notes);
                  if (notes.length === 0) toast.info('No notes — the edit looks solid.');
                })
              }
            >
              Review my edit
            </Button>
          </div>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="mt-4 space-y-1.5">
            <p className="text-2xs uppercase tracking-wide text-ink-3">Editing notes</p>
            {suggestions.map((suggestion) => (
              <div key={suggestion.title} className="rounded-md border border-line bg-bg-2 p-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink-0">
                  <Badge tone={suggestion.severity === 'fix' ? 'danger' : suggestion.severity === 'info' ? 'neutral' : 'warn'}>
                    {suggestion.severity}
                  </Badge>
                  {suggestion.title}
                </p>
                {suggestion.detail ? (
                  <p className="mt-1 text-2xs leading-relaxed text-ink-2">{suggestion.detail}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {titles ? (
          <div className="mt-4 rounded-md border border-line bg-bg-2 p-2">
            <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-3">Titles</p>
            <ul className="space-y-1">
              {titles.titles.map((title) => (
                <li key={title} className="text-xs text-ink-1">
                  {title}
                </li>
              ))}
            </ul>
            {titles.hashtags.length > 0 ? (
              <p className="mt-2 text-2xs text-accent">{titles.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
