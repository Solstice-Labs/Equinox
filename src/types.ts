// Core domain types for Equinox.
// Framework-agnostic primitives: anything a plugin, adapter, or future
// DSH bridge needs can be derived from these.

export const CATEGORIES = [
  "coding",
  "reasoning",
  "tool_use",
  "math",
  "instruction_following",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Task {
  id: string;
  category: Category;
  prompt: string;
  expected?: string;
  passKeywords?: string[];
  failKeywords?: string[];
  maxTokens?: number;
  /** Invert grading: pass when keywords are ABSENT. */
  passFailInvert?: boolean;
}

export interface TaskResult {
  taskId: string;
  category: Category;
  prompt: string;
  output: string;
  pass: boolean;
  evidence: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  ts: string;
}

export interface Probe extends Task {
  weight: number;
}

export interface CategoryScore {
  category: Category;
  score: number;
  probes: number;
  passRate: number;
  avgOutputTokens: number;
}

export interface FailurePattern {
  category: Category;
  frequency: "low" | "medium" | "high";
  summary: string;
  exampleTaskId: string;
  mitigation: string;
}

export interface ModelProfile {
  model_info: {
    name: string;
    quantization?: string;
    inference_engine: string;
    base_url: string;
    profiled_ts: string;
  };
  behavioral_fingerprint: {
    response_style: "concise" | "verbose";
    preferred_formatting: string;
    tool_preferences: string[];
  };
  capability_scores: Record<Category, CategoryScore>;
  failure_patterns: FailurePattern[];
  run_stats: {
    totalProbes: number;
    passRate: number;
    avgTokensIn: number;
    avgTokensOut: number;
    avgLatencyMs: number;
  };
}

export interface HarnessEvent {
  ts: string;
  kind:
    | "profile_start"
    | "profile_complete"
    | "task_start"
    | "task_complete"
    | "adaptation_applied";
  task?: TaskResult;
  profileName?: string;
  adaptation?: AdaptedConfig;
}

export interface AdaptedConfig {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  toolCallStyle: "json" | "xml" | "markdown-codeblock";
  taskSplitting: boolean;
  evidence: string[];
}