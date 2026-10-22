// Draw probe wrapper (design §6.2): absolutely positioned, so it never changes the normative layout bands.
import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { MobileBenchProbe } from '@mobilebench/rn-benchkit';
import { bench } from './benchkit';

export type ProbeKind = 'row' | 'summary' | 'screen' | 'list' | 'insights';

export interface ProbeProps {
  kind: ProbeKind;
  index: number;
  token: string;
}

export type ProbeComponent = React.ComponentType<ProbeProps>;

export const Probe = memo(function ProbeView({ kind, index, token }: ProbeProps): React.JSX.Element | null {
  if (!bench.native) {
    return null;
  }
  return (
    <MobileBenchProbe
      kind={kind}
      index={index}
      token={token}
      pointerEvents="none"
      style={kind === 'list' ? StyleSheet.absoluteFill : styles.dot}
    />
  );
});

const styles = StyleSheet.create({
  dot: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, backgroundColor: '#FFFFFF' },
});
