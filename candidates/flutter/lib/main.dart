import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'app.dart';
import 'app_controller.dart';
import 'benchkit/backend_ffi.dart';
import 'benchkit/benchkit.dart';
import 'benchkit/launch_config.dart';
import 'domain/fixture.dart';
import 'domain/restore_record.dart';
import 'domain/store.dart';
import 'stream/replay_source.dart';

/// `--dart-define=MB_BENCHKIT=noop` builds the instrumentation-overhead variant.
const bool kBenchKitNoop = String.fromEnvironment('MB_BENCHKIT') == 'noop';

/// Update rate per profile (messages per second), from fixtures/generator/profiles.json.
const Map<String, int> kProfileRates = {'small': 5, 'representative': 20, 'stress': 100};

/// Keeps the semantics tree alive when `mb.semantics=on`.
SemanticsHandle? semanticsHandle;

/// Startup sequence: launch configuration, embedded fixture (parsed at run time),
/// optional restoration record, then the List screen with the full state in the first frame. The
/// update stream connects only after the first usable UI.
Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = LaunchConfig.parse([...args, if (Platform.isIOS) ...iosProcessArguments()]);
  final bench = BenchKit(
    backend: createPlatformBackend(noop: kBenchKitNoop),
    journeyId: config.journeyId,
    mirrorAll: config.mirrorAll,
    enabled: !kBenchKitNoop,
  );
  final anchor = bench.backend.nativePayload('proc.anchor');
  if (anchor != null) {
    bench.mark('proc.anchor', anchor);
  }
  if (config.semanticsOn) {
    semanticsHandle = SemanticsBinding.instance.ensureSemantics();
  }
  if (config.savedState != null) {
    bench.mark('launch', 'ss=${config.savedState}');
  }
  if (config.invalidKeys.isNotEmpty) {
    bench.mark('err', 'code=launch-config-invalid');
  }
  if (config.unknownKeys.isNotEmpty) {
    bench.mark('err', 'code=launch-config-unknown');
  }
  FlutterError.onError = (details) {
    bench.mark('err', 'code=unexpected-exception');
    FlutterError.presentError(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    bench.mark('err', 'code=unexpected-exception');
    return false;
  };

  final Fixture fixture;
  try {
    fixture = Fixture.parse(utf8.decode(await _asset('assets/fixtures/${config.profile}.json')));
  } on Object {
    bench.mark('err', 'code=fixture-invalid');
    runApp(const ErrorApp(code: 'fixture-invalid'));
    return;
  }

  final restoreStore = RestoreStore(platformAppDataDir(androidFilesDir: config.androidFilesDir));
  RestoreRecord? record;
  if (config.restore) {
    try {
      record = restoreStore.read(itemCount: fixture.itemCount);
    } on Object {
      record = null;
    }
    if (record == null) {
      bench.mark('err', 'code=persist-read');
    }
  }

  final store = record == null
      ? AppStore.fromFixture(fixture)
      : AppStore.restored(fixture, record.values, record.selection, record.lastSeq);
  final source = ReplayFrameSource(
    profile: fixture.profile,
    seed: fixture.seed,
    rate: kProfileRates[fixture.profile] ?? 20,
    load: () => _asset('assets/fixtures/${fixture.profile}.stream.jsonl'),
  );
  final controller = AppController(
    bench: bench,
    store: store,
    source: source,
    restoreStore: restoreStore,
    initialRoutes: record?.route ?? const [Routes.list],
    initialAnchor: record?.anchor ?? 0,
    restored: record != null,
  );
  runApp(BenchApp(controller: controller));
}

/// Loads an asset's bytes without the isolate hop `rootBundle.loadString` uses for large assets.
Future<Uint8List> _asset(String key) async {
  final data = await rootBundle.load(key);
  return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
}
