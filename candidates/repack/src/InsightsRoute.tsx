// Insights in the `repack` candidate. `mb.remote=embedded` (default): the embedded copy (mechanism R1).
// `mb.remote=remote`: the Insights module is loaded at run time as a Module Federation 2 remote from the local
// server: the indirection `/v1/modules/repack/<platform>/current/manifest.json` (`{"version":"<v>"}`, design §15.2)
// names the active version, then `/v1/modules/repack/<platform>/<v>/mf-manifest.json` is registered. Every artifact
// URL contains the version, so a new version is a new ScriptManager locator and is fetched instead of being served
// from the cache of the old one (C5, R9). Scripts are verified (code signing, strict) and cached by ScriptManager;
// on any failure the embedded copy is shown as `embedded-fallback` and `remote.error` is emitted (the journey's
// remote metrics are then failed; the fallback never counts as a remote load).
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { ScriptManager } from '@callstack/repack/client';
import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import {
  bench,
  EmbeddedInsights,
  InsightsFrame,
  Probe,
  useInsightsOpen,
  useSession,
} from '@mobilebench/rn-ui';
import type { InsightsSourceKind, InsightsViewProps, Session } from '@mobilebench/rn-ui';
import { remoteHeaders, setRemoteToken } from './remoteConfig';

const REMOTE_NAME = 'MbInsights';
const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;

function isIndirection(doc: unknown): doc is { version: string } {
  if (typeof doc !== 'object' || doc === null) {
    return false;
  }
  const version = (doc as { version?: unknown }).version;
  return typeof version === 'string' && VERSION_RE.test(version);
}

/** Active module version from the server's indirection document. */
async function activeVersion(base: string): Promise<string> {
  const res = await fetch(`${base}/current/manifest.json`, { headers: remoteHeaders() });
  if (!res.ok) {
    throw new Error(`module indirection: HTTP ${res.status}`);
  }
  const doc: unknown = await res.json();
  if (!isIndirection(doc)) {
    throw new Error('module indirection: invalid document');
  }
  return doc.version;
}

// ScriptManager is an EventEmitter at run time; its typings do not expose the emitter methods.
type LoadingListener = (script: { locator?: { fetch?: boolean } }) => void;
type ErrorListener = (event: { originalError?: unknown }) => void;
interface ScriptEvents {
  on(event: 'loading', cb: LoadingListener): void;
  on(event: 'error', cb: ErrorListener): void;
  removeListener(event: 'loading', cb: LoadingListener): void;
  removeListener(event: 'error', cb: ErrorListener): void;
}
const scriptEvents = (): ScriptEvents => ScriptManager.shared as unknown as ScriptEvents;
// Re.Pack's native loaders (Android and iOS) report every rejected signature as
// "The bundle verification failed because ...". The rejection can surface in the prefetch of the remote entry,
// so it is read from ScriptManager's `error` events rather than from the error that reaches loadRemote.
const VERIFICATION_FAILED = /verification failed|signature/i;

interface RemoteModule {
  InsightsView?: React.ComponentType<InsightsViewProps>;
  VERSION?: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'remote'; View: React.ComponentType<InsightsViewProps>; version: string; source: InsightsSourceKind }
  | { kind: 'fallback' };

let registeredVersion: string | null = null;
let cacheCleared = false;

async function loadInsightsRemote(session: Session): Promise<LoadState> {
  const server = session.config.server;
  if (server === null) {
    return { kind: 'fallback' };
  }
  setRemoteToken(session.config.token);
  if (session.config.clearModuleCache && !cacheCleared) {
    cacheCleared = true;
    await ScriptManager.shared.invalidateScripts();
  }
  let fetched = false;
  let rejected = false;
  const onLoading: LoadingListener = (script) => {
    if (script.locator?.fetch === true) {
      fetched = true;
    }
  };
  const onError: ErrorListener = (event) => {
    if (VERIFICATION_FAILED.test(String(event.originalError ?? ''))) {
      rejected = true;
    }
  };
  scriptEvents().on('loading', onLoading);
  scriptEvents().on('error', onError);
  try {
    const base = `${server.httpBase}/v1/modules/repack/${Platform.OS}`;
    const version = await activeVersion(base);
    if (registeredVersion !== version) {
      registerRemotes([{ name: REMOTE_NAME, entry: `${base}/${version}/mf-manifest.json` }], { force: true });
      registeredVersion = version;
    }
    const mod = (await loadRemote<RemoteModule>(`${REMOTE_NAME}/InsightsView`)) ?? {};
    if (typeof mod.InsightsView !== 'function') {
      throw new Error('remote-load');
    }
    const source: InsightsSourceKind = fetched ? 'network' : 'cache';
    bench.mark('remote.source', `src=${source}`);
    return { kind: 'remote', View: mod.InsightsView, version: String(mod.VERSION ?? '1'), source };
  } catch (e) {
    const code = rejected || VERIFICATION_FAILED.test(String(e)) ? 'remote-checksum' : 'remote-load';
    bench.mark('remote.error', `code=${code}`);
    bench.mark('err', `code=${code}`);
    bench.mark('remote.source', 'src=embedded-fallback');
    return { kind: 'fallback' };
  } finally {
    scriptEvents().removeListener('loading', onLoading);
    scriptEvents().removeListener('error', onError);
  }
}

function RemoteInsights({ openSeq }: { openSeq: number }): React.JSX.Element {
  const session = useSession();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    loadInsightsRemote(session).then(
      (next) => {
        if (alive) {
          setState(next);
        }
      },
      () => {
        if (alive) {
          setState({ kind: 'fallback' });
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [session]);
  if (state.kind === 'loading') {
    return <View style={styles.loading} />;
  }
  if (state.kind === 'fallback') {
    return <EmbeddedInsights source="embedded-fallback" openSeq={openSeq} />;
  }
  const RemoteView = state.View;
  return (
    <RemoteView
      store={session.store}
      digest={session.insightsDigest}
      source={state.source}
      version={state.version}
      openSeq={openSeq}
      Probe={Probe}
    />
  );
}

export function InsightsRoute(): React.JSX.Element {
  const session = useSession();
  const openSeq = useInsightsOpen();
  const remote = session.config.remote === 'remote' && session.config.server !== null;
  // Embedded mode reports its source once per open (the remote loader reports its own).
  useState(() => {
    if (!remote) {
      bench.mark('remote.source', 'src=embedded');
    }
    return true;
  });
  return (
    <InsightsFrame>
      {remote ? <RemoteInsights openSeq={openSeq} /> : <EmbeddedInsights source="embedded" openSeq={openSeq} />}
    </InsightsFrame>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
});
