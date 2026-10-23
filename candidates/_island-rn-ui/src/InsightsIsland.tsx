// Insights island (design §8.1, §8.10; decision 38): the shared InsightsView (top 5 by option A, option B buckets,
// `Source: <src>`, `mb.insights.digest`, content probe -> `remote.ready`) fed by the Insights the host computes.
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { InsightsView } from '@mobilebench/rn-ui/screens/InsightsView';
import { Probe } from '@mobilebench/rn-ui/bench/Probe';
import { colors } from '@mobilebench/rn-ui/components/theme';
import type { IslandModel } from './model';

/** Route index of the Insights screen in the probe numbering of the shared RN UI. */
const INSIGHTS_ROUTE_INDEX = 3;

export function InsightsIsland({ model }: { model: IslandModel }): React.JSX.Element {
  const token = useSyncExternalStore(model.token.subscribe, model.token.get, model.token.get);
  return (
    <View collapsable={false} style={styles.root}>
      <InsightsView
        store={model}
        digest={model.insightsDigest}
        source={model.source}
        version={model.version}
        openSeq={model.openSeq}
        Probe={Probe}
      />
      <Probe kind="screen" index={INSIGHTS_ROUTE_INDEX} token={token} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
