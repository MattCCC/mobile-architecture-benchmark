# Keep the BenchKit wrapper intact in R8-minified release builds: TurboModule methods are looked up by name from
# C++ (JSI), the probe view manager by its React name, the init provider by the merged manifest.
-keep class org.example.mobilebench.benchkit.** { *; }
