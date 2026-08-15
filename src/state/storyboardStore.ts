'use client';

import { create } from 'zustand';
import type { SceneRecommendations } from '@/features/ai/actions';

/**
 * B-roll recommendations live outside the project document: they are search
 * results awaiting the user's approval, not saved project data.
 */
interface StoryboardUiState {
  recommendations: SceneRecommendations;
  setRecommendations: (recommendations: SceneRecommendations) => void;
  setSceneRecommendation: (sceneId: string, value: SceneRecommendations[string]) => void;
  clear: () => void;
}

export const useStoryboardStore = create<StoryboardUiState>((set) => ({
  recommendations: {},
  setRecommendations: (recommendations) =>
    set((state) => ({ recommendations: { ...state.recommendations, ...recommendations } })),
  setSceneRecommendation: (sceneId, value) =>
    set((state) => ({ recommendations: { ...state.recommendations, [sceneId]: value } })),
  clear: () => set({ recommendations: {} }),
}));
