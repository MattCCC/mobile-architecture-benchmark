import 'package:flutter/material.dart';

/// Visual specification: light theme, system font, one accent colour, no images,
/// shadows, gradients or custom fonts.
abstract final class Style {
  static const Color background = Color(0xFFFFFFFF);
  static const Color text = Color(0xFF1F1F1F);
  static const Color secondaryText = Color(0xFF5F5F5F);
  static const Color neutral = Color(0xFFE6E6E6);
  static const Color accent = Color(0xFF2F6FEB);
  static const Color onAccent = Color(0xFFFFFFFF);
  static const Color lowContrast = Color(0xFFB8B8B8);

  static const double headerHeight = 56;
  static const double statusRowHeight = 32;
  static const double summaryHeight = 48;
  static const double rowHeight = 72;

  static ThemeData theme() => ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: const ColorScheme.light(primary: accent, surface: background),
    scaffoldBackgroundColor: background,
    // No ink effects: touch feedback is not part of the specification (equal visual work).
    splashFactory: NoSplash.splashFactory,
    highlightColor: Colors.transparent,
    appBarTheme: const AppBarTheme(
      backgroundColor: background,
      foregroundColor: text,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      toolbarHeight: headerHeight,
    ),
  );
}

/// Neutral button: minimum 48 x 36 dp, grey, or accent with white text when [selected].
class PlainButton extends StatelessWidget {
  const PlainButton({super.key, required this.label, required this.onTap, this.selected = false});

  final String label;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minWidth: 48, minHeight: 36),
        padding: const EdgeInsets.symmetric(horizontal: 8),
        alignment: Alignment.center,
        color: selected ? Style.accent : Style.neutral,
        child: Text(label, style: TextStyle(fontSize: 14, color: selected ? Style.onAccent : Style.text)),
      ),
    );
  }
}

/// Wraps [child] in its own semantics node with an accessibility identifier (Android resource-id,
/// iOS accessibilityIdentifier).
class Id extends StatelessWidget {
  const Id(this.id, {super.key, required this.child, this.button = false, this.selected});

  final String id;
  final Widget child;
  final bool button;
  final bool? selected;

  @override
  Widget build(BuildContext context) {
    return Semantics(identifier: id, container: true, button: button ? true : null, selected: selected, child: child);
  }
}

/// App bar of the pushed screens; the back control carries `mb.nav.back`.
PreferredSizeWidget benchAppBar(String title) {
  return AppBar(
    title: Text(title),
    leading: const Id('mb.nav.back', child: BackButton()),
  );
}
