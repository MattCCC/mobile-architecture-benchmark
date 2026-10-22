// Fabric draw probe (design §6.2): a 1 x 1 dp/pt opaque native view painted white (the parent background). Its
// draw callback reports (kind, index, token) to the BenchKit core, which runs the FUI gate and emits `resp`,
// `screen`, `resume`, `restore` and `remote.ready` when the token differs from the last emitted one. On a token
// change the native view requests a redraw (`invalidate()` / `setNeedsDisplay`). Kind `list` draws nothing and
// reports the list container height from native layout instead.
import type { CodegenTypes, HostComponent, ViewProps } from 'react-native';
import { codegenNativeComponent } from 'react-native';

export interface NativeProps extends ViewProps {
  kind: string;
  index: CodegenTypes.Int32;
  token: string;
}

export default codegenNativeComponent<NativeProps>('MobileBenchProbe') as HostComponent<NativeProps>;
