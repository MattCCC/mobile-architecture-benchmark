// Launch configuration (design §6.5, validation §5.9). The native BenchKit facade returns the `mb.*` launch keys
// (Android Intent extras, iOS `-mb.<key> <value>` arguments) as a JSON object of strings. Pure TypeScript.

import { PROFILES } from './types.ts';
import type { ProfileName } from './types.ts';

export type DataSourceKind = 'replay' | 'websocket';

export interface ServerAddress {
  host: string;
  port: number;
  /** `http://host:port` */
  httpBase: string;
  /** `ws://host:port` */
  wsBase: string;
}

export interface LaunchConfig {
  journey: string;
  profile: ProfileName;
  server: ServerAddress | null;
  session: string | null;
  token: string | null;
  dataset: 'embedded' | 'network';
  restore: boolean;
  remote: 'embedded' | 'remote';
  clearModuleCache: boolean;
  journeyMode: boolean;
  bridgeBench: '0' | 'sync' | 'async';
  markerMirror: 'control' | 'all';
  /** PoC key `mb.source`: the update-stream source (default: in-app replay of the bundled stream). */
  source: DataSourceKind;
  /** PoC key `mb.count`: replay sends the end frame after this many messages (default: whole bundled stream). */
  count: number | null;
}

export interface LaunchConfigResult {
  config: LaunchConfig;
  /** Keys whose values are invalid (-> error screen, `err code=launch-config-invalid`). */
  invalid: string[];
  /** Unknown `mb.*` keys (ignored, reported in one `err` marker). */
  unknown: string[];
}

const KNOWN_KEYS = new Set([
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
  'mb.source',
  'mb.count',
]);

const JOURNEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SESSION_RE = /^[a-z0-9-]{1,40}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const SERVER_RE = /^(ws|http):\/\/([A-Za-z0-9.-]{1,253}):(\d{1,5})\/?$/;

export const DEFAULT_CONFIG: LaunchConfig = {
  journey: '-',
  profile: 'representative',
  server: null,
  session: null,
  token: null,
  dataset: 'embedded',
  restore: false,
  remote: 'embedded',
  clearModuleCache: false,
  journeyMode: false,
  bridgeBench: '0',
  markerMirror: 'control',
  source: 'replay',
  count: null,
};

function isAllowedHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2' || /\.local$/.test(host);
}

export function parseServer(value: string): ServerAddress | null {
  const m = SERVER_RE.exec(value);
  if (!m) {
    return null;
  }
  const host = m[2];
  const port = Number(m[3]);
  if (!isAllowedHost(host) || port < 1024 || port > 65535) {
    return null;
  }
  return { host, port, httpBase: `http://${host}:${port}`, wsBase: `ws://${host}:${port}` };
}

function bool(v: string): boolean | null {
  if (v === '1') {
    return true;
  }
  if (v === '0') {
    return false;
  }
  return null;
}

export function parseLaunchConfig(raw: Record<string, string>): LaunchConfigResult {
  const config: LaunchConfig = { ...DEFAULT_CONFIG };
  const invalid: string[] = [];
  const unknown: string[] = [];
  const keys = Object.keys(raw).sort();
  for (const key of keys) {
    if (!key.startsWith('mb.')) {
      continue;
    }
    if (!KNOWN_KEYS.has(key)) {
      unknown.push(key);
      continue;
    }
    const value = String(raw[key]);
    switch (key) {
      case 'mb.journey':
        if (JOURNEY_RE.test(value)) {
          config.journey = value;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.profile':
        if ((PROFILES as readonly string[]).includes(value)) {
          config.profile = value as ProfileName;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.server': {
        const server = parseServer(value);
        if (server) {
          config.server = server;
        } else {
          invalid.push(key);
        }
        break;
      }
      case 'mb.session':
        if (SESSION_RE.test(value)) {
          config.session = value;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.token':
        if (TOKEN_RE.test(value)) {
          config.token = value;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.dataset':
        if (value === 'embedded' || value === 'network') {
          config.dataset = value;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.remote':
        if (value === 'embedded' || value === 'remote') {
          config.remote = value;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.bridgeBench':
        if (value === '0' || value === 'sync' || value === 'async') {
          config.bridgeBench = value;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.markerMirror':
        if (value === 'control' || value === 'all') {
          config.markerMirror = value;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.source':
        if (value === 'replay' || value === 'websocket') {
          config.source = value;
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.count':
        if (/^\d{1,7}$/.test(value)) {
          config.count = Number(value);
        } else {
          invalid.push(key);
        }
        break;
      case 'mb.restore':
      case 'mb.clearModuleCache':
      case 'mb.journeyMode':
      case 'mb.layoutProbe':
      case 'mb.semantics': {
        if (key === 'mb.semantics') {
          // `auto` | `on` (design §6.5); only opt-in accessibility trees act on it, so the RN family ignores it.
          if (value !== 'auto' && value !== 'on') {
            invalid.push(key);
          }
          break;
        }
        const b = bool(value);
        if (b === null) {
          invalid.push(key);
        } else if (key === 'mb.restore') {
          config.restore = b;
        } else if (key === 'mb.clearModuleCache') {
          config.clearModuleCache = b;
        } else if (key === 'mb.journeyMode') {
          config.journeyMode = b;
        }
        break;
      }
      default:
        unknown.push(key);
    }
  }
  // `*.local` hosts are accepted only together with a token (design §31 item 22).
  if (config.server && /\.local$/.test(config.server.host) && config.token === null) {
    config.server = null;
    if (!invalid.includes('mb.server')) {
      invalid.push('mb.server');
    }
  }
  // ...and a token only together with a `*.local` host (design §5.9).
  if (config.token !== null && !(config.server && /\.local$/.test(config.server.host))) {
    config.token = null;
    if (!invalid.includes('mb.token')) {
      invalid.push('mb.token');
    }
  }
  if ((config.source === 'websocket' || config.dataset === 'network' || config.remote === 'remote') && !config.server) {
    if (!invalid.includes('mb.server')) {
      invalid.push('mb.server');
    }
  }
  return { config, invalid, unknown };
}
