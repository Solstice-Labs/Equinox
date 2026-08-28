import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ModelClient, resolveEndpoint } from "./model-client.js";
import { Profiler, type GradedResult } from "./profiler.js";
import { Adapter } from "./adapter.js";
import { SessionLog } from "./session-log.js";
import { ProfileStore } from "./profile-store.js";
import type { Category, ModelProfile, TaskResult } from "./types.js";

const USE = `Equinox — self-improving harness for local LLMs

USAGE:
  equinox profile [--categories=a,b] [--out=".equinox"] [--name=MODELNAME]
  equinox adapt   [--out=".equinox"]
  equinox run     "PROMPT" [--category=coding] [--out=".equinox"]

ENV:
  EQUINOX_BASE_URL   OpenAI-compatible base URL (default http://127.0.0.1:8080/v1)
  EQUINOX_MODEL      model id
  EQUINOX_API_KEY    API key (omit for local llama-server with no auth)
  EQUINOX_HEADERS    optional JSON of extra headers`;
interface Flags {
  categories: Category[] | undefined;
  out: string;
  name: string | undefined;
  category: Category;
  prompt: string;
}

function parseArgs(argv: string[]): { cmd: string; flags: Flags } {
  const cmd = argv[0] ?? "";
  const flags: Flags = { categories: undefined, out: ".equinox", name: undefined, category: "coding", prompt: "" };
  for (const a of argv.slice(1)) {
    if (a.startsWith("--categories=")) flags.categories = a.slice("--categories=".length).split(",") as Category[];
    else if (a.startsWith("--out=")) flags.out = a.slice("--out=".length);
    else if (a.startsWith("--name=")) flags.name = a.slice("--name=".length);
    else if (a.startsWith("--category=")) flags.category = a.slice("--category=".length) as Category;
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else flags.prompt += (flags.prompt ? " " : "") + a;
  }
  return { cmd, flags };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || ["help", "--help", "-h"].includes(argv[0])) {
    console.log(USE);
    return;
  }
  const { cmd, flags } = parseArgs(argv);
  mkdirSync(flags.out, { recursive: true });

  const ep = resolveEndpoint();
  const engine = "equinox://" + new URL(ep.baseUrl).hostname;
  const store = new ProfileStore(flags.out, engine, ep.baseUrl);
  const adapter = new Adapter();

  switch (cmd) {
    case "profile":
      await cmdProfile(flags, ep, engine, store, adapter);
      break;
    case "adapt":
      cmdAdapt(flags, adapter, store);
      break;
    case "run":
      await cmdRun(flags, ep, adapter, store);
      break;
    default:
      console.log(USE);
      process.exitCode = 2;
  }
}

async function cmdProfile(
  flags: Flags,
  ep: ReturnType<typeof resolveEndpoint>,
  engine: string,
  store: ProfileStore,
  adapter: Adapter
) {
  const modelName = flags.name ?? ep.model;
  const log = new SessionLog(join(flags.out, "logs"), `profile-${modelName}`);
  const client = new ModelClient(ep);
  const profiler = new Profiler(console);

  console.log(`Profiling '${modelName}' via ${ep.baseUrl}`);
  console.log(`Categories: ${flags.categories?.join(",") ?? "all"}`);
  console.log(`Session log: ${log.filePath}\n`);

  try {
    const { profile, results } = await profiler.profile({
      modelName,
      baseUrl: ep.baseUrl,
      inferenceEngine: engine,
      run: {
        complete: (probe, opts) =>
          client.complete(
            { id: probe.category + "-probe", category: probe.category, prompt: probe.prompt },
            { temperature: opts.temperature, maxTokens: opts.maxTokens ?? probe.maxTokens }
          ),
      },
      log,
      categories: flags.categories,
    });
    store.save(profile);
    printResults(results);
    console.log(`\nProfile written: ${store.filePath}`);
    const adapted = adapter.adapt(profile);
    console.log(`\nAdapter recommends: temp=${adapted.temperature}, toolStyle=${adapted.toolCallStyle}, taskSplitting=${adapted.taskSplitting}`);
    for (const e of adapted.evidence) console.log(`  • ${e}`);
  } catch (e) {
    console.error(`\nProfiling failed: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

function cmdAdapt(flags: Flags, adapter: Adapter, store: ProfileStore) {
  const profile = store.load<ModelProfile>();
  if (!profile) {
    console.error(`No profile at ${store.filePath}. Run 'equinox profile' first.`);
    process.exitCode = 1;
    return;
  }
  const adapted = adapter.adapt(profile);
  console.log(`\nAdapted config for '${profile.model_info.name}':\n`);
  console.log(`  temperature   ${adapted.temperature}`);
  console.log(`  toolCallStyle ${adapted.toolCallStyle}`);
  console.log(`  taskSplitting ${adapted.taskSplitting}`);
  console.log(`  maxTokens     ${adapted.maxTokens}`);
  console.log(`\n  systemPrompt:\n\n${indent(adapted.systemPrompt, 4)}\n`);
  console.log("  evidence:");
  for (const e of adapted.evidence) console.log(`   - ${e}`);
}

async function cmdRun(
  flags: Flags,
  ep: ReturnType<typeof resolveEndpoint>,
  adapter: Adapter,
  store: ProfileStore
) {
  if (!flags.prompt) {
    console.error("run requires a prompt.");
    process.exitCode = 1;
    return;
  }
  const profile = store.load<ModelProfile>();
  const adapted = profile
    ? adapter.adapt(profile)
    : { systemPrompt: "You are an autonomous software agent.", temperature: 0.4, maxTokens: 512, toolCallStyle: "json" as const, taskSplitting: false, evidence: ["no profile present; using defaults"] };

  const client = new ModelClient(ep);
  const log = new SessionLog(join(flags.out, "logs"), "runs");
  const task = { id: `task-${Date.now()}`, category: flags.category, prompt: flags.prompt };

  console.log(`Running task [${flags.category}] '${flags.prompt.slice(0, 60)}${flags.prompt.length > 60 ? "..." : ""}'`);
  if (adapted.evidence.length) {
    console.log("Adaptation:");
    for (const e of adapted.evidence) console.log(`  • ${e}`);
  }

  const result = await client.complete(task, {
    system: adapted.systemPrompt,
    temperature: adapted.temperature,
    maxTokens: adapted.maxTokens,
  });

  const taskResult: TaskResult = {
    taskId: task.id,
    category: task.category,
    prompt: flags.prompt,
    output: result.text,
    pass: false,
    evidence: "no automated grader for arbitrary 'run' prompts",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    ts: new Date().toISOString(),
  };
  log.append({ ts: taskResult.ts, kind: "task_complete", task: taskResult });

  console.log(`\n[${taskResult.tokensOut} tokens out, ${taskResult.latencyMs}ms]\n`);
  console.log(result.text);
  console.log(`\nLogged to ${log.filePath}`);
}

function printResults(results: GradedResult[]) {
  const w = Math.max(...results.map((r) => r.category.length));
  for (const r of results) {
    const color = r.pass ? "\x1b[32m" : "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(`  ${r.category.padEnd(w)}  ${color}${r.pass ? "PASS" : "FAIL"}${reset}  ${String(r.tokensOut).padStart(5)} tok  ${r.latencyMs}ms  ${r.taskId}`);
  }
}

function indent(s: string, n: number): string {
  return s.split("\n").map((l) => " ".repeat(n) + l).join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});