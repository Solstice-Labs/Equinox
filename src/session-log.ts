import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HarnessEvent } from "./types.js";

/**
 * Append-only JSONL session log — the same durability pattern used across the
 * Solace pipeline. Every event is one JSON line appended to a file, so a crash
 * or VM wipe never loses recorded work and the log is trivially replayable /
 * forkable (the raw material the Distiller will consume later).
 */
export class SessionLog {
  private readonly path: string;

  constructor(outputDir: string, name = "sessions") {
    this.path = join(outputDir, `${name}.jsonl`);
    mkdirSync(dirname(this.path), { recursive: true });
  }

  append(event: HarnessEvent): void {
    appendFileSync(this.path, JSON.stringify(event) + "\n");
  }

  get filePath(): string {
    return this.path;
  }
}