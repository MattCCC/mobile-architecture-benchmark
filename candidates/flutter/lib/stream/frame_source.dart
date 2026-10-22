/// Transport of the update stream: delivers wire-form text frames, starting with a
/// hello frame, then update frames from `from`, plus checkpoint / resume / end frames.
///
/// Implementations: [ReplayFrameSource] (default, in-app replay of the bundled stream bytes on a
/// monotonic schedule). A WebSocket implementation for the local server (`mb.server`) implements
/// the same interface; the protocol rules live in StreamClient, so they are shared.
abstract interface class FrameSource {
  /// Opens a connection. [onOpen] fires once the connection is established (socket open), then
  /// [onFrame] for every text frame, and [onClosed] once if the connection ends for any reason
  /// other than [close].
  void open({
    required int from,
    required void Function() onOpen,
    required void Function(String frame) onFrame,
    required void Function(String why) onClosed,
  });

  /// Closes the current connection; no callback follows.
  void close();
}
