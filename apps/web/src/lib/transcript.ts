import { api, pollJob, type Job, type Transcript } from './api';
import { useEditorStore, primaryAssetId } from '../state/editorStore';

/**
 * Ensure a transcript exists for the sequence's primary asset.
 * Fetches cached transcript, or runs a transcribe job (reporting progress).
 */
export async function ensureTranscript(onJob?: (job: Job) => void): Promise<{ transcript: Transcript; assetId: string } | null> {
  const state = useEditorStore.getState();
  const assetId = primaryAssetId(state);
  if (!assetId) throw new Error('No video asset in this project yet. Upload one first.');

  if (state.transcript && state.transcriptAssetId === assetId) {
    return { transcript: state.transcript, assetId };
  }

  let transcript = await api.getTranscript(assetId);
  if (!transcript || transcript.segments.length === 0) {
    const { jobId } = await api.transcribe(assetId);
    const job = await pollJob(jobId, onJob, 1200);
    if (job.status === 'error') throw new Error(job.error ?? 'Transcription failed');
    transcript = await api.getTranscript(assetId);
  }
  if (!transcript) throw new Error('Transcript unavailable after transcription');
  useEditorStore.getState().setTranscript(transcript, assetId);
  return { transcript, assetId };
}
