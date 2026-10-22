// List row (design §8.2): fixed 72 dp/pt, `Item NNN`, `Group <g>`, three option buttons `A 12.34`.
// Memoized; it subscribes only to its own item (design §8.6), and counts its renders for the `ctr` checkpoint.
import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useItem, useNav, useSession } from '../app/context';
import { itemLabel, optionText } from '../domain/format';
import { Probe } from '../bench/Probe';
import { bands, colors } from './theme';

const OPTION_IDS = ['a', 'b', 'c'] as const;

interface OptionButtonProps {
  index: number;
  option: number;
  value: number;
  selected: boolean;
}

const OptionButton = memo(function OptionButtonView({ index, option, value, selected }: OptionButtonProps): React.JSX.Element {
  const session = useSession();
  const onPress = useCallback(() => session.toggle(index, option), [session, index, option]);
  return (
    <Pressable
      testID={`mb.row.${index}.opt.${OPTION_IDS[option]}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, selected ? styles.optionSelected : null]}
    >
      <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>{optionText(option, value)}</Text>
    </Pressable>
  );
});

export interface RowProps {
  index: number;
  labelWidth: number;
}

export const Row = memo(function RowView({ index, labelWidth }: RowProps): React.JSX.Element {
  const session = useSession();
  const nav = useNav();
  const item = useItem(index);
  session.store.rowRenders += 1;
  const openDetail = useCallback(() => nav.openDetail(index), [nav, index]);
  return (
    <View testID={`mb.row.${index}`} style={styles.row}>
      <Pressable onPress={openDetail} style={styles.labelBox}>
        <Text testID={`mb.row.${index}.label`} style={styles.label}>
          {itemLabel(index, labelWidth)}
        </Text>
        <Text style={styles.group}>{`Group ${session.store.group(index)}`}</Text>
      </Pressable>
      <OptionButton index={index} option={0} value={item.v[0]} selected={item.sel === 0} />
      <OptionButton index={index} option={1} value={item.v[1]} selected={item.sel === 1} />
      <OptionButton index={index} option={2} value={item.v[2]} selected={item.sel === 2} />
      <Probe kind="row" index={index} token="fui0" />
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    height: bands.row,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  labelBox: { flex: 1, justifyContent: 'center', alignSelf: 'stretch' },
  label: { fontSize: 16, color: colors.text },
  group: { fontSize: 14, color: colors.muted },
  option: {
    minWidth: 48,
    height: 36,
    marginLeft: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: colors.neutral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: { backgroundColor: colors.accent },
  optionText: { fontSize: 14, color: colors.text },
  optionTextSelected: { color: colors.onAccent },
});
