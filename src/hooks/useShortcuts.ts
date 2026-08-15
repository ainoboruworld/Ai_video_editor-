'use client';

import { useEffect } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { deleteSelection, duplicateSelection, splitAtPlayhead } from '@/features/timeline/operations';

/** True when the user is typing, so shortcuts must not hijack the keystroke. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

/**
 * Editor keyboard map. Everything here is an in-place state change — the page
 * never reloads while editing.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const state = useEditorStore.getState();
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        state.redo();
        return;
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void state.saveNow();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelection();
        return;
      }

      switch (event.key) {
        case ' ':
          event.preventDefault();
          state.setPlaying(!state.playing);
          break;
        case 'Delete':
        case 'Backspace':
          if (state.selection.length > 0) {
            event.preventDefault();
            deleteSelection();
          }
          break;
        case 's':
        case 'S':
          event.preventDefault();
          splitAtPlayhead();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          state.setPlayhead(state.playhead - (event.shiftKey ? 1 : 1 / state.fps));
          break;
        case 'ArrowRight':
          event.preventDefault();
          state.setPlayhead(state.playhead + (event.shiftKey ? 1 : 1 / state.fps));
          break;
        case 'Home':
          event.preventDefault();
          state.setPlayhead(0);
          break;
        case 'Escape':
          state.select([]);
          break;
        case '+':
        case '=':
          state.setZoom(state.zoom * 1.25);
          break;
        case '-':
          state.setZoom(state.zoom / 1.25);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
