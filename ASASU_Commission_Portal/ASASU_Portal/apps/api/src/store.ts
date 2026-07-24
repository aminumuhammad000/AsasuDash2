import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSeedData } from "./seedData.js";
import type { DatabaseShape } from "./domain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, "../data/store.json");

export class JsonStore {
  private data: DatabaseShape | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  async read(): Promise<DatabaseShape> {
    if (this.data) {
      return this.data;
    }

    try {
      const raw = await fs.readFile(dataPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<DatabaseShape>;
      const hasCurrentSchema = Boolean(
        parsed.schedules?.every((schedule) => schedule.scheduleNumber && schedule.status && typeof schedule.totalRsaAmount === "number") &&
          parsed.claims?.every((claim) => claim.reference && claim.scheduleId && typeof claim.totalRsaAmount === "number") &&
          parsed.disputes &&
          parsed.auditLog
      );
      this.data = hasCurrentSchema ? (parsed as DatabaseShape) : createSeedData();
      if (!hasCurrentSchema) await this.write(this.data);
    } catch {
      this.data = createSeedData();
      await this.write(this.data);
    }

    return this.data;
  }

  async write(nextData?: DatabaseShape) {
    this.data = nextData ?? this.data ?? createSeedData();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(this.data, null, 2));
    return this.data;
  }

  async mutate(mutator: (data: DatabaseShape) => void | Promise<void>) {
    let result!: DatabaseShape;
    const next = this.mutationQueue.then(async () => {
      const data = await this.read();
      await mutator(data);
      await this.write(data);
      result = data;
    });
    this.mutationQueue = next.catch(() => undefined);
    await next;
    return result;
  }
}
