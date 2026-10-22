import 'package:flutter/material.dart';

import 'style.dart';

/// Error screen (route `error`), shown only for fatal app-level errors (e.g. an invalid fixture).
class ErrorScreen extends StatelessWidget {
  const ErrorScreen({super.key, required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(fontSize: 16, color: Style.text);
    return Scaffold(
      body: SafeArea(
        child: Id(
          'mb.screen.error',
          child: Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Error: ', style: style),
                Id('mb.error.code', child: Text(code, style: style)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
