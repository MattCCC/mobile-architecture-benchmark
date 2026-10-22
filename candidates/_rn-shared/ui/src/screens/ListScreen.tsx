// List screen (design §8.1, §8.2): normative bands top inset | header 56 | status chip row 32 | summary bar 48 |
// list container | bottom inset. The framework-provided FlatList (K8) renders every item; the list probe reports
// the container height to the FUI gate at native layout.
import React, { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent, ListRenderItem, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../app/context';
import { labelWidth as labelWidthFor } from '../domain/format';
import { bench } from '../bench/benchkit';
import { Probe } from '../bench/Probe';
import { Row } from '../components/Row';
import { Header, StatusRow, SummaryBar } from '../components/ListHeader';
import { ScreenRoot } from '../components/ScreenRoot';
import { bands, colors } from '../components/theme';

const keyExtractor = (i: number): string => `item-${i}`;

const getItemLayout = (_data: ArrayLike<number> | null | undefined, index: number) => ({
  length: bands.row,
  offset: bands.row * index,
  index,
});

export function ListScreen(): React.JSX.Element {
  const session = useSession();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const count = session.store.itemCount;
  const width = labelWidthFor(count);
  const data = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  // RN idiom (design §8.4): render enough rows in the first batch to fill the viewport.
  const initialNumToRender = Math.ceil(windowHeight / bands.row);
  const anchor = session.startupPlan.anchor;

  const renderItem: ListRenderItem<number> = useCallback(({ item }) => <Row index={item} labelWidth={width} />, [width]);

  const onListLayout = useCallback((e: LayoutChangeEvent) => {
    bench.listLayoutFallback(e.nativeEvent.layout.height);
  }, []);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      session.setAnchor(Math.round(e.nativeEvent.contentOffset.y / bands.row));
      bench.mark('scroll.idle', '');
    },
    [session],
  );

  const onDragEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const v = e.nativeEvent.velocity;
      session.setAnchor(Math.round(e.nativeEvent.contentOffset.y / bands.row));
      if (v === undefined || Math.abs(v.y) < 0.01) {
        bench.mark('scroll.idle', '');
      }
    },
    [session],
  );

  return (
    <ScreenRoot route="list" routeKind="list" testID="mb.screen.list">
      <View style={{ height: insets.top }} />
      <Header />
      <StatusRow />
      <SummaryBar />
      <View style={styles.listBox} onLayout={bench.native ? undefined : onListLayout}>
        <Probe kind="list" index={0} token="" />
        <FlatList
          testID="mb.list"
          data={data}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          initialNumToRender={initialNumToRender}
          initialScrollIndex={anchor > 0 ? anchor : undefined}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={onDragEnd}
          style={styles.list}
        />
      </View>
      <View style={{ height: insets.bottom }} />
    </ScreenRoot>
  );
}

const styles = StyleSheet.create({
  listBox: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1, backgroundColor: colors.background },
});
