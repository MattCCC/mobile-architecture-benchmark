// Insights host screen. Embedded mode (every candidate, mechanism R1): the Insights code is in the installed
// artifact. Hosts with a remote mechanism pass `remoteView` (a loaded component) or render their own loader and
// reuse <InsightsFrame> for the markers and the screen root.
import React, { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSession } from '../app/context';
import { bench } from '../bench/benchkit';
import { Probe } from '../bench/Probe';
import { ScreenRoot } from '../components/ScreenRoot';
import { InsightsView } from './InsightsView';
import type { InsightsSourceKind } from './InsightsView';

let openCounter = 0;

/** Screen root + visibility bookkeeping (the digest element is updated at checkpoints while shown). */
export function InsightsFrame({ children }: { children: ReactNode }): React.JSX.Element {
  const session = useSession();
  useEffect(() => {
    session.insightsVisible(true);
    return () => session.insightsVisible(false);
  }, [session]);
  return (
    <ScreenRoot route="insights" routeKind="insights" testID="mb.screen.insights">
      {children}
    </ScreenRoot>
  );
}

/** Allocates the per-open sequence and emits `remote.request` once per open. */
export function useInsightsOpen(): number {
  const [openSeq] = useState(() => {
    openCounter += 1;
    bench.mark('remote.request', '');
    return openCounter;
  });
  return openSeq;
}

export function EmbeddedInsights({ source, openSeq }: { source: InsightsSourceKind; openSeq: number }): React.JSX.Element {
  const session = useSession();
  return (
    <InsightsView
      store={session.store}
      digest={session.insightsDigest}
      source={source}
      version="1"
      openSeq={openSeq}
      Probe={Probe}
    />
  );
}

/** Embedded-only Insights screen (candidates without a remote mechanism). */
export function InsightsScreen(): React.JSX.Element {
  const openSeq = useInsightsOpen();
  useState(() => {
    bench.mark('remote.source', 'src=embedded');
    return true;
  });
  return (
    <InsightsFrame>
      <EmbeddedInsights source="embedded" openSeq={openSeq} />
    </InsightsFrame>
  );
}
