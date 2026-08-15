import { NextResponse } from 'next/server';
import { activeProviderName, availableProviders, providerCatalog } from '@/lib/ai';
import { activeTranscriptionProvider, availableTranscriptionProviders } from '@/lib/ai/transcribe';
import { getSession, withSessionCookie } from '@/lib/auth/session';
import { databaseInfo } from '@/lib/database';
import { env } from '@/lib/env';
import { handle, ok } from '@/lib/http';
import { configuredProviders } from '@/lib/media';
import { storageInfo } from '@/lib/storage';
import type { AiCapabilities } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Capability discovery. The UI reads this once on boot so every feature can
 * show its real state ("Pexels connected", "add an AI key to generate scripts")
 * instead of failing silently at click time.
 */
export async function GET(): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const stock = configuredProviders();
    const storage = storageInfo();
    const transcription = activeTranscriptionProvider();

    const capabilities: AiCapabilities = {
      ai: {
        available: availableProviders().length > 0,
        providers: availableProviders(),
        active: activeProviderName(),
        catalog: providerCatalog(),
      },
      stock: {
        pexels: stock.includes('pexels'),
        pixabay: stock.includes('pixabay'),
        unsplash: stock.includes('unsplash'),
      },
      storage: {
        available: true,
        driver: storage.driver,
        directUpload: storage.directUpload,
      },
      database: databaseInfo(),
      transcription: {
        available: Boolean(transcription),
        provider: transcription?.name ?? null,
        providers: availableTranscriptionProviders(),
      },
      rendering: {
        browser: true,
        cloud: Boolean(env.RENDER_WORKER_URL),
        worker: env.RENDER_WORKER_URL ? 'remote' : null,
      },
    };

    return withSessionCookie(ok({ capabilities, ownerId: session.ownerId }), session);
  });
}
