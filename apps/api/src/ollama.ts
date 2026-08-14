/** Optional Ollama integration. All calls are best-effort with a 20s timeout. */

const OLLAMA_URL = process.env.OLLAMA_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

export function ollamaEnabled(): boolean {
  return !!OLLAMA_URL;
}

/** Generate text via Ollama. Returns null on any error or timeout. */
export async function ollamaGenerate(prompt: string, system?: string): Promise<string | null> {
  if (!OLLAMA_URL) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(`${OLLAMA_URL.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, system, stream: false, format: 'json' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    return data.response ?? null;
  } catch {
    return null;
  }
}

/** Parse a JSON object out of an LLM response, tolerating fences. Returns null on failure. */
export function parseJsonLoose(text: string | null): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
