// Host app of the `repack` candidate: React Navigation native-stack around the shared RN UI.
import React, { useCallback, useMemo } from 'react';
import { StatusBar } from 'react-native';
import { DefaultTheme, NavigationContainer, StackActions, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NavigationState, PartialState } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  colors,
  DetailScreen,
  ErrorScreen,
  ListScreen,
  MobileBenchProvider,
  SelectionScreen,
  useBoot,
} from '@mobilebench/rn-ui';
import type { NavAdapter, Session } from '@mobilebench/rn-ui';
import { InsightsRoute } from './InsightsRoute';
import { BUILD_PROBE } from './BuildProbe';

type RootStack = {
  List: undefined;
  Selection: undefined;
  Detail: { i: number };
  Insights: undefined;
};

const Stack = createNativeStackNavigator<RootStack>();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background, card: colors.background, text: colors.text },
};

interface RouteLike {
  name: string;
  params?: { i?: number } | object;
}

function toRoute(r: RouteLike): string {
  switch (r.name) {
    case 'List':
      return 'list';
    case 'Selection':
      return 'selection';
    case 'Insights':
      return 'insights';
    case 'Detail':
      return `detail/${String((r.params as { i?: number } | undefined)?.i ?? 0)}`;
    default:
      return r.name.toLowerCase();
  }
}

function fromRoute(route: string): RouteLike {
  if (route === 'list') {
    return { name: 'List' };
  }
  if (route === 'selection') {
    return { name: 'Selection' };
  }
  if (route === 'insights') {
    return { name: 'Insights' };
  }
  return { name: 'Detail', params: { i: Number(route.split('/')[1]) } };
}

function DetailRoute({ route }: NativeStackScreenProps<RootStack, 'Detail'>): React.JSX.Element {
  return <DetailScreen index={route.params.i} buildProbe={BUILD_PROBE} />;
}

function Ready({ session }: { session: Session }): React.JSX.Element {
  const navRef = useNavigationContainerRef<RootStack>();

  const nav = useMemo<NavAdapter>(
    () => ({
      openSelection: () => navRef.dispatch(StackActions.push('Selection')),
      openDetail: (i: number) => navRef.dispatch(StackActions.push('Detail', { i })),
      openInsights: () => navRef.dispatch(StackActions.push('Insights')),
      back: () => navRef.goBack(),
      routes: () => {
        const state = navRef.getRootState();
        return state ? state.routes.map(toRoute) : ['list'];
      },
    }),
    [navRef],
  );

  // A restored stack is rebuilt as the navigator's initial state (values, selection and anchor are already applied).
  const [initialState] = React.useState<PartialState<NavigationState> | undefined>(() => {
    const plan = session.startupPlan;
    if (!plan.restored) {
      return undefined;
    }
    return { routes: plan.routes.map(fromRoute) } as PartialState<NavigationState>;
  });

  // navSeq increments when a destination becomes the top route (state change at transition start).
  const report = useCallback(() => {
    const current = navRef.getCurrentRoute();
    if (current) {
      session.routeChanged(toRoute(current));
    }
  }, [navRef, session]);

  return (
    <MobileBenchProvider session={session} nav={nav}>
      <NavigationContainer ref={navRef} theme={theme} initialState={initialState} onReady={report} onStateChange={report}>
        <StatusBar barStyle="dark-content" />
        <Stack.Navigator
          screenOptions={{
            contentStyle: { backgroundColor: colors.background },
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        >
          <Stack.Screen name="List" component={ListScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Selection" component={SelectionScreen} options={{ title: 'Selection' }} />
          <Stack.Screen name="Detail" component={DetailRoute} options={{ title: 'Detail' }} />
          <Stack.Screen name="Insights" component={InsightsRoute} options={{ title: 'Insights' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </MobileBenchProvider>
  );
}

export default function App(): React.JSX.Element | null {
  const boot = useBoot();
  if (boot.kind === 'error') {
    return <ErrorScreen code={boot.code} />;
  }
  if (boot.kind === 'pending') {
    return null;
  }
  return (
    <SafeAreaProvider>
      <Ready session={boot.session} />
    </SafeAreaProvider>
  );
}
