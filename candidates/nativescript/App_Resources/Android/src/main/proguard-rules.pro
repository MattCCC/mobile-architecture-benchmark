# R8 keep rules for the NativeScript Android runtime (benchmark, design §13.1).
# JavaScript reaches Java classes by name at run time through the runtime's metadata, which R8 cannot see.
# The rules keep every class the metadata may expose and disable renaming; R8 still optimizes and removes
# classes outside these packages that nothing references.
-dontobfuscate
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions

# Runtime, generated JavaScript-to-Java bindings and widgets
-keep class com.tns.** { *; }
-keep interface com.tns.** { *; }
-keep class org.nativescript.** { *; }
-keep interface org.nativescript.** { *; }

# Libraries @nativescript/core uses from JavaScript
-keep class androidx.** { *; }
-keep interface androidx.** { *; }
-keep class com.google.android.material.** { *; }
-keep interface com.google.android.material.** { *; }
-keep class kotlin.** { *; }
-keep interface kotlin.** { *; }
