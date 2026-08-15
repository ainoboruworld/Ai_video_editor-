import type { AiProviderName } from '@/types';

export interface JsonRequest {
  /** System / role instruction. */
  system: string;
  /** User instruction. */
  prompt: string;
  /** A description of the exact JSON shape expected back. */
  schemaHint: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * AI providers only ever return parsed JSON. Free-form text parsing is not
 * used anywhere in the app: the caller validates the parsed object with zod
 * before it touches the project.
 */
export interface AiProvider {
  readonly name: AiProviderName;
  readonly label: string;
  isConfigured(): boolean;
  generateJson(request: JsonRequest): Promise<unknown>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public provider: AiProviderName,
    public status?: number,
  ) {
    super(message);
  }
}

/** LLMs sometimes wrap JSON in prose or code fences — recover the object. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('Model did not return valid JSON');
  }
}
