import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:mobilebench_flutter/domain/fixture.dart';

/// Test helpers. `flutter test` runs with the package root as working directory.
const String assetDir = 'assets/fixtures';
const String goldenPath = '../../fixtures/v1/golden.json';
const List<String> profiles = ['small', 'representative', 'stress'];

Map<String, Object?> golden() => jsonDecode(File(goldenPath).readAsStringSync()) as Map<String, Object?>;

Map<String, Object?> goldenProfile(String profile) =>
    (golden()['profiles'] as Map<String, Object?>)[profile] as Map<String, Object?>;

Uint8List assetBytes(String name) => File('$assetDir/$name').readAsBytesSync();

Fixture fixture(String profile) => Fixture.parse(utf8.decode(assetBytes('$profile.json')));

/// Wire-form update frames of the bundled stream, in order.
List<String> streamLines(String profile) {
  final text = utf8.decode(assetBytes('$profile.stream.jsonl'));
  final lines = text.split('\n');
  return lines.sublist(0, lines.length - 1);
}
