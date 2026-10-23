/**
 * Entry of the island bundle (one React Native runtime for both islands). Host messages arrive through Brownfield
 * messaging (`postMessage` on the native side, delivered as `onMessage` here); markers and draw probes go to the
 * host's marker core through the island BenchKit forwarder (`@mobilebench/rn-benchkit`).
 */
import ReactNativeBrownfield from '@callstack/react-native-brownfield';
import { registerIslands } from '@mobilebench/island-ui/islands';
import { BUILD_PROBE } from './BuildProbe';

registerIslands(
  {
    subscribe: (receive) => {
      ReactNativeBrownfield.onMessage((event) => receive(event.data));
    },
    post: (message) => ReactNativeBrownfield.postMessage(message),
  },
  BUILD_PROBE,
);
