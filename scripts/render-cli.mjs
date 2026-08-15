#!/usr/bin/env node
/**
 * Render a saved project document to a video file locally.
 *
 *   npm run render -- ./project.json ./out/video.mp4 --height 1080 --fps 30
 *
 * Export a project document from the editor's API:
 *   curl -b cookies.txt http://localhost:3000/api/projects/<id> | jq .project > project.json
 */
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderProject } from './render-lib.mjs';

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined ? fallback : value;
}

async function main() {
  const [, , inputPath, outputPathArg] = process.argv;
  if (!inputPath) {
    console.error('Usage: npm run render -- <project.json> [output.mp4] [--height 1080] [--fps 30] [--format mp4]');
    process.exit(1);
  }
  const outputPath = outputPathArg && !outputPathArg.startsWith('--') ? outputPathArg : 'out/video.mp4';
  const project = JSON.parse(await readFile(inputPath, 'utf8'));
  const doc = project.project ?? project;

  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });

  const height = Number(flag('height', doc.height ?? 1920));
  const width = Math.round(((height * (doc.width / doc.height)) / 2)) * 2;

  console.log(`[render] ${doc.name} → ${outputPath} (${width}×${height})`);
  let last = -1;
  const result = await renderProject({
    project: doc,
    outputPath,
    width,
    height,
    fps: Number(flag('fps', doc.fps ?? 30)),
    format: flag('format', 'mp4'),
    onProgress: (progress) => {
      const percent = Math.round(progress * 100);
      if (percent !== last && percent % 5 === 0) {
        last = percent;
        console.log(`[render] ${percent}%`);
      }
    },
  });

  console.log(`[render] done: ${result.outputPath} (${result.durationSeconds.toFixed(1)}s)`);
}

main().catch((error) => {
  console.error('[render] failed:', error);
  process.exit(1);
});
