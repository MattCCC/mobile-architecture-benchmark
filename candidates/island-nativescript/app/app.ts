// Entry of the NativeScript island bundle. The native host starts the runtime (lazily at the first island open, or
// at launch with mb.engine=prewarm); this module only registers the islands with it. No Application.run(): the
// native shell owns the window, navigation and every other screen.
import './islands';
