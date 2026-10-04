import type {
  GitInspector,
  GitStatus,
  ProcessExit,
  ProcessRunner,
  ProcessSpec,
  PromptFileStore,
  Timer,
} from "./types";

/**
 * In-memory fakes for tests and dry runs. Nothing here starts a process,
 * touches git, writes files, or schedules real timers.
 */

export interface FakeProcessBehavior {
  /** Resolve immediately with this exit; omit to hang until kill(). */
  exit?: Partial<ProcessExit>;
}

export interface FakeRunner extends ProcessRunner {
  specs: ProcessSpec[];
  kills: number;
}

export function createFakeRunner(behavior: (spec: ProcessSpec) => FakeProcessBehavior): FakeRunner {
  const runner: FakeRunner = {
    specs: [],
    kills: 0,
    spawn(spec) {
      runner.specs.push(structuredClone({ ...spec, args: [...spec.args] }));
      const b = behavior(spec);
      let resolve!: (e: ProcessExit) => void;
      const exit = new Promise<ProcessExit>((r) => (resolve = r));
      const done = (e: Partial<ProcessExit>) =>
        resolve({ exitCode: 0, signal: null, stdout: "", stderr: "", truncated: false, ...e });
      if (b.exit) done(b.exit);
      return {
        exit,
        kill() {
          runner.kills++;
          done({ exitCode: null, signal: "SIGTERM" });
        },
      };
    },
  };
  return runner;
}

export function createFakeGit(statuses: GitStatus[], changed: string[] = []): GitInspector & { statusCalls: number } {
  const git = {
    statusCalls: 0,
    async status() {
      const s = statuses[Math.min(git.statusCalls, statuses.length - 1)];
      git.statusCalls++;
      return structuredClone(s);
    },
    async changedPathsSince() {
      return [...changed];
    },
  };
  return git;
}

export interface FakePromptFiles extends PromptFileStore {
  live: Map<string, string>;
  written: number;
  removed: number;
}

export function createFakePromptFiles(dir = "/tmp/oxm-worker-fake"): FakePromptFiles {
  const store: FakePromptFiles = {
    live: new Map(),
    written: 0,
    removed: 0,
    async write(content) {
      const path = `${dir}/${++store.written}/prompt.txt`;
      store.live.set(path, content);
      return {
        path,
        async remove() {
          if (store.live.delete(path)) store.removed++;
        },
      };
    },
  };
  return store;
}

export interface FakeTimer extends Timer {
  /** Fires every pending callback (simulates the timeout elapsing). */
  fire(): void;
  pending: number;
  scheduledMs: number[];
}

export function createFakeTimer(): FakeTimer {
  const cbs = new Set<() => void>();
  const t: FakeTimer = {
    scheduledMs: [],
    get pending() {
      return cbs.size;
    },
    schedule(ms, cb) {
      t.scheduledMs.push(ms);
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
    fire() {
      for (const cb of Array.from(cbs)) {
        cbs.delete(cb);
        cb();
      }
    },
  };
  return t;
}
