import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class ProfileStore {
  private readonly file: string;
  readonly engine: string;
  readonly baseUrl: string;

  constructor(dir: string, engine: string, baseUrl: string) {
    this.file = join(dir, "model-profile.json");
    this.engine = engine;
    this.baseUrl = baseUrl;
    mkdirSync(dir, { recursive: true });
  }

  save<T>(profile: T): void {
    writeFileSync(this.file, JSON.stringify(profile, null, 2) + "\n");
  }

  load<T>(): T | null {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  get filePath(): string {
    return this.file;
  }
}