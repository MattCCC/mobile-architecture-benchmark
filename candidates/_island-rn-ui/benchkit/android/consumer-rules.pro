# Keep the island BenchKit forwarder intact in R8-minified release builds: TurboModule methods are looked up by name
# from C++ (JSI), the probe view manager by its React name, the sink interface by the host embedding.
-keep class org.example.mobilebench.islandbench.** { *; }
