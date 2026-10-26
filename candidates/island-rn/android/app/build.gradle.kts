import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val candidateDir = rootDir.resolve("..").canonicalFile
val repoRoot = candidateDir.resolve("../..").canonicalFile
val sharedHost = repoRoot.resolve("candidates/_island-host")
val islandAar = candidateDir.resolve("rn/android/islands/build/outputs/aar/islands-release.aar")
val generatedAssets = sharedHost.resolve("generated/assets")

val keystoreProperties = listOf(
    repoRoot.resolve("out/keys/keystore.properties"),
    sharedHost.resolve("android/.keys/keystore.properties"),
).firstOrNull { it.isFile }

android {
    namespace = "org.example.mobilebench.islandhost"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.example.mobilebench.islandrn"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += "arm64-v8a" }
    }

    signingConfigs {
        if (keystoreProperties != null) {
            create("mbLocal") {
                val props = Properties().apply { keystoreProperties.inputStream().use { load(it) } }
                storeFile = keystoreProperties.parentFile.resolve(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), sharedHost.resolve("android/proguard-rules.pro"))
            if (keystoreProperties != null) signingConfig = signingConfigs.getByName("mbLocal")
        }
    }

    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets {
        getByName("main") {
            manifest.srcFile(sharedHost.resolve("android/src/main/AndroidManifest.xml"))
            java.srcDirs(sharedHost.resolve("android/src/main/java"), "src/main/java")
            res.srcDirs(sharedHost.resolve("android/src/main/res"), "src/main/res")
            assets.srcDir(generatedAssets)
        }
        getByName("test").java.srcDir(sharedHost.resolve("android/src/test/java"))
    }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        disable += listOf("MissingApplicationIcon", "ChromeOsAbiSupport")
    }
    testOptions {
        unitTests.all {
            it.systemProperty("mb.assetsDir", sharedHost.resolve("generated/assets/fixtures").path)
            it.systemProperty("mb.goldenFile", repoRoot.resolve("fixtures/v1/golden.json").path)
        }
    }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    check(islandAar.isFile) { "missing $islandAar; run make package-island-rn-android" }
    implementation(files(islandAar))
    implementation("com.facebook.react:react-android:0.88.0")
    // React Native 0.88 publishes Hermes under its own group and engine version.
    implementation("com.facebook.hermes:hermes-android:260318099.0.4")

    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.navigation:navigation-compose:2.10.2")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
