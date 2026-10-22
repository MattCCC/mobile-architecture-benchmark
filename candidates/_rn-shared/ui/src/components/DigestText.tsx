// Checkpoint element `mb.state.digest`: tiny, low-contrast visible text `k=<k>;seq=<n>;d=<12 hex>` (design §8.12),
// updated only at checkpoints.
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useObservable, useSession } from '../app/context';
import { colors } from './theme';

export function DigestText(): React.JSX.Element {
  const session = useSession();
  const text = useObservable(session.digestText);
  return (
    <Text testID="mb.state.digest" style={styles.digest} numberOfLines={1}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  digest: { fontSize: 8, color: colors.digest },
});
