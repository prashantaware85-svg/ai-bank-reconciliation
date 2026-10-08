import { ConfigService } from '@nestjs/config';
import {
  AiProviderError,
  isRetryableProviderError,
  type AiExceptionAnalyzer,
  type AiExceptionAnalysis,
  type AiTransactionInput,
} from './ai-provider.js';
import {
  AI_EXCEPTION_PROMPT_V2,
  buildUserPrompt,
  parseAiResponse,
} from './ai-prompt.js';

const DEFAULT_TIMEOUT_MS = 30000;

/** Bounded retries: 3 attempts max with exponential backoff. */
export const MAX_PROVIDER_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generic OpenAI-compatible chat-completions HTTP provider. Configurable
 * via AI_PROVIDER / AI_API_KEY / AI_MODEL / AI_BASE_URL. The API key is
 * read from environment only — never logged, never stored in the DB.
 */
export class HttpAiExceptionAnalyzer implements AiExceptionAnalyzer {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion = 'AI_EXCEPTION_PROMPT_V2';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryBaseMs: number;

  constructor(configService: ConfigService) {
    this.provider = configService.get<string>('AI_PROVIDER') ?? 'openai-compatible';
    this.model = configService.get<string>('AI_MODEL') ?? 'gpt-4o-mini';
    this.apiKey = configService.get<string>('AI_API_KEY') ?? '';
    this.baseUrl = (
      configService.get<string>('AI_BASE_URL') ?? 'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    this.timeoutMs = Number(
      configService.get<string>('AI_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS,
    );
    this.retryBaseMs = Number(
      configService.get<string>('AI_RETRY_BASE_MS') ?? DEFAULT_RETRY_BASE_MS,
    );
  }

  private assertConfigured(): void {
    if (!this.apiKey) {
      throw new AiProviderError(
        'AI provider is not configured (set AI_API_KEY)',
        'unavailable',
      );
    }
  }

  async analyzeTransaction(
    input: AiTransactionInput,
  ): Promise<AiExceptionAnalysis> {
    this.assertConfigured();
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      try {
        return await this.attemptOnce(input);
      } catch (error) {
        lastError = error;
        const retryable = isRetryableProviderError(error);
        const moreTries = attempt + 1 < MAX_PROVIDER_ATTEMPTS;
        if (!retryable || !moreTries) throw error;
        await sleep(this.retryBaseMs * 2 ** attempt);
      }
    }
    throw lastError;
  }

  private async attemptOnce(
    input: AiTransactionInput,
  ): Promise<AiExceptionAnalysis> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: AI_EXCEPTION_PROMPT_V2 },
            { role: 'user', content: buildUserPrompt(input) },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new AiProviderError('AI provider timed out', 'timeout');
      }
      throw new AiProviderError(
        'AI provider is temporarily unavailable',
        'unavailable',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiProviderError('AI provider rejected the API key', 'auth');
    }
    if (res.status === 429) {
      throw new AiProviderError(
        'AI provider rate limit exceeded; backing off',
        'rate_limited',
      );
    }
    if (res.status >= 500) {
      throw new AiProviderError(
        `AI provider returned HTTP ${res.status}`,
        'unavailable',
      );
    }
    if (!res.ok) {
      throw new AiProviderError(
        `AI provider returned HTTP ${res.status}`,
        'malformed',
      );
    }
    const data = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiProviderError('AI response had no content', 'malformed');
    }
    return parseAiResponse(content);
  }

  async analyzeBatch(
    inputs: AiTransactionInput[],
  ): Promise<AiExceptionAnalysis[]> {
    // Bounded sequential analysis: one call per input, no uncontrolled fan-out.
    const out: AiExceptionAnalysis[] = [];
    for (const input of inputs) {
      out.push(await this.analyzeTransaction(input));
    }
    return out;
  }
}
