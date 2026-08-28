import {
  CATEGORIES,
  type Category,
  type CategoryScore,
  type FailurePattern,
  type ModelProfile,
  type Probe,
  type TaskResult,
} from "./types.js";
import { PROBE_SUITE } from "./probes.js";

export interface SessionLogWriter {
  append(event: object): Promise<void> | void;
}

export interface ProfilerRunner {
  complete(
    probe: { prompt: string; maxTokens?: number; category: Category },
    opts: { temperature: number; maxTokens?: number; system?: string }
  ): Promise<{ text: string; tokensIn: number; tokensOut: number; latencyMs: number }>;
}

export type Logger = Pick<Console, "error" | "info" | "warn">;

export interface GradedResult extends TaskResult {
  category: Category;
}

class Agg {
  private scores = new Map<
    Category,
    { sum: number; probes: number; pass: number; outTokens: number }
  >();

  constructor() {
    for (const c of CATEGORIES)
      this.scores.set(c, { sum: 0, probes: 0, pass: 0, outTokens: 0 });
  }

  add(r: GradedResult) {
    const a = this.scores.get(r.category)!;
    a.sum += r.pass ? 10 : 0;
    a.probes += 1;
    a.pass += r.pass ? 1 : 0;
    a.outTokens += r.tokensOut;
  }

  export(): Record<Category, CategoryScore> {
    const out = {} as Record<Category, CategoryScore>;
    for (const c of CATEGORIES) {
      const a = this.scores.get(c)!;
      out[c] =
        a.probes === 0
          ? { category: c, score: 0, probes: 0, passRate: 0, avgOutputTokens: 0 }
          : {
              category: c,
              score: Number((a.sum / a.probes).toFixed(2)),
              probes: a.probes,
              passRate: Number((a.pass / a.probes).toFixed(3)),
              avgOutputTokens: Math.round(a.outTokens / a.probes),
            };
    }
    return out;
  }
}

/**
 * Runs PROBE_SUITE against a model, grades each probe with a deterministic
 * keyword heuristic, and aggregates a ModelProfile. Requires only the model
 * endpoint — no judge model, no labels.
 */
export class Profiler {
  constructor(private readonly log?: Logger) {}

  async profile(opts: {
    modelName: string;
    baseUrl: string;
    inferenceEngine: string;
    run: ProfilerRunner;
    log: SessionLogWriter;
    categories?: Category[];
  }): Promise<{ profile: ModelProfile; results: GradedResult[] }> {
    const categories = new Set(opts.categories ?? CATEGORIES);
    const profiledProbes = PROBE_SUITE.filter((p) => categories.has(p.category));

    opts.log.append({
      ts: new Date().toISOString(),
      kind: "profile_start",
      model: opts.modelName,
    });

    const results: GradedResult[] = [];
    const failures: FailurePattern[] = [];

    for (const probe of profiledProbes) {
      const raw = await opts.run.complete(
        { prompt: probe.prompt, maxTokens: probe.maxTokens, category: probe.category },
        { temperature: 0.4, maxTokens: probe.maxTokens }
      );
      const graded = grade(probe, raw.text);
      const result: GradedResult = {
        taskId: probe.id,
        category: probe.category,
        prompt: probe.prompt,
        output: raw.text,
        pass: graded.pass,
        evidence: graded.evidence,
        tokensIn: raw.tokensIn,
        tokensOut: raw.tokensOut,
        latencyMs: raw.latencyMs,
        ts: new Date().toISOString(),
      };
      results.push(result);
      opts.log.append({ ts: result.ts, kind: "task_complete", task: result });
      this.log?.info(
        `  [${result.category}] ${probe.id}: ${result.pass ? "PASS" : "FAIL"} ` +
          `(${result.tokensOut} tok, ${result.latencyMs}ms)`
      );

      if (!result.pass) {
        failures.push({
          category: probe.category,
          frequency: "low",
          summary: `Fails probe '${probe.id}'`,
          exampleTaskId: probe.id,
          mitigation: heuristicMitigation(probe.category),
        });
      }
    }

    opts.log.append({
      ts: new Date().toISOString(),
      kind: "profile_complete",
      model: opts.modelName,
    });

    const agg = new Agg();
    for (const r of results) agg.add(r);
    const capabilityScores = agg.export();

    const passCount = results.filter((r) => r.pass).length;
    const passRate = results.length ? passCount / results.length : 0;
    const avgTokensIn = results.length
      ? Math.round(results.reduce((s, r) => s + r.tokensIn, 0) / results.length)
      : 0;
    const avgTokensOut = results.length
      ? Math.round(results.reduce((s, r) => s + r.tokensOut, 0) / results.length)
      : 0;
    const avgLatencyMs = results.length
      ? Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)
      : 0;

    const toolUse = capabilityScores.tool_use ?? null;
    const toolPreferences =
      !toolUse || toolUse.score >= 7
        ? ["file_editor", "shell", "web_search"]
        : ["shell_only"];

    const profile: ModelProfile = {
      model_info: {
        name: opts.modelName,
        inference_engine: opts.inferenceEngine,
        base_url: opts.baseUrl,
        profiled_ts: new Date().toISOString(),
      },
      behavioral_fingerprint: {
        response_style: avgTokensOut > 1800 ? "verbose" : "concise",
        preferred_formatting: "markdown",
        tool_preferences: toolPreferences,
      },
      capability_scores: capabilityScores,
      failure_patterns: failures,
      run_stats: {
        totalProbes: results.length,
        passRate: Number(passRate.toFixed(3)),
        avgTokensIn,
        avgTokensOut,
        avgLatencyMs,
      },
    };

    return { profile, results };
  }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export function grade(
  probe: Probe,
  output: string
): { pass: boolean; evidence: string } {
  const text = (output ?? "").trim();
  if (!text) return { pass: false, evidence: "empty output" };

  if (probe.expected && text === probe.expected.trim()) {
    return { pass: true, evidence: "exact match on expected" };
  }

  if (probe.passFailInvert) {
    const neg = probe.failKeywords?.find((k) => contains(text, k));
    if (neg) return { pass: false, evidence: `found forbidden token '${neg}'` };
    if (probe.passKeywords?.length) {
      const pos = probe.passKeywords.find((k) => contains(text, k));
      if (!pos) return { pass: false, evidence: "missing required content" };
    }
    return { pass: true, evidence: "no forbidden tokens; required content present" };
  }

  const hit = probe.passKeywords?.find((k) => contains(text, k));
  if (!hit) return { pass: false, evidence: "no pass keyword triggered" };
  const bad = probe.failKeywords?.find((k) => contains(text, k));
  if (bad) return { pass: false, evidence: `contradicted by token '${bad}'` };
  return { pass: true, evidence: `matched keyword '${hit}'` };
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function heuristicMitigation(category: Category): string {
  switch (category) {
    case "coding":
      return "break task into smaller steps; request intermediary outputs";
    case "reasoning":
      return "ask for chain-of-thought explicitly; constrain to one correction";
    case "tool_use":
      return "provide exact tool-call JSON schema; forbid free-form tool talk";
    case "math":
      return "request the final integer/fraction only, no prose";
    case "instruction_following":
      return "use tighter system prompt with explicit stop tokens";
  }
}