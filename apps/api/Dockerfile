# AI Video Editor — API + render worker.
# Runs anywhere containers run (Render, Railway, Fly.io, a VPS) — NOT on
# serverless platforms: FFmpeg rendering and large uploads need a real server.
FROM node:22-slim

# FFmpeg (render engine) + Python (optional local transcription)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# faster-whisper for free local transcription (CTranslate2 CPU build, no torch)
RUN pip3 install --no-cache-dir --break-system-packages faster-whisper

WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/editor-core/package.json packages/editor-core/package.json
RUN npm install --workspace=@ave/api --workspace=@ave/editor-core --include-workspace-root

COPY packages/editor-core packages/editor-core
COPY apps/api apps/api

WORKDIR /repo/apps/api
RUN npx prisma generate

ENV PORT=4001 \
    DATA_DIR=/data/media-store \
    DATABASE_URL=file:/data/dev.db \
    WHISPER_MODEL=small

EXPOSE 4001
VOLUME ["/data"]

# Push schema on boot (SQLite lives on the mounted volume), then serve.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx src/server.ts"]
