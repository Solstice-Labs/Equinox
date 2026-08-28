import type { AdaptedConfig, ModelProfile } from "./types.js";

/**
 * The Adapter reads a ModelProfile and emits the concrete run parameters the
 * harness should use — system prompt, temperature, tool-call formatting, and
 * whether to split tasks. In MVP this is rule-based; every rule is derived
 * from the observed capability scores and failure patterns.
 */
export class Adapter {
  adapt(profile: ModelProfile): AdaptedConfig {
    const evidence: string[] = [];

    const style = profile.behavioral_fingerprint.response_style;
    const coding = score(profile, "coding");
    const reasoning = score(profile, "reasoning");
    const toolUse = score(profile, "tool_use");
    const math = score(profile, "math");

    // ---- temperature ----
    const overall = overallScore(profile);
    const temperature = overall >= 8 ? 0.5 : overall >= 5 ? 0.35 : 0.2;
    evidence.push(`avg capability ${overall.toFixed(1)}/10 -> temperature ${temperature}`);

    // ---- tool-call style ----
    let toolCallStyle: AdaptedConfig["toolCallStyle"] = "json";
    if (toolUse < 5) {
      toolCallStyle = "xml";
      evidence.push(`tool_use ${toolUse}/10 -> strict 'xml' tool-call blocks`);
    }

    // ---- task splitting ----
    const taskSplitting = reasoning < 7;
    evidence.push(
      taskSplitting
        ? `reasoning ${reasoning}/10 -> enable task splitting`
        : `reasoning ${reasoning}/10 -> keep monolithic tasks`
    );

    // ---- system prompt ----
    const needed = failureSummaries(profile);
    const sys: string[] = [
      "You are an autonomous software agent. Follow instructions exactly, prefer concrete tool calls over prose, and stop once the requested goal is met." +
        ` Your profiled style: ${style}.`,
    ];
    if (style === "concise") sys.push("Be concise. Omit filler and pleasantries.");
    else sys.push("You may be thorough, but do not pad output.");
    if (toolCallStyle === "xml") {
      sys.push(
        "When acting, emit EXACTLY ONE <tool>...</tool> block per action with fields <name> and <input>, then STOP until you receive the result."
      );
    }
    if (taskSplitting) {
      sys.push("Break large tasks into small explicit steps and verify each before proceeding.");
    }
    if (needed.length) {
      sys.push(`Known failure patterns to avoid: ${needed.join("; ")}.`);
    }

    return {
      systemPrompt: sys.join("\n"),
      temperature,
      maxTokens: 512,
      toolCallStyle,
      taskSplitting,
      evidence,
    };
  }
}

function score(p: ModelProfile, c: keyof ModelProfile["capability_scores"]): number {
  return p.capability_scores[c]?.score ?? 0;
}

function overallScore(p: ModelProfile): number {
  const scores = Object.values(p.capability_scores).map((s) => s.score);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

function failureSummaries(p: ModelProfile): string[] {
  return p.failure_patterns.slice(0, 4).map((f) => f.summary);
}