/**
 * Shared Remotion rendering helper used by the CLI and the HTTP worker.
 *
 * This code never runs on Vercel: Remotion needs a long-lived process and a
 * headless browser, which is exactly what a serverless function cannot provide.
 * Run it on any container host (Render, Fly, Railway, ECS, a VM) or adapt
 * `renderProject` to @remotion/lambda.
 */
import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(here, '..', 'remotion', 'index.ts');

let bundlePromise = null;

/** Bundles the Remotion entry once per process. */
export async function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: ENTRY,
      onProgress: (percent) => {
        if (percent % 25 === 0) console.log(`[render] bundling ${percent}%`);
      },
    });
  }
  return bundlePromise;
}

export function sequenceDuration(sequence) {
  let end = 0;
  for (const track of sequence.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }
  return end;
}

/**
 * Renders a project document to a file.
 *
 * @param {object} options
 * @param {object} options.project  The project document saved by the editor.
 * @param {string} options.outputPath Where to write the video.
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {number} [options.fps]
 * @param {'mp4'|'webm'} [options.format]
 * @param {(progress: number) => void} [options.onProgress]
 */
export async function renderProject(options) {
  const { project, outputPath } = options;
  const fps = options.fps ?? project.fps ?? 30;
  const width = options.width ?? project.width;
  const height = options.height ?? project.height;
  const format = options.format ?? 'mp4';

  const duration = sequenceDuration(project.sequence);
  if (duration <= 0) throw new Error('The project timeline is empty.');

  const serveUrl = await getBundle();
  const compositions = await getCompositions(serveUrl, { inputProps: { project } });
  const base = compositions.find((composition) => composition.id === 'Project');
  if (!base) throw new Error('Composition "Project" not found in the Remotion bundle.');

  await renderMedia({
    serveUrl,
    composition: {
      ...base,
      width,
      height,
      fps,
      durationInFrames: Math.max(1, Math.ceil(duration * fps)),
    },
    codec: format === 'webm' ? 'vp8' : 'h264',
    outputLocation: outputPath,
    inputProps: { project },
    onProgress: ({ progress }) => options.onProgress?.(progress),
  });

  return { outputPath, durationSeconds: duration, width, height, fps, format };
}
