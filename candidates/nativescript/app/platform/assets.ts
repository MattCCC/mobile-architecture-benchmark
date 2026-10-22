// Bundled workload data. scripts/prepare-assets.mjs copies the committed fixture bytes from fixtures/v1
// (verified against SHA256SUMS and golden.json) into app/generated/fixtures; webpack inlines the parsed JSON
// (the documented JS-bundler path of fixtures/README.md). Only the requested profile module is evaluated.

import type { Profile } from '../core/launch-config';

export function loadFixtureDocument(profile: Profile): unknown {
  switch (profile) {
    case 'small':
      return require('../generated/fixtures/small.json');
    case 'stress':
      return require('../generated/fixtures/stress.json');
    default:
      return require('../generated/fixtures/representative.json');
  }
}

/** Update rate of a profile (messages per second), from the verified golden.json copy. */
export function profileRate(profile: Profile): number {
  const golden = require('../generated/fixtures/golden.json') as {
    profiles: Record<string, { updateRatePerSecond: number }>;
  };
  return golden.profiles[profile].updateRatePerSecond;
}
