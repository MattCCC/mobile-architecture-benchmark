// Embedded workload assets, resolved through bundler aliases to the candidate's generated (gitignored) asset dir:
//   @mobilebench/fixtures/<profile>.json  byte-identical copy of fixtures/v1 (bundle-inlined by Metro / Rspack)
//   @mobilebench/stream/<profile>.json    first 10000 messages, verified against golden.json at build time
// Each asset is required lazily, so only the active profile's data is evaluated, and the stream only after FUI.
import type { FixtureFile, ProfileName } from '../domain/types';
import type { StreamAsset } from '../stream/replay';
import type { ServerAddress } from '../domain/launchConfig';

export function loadEmbeddedFixture(profile: ProfileName): FixtureFile {
  switch (profile) {
    case 'small':
      return require('@mobilebench/fixtures/small.json') as FixtureFile;
    case 'stress':
      return require('@mobilebench/fixtures/stress.json') as FixtureFile;
    default:
      return require('@mobilebench/fixtures/representative.json') as FixtureFile;
  }
}

export function loadStreamAsset(profile: ProfileName): StreamAsset {
  switch (profile) {
    case 'small':
      return require('@mobilebench/stream/small.json') as StreamAsset;
    case 'stress':
      return require('@mobilebench/stream/stress.json') as StreamAsset;
    default:
      return require('@mobilebench/stream/representative.json') as StreamAsset;
  }
}

/** `mb.dataset=network`: GET /v1/fixtures/<profile>.json from the local server, parsed at run time. */
export async function fetchFixture(server: ServerAddress, profile: ProfileName, token: string | null): Promise<FixtureFile> {
  const headers: Record<string, string> = {};
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${server.httpBase}/v1/fixtures/${profile}.json`, { headers });
  if (!res.ok) {
    throw new Error(`fixture-http-${res.status}`);
  }
  return JSON.parse(await res.text()) as FixtureFile;
}

/** Minimal structural check of a fixture (wrong profile, truncated or foreign data -> `fixture-invalid`). */
export function isValidFixture(f: FixtureFile, profile: ProfileName): boolean {
  if (f === null || typeof f !== 'object' || f.schema !== 'mobilebench.fixture/1.0.0' || f.profile !== profile) {
    return false;
  }
  if (!Array.isArray(f.items) || f.items.length === 0 || !Array.isArray(f.selection)) {
    return false;
  }
  for (let i = 0; i < f.items.length; i += 1) {
    const it = f.items[i];
    if (it.i !== i || !Array.isArray(it.v) || it.v.length !== 3) {
      return false;
    }
  }
  return true;
}
