import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing: a locally generated, non-distribution key. Looked up in
// $MB_KEYSTORE_PROPERTIES or <repo>/out/keys/keystore.properties (gitignored, never committed), with
// the keys storeFile, storePassword, keyAlias, keyPassword. Without it the release build falls back
// to the debug key (the Flutter template default) and prints a warning.
val mbKeystoreProperties: File? = (System.getenv("MB_KEYSTORE_PROPERTIES")?.let { file(it) }
    ?: rootProject.file("../../../out/keys/keystore.properties")).takeIf { it.isFile }

android {
    namespace = "org.example.mobilebench.flutter"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "org.example.mobilebench.flutter"
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (mbKeystoreProperties != null) {
            create("mobilebenchLocal") {
                val p = Properties().apply { mbKeystoreProperties.inputStream().use { load(it) } }
                storeFile = mbKeystoreProperties.parentFile.resolve(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // R8 shrinking and resource shrinking are enabled by the Flutter Gradle plugin for
            // release builds (no override here).
            signingConfig = if (mbKeystoreProperties != null) {
                signingConfigs.getByName("mobilebenchLocal")
            } else {
                logger.warn("mobilebench: no out/keys/keystore.properties; release build signed with the debug key")
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // Baseline-profile installation; Macrobenchmark needs ProfileInstaller >= 1.3.
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
}

flutter {
    source = "../.."
}
