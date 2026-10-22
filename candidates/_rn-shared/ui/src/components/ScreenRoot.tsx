// Screen root with the `screen` probe (design §6.2/§6.3). The probe token comes from BenchKit core state through
// the session: `nav:<navSeq>` when the route becomes top, `fg:<fgSeq>` after foreground, `restore:<route>:<anchor>`
// for the restored screen. A screen that is not on top keeps its last token, so it emits nothing.
import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Probe } from '../bench/Probe';
import { useObservable, useSession } from '../app/context';
import { colors } from './theme';

export const ROUTE_INDEX = { list: 0, selection: 1, detail: 2, insights: 3, error: 4 } as const;

export interface ScreenRootProps {
  route: string;
  routeKind: keyof typeof ROUTE_INDEX;
  testID: string;
  children: ReactNode;
}

export function ScreenRoot({ route, routeKind, testID, children }: ScreenRootProps): React.JSX.Element {
  const session = useSession();
  // Re-render when the top token changes; the token itself is read from the session's per-screen record.
  useObservable(session.topToken);
  const token = session.tokenFor(route);
  useEffect(() => () => session.forgetScreen(route), [session, route]);
  return (
    <View testID={testID} collapsable={false} style={styles.root}>
      {children}
      <Probe kind="screen" index={ROUTE_INDEX[routeKind]} token={token} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
