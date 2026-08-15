'use client';

/**
 * The AI workflow, expressed as plain functions over the editor store:
 * prompt → storyboard → B-roll → timeline → captions.
 *
 * Nothing here is simulated. Script generation calls the configured AI provider
 * (or the labelled offline draft generator), B-roll comes from the real stock
 * APIs, and assembly runs through the command engine so every result is an
 * ordinary, editable, undoable edit.
 */
import { api, ApiClientError } from '@/lib/api-client';
import { assembleStoryboard } from '@/features/broll/assemble';
import { trackByRole, type AspectRatio } from '@/lib/engine';
import { useEditorStore } from '@/state/editorStore';
import { toast } from '@/state/toastStore';
import type { Asset, StockMediaItem, StoryboardScene } from '@/types';

export interface SceneRecommendations {
  [sceneId: string]: { queries: string[]; items: StockMediaItem[]; error?: string };
}

export async function generateStoryboard(input: {
  prompt: string;
  durationSeconds: number;
  tone?: string;
  sceneCount?: number;
}): Promise<void> {
  const state = useEditorStore.getState();
  const { storyboard } = await api.generateScript({
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    aspect: state.aspect as AspectRatio,
    tone: input.tone,
    sceneCount: input.sceneCount,
  });
  state.setStoryboard(storyboard);
  useEditorStore.getState().setStoryboardOpen(true);
  if (storyboard.provider === 'offline') {
    toast.warn('Structural draft created', 'No AI provider configured — edit the scenes or add an API key.');
  } else {
    toast.success(`Storyboard ready · ${storyboard.scenes.length} scenes`);
  }
}

/** Runs "Find B-roll" for the given scenes and returns ranked options. */
export async function findBrollForScenes(scenes: StoryboardScene[]): Promise<SceneRecommendations> {
  const state = useEditorStore.getState();
  if (scenes.length === 0) return {};

  const { recommendations, missingKeys } = await api.findBroll({
    aspect: state.aspect as AspectRatio,
    topic: state.storyboard?.title,
    perScene: 6,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      visual: scene.visual,
      duration: scene.duration,
      queries: scene.brollQueries.length > 0 ? scene.brollQueries : undefined,
    })),
  });

  if (missingKeys.length > 0 && recommendations.every((rec) => rec.items.length === 0)) {
    throw new ApiClientError(
      503,
      `No stock provider configured (${missingKeys.join(', ')}). Add a free PEXELS_API_KEY to search B-roll.`,
      'no_provider',
    );
  }

  const result: SceneRecommendations = {};
  for (const recommendation of recommendations) {
    result[recommendation.sceneId] = {
      queries: recommendation.queries,
      items: recommendation.items,
      error: recommendation.error,
    };
    // Keep the generated queries on the scene so the user can refine them.
    if (recommendation.queries.length > 0) {
      useEditorStore.getState().updateScene(recommendation.sceneId, { brollQueries: recommendation.queries });
    }
  }
  return result;
}

/** Imports a stock item and attaches it to a scene (no timeline change yet). */
export async function attachItemToScene(sceneId: string, item: StockMediaItem): Promise<Asset | null> {
  const state = useEditorStore.getState();
  if (!state.projectId) return null;
  const { asset } = await api.importStockAsset({ projectId: state.projectId, item });
  state.addAsset(asset);
  useEditorStore.getState().updateScene(sceneId, { assetId: asset.id });
  return asset;
}

/** Lays the approved storyboard onto the timeline as one undoable step. */
export function applyStoryboardToTimeline(options?: { withCaptions?: boolean; withText?: boolean }): boolean {
  const state = useEditorStore.getState();
  const { sequence, storyboard, assets } = state;
  if (!sequence || !storyboard) return false;

  const { commands, placements } = assembleStoryboard({
    sequence,
    scenes: storyboard.scenes,
    assets,
    withCaptions: options?.withCaptions ?? true,
    withText: options?.withText ?? true,
  });

  if (commands.length === 0) {
    toast.info('Nothing to assemble yet', 'Add B-roll to at least one scene first.');
    return false;
  }

  const applied = state.apply(commands, 'Assemble storyboard');
  if (applied) {
    for (const placement of placements) {
      useEditorStore.getState().updateScene(placement.sceneId, { clipIds: placement.clipIds });
    }
    toast.success('Storyboard assembled on the timeline');
  }
  return applied;
}

/** Turns scene narration into caption clips (no audio needed). */
export async function generateCaptionsFromScript(): Promise<void> {
  const state = useEditorStore.getState();
  const { sequence, storyboard } = state;
  if (!sequence || !storyboard) throw new Error('Generate a storyboard first.');

  const captionTrack = trackByRole(sequence, 'caption');
  if (!captionTrack) throw new Error('This project has no caption track.');

  let cursor = 0;
  const segments = storyboard.scenes
    .map((scene) => {
      const segment = { id: scene.id, text: scene.script.trim(), start: cursor, duration: scene.duration };
      cursor += scene.duration;
      return segment;
    })
    .filter((segment) => segment.text.length > 0);

  if (segments.length === 0) throw new Error('The storyboard has no narration to caption.');

  const { results } = await api.generateCaptions(segments);

  const commands = [
    ...captionTrack.clips.map((clip) => ({ type: 'DELETE_CLIP' as const, clipId: clip.id })),
    ...results.flatMap((result) =>
      result.cues.map((cue, index) => ({
        type: 'ADD_CAPTION' as const,
        trackId: captionTrack.id,
        clipId: `cap_${result.id}_${index}`,
        text: cue.text,
        start: cue.start,
        duration: Math.max(0.4, cue.end - cue.start),
        style: 'bold' as const,
      })),
    ),
  ];

  if (!state.apply(commands, 'Generate captions')) {
    throw new Error('Captions could not be applied.');
  }
}

/** Compact timeline description handed to the AI for editing notes. */
export function timelineSummary(): string {
  const state = useEditorStore.getState();
  const sequence = state.sequence;
  if (!sequence) return '';
  const lines: string[] = [
    `Project: ${state.name} (${state.aspect}, ${sequence.fps}fps)`,
    state.storyboard ? `Topic: ${state.storyboard.title} — ${state.storyboard.prompt}` : '',
  ];
  for (const track of sequence.tracks) {
    if (track.clips.length === 0) continue;
    lines.push(`Track "${track.name}" (${track.role}):`);
    for (const clip of track.clips.slice(0, 40)) {
      const label = clip.kind === 'text' || clip.kind === 'caption' ? `"${clip.text ?? ''}"` : clip.name;
      lines.push(
        `  ${clip.start.toFixed(1)}s → ${(clip.start + clip.duration).toFixed(1)}s · ${clip.kind} · ${label} · volume ${clip.volume}`,
      );
    }
  }
  return lines.filter(Boolean).join('\n').slice(0, 11_000);
}
