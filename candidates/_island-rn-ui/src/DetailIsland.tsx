// Detail island (design §8.1, §8.7; decision 38): item label, group, three live values and the animated info panel:
// show = translateY +240 -> 0 and opacity 0 -> 1 over 300 ms, cubic-bezier(0.42, 0, 0.58, 1); hide = reverse.
// The same content and styles as the shared RN Detail screen (candidates/_rn-shared/ui/src/screens/DetailScreen.tsx)
// without the parts the island host draws natively (navigation bar, status row with the checkpoint digest element).
import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { itemLabel, labelWidth as labelWidthFor, optionText } from '@mobilebench/rn-ui/domain/format';
import { bench } from '@mobilebench/rn-ui/bench/benchkit';
import { Probe } from '@mobilebench/rn-ui/bench/Probe';
import { colors } from '@mobilebench/rn-ui/components/theme';
import type { IslandModel } from './model';

const EASING = Easing.bezier(0.42, 0, 0.58, 1);
const VALUE_IDS = ['a', 'b', 'c'] as const;
/** Route index of the Detail screen in the probe numbering of the shared RN UI. */
const DETAIL_ROUTE_INDEX = 2;

export interface DetailIslandProps {
  model: IslandModel;
  /** Build-probe string of the island bundle (incremental-build scenario F2); shown in the footer. */
  buildProbe: string;
}

export function DetailIsland({ model, buildProbe }: DetailIslandProps): React.JSX.Element {
  const values = useSyncExternalStore(model.values.subscribe, model.values.get, model.values.get);
  const token = useSyncExternalStore(model.token.subscribe, model.token.get, model.token.get);
  const [progress] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(false);
  const [present, setPresent] = useState(false);

  const toggle = useCallback(() => {
    if (!shown) {
      setShown(true);
      setPresent(true);
      bench.mark('anim.start', 'dir=show');
      Animated.timing(progress, { toValue: 1, duration: 300, easing: EASING, useNativeDriver: true }).start(() => {
        bench.mark('anim.end', 'dir=show');
      });
    } else {
      setShown(false);
      bench.mark('anim.start', 'dir=hide');
      Animated.timing(progress, { toValue: 0, duration: 300, easing: EASING, useNativeDriver: true }).start(
        ({ finished }) => {
          bench.mark('anim.end', 'dir=hide');
          if (finished) {
            setPresent(false);
          }
        },
      );
    }
  }, [shown, progress]);

  const translateY = useMemo(() => progress.interpolate({ inputRange: [0, 1], outputRange: [240, 0] }), [progress]);
  const label = itemLabel(model.index, labelWidthFor(model.itemCount));
  return (
    <View collapsable={false} style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.group}>{`Group ${model.group}`}</Text>
        {VALUE_IDS.map((id, o) => (
          <Text key={id} testID={`mb.detail.values.${id}`} style={styles.value}>
            {optionText(o, values[o])}
          </Text>
        ))}
        <Pressable testID="mb.detail.panel.toggle" accessibilityRole="button" onPress={toggle} style={styles.toggle}>
          <Text style={styles.toggleText}>{shown ? 'Hide details' : 'Show details'}</Text>
        </Pressable>
        {present ? (
          <Animated.View testID="mb.detail.panel" style={[styles.panel, { opacity: progress, transform: [{ translateY }] }]}>
            <Text style={styles.panelText}>{`Details for ${label}`}</Text>
            <Text style={styles.panelText}>{`Group ${model.group}`}</Text>
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>{buildProbe}</Text>
      </View>
      <Probe kind="screen" index={DETAIL_ROUTE_INDEX} token={token} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: '600', color: colors.text },
  group: { fontSize: 14, color: colors.muted, marginBottom: 12 },
  value: { fontSize: 16, color: colors.text, marginVertical: 4 },
  toggle: {
    marginTop: 16,
    height: 40,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    borderRadius: 4,
    backgroundColor: colors.neutral,
    justifyContent: 'center',
  },
  toggleText: { fontSize: 14, color: colors.text },
  panel: {
    marginTop: 16,
    height: 160,
    padding: 16,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  panelText: { fontSize: 14, color: colors.text },
  footer: { paddingHorizontal: 16, paddingVertical: 8 },
  footerText: { fontSize: 10, color: colors.muted },
});
