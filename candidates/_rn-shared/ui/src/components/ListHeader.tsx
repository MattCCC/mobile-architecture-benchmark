// List screen bands: header (56), status chip row (32), summary bar (48) (design §8.2).
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNav, useObservable, useSelectionSnapshot, useSession } from '../app/context';
import { summaryCountText, summaryTotalText } from '../domain/format';
import { Probe } from '../bench/Probe';
import { DigestText } from './DigestText';
import { bands, colors } from './theme';

export const Header = memo(function HeaderView(): React.JSX.Element {
  const nav = useNav();
  const { count } = useSelectionSnapshot();
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Items</Text>
      <Pressable testID="mb.nav.selection" accessibilityRole="button" onPress={nav.openSelection} style={styles.headerButton}>
        <Text style={styles.headerButtonText}>{`Selection (${count})`}</Text>
      </Pressable>
      <Pressable testID="mb.nav.insights" accessibilityRole="button" onPress={nav.openInsights} style={styles.headerButton}>
        <Text style={styles.headerButtonText}>Insights</Text>
      </Pressable>
    </View>
  );
});

export const StatusRow = memo(function StatusRowView(): React.JSX.Element {
  const session = useSession();
  const status = useObservable(session.status);
  return (
    <View style={styles.statusRow}>
      <View style={styles.chip}>
        <Text testID="mb.stream.status" style={styles.chipText}>
          {status}
        </Text>
      </View>
      <View style={styles.spacer} />
      <DigestText />
    </View>
  );
});

export const SummaryBar = memo(function SummaryBarView(): React.JSX.Element {
  const session = useSession();
  const { count, total } = useSelectionSnapshot();
  const token = useObservable(session.summaryToken);
  return (
    // collapsable={false} keeps count/total nested under `mb.summary` in the accessibility tree (see InsightsView).
    <View testID="mb.summary" collapsable={false} style={styles.summary}>
      <Text testID="mb.summary.count" style={styles.summaryText}>
        {summaryCountText(count)}
      </Text>
      <Text style={styles.summaryText}>{' · '}</Text>
      <Text testID="mb.summary.total" style={styles.summaryText}>
        {summaryTotalText(total)}
      </Text>
      <Probe kind="summary" index={0} token={token} />
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    height: bands.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: colors.background,
  },
  title: { flex: 1, fontSize: 20, fontWeight: '600', color: colors.text },
  headerButton: {
    height: 36,
    minWidth: 48,
    paddingHorizontal: 10,
    marginLeft: 8,
    borderRadius: 4,
    backgroundColor: colors.neutral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: { fontSize: 14, color: colors.text },
  statusRow: {
    height: bands.statusRow,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: colors.background,
  },
  chip: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.neutral,
    justifyContent: 'center',
  },
  chipText: { fontSize: 12, color: colors.text },
  spacer: { flex: 1 },
  summary: {
    height: bands.summary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  summaryText: { fontSize: 14, color: colors.text },
});
