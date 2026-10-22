// Root layout (expo-router Stack). Boots the shared benchmark session, reports route changes at transition start,
// rebuilds a restored route stack, and supplies the NavAdapter used by the shared screens.
import { router, Stack, useNavigationContainerRef, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, ErrorScreen, MobileBenchProvider, useBoot } from '@mobilebench/rn-ui';
import type { NavAdapter, Session } from '@mobilebench/rn-ui';

interface RouteLike {
  name: string;
  params?: Record<string, unknown>;
  state?: StateLike;
}

interface StateLike {
  routes?: RouteLike[];
}

function pathToRoute(pathname: string): string {
  if (pathname === '/' || pathname === '') {
    return 'list';
  }
  const detail = /^\/detail\/(\d+)$/.exec(pathname);
  if (detail) {
    return `detail/${detail[1]}`;
  }
  return pathname.replace(/^\//, '');
}

function routeToPath(route: string): string {
  return route === 'list' ? '/' : `/${route}`;
}

function routesFromState(state: StateLike | undefined): string[] {
  let s = state;
  while (s?.routes && s.routes.length === 1 && s.routes[0].state) {
    s = s.routes[0].state;
  }
  const out = (s?.routes ?? []).map((r) => {
    if (r.name === 'index') {
      return 'list';
    }
    if (r.name === 'detail/[i]') {
      return `detail/${String(r.params?.i ?? '0')}`;
    }
    return r.name;
  });
  return out.length > 0 ? out : ['list'];
}

function Ready({ session }: { session: Session }): React.JSX.Element {
  const pathname = usePathname();
  const navigationRef = useNavigationContainerRef();

  const nav = useMemo<NavAdapter>(
    () => ({
      openSelection: () => router.push('/selection'),
      openDetail: (i: number) => router.push(`/detail/${i}`),
      openInsights: () => router.push('/insights'),
      back: () => router.back(),
      routes: () => routesFromState(navigationRef.getRootState() as unknown as StateLike | undefined),
    }),
    [navigationRef],
  );

  // navSeq increments when a destination becomes the top route (push and pop).
  useLayoutEffect(() => {
    session.routeChanged(pathToRoute(pathname));
  }, [session, pathname]);

  // Restoration: rebuild the restored stack above the List (the List is the stack root).
  useEffect(() => {
    const plan = session.startupPlan;
    if (plan.restored) {
      for (const route of plan.routes.slice(1)) {
        router.push(routeToPath(route));
      }
    }
  }, [session]);

  return (
    <MobileBenchProvider session={session} nav={nav}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="selection" options={{ title: 'Selection' }} />
        <Stack.Screen name="detail/[i]" options={{ title: 'Detail' }} />
        <Stack.Screen name="insights" options={{ title: 'Insights' }} />
      </Stack>
    </MobileBenchProvider>
  );
}

export default function RootLayout(): React.JSX.Element | null {
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
