/// Display formatting without locale APIs (fixtures/README.md, "Display formatting").
library;

/// Fixed-point scale of every option value and total (1234 -> "12.34").
const int valueScale = 100;
const int valueMin = 100;
const int valueMax = 9999;
const int optionsPerItem = 3;
const List<String> optionKeys = ['A', 'B', 'C'];

/// `fmt(v) = floor(v / 100) + "." + pad2(v mod 100)`; no thousands separators.
String fmt(int v) {
  final whole = v ~/ valueScale;
  final frac = v % valueScale;
  return '$whole.${frac < 10 ? '0' : ''}$frac';
}

/// Width of the zero-padded item index: max(3, digits(N - 1)).
int labelWidth(int itemCount) {
  final digits = (itemCount - 1).toString().length;
  return digits > 3 ? digits : 3;
}

/// `Item 042` (N = 300) or `Item 0042` (N = 3000).
String itemLabel(int index, int itemCount) => 'Item ${index.toString().padLeft(labelWidth(itemCount), '0')}';

/// Option button text, e.g. `A 12.34`.
String optionText(int option, int value) => '${optionKeys[option]} ${fmt(value)}';
