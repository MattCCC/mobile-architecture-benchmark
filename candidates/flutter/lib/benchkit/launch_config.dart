/// Launch configuration. Android: Intent extras `mb.<key>`, forwarded by MainActivity
/// as Dart entry-point arguments `-mb.<key> <value>`; iOS: launch arguments `-mb.<key> <value>`.
class LaunchConfig {
  LaunchConfig._(this.values, this.invalidKeys, this.unknownKeys, this.androidFilesDir, this.savedState);

  static const String defaultProfile = 'representative';

  static final Map<String, RegExp> _known = {
    'mb.journey': RegExp(r'^[A-Za-z0-9._-]{1,64}$'),
    'mb.profile': RegExp(r'^(small|representative|stress)$'),
    'mb.server': RegExp(r'^(wss?|https?)://\S+$'),
    'mb.session': RegExp(r'^[A-Za-z0-9._-]{1,64}$'),
    'mb.token': RegExp(r'^[0-9a-f]{32}$'),
    'mb.dataset': RegExp(r'^(embedded|network)$'),
    'mb.restore': RegExp(r'^[01]$'),
    'mb.remote': RegExp(r'^(embedded|remote)$'),
    'mb.clearModuleCache': RegExp(r'^[01]$'),
    'mb.journeyMode': RegExp(r'^[01]$'),
    'mb.bridgeBench': RegExp(r'^(0|sync|async)$'),
    'mb.markerMirror': RegExp(r'^(control|all)$'),
    'mb.layoutProbe': RegExp(r'^[01]$'),
    'mb.semantics': RegExp(r'^(auto|on)$'),
  };

  static const String _filesDirArg = '--mb-internal-files-dir=';
  static const String _savedStateArg = '--mb-internal-saved-state=';

  /// Valid values of known keys.
  final Map<String, String> values;

  /// Known keys whose value was invalid (the default is used instead).
  final List<String> invalidKeys;

  /// `mb.*` keys this candidate does not know (ignored).
  final List<String> unknownKeys;

  /// Android only: `Context.getFilesDir()`, passed by MainActivity.
  final String? androidFilesDir;

  /// Android only: 1 when the platform passed saved instance state to the activity.
  final int? savedState;

  String get journeyId => values['mb.journey'] ?? '-';
  String get profile => values['mb.profile'] ?? defaultProfile;
  bool get restore => values['mb.restore'] == '1';
  bool get mirrorAll => values['mb.markerMirror'] == 'all';
  bool get semanticsOn => values['mb.semantics'] == 'on';
  bool get journeyMode => values['mb.journeyMode'] == '1';

  /// Parses `-mb.<key> <value>` pairs and MainActivity's internal arguments; ignores anything else.
  static LaunchConfig parse(List<String> args) {
    final values = <String, String>{};
    final invalid = <String>[];
    final unknown = <String>[];
    String? filesDir;
    int? savedState;
    var k = 0;
    while (k < args.length) {
      final a = args[k];
      if (a.startsWith(_filesDirArg)) {
        filesDir = a.substring(_filesDirArg.length);
        k++;
      } else if (a.startsWith(_savedStateArg)) {
        savedState = a.substring(_savedStateArg.length) == '1' ? 1 : 0;
        k++;
      } else if (a.startsWith('-mb.') && k + 1 < args.length) {
        final key = a.substring(1);
        final value = args[k + 1];
        final pattern = _known[key];
        if (pattern == null) {
          unknown.add(key);
        } else if (pattern.hasMatch(value)) {
          values[key] = value;
        } else {
          invalid.add(key);
        }
        k += 2;
      } else {
        k++;
      }
    }
    return LaunchConfig._(
      Map.unmodifiable(values),
      List.unmodifiable(invalid),
      List.unmodifiable(unknown),
      filesDir,
      savedState,
    );
  }
}
