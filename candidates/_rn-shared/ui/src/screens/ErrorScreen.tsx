// Error screen (design §8.1): fatal app-level errors only. `mb.error.code` holds the error code.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function ErrorScreen({ code }: { code: string }): React.JSX.Element {
  return (
    <View testID="mb.screen.error" collapsable={false} style={styles.root}>
      <View style={styles.line}>
        <Text style={styles.text}>Error: </Text>
        <Text testID="mb.error.code" style={styles.text}>
          {code}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  line: { flexDirection: 'row' },
  text: { fontSize: 16, color: '#111111' },
});
