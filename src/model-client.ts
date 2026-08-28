import type { Task } from "./types.js";

export interface EndpointConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
}

export interface CompletionOpts {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface Completion {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

/**
 * Minimal OpenAI-compatible chat completions client on native fetch.
 *
 * Works against ANY OpenAI-compatible endpoint: llama.cpp llama-server,
 * Ollama, vLLM, build.nvidia.com, the Lightning box, or a future Anvil
 * engine. Keeps the harness box-agnostic.
 */
export class ModelClient {
  constructor(private readonly cfg: EndpointConfig) {}

  private get url(): string {
    return `${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  async complete(task: Task, opts: CompletionOpts = {}): Promise<Completion> {
    const t0 = Date.now();
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: task.prompt });

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: opts.temperature ?? 0.4,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
          ...this.cfg.headers,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(`Request to ${this.url} failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(
        `Model endpoint returned ${res.status} ${res.statusText}: ${bodyText.slice(0, 400)}`
      );
    }

    const data = (await res.json()) as any;
    const text: string =
      data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
    const usage = data?.usage ?? {};
    const latencyMs = Date.now() - t0;

    return {
      text,
      tokensIn: usage.prompt_tokens ?? 0,
      tokensOut: usage.completion_tokens ?? estimateTokens(text),
      latencyMs,
    };
  }
}

/** Rough fallback token estimate when the endpoint omits usage. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function resolveEndpoint(): EndpointConfig {
  const baseUrl = process.env.EQUINOX_BASE_URL ?? "http://127.0.0.1:8080/v1";
  const model = process.env.EQUINOX_MODEL ?? "local-model";
  const apiKey = process.env.EQUINOX_API_KEY;
  const extraHeaders = process.env.EQUINOX_HEADERS
    ? (JSON.parse(process.env.EQUINOX_HEADERS) as Record<string, string>)
    : undefined;
  return { baseUrl, apiKey, model, headers: extraHeaders };
}