// Selection screen (design §8.1): selected entries `Item 042 · Option B — 12.34` with live values, and the total.
import React, { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useItem, useSelectionSnapshot, useSession } from '../app/context';
import { fmt, itemLabel, labelWidth as labelWidthFor, summaryTotalText } from '../domain/format';
import { OPTION_KEYS } from '../domain/types';
import { ScreenRoot } from '../components/ScreenRoot';
import { DigestText } from '../components/DigestText';
import { colors } from '../components/theme';

const Entry = memo(function EntryView({ index, width }: { index: number; width: number }): React.JSX.Element | null {
  const item = useItem(index);
  if (item.sel < 0) {
    return null;
  }
  return (
    <View style={styles.entry}>
      <Text testID={`mb.selection.${index}`} style={styles.entryText}>
        {`${itemLabel(index, width)} · Option ${OPTION_KEYS[item.sel]} — ${fmt(item.v[item.sel])}`}
      </Text>
    </View>
  );
});

const keyExtractor = (i: number): string => `sel-${i}`;

export function SelectionScreen(): React.JSX.Element {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const snap = useSelectionSnapshot();
  const width = labelWidthFor(session.store.itemCount);
  // Cached per selection revision in the store (value updates re-render single entries only).
  const items = session.store.selectedItems();
  const renderItem: ListRenderItem<number> = useCallback(({ item }) => <Entry index={item} width={width} />, [width]);
  return (
    <ScreenRoot route="selection" routeKind="selection" testID="mb.screen.selection">
      <View style={styles.totalRow}>
        <Text testID="mb.selection.total" style={styles.total}>
          {`${summaryTotalText(snap.total)} · ${snap.count} selected`}
        </Text>
        <DigestText />
      </View>
      <FlatList data={items} keyExtractor={keyExtractor} renderItem={renderItem} style={styles.list} />
      <View style={{ height: insets.bottom }} />
    </ScreenRoot>
  );
}

const styles = StyleSheet.create({
  totalRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  total: { fontSize: 16, color: colors.text },
  list: { flex: 1 },
  entry: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  entryText: { fontSize: 14, color: colors.text },
});
