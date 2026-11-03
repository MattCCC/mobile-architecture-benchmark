import React, { memo, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Probe } from '@mobilebench/rn-ui/bench/Probe';
import { bench } from '@mobilebench/rn-ui/bench/benchkit';
import { fmt, itemLabel, labelWidth, optionText } from '@mobilebench/rn-ui/domain/format';
import { colors } from '@mobilebench/rn-ui/components/theme';
import type { IslandModel } from './model';
import type { IslandChannel } from './islands';
import { RenderCounter } from './renderCounter';

const IDS = ['a', 'b', 'c'];
const keyExtractor = (i: number): string => `item-${i}`;
const getItemLayout = (_: ArrayLike<number> | null | undefined, index: number) => ({ length: 72, offset: 72 * index, index });

const ListRow = memo(function ListRowView({ model, index, channel, counter }: { model: IslandModel; index: number; channel: IslandChannel; counter: RenderCounter }): React.JSX.Element {
  const row = model.rows[index];
  const data = useSyncExternalStore(row.subscribe, row.get, row.get);
  counter.rendered();
  return (
    <View testID={`mb.row.${index}`} style={styles.row}>
      <Pressable style={styles.labelBox} onPress={() => channel.post({ t: 'detail', sid: model.sid, i: index })}>
        <Text testID={`mb.row.${index}.label`} style={styles.label}>{itemLabel(index, labelWidth(model.itemCount))}</Text>
        <Text style={styles.group}>{`Group ${data[0]}`}</Text>
      </Pressable>
      {IDS.map((id, o) => (
        <Pressable key={id} testID={`mb.row.${index}.opt.${id}`} accessibilityRole="button"
          accessibilityState={{ selected: data[4] === o }}
          onPress={() => channel.post({ t: 'toggle', sid: model.sid, i: index, o })}
          style={[styles.option, data[4] === o ? styles.selected : null]}>
          <Text style={[styles.optionText, data[4] === o ? styles.selectedText : null]}>{optionText(o, data[o + 1])}</Text>
        </Pressable>
      ))}
      <Probe kind="row" index={index} token="fui0" />
    </View>
  );
});

export function ListIsland({ model, channel }: { model: IslandModel; channel: IslandChannel }): React.JSX.Element {
  const summary = useSyncExternalStore(model.summary.subscribe, model.summary.get, model.summary.get);
  const token = useSyncExternalStore(model.token.subscribe, model.token.get, model.token.get);
  const data = useMemo(() => Array.from({ length: model.itemCount }, (_, i) => i), [model]);
  const { height } = useWindowDimensions();
  const lastAnchor = useRef(model.anchor);
  const counter = useMemo(() => new RenderCounter((n) => channel.post({ t: 'rendered', sid: model.sid, n })), [model, channel]);
  const renderItem = useCallback(({ item }: { item: number }) => <ListRow model={model} index={item} channel={channel} counter={counter} />, [model, channel, counter]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(model.itemCount - 1, Math.floor(e.nativeEvent.contentOffset.y / 72)));
    if (i !== lastAnchor.current) {
      lastAnchor.current = i;
      channel.post({ t: 'anchor', sid: model.sid, i });
    }
  }, [model, channel]);
  return (
    <View collapsable={false} style={styles.root}>
      <View testID="mb.summary" style={styles.summary}>
        <Text testID="mb.summary.count" style={styles.optionText}>{`Selected ${summary[0]}`}</Text>
        <Text style={styles.optionText}>{' · '}</Text>
        <Text testID="mb.summary.total" style={styles.optionText}>{`Total ${fmt(summary[1])}`}</Text>
        <Probe kind="summary" index={summary[2]} token={`${summary[2]}:${summary[0]}`} />
      </View>
      <View style={styles.root}>
        <Probe kind="list" index={0} token="" />
        <FlatList testID="mb.list" data={data} keyExtractor={keyExtractor} renderItem={renderItem}
          getItemLayout={getItemLayout} initialNumToRender={Math.ceil(height / 72)}
          initialScrollIndex={model.anchor > 0 ? model.anchor : undefined}
          onScroll={onScroll} scrollEventThrottle={16}
          onMomentumScrollEnd={() => bench.mark('scroll.idle', '')}
          onScrollEndDrag={(e: NativeSyntheticEvent<NativeScrollEvent>) => { if (!e.nativeEvent.velocity || Math.abs(e.nativeEvent.velocity.y) < 0.01) bench.mark('scroll.idle', ''); }} />
      </View>
      <Probe kind="screen" index={0} token={token} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  summary: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  row: { height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  labelBox: { flex: 1, justifyContent: 'center', alignSelf: 'stretch' },
  label: { fontSize: 16, color: colors.text },
  group: { fontSize: 14, color: colors.muted },
  option: { minWidth: 48, height: 36, marginLeft: 6, paddingHorizontal: 8, borderRadius: 4,
    backgroundColor: colors.neutral, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: colors.accent },
  optionText: { fontSize: 14, color: colors.text },
  selectedText: { color: colors.onAccent },
});
