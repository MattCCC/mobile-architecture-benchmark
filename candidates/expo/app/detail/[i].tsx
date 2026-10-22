import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DetailScreen } from '@mobilebench/rn-ui';
import { BUILD_PROBE } from '../../BuildProbe';

export default function Detail(): React.JSX.Element {
  const { i } = useLocalSearchParams<{ i: string }>();
  return <DetailScreen index={Number(i)} buildProbe={BUILD_PROBE} />;
}
