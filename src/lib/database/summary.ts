import { sequenceDuration } from '@/lib/engine';
import type { Project, ProjectSummary } from '@/types';

export function toSummary(project: Project): ProjectSummary {
  const firstVisual = project.assets.find((a) => a.thumbnailUrl) ?? null;
  return {
    id: project.id,
    name: project.name,
    aspect: project.aspect,
    duration: sequenceDuration(project.sequence),
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    thumbnailUrl: firstVisual?.thumbnailUrl ?? null,
    sceneCount: project.sequence.tracks.reduce((total, track) => total + track.clips.length, 0),
    assetCount: project.assets.length,
  };
}
