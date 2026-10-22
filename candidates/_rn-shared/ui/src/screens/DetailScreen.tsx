// Detail screen (design §8.1, §8.7): item label, group, three live values, and the animated info panel:
// show = translateY +240 -> 0 and opacity 0 -> 1 over 300 ms, cubic-bezier(0.42, 0, 0.58, 1); hide = reverse.
// RN `Animated` with the native driver. `anim.start` / `anim.end` are diagnostic markers.
import React, { useCallback, useMemo, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useItem, useSession } from '../app/context';
import { itemLabel, labelWidth as labelWidthFor, optionText } from '../domain/format';
import { bench } from '../bench/benchkit';
import { ScreenRoot } from '../components/ScreenRoot';
import { DigestText } from '../components/DigestText';
import { colors } from '../components/theme';

const EASING = Easing.bezier(0.42, 0, 0.58, 1);
const VALUE_IDS = ['a', 'b', 'c'] as const;

export interface DetailScreenProps {
  index: number;
  /** Build-probe string of the host (incremental-build scenario F2); shown in the footer. */
  buildProbe: string;
}

export function DetailScreen({ index, buildProbe }: DetailScreenProps): React.JSX.Element {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const item = useItem(index);
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
  const width = labelWidthFor(session.store.itemCount);
  return (
    <ScreenRoot route={`detail/${index}`} routeKind="detail" testID="mb.screen.detail">
      <View style={styles.body}>
        <Text style={styles.title}>{itemLabel(index, width)}</Text>
        <Text style={styles.group}>{`Group ${session.store.group(index)}`}</Text>
        {VALUE_IDS.map((id, o) => (
          <Text key={id} testID={`mb.detail.values.${id}`} style={styles.value}>
            {optionText(o, item.v[o])}
          </Text>
        ))}
        <Pressable testID="mb.detail.panel.toggle" accessibilityRole="button" onPress={toggle} style={styles.toggle}>
          <Text style={styles.toggleText}>{shown ? 'Hide details' : 'Show details'}</Text>
        </Pressable>
        {present ? (
          <Animated.View testID="mb.detail.panel" style={[styles.panel, { opacity: progress, transform: [{ translateY }] }]}>
            <Text style={styles.panelText}>{`Details for ${itemLabel(index, width)}`}</Text>
            <Text style={styles.panelText}>{`Group ${session.store.group(index)}`}</Text>
          </Animated.View>
        ) : null}
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
        <Text style={styles.footerText}>{buildProbe}</Text>
        <DigestText />
      </View>
    </ScreenRoot>
  );
}

const styles = StyleSheet.create({
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
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  footerText: { fontSize: 10, color: colors.muted },
});
