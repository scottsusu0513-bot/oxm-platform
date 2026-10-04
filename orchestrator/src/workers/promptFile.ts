import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PromptFileStore } from "./types";

/**
 * Ephemeral prompt files: one private (0700) directory per prompt under the
 * OS temp dir — never the repository — holding a 0600 file. remove() deletes
 * the whole directory and is idempotent. Contents are never logged.
 */
export function createTempPromptFileStore(baseDir: string = tmpdir()): PromptFileStore {
  return {
    async write(content) {
      const dir = await mkdtemp(join(baseDir, "oxm-worker-"));
      const path = join(dir, "prompt.txt");
      const remove = () => rm(dir, { recursive: true, force: true });
      try {
        await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      } catch (e) {
        await remove();
        throw e;
      }
      return { path, remove };
    },
  };
}
