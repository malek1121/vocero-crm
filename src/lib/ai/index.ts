import type { z } from "zod";
import { getEnv, isAiConfigured } from "@/lib/env";

/** OpenAI-compatible boundary. Prompts and provider bodies never enter errors. */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: "not_configured" | "provider_error" | "invalid_output";
      detail: string;
      attempts: number;
      providerStatus?: number;
    };

export type ChatJsonOptions = {
  model?: string;
  judge?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class AiAbortError extends Error {
  constructor() {
    super("AI operation aborted");
    this.name = "AiAbortError";
  }
}

class ProviderCallError extends Error {
  readonly detail: string;
  readonly status: number | undefined;

  constructor(detail: string, status?: number) {
    super(detail);
    this.name = "ProviderCallError";
    this.detail = detail;
    this.status = status;
  }
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts: ChatJsonOptions = {}
): Promise<ChatJsonResult<T>> {
  throwIfAborted(opts.signal);
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "ai_token_missing",
      attempts: 0,
    };
  }

  const env = getEnv();
  const model =
    opts.model ??
    (opts.judge ? (env.AI_JUDGE_MODEL ?? env.AI_MODEL) : env.AI_MODEL);
  if (!model?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "ai_model_missing",
      attempts: 0,
    };
  }

  let lastDetail = "provider_request_failed";
  let providerStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    throwIfAborted(opts.signal);
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: la respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];

    try {
      const raw = await callProvider(
        model,
        attemptMessages,
        opts.timeoutMs,
        opts.signal
      );
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = "invalid_json";
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = "schema_validation_failed";
        continue;
      }
      return { ok: true, data: parsed.data };
    } catch (error) {
      if (error instanceof AiAbortError) throw error;
      if (error instanceof ProviderCallError) {
        lastDetail = error.detail;
        providerStatus = error.status;
      } else {
        lastDetail = "provider_request_failed";
      }
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt, opts.signal);
      }
    }
  }

  const invalidOutput =
    lastDetail === "invalid_json" ||
    lastDetail === "schema_validation_failed";
  return {
    ok: false,
    error: invalidOutput ? "invalid_output" : "provider_error",
    detail: lastDetail,
    attempts: MAX_ATTEMPTS,
    ...(providerStatus === undefined ? {} : { providerStatus }),
  };
}

async function callProvider(
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal);
  const env = getEnv();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  try {
    let response: Response;
    try {
      response = await fetch(`${env.AI_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AI_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) throw new AiAbortError();
      throw new ProviderCallError(
        timedOut ? "provider_timeout" : "provider_network_error"
      );
    }

    if (!response.ok) {
      throw new ProviderCallError(
        `provider_http_${response.status}`,
        response.status
      );
    }

    let json: { choices?: { message?: { content?: string } }[] };
    try {
      json = (await response.json()) as typeof json;
    } catch {
      throw new ProviderCallError("provider_invalid_response");
    }
    const modelOutput = json.choices?.[0]?.message?.content;
    if (typeof modelOutput !== "string" || modelOutput.length === 0) {
      throw new ProviderCallError("provider_empty_response");
    }
    return modelOutput;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Extracts JSON from a fenced block, full text, or first-to-last braces. */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next extraction strategy.
    }
  }
  return null;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AiAbortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}