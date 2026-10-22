// Launch configuration (design §6.5). Android: Intent extras; iOS: launch arguments `-mb.<key> <value>`.
// Unknown keys are ignored and reported once; invalid values of known keys fall back to the default and
// are reported with error code launch-config-invalid.

export type Profile = 'small' | 'representative' | 'stress';

export interface LaunchConfig {
  readonly journey: string;
  readonly profile: Profile;
  readonly restore: boolean;
  readonly journeyMode: boolean;
  readonly markerMirror: 'control' | 'all';
  /** Candidate-local PoC key: number of replayed messages before the end frame (server session `count`). */
  readonly replayCount: number | null;
  readonly server: string | null;
  readonly token: string | null;
  readonly unknownKeys: readonly string[];
  /** Known keys with an invalid value, or a value this build does not implement. */
  readonly invalidKeys: readonly string[];
}

const PROFILES: readonly string[] = ['small', 'representative', 'stress'];

/** Keys of design §6.5 plus the candidate-local `mb.replayCount`. */
export const KNOWN_KEYS: readonly string[] = [
  'mb.journey',
  'mb.profile',
  'mb.server',
  'mb.session',
  'mb.token',
  'mb.dataset',
  'mb.restore',
  'mb.remote',
  'mb.clearModuleCache',
  'mb.journeyMode',
  'mb.bridgeBench',
  'mb.markerMirror',
  'mb.layoutProbe',
  'mb.semantics',
  'mb.replayCount',
];

const BIT = /^[01]$/;

export function parseLaunchConfig(entries: Readonly<Record<string, string>>): LaunchConfig {
  const unknownKeys: string[] = [];
  const invalidKeys: string[] = [];
  const get = (key: string): string | undefined => entries[key];
  const check = (key: string, ok: (v: string) => boolean): string | undefined => {
    const v = get(key);
    if (v === undefined) {
      return undefined;
    }
    if (!ok(v)) {
      invalidKeys.push(key);
      return undefined;
    }
    return v;
  };
  Object.keys(entries)
    .filter((k) => k.startsWith('mb.') && !KNOWN_KEYS.includes(k))
    .sort()
    .forEach((k) => unknownKeys.push(k));

  const journey = check('mb.journey', (v) => /^[A-Za-z0-9._-]{1,64}$/.test(v)) ?? '-';
  const profile = (check('mb.profile', (v) => PROFILES.includes(v)) ?? 'representative') as Profile;
  const restore = check('mb.restore', (v) => BIT.test(v)) === '1';
  const journeyMode = check('mb.journeyMode', (v) => BIT.test(v)) === '1';
  const markerMirror = (check('mb.markerMirror', (v) => v === 'control' || v === 'all') ?? 'control') as 'control' | 'all';
  const count = check('mb.replayCount', (v) => /^(0|[1-9][0-9]{0,6})$/.test(v));
  const server = check('mb.server', (v) => /^(wss?|https?):\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/\S*)?$/.test(v)) ?? null;
  const token = check('mb.token', (v) => /^[0-9a-f]{32}$/.test(v)) ?? null;
  check('mb.session', (v) => /^[A-Za-z0-9._-]{1,64}$/.test(v));
  // Valid values this build implements as the defaults only; anything else is reported.
  check('mb.dataset', (v) => v === 'embedded');
  check('mb.remote', (v) => v === 'embedded');
  check('mb.clearModuleCache', (v) => BIT.test(v));
  check('mb.bridgeBench', (v) => v === '0');
  check('mb.layoutProbe', (v) => v === '0');
  check('mb.semantics', (v) => v === 'auto' || v === 'on');
  if (server !== null) {
    // The WebSocket transport is not part of this build; the replay transport stays active.
    invalidKeys.push('mb.server');
  }
  return {
    journey,
    profile,
    restore,
    journeyMode,
    markerMirror,
    replayCount: count === undefined ? null : Number(count),
    server,
    token,
    unknownKeys,
    invalidKeys,
  };
}

/** iOS: `-mb.<key> <value>` pairs from ProcessInfo.arguments (index 0 is the executable). */
export function entriesFromArguments(args: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let k = 1; k < args.length; k += 1) {
    const a = args[k];
    if (a.startsWith('-mb.') && k + 1 < args.length) {
      out[a.slice(1)] = args[k + 1];
      k += 1;
    }
  }
  return out;
}
