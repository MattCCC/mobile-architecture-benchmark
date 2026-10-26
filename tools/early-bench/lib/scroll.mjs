// early.scroll: seeded fling plan, SurfaceFlinger per-layer latency parsing and frame metrics. Pure functions.
import { rngFor } from './order.mjs';
import { quantile7, sortNumeric } from './stats.mjs';
import { decodeFrameTimeline, isJanky } from './frametimeline.mjs';
import { lines as rawLines } from './parse.mjs';

const lines = (text) => rawLines(text).map((t, i) => ({ line: i + 1, text: t }));

// Present-to-present intervals longer than this are idle breaks between flings, not frames (excluded). Validation on
// the emulator showed 200-300 ms pauses between a decelerated fling and the next one, so the bound is 100 ms
// (6 refresh periods at 60 Hz); a hitch longer than that is counted as a break, so jank from this source is a lower
// bound.
export const IDLE_GAP_NS = 100e6;
const PENDING = 9223372036854775807n;

// Fixed seeded fling sequence over the List screen. Coordinates are fractions of the screen size so one plan fits
// every candidate; direction is mostly "content up" (finger up) with every 4th fling reversed, so the 300-row list
// is never exhausted. The plan depends only on (seed, n).
export function swipePlan(seed, n) {
  const rng = rngFor(seed, 'early.scroll.swipes');
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const up = i % 4 !== 3;
    const x = 0.40 + 0.20 * rng();
    const dist = 0.35 + 0.15 * rng();
    const from = up ? 0.78 : 0.30;
    const to = up ? from - dist : from + dist;
    out.push({ i, x: round3(x), y1: round3(from), y2: round3(to), durationMs: 80 + Math.floor(rng() * 101), gapMs: 1200 });
  }
  return out;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

// One device shell script for the whole plan (no host round trip between flings).
export function swipeScript(plan, { width, height }) {
  return plan.map((s) => `input swipe ${Math.round(s.x * width)} ${Math.round(s.y1 * height)} ${Math.round(s.x * width)} ${Math.round(s.y2 * height)} ${s.durationMs}; sleep ${(s.gapMs / 1000).toFixed(3)}`).join('; ');
}

export function planDurationMs(plan) {
  return plan.reduce((a, s) => a + s.durationMs + s.gapMs, 0);
}

// `dumpsys SurfaceFlinger --latency <layer>`: line 1 refresh period (ns), then "desiredPresent actualPresent
// frameReady" per buffer of a ring (64 entries on API 37), not in time order; zero and INT64_MAX rows are unused or
// pending. Returns the presented frames with their 1-based line.
export function parseSfLatency(text) {
  const ls = lines(text);
  const nonEmpty = ls.filter((l) => l.text.trim());
  if (nonEmpty.length === 0 || !/^\d+$/.test(nonEmpty[0].text.trim())) {
    return { refreshNs: null, frames: [] };
  }
  const frames = [];
  for (const l of nonEmpty.slice(1)) {
    const m = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(l.text.trim());
    if (!m) {
      continue;
    }
    const actual = BigInt(m[2]);
    if (actual === 0n || actual === PENDING) {
      continue;
    }
    frames.push({ desired: BigInt(m[1]), actual, ready: BigInt(m[3]), line: l.line, text: l.text });
  }
  return { refreshNs: Number(nonEmpty[0].text.trim()), frames };
}

// Merge polls (each { file, parsed }); frames already present in the baseline poll are excluded. Dedupe by actual
// present time; sorted.
export function mergeSfPolls(baseline, polls) {
  const seen = new Set(baseline ? baseline.frames.map((f) => f.actual) : []);
  const out = new Map();
  for (const p of polls) {
    for (const f of p.parsed.frames) {
      if (!seen.has(f.actual) && !out.has(f.actual)) {
        out.set(f.actual, { ...f, file: p.file });
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.actual < b.actual ? -1 : (a.actual > b.actual ? 1 : 0)));
}

function pct(sorted) {
  return { p50: quantile7(sorted, 0.5), p90: quantile7(sorted, 0.9), p99: quantile7(sorted, 0.99) };
}

// SF latency metrics: frames = presented buffers after the baseline; frame time = present-to-present interval of
// consecutive frames, intervals > IDLE_GAP_NS are idle breaks and excluded; janky = interval > 1.5 x refresh period.
export function sfLatencyMetrics(frames, refreshNs) {
  const intervals = [];
  for (let i = 1; i < frames.length; i += 1) {
    const d = Number(frames[i].actual - frames[i - 1].actual);
    if (d > 0 && d <= IDLE_GAP_NS) {
      intervals.push(d);
    }
  }
  const s = sortNumeric(intervals);
  const janky = refreshNs ? s.filter((d) => d > 1.5 * refreshNs).length : null;
  return {
    frames: frames.length, intervals: s.length, janky,
    jankyPct: s.length > 0 && janky !== null ? (100 * janky) / s.length : null, ...pct(s),
    spanNs: frames.length > 1 ? Number(frames[frames.length - 1].actual - frames[0].actual) : 0,
  };
}

// FrameTimeline metrics for one process: its actual surface frames (all layers of the pid). Frame time = actual
// surface frame duration (app start of frame to present / frame end); janky by SurfaceFlinger's jank type.
export function frameTimelineMetrics(buf, pid) {
  const ft = decodeFrameTimeline(buf);
  const mine = ft.actual.filter((a) => String(a.pid) === String(pid));
  const durs = sortNumeric(mine.filter((a) => a.durNs !== null && a.durNs > 0).map((a) => a.durNs));
  const janky = mine.filter((a) => isJanky(a.jankType)).length;
  const layers = {};
  for (const a of mine) {
    layers[a.layerName ?? '?'] = (layers[a.layerName ?? '?'] ?? 0) + 1;
  }
  return {
    packets: ft.packets, allSurfaceFrames: ft.actual.length, frames: mine.length, janky,
    jankyPct: mine.length > 0 ? (100 * janky) / mine.length : null, ...pct(durs), layers, list: mine,
  };
}

// Text rendering of the decoded frames (one line per actual surface frame of the pid) so observations can cite
// lines; the binary trace stays next to it.
export function frameTimelineText(m, pid) {
  const head = [`# perfetto frametimeline: ${m.packets} packets, ${m.allSurfaceFrames} actual surface frames, ${m.frames} of pid ${pid}`,
    '# start_ns dur_ns jank_type present_type prediction_type layer'];
  const body = m.list.map((a) => `${a.start} ${a.durNs ?? 'null'} ${a.jankType ?? 0} ${a.presentType ?? 0} ${a.predictionType ?? 0} ${a.layerName ?? '?'}`);
  const summary = `summary frames=${m.frames} janky=${m.janky} p50_ns=${m.p50 ?? 'null'} p90_ns=${m.p90 ?? 'null'} p99_ns=${m.p99 ?? 'null'}`;
  return { text: `${[...head, ...body, summary].join('\n')}\n`, summaryLine: head.length + body.length + 1, summary };
}

export function sfSummaryLine(layer, m) {
  return `summary layer=${layer} frames=${m.frames} intervals=${m.intervals} janky=${m.janky ?? 'null'} p50_ns=${m.p50 ?? 'null'} p90_ns=${m.p90 ?? 'null'} p99_ns=${m.p99 ?? 'null'}`;
}

// Plausibility: > 0 frames and no more than the window allows at the refresh rate (+10 %).
export function plausibleFrameCount(frames, windowNs, refreshNs) {
  if (!(frames > 0)) {
    return { pass: false, reason: 'no-frames' };
  }
  if (refreshNs && windowNs > 0 && frames > 1.1 * (windowNs / refreshNs) + 2) {
    return { pass: false, reason: `more-frames-than-refresh-allows (${frames} > ${Math.round(windowNs / refreshNs)})` };
  }
  return { pass: true, reason: null };
}

// `dumpsys SurfaceFlinger --list` lines -> layer names of a package (RequestedLayerState{<name> parentId=...} or
// bare names), the candidates for the frame source.
export function sfLayersFor(text, pkg) {
  const out = [];
  for (const l of lines(text)) {
    const t = l.text.trim();
    const m = /^RequestedLayerState\{(.*?)(?: parentId=.*)?\}$/.exec(t);
    const name = m ? m[1] : t;
    if (name.includes(pkg) && (/SurfaceView\[.*\(BLAST\)#\d+$/.test(name) || /^VRI-.*#\d+$/.test(name))) {
      out.push(name);
    }
  }
  return [...new Set(out)];
}
