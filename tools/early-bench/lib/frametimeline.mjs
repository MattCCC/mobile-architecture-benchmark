// Minimal Perfetto trace decoder for the SurfaceFlinger FrameTimeline data source
// (android.surfaceflinger.frametimeline), Node built-ins only. Only the fields the early-bench frame methods use
// are decoded; everything else is skipped by wire type.
//
// Schema (perfetto/protos/perfetto/trace/android/frame_timeline_event.proto):
//   Trace { repeated TracePacket packet = 1 }
//   TracePacket { uint64 timestamp = 8; FrameTimelineEvent frame_timeline_event = 76 }
//   FrameTimelineEvent oneof { 1 expected_display_frame_start, 2 actual_display_frame_start,
//     3 expected_surface_frame_start, 4 actual_surface_frame_start, 5 frame_end }
//   ActualSurfaceFrameStart { 1 cookie, 2 token, 3 display_frame_token, 4 pid, 5 layer_name, 6 present_type,
//     7 on_time_finish, 8 gpu_composition, 9 jank_type, 10 prediction_type, 11 is_buffer, 12 jank_severity_type }
//   ExpectedSurfaceFrameStart { 1 cookie, 2 token, 3 display_frame_token, 4 pid, 5 layer_name }
//   FrameEnd { 1 cookie }

export const JANK_BITS = {
  1: 'none', 2: 'sf-scheduling', 4: 'prediction-error', 8: 'display-hal', 16: 'sf-cpu-deadline-missed',
  32: 'sf-gpu-deadline-missed', 64: 'app-deadline-missed', 128: 'buffer-stuffing', 256: 'unknown', 512: 'sf-stuffing',
  1024: 'dropped', 2048: 'non-animating', 4096: 'app-resynced-jitter',
};
// Flags that do not make a frame janky: none, buffer-stuffing (queueing, not a missed frame) and non-animating
// (SurfaceFlinger marks frames outside an animation; they carry no jank verdict).
const NOT_JANK_MASK = 1 | 128 | 2048;
export const PRESENT_TYPES = { 1: 'on-time', 2: 'late', 3: 'early', 4: 'dropped', 5: 'unknown' };

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) {
      throw new Error('truncated varint');
    }
    const b = buf[pos];
    pos += 1;
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return [result, pos];
    }
    shift += 7n;
  }
}

// Yields [fieldNumber, wireType, value] where value is a BigInt (varint / fixed) or a Buffer (length-delimited).
export function* fields(buf) {
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      let v;
      [v, pos] = readVarint(buf, pos);
      yield [field, wire, v];
    } else if (wire === 1) {
      yield [field, wire, buf.readBigUInt64LE(pos)];
      pos += 8;
    } else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      const end = pos + Number(len);
      if (end > buf.length) {
        throw new Error('truncated length-delimited field');
      }
      yield [field, wire, buf.subarray(pos, end)];
      pos = end;
    } else if (wire === 5) {
      yield [field, wire, BigInt(buf.readUInt32LE(pos))];
      pos += 4;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

function decodeMsg(buf, names) {
  const out = {};
  for (const [f, w, v] of fields(buf)) {
    const name = names[f];
    if (!name) {
      continue;
    }
    out[name] = w === 2 ? v.toString('utf8') : (name === 'cookie' || name === 'token' || name === 'displayFrameToken' ? v : Number(v));
  }
  return out;
}

const SURFACE_ACTUAL = { 1: 'cookie', 2: 'token', 3: 'displayFrameToken', 4: 'pid', 5: 'layerName', 6: 'presentType', 7: 'onTimeFinish',
  8: 'gpuComposition', 9: 'jankType', 10: 'predictionType', 11: 'isBuffer', 12: 'jankSeverityType' };
const SURFACE_EXPECTED = { 1: 'cookie', 2: 'token', 3: 'displayFrameToken', 4: 'pid', 5: 'layerName' };

// Returns { actual: [...], expected: [...] } surface frames with start/end timestamps (ns, BigInt) and duration (ns,
// Number); a start without its frame_end has end null.
export function decodeFrameTimeline(buf) {
  const starts = new Map();
  const actual = [];
  const expected = [];
  let packets = 0;
  for (const [f, w, packet] of fields(buf)) {
    if (f !== 1 || w !== 2) {
      continue;
    }
    packets += 1;
    let ts = null;
    let ev = null;
    for (const [pf, pw, pv] of fields(packet)) {
      if (pf === 8 && pw === 0) {
        ts = pv;
      } else if (pf === 76 && pw === 2) {
        ev = pv;
      }
    }
    if (!ev || ts === null) {
      continue;
    }
    for (const [ef, ew, ev2] of fields(ev)) {
      if (ew !== 2) {
        continue;
      }
      if (ef === 4 || ef === 3) {
        const m = decodeMsg(ev2, ef === 4 ? SURFACE_ACTUAL : SURFACE_EXPECTED);
        const rec = { kind: ef === 4 ? 'actual' : 'expected', ...m, start: ts, end: null, durNs: null };
        (ef === 4 ? actual : expected).push(rec);
        if (m.cookie !== undefined) {
          starts.set(m.cookie, rec);
        }
      } else if (ef === 1 || ef === 2) {
        // display frames: only their cookie matters (so frame_end packets of display frames are not misattributed)
        const m = decodeMsg(ev2, { 1: 'cookie' });
        if (m.cookie !== undefined) {
          starts.set(m.cookie, { kind: 'display', start: ts, end: null });
        }
      } else if (ef === 5) {
        const m = decodeMsg(ev2, { 1: 'cookie' });
        const rec = starts.get(m.cookie);
        if (rec && rec.end === null) {
          rec.end = ts;
          rec.durNs = Number(ts - rec.start);
        }
      }
    }
  }
  return { packets, actual, expected };
}

export function jankNames(mask) {
  if (!mask) {
    return ['unspecified'];
  }
  return Object.entries(JANK_BITS).filter(([bit]) => (mask & Number(bit)) !== 0).map(([, n]) => n);
}

// Janky = any jank flag outside NOT_JANK_MASK; unspecified (0) counts as not janky.
export function isJanky(mask) {
  return Boolean(mask) && (mask & ~NOT_JANK_MASK) !== 0;
}
