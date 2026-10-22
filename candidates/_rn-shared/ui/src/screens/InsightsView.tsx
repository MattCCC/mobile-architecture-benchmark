// Insights content (design §7.1, §8.1, §8.10): top 5 items by option A, option B distribution in 5 buckets,
// `Source: <src>`, and the checkpoint element `mb.insights.digest`. Self-contained (props only, no app context or
// native-module imports) so the same component can also be built into a remotely loaded module; the host passes
// its live store, its digest observable and its probe component. The content probe emits `remote.ready`.
import React, { useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fmt, itemLabel, labelWidth as labelWidthFor } from '../domain/format';
import type { InsightsSnapshot } from '../domain/store';

export type InsightsSourceKind = 'embedded' | 'cache' | 'network' | 'embedded-fallback';

export interface InsightsStoreLike {
  readonly itemCount: number;
  insightsSnapshot(): InsightsSnapshot;
  subscribeValues(cb: () => void): () => void;
}

export interface ReadonlyObservable<T> {
  get(): T;
  subscribe(cb: () => void): () => void;
}

export interface InsightsProbeProps {
  kind: 'insights';
  index: number;
  token: string;
}

export interface InsightsViewProps {
  store: InsightsStoreLike;
  digest: ReadonlyObservable<string>;
  source: InsightsSourceKind;
  /** Version of the Insights code (embedded copy: "1"; remote: the module version). */
  version: string;
  /** Per-open sequence, so every open emits one `remote.ready`. */
  openSeq: number;
  Probe: React.ComponentType<InsightsProbeProps>;
}

export function InsightsView({ store, digest, source, version, openSeq, Probe }: InsightsViewProps): React.JSX.Element {
  const subscribe = useMemo(() => (cb: () => void) => store.subscribeValues(cb), [store]);
  const getSnapshot = useMemo(() => () => store.insightsSnapshot(), [store]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const digestText = useSyncExternalStore(digest.subscribe, digest.get, digest.get);
  const width = labelWidthFor(store.itemCount);
  return (
    <View style={styles.body}>
      <Text style={styles.heading}>Top 5 by Option A</Text>
      {/* collapsable={false}: a testID alone keeps the view but Fabric still mounts its children into the parent,
          which would leave the id-bearing element without its entries in the accessibility tree. */}
      <View testID="mb.insights.top" collapsable={false}>
        {snap.top.map(([i, a]) => (
          <Text key={i} style={styles.line}>{`${itemLabel(i, width)} — ${fmt(a)}`}</Text>
        ))}
      </View>
      <Text style={styles.heading}>Option B distribution</Text>
      <Text testID="mb.insights.buckets" style={styles.line}>
        {snap.buckets.join(' · ')}
      </Text>
      <Text testID="mb.insights.source" style={styles.source}>{`Source: ${source}`}</Text>
      <Text testID="mb.insights.digest" style={styles.digest}>
        {digestText}
      </Text>
      <Probe kind="insights" index={0} token={`ready:${version}:${openSeq}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 16, backgroundColor: '#FFFFFF' },
  heading: { fontSize: 16, fontWeight: '600', color: '#111111', marginTop: 8, marginBottom: 4 },
  line: { fontSize: 14, color: '#111111', marginVertical: 2 },
  source: { fontSize: 14, color: '#5F6368', marginTop: 16 },
  digest: { fontSize: 8, color: '#E4E4E4', marginTop: 8 },
});
