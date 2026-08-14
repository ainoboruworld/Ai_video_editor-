import { useEffect } from 'react';
import { sequenceDuration, type Clip } from '@ave/editor-core';
import { useEditorStore, findClip, clipAt } from '../state/editorStore';
import { uid } from '../lib/format';
import { toast } from '../state/toastStore';

function inInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

export function useShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (inInput(e)) return;
      const st = useEditorStore.getState();
      const seq = st.sequence;
      if (!seq) return;
      const fps = seq.fps || 30;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }

      if (mod && e.key.toLowerCase() === 'c') {
        copySelection(false);
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        copySelection(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        pasteClipboard();
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          st.setPlaying(!st.playing);
          break;
        case 's':
        case 'S': {
          const target =
            st.selection
              .map((id) => findClip(seq, id))
              .find((f) => f && st.playhead > f.clip.start && st.playhead < f.clip.start + f.clip.duration) ??
            clipAt(seq, st.playhead);
          if (target) {
            st.apply({ type: 'SPLIT_CLIP', clipId: target.clip.id, time: st.playhead, newClipId: uid('clip') }, 'Split clip');
          }
          break;
        }
        case 'Delete':
        case 'Backspace':
          if (st.selection.length > 0) {
            st.apply(
              st.selection.map((clipId) => ({ type: 'DELETE_CLIP' as const, clipId })),
              'Delete clips',
            );
            st.select([]);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          st.setPlayhead(st.playhead - (e.shiftKey ? 1 : 1 / fps));
          break;
        case 'ArrowRight':
          e.preventDefault();
          st.setPlayhead(st.playhead + (e.shiftKey ? 1 : 1 / fps));
          break;
        case 'j':
        case 'J':
          st.setPlayhead(st.playhead - 1);
          break;
        case 'k':
        case 'K':
          st.setPlaying(false);
          break;
        case 'l':
        case 'L':
          if (st.playing) st.setPlayhead(st.playhead + 1);
          else st.setPlaying(true);
          break;
        case 'Home':
          st.setPlayhead(0);
          break;
        case 'End':
          st.setPlayhead(sequenceDuration(seq));
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function copySelection(cut: boolean) {
  const st = useEditorStore.getState();
  const seq = st.sequence;
  if (!seq || st.selection.length === 0) return;
  const clips: Clip[] = [];
  for (const id of st.selection) {
    const f = findClip(seq, id);
    if (f) clips.push(f.clip);
  }
  if (clips.length === 0) return;
  st.setClipboard({ clips: clips.map((c) => ({ ...c })) });
  if (cut) {
    st.apply(
      clips.map((c) => ({ type: 'DELETE_CLIP' as const, clipId: c.id })),
      'Cut clips',
    );
    st.select([]);
  }
  toast.info(`${clips.length} clip${clips.length > 1 ? 's' : ''} ${cut ? 'cut' : 'copied'}`);
}

function pasteClipboard() {
  const st = useEditorStore.getState();
  const seq = st.sequence;
  if (!seq || !st.clipboard || st.clipboard.clips.length === 0) return;
  const minStart = Math.min(...st.clipboard.clips.map((c) => c.start));
  const cmds = [];
  const newIds: string[] = [];
  for (const c of st.clipboard.clips) {
    // find original track by looking up clip kind; original track may be gone → first matching kind
    const origTrack = seq.tracks.find((t) => t.clips.some((x) => x.id === c.id));
    const trackKind = c.kind === 'audio' ? 'audio' : c.kind === 'text' ? 'text' : c.kind === 'caption' ? 'caption' : 'video';
    const track = origTrack ?? seq.tracks.find((t) => t.kind === trackKind && !t.locked);
    if (!track) continue;
    const id = uid('clip');
    newIds.push(id);
    cmds.push({
      type: 'ADD_CLIP' as const,
      trackId: track.id,
      clip: { ...c, id, start: st.playhead + (c.start - minStart) },
    });
  }
  if (cmds.length) {
    st.apply(cmds, 'Paste clips');
    st.select(newIds);
  }
}
