// Island roots and registration for React Native island runtimes. One runtime may render several island instances
// (Detail and Insights share one engine in `island-rn`); each root receives its `init` message as the initial prop
// `init` (JSON text) and gets later messages through the runtime's host channel, routed by `sid`.
import React, { Component, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AppRegistry } from 'react-native';
import { bench } from '@mobilebench/rn-ui/bench/benchkit';
import { ErrorScreen } from '@mobilebench/rn-ui/screens/ErrorScreen';
import { IslandRegistry } from './model';
import type { IslandModel } from './model';
import type { IslandKindName, IslandMessage } from './protocol';
import { DetailIsland } from './DetailIsland';
import { InsightsIsland } from './InsightsIsland';

/** The host channel of one runtime (Brownfield messaging in `island-rn`). */
export interface IslandChannel {
  /** Registers the receiver of host messages (objects or JSON texts). */
  subscribe(receive: (message: unknown) => void): void;
  /** Sends one island message to the host. */
  post(message: IslandMessage): void;
}

export interface IslandRootProps {
  init?: string;
}

class IslandBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    bench.mark('err', 'code=unexpected-exception');
  }

  render(): ReactNode {
    return this.state.failed ? <ErrorScreen code="unexpected-exception" /> : this.props.children;
  }
}

function makeRoot(
  kind: IslandKindName,
  registry: IslandRegistry,
  channel: IslandChannel,
  buildProbe: string,
): React.ComponentType<IslandRootProps> {
  return function IslandRoot({ init }: IslandRootProps): React.JSX.Element {
    const [model] = useState<IslandModel | null>(() => {
      const m = registry.adopt(init ?? null);
      if (m === null || m.kind !== kind) {
        bench.mark('err', 'code=unexpected-exception');
        return null;
      }
      return m;
    });
    useEffect(() => {
      if (model === null) {
        return undefined;
      }
      // Anything the host sent while this runtime was still loading is replaced by the `snap` answer.
      channel.post({ t: 'ready', sid: model.sid });
      return () => registry.remove(model.sid);
    }, [model]);
    if (model === null) {
      return <ErrorScreen code="unexpected-exception" />;
    }
    return (
      <IslandBoundary>
        {kind === 'detail' ? <DetailIsland model={model} buildProbe={buildProbe} /> : <InsightsIsland model={model} />}
      </IslandBoundary>
    );
  };
}

/** Registers `MBDetailIsland` and `MBInsightsIsland` and connects the host channel. Call once per runtime. */
export function registerIslands(channel: IslandChannel, buildProbe: string): IslandRegistry {
  const registry = new IslandRegistry(bench);
  channel.subscribe((message) => registry.dispatch(message));
  const detail = makeRoot('detail', registry, channel, buildProbe);
  const insights = makeRoot('insights', registry, channel, buildProbe);
  AppRegistry.registerComponent('MBDetailIsland', () => detail);
  AppRegistry.registerComponent('MBInsightsIsland', () => insights);
  return registry;
}
