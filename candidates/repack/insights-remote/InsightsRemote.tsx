// Exposed module `MbInsights/InsightsView`: the same Insights component as the embedded copy, built into the
// remote container. The host passes its live store, digest observable and probe component as props.
export { InsightsView } from '@mobilebench/rn-ui/screens/InsightsView';

declare const __MB_REMOTE_VERSION__: string;

export const VERSION: string = __MB_REMOTE_VERSION__;
