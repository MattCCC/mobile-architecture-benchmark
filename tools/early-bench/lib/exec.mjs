// Async process helpers (never blocking the event loop, so the watchdog and the sleep detector keep running),
// plus the redactor that keeps identifiers (home paths, serials, UDIDs) out of every file a session writes.
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function nowNs() {
  return process.hrtime.bigint();
}

export function isoNow() {
  return new Date().toISOString();
}

// Resolves (never rejects) with { code, stdout, stderr, durationMs, timedOut, spawnError }.
export function run(cmd, args, { timeoutMs = 60000, env, input, maxBuffer = 128 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer, env, encoding: 'utf8', killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
        let code = 0;
        let spawnError = null;
        if (error) {
          if (typeof error.code === 'number') {
            code = error.code;
          } else if (error.killed) {
            code = 124;
          } else {
            code = 127;
            spawnError = String(error.code ?? error.message);
          }
        }
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '', durationMs, timedOut: Boolean(error?.killed), spawnError });
      });
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin?.end();
    }
  });
}

// JSON.stringify escapes "/" only in some producers (the unified log's ndjson does: "\/Users\/..."), so every
// registered string is also replaced in its slash-escaped form.
export function slashEscaped(s) {
  return String(s).replace(/\//g, '\\/');
}

// Replaces registered strings (longest first) in their plain and slash-escaped forms. Idempotent as long as no
// replacement text contains a registered string.
export function makeRedactor() {
  const pairs = [];
  const sorted = () => [...pairs].sort((a, b) => b[0].length - a[0].length);
  return {
    add(from, to) {
      if (!from || String(from).length < 3) {
        return;
      }
      const f = String(from);
      if (!pairs.some(([x]) => x === f)) {
        pairs.push([f, to]);
        const esc = slashEscaped(f);
        if (esc !== f) {
          pairs.push([esc, slashEscaped(to)]);
        }
      }
    },
    scrub(s) {
      return sorted().reduce((acc, [from, to]) => acc.split(from).join(to), String(s ?? ''));
    },
    size: () => pairs.length,
  };
}

// JSONL harness log. Every line goes through the redactor before it is written.
export function makeLogger(path, redactor = makeRedactor()) {
  const write = (level, event, details = {}) => {
    const line = JSON.stringify({ ts: isoNow(), level, event, details });
    appendFileSync(path, `${redactor.scrub(line)}\n`);
  };
  return {
    redact: (from, to) => redactor.add(from, to),
    scrub: (s) => redactor.scrub(s),
    redactor,
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
  };
}
