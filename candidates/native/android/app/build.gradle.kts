import java.security.MessageDigest
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Layout: <repo>/candidates/native/android/app
val mbCandidateDir: File = rootDir.resolve("..").canonicalFile
val mbRepoRoot: File = mbCandidateDir.resolve("../..").canonicalFile
// Written by `node candidates/native/tools/prepare-assets.mjs` (make prepare-native); gitignored.
val mbGeneratedAssets: File = mbCandidateDir.resolve("generated/assets/fixtures")
val mbGolden: File = mbRepoRoot.resolve("fixtures/v1/golden.json")

/**
 * Verifies the bundled fixture and stream bytes against fixtures/v1/golden.json and copies them
 * into the APK assets (assets/fixtures/). Fails the build if a file is missing or differs.
 */
abstract class VerifyBenchAssets : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sourceDir: ConfigurableFileCollection

    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val goldenFile: RegularFileProperty

    @get:Internal
    abstract val sourceRoot: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun run() {
        val src = sourceRoot.get().asFile
        if (!src.isDirectory) {
            throw GradleException(
                "Bundled fixtures missing in $src. Run `make prepare-native` " +
                    "(node candidates/native/tools/prepare-assets.mjs) from the repository root first.",
            )
        }
        @Suppress("UNCHECKED_CAST")
        val golden = groovy.json.JsonSlurper().parse(goldenFile.get().asFile) as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val profiles = golden["profiles"] as Map<String, Map<String, Any?>>
        val out = outputDir.get().asFile.resolve("fixtures")
        outputDir.get().asFile.deleteRecursively()
        out.mkdirs()
        profiles.forEach { (name, p) ->
            @Suppress("UNCHECKED_CAST")
            val stream = p["stream"] as Map<String, Any?>
            listOf("$name.json" to p["sha256"] as String, "stream-$name.jsonl" to stream["sha256"] as String)
                .forEach { (file, expected) ->
                    val f = src.resolve(file)
                    if (!f.isFile) {
                        throw GradleException("missing bundled file $f (run make prepare-native)")
                    }
                    val actual = MessageDigest.getInstance("SHA-256").digest(f.readBytes())
                        .joinToString("") { b -> "%02x".format(b.toInt() and 0xff) }
                    if (actual != expected) {
                        throw GradleException("$file: sha256 $actual != golden.json $expected")
                    }
                    f.copyTo(out.resolve(file), overwrite = true)
                }
        }
    }
}

val verifyBenchAssets = tasks.register<VerifyBenchAssets>("verifyBenchAssets") {
    sourceRoot.set(mbGeneratedAssets)
    sourceDir.from(mbGeneratedAssets)
    goldenFile.set(mbGolden)
    outputDir.set(layout.buildDirectory.dir("generated/mbassets"))
}

// Release signing: the repository-wide local key (`make keystore` -> out/keys/keystore.properties),
// an explicit MB_KEYSTORE_PROPERTIES file, or this candidate's local key (make keystore-native).
// Keys are never committed. Without a key the release APK is unsigned.
val mbKeystoreProperties: File? = listOfNotNull(
    providers.environmentVariable("MB_KEYSTORE_PROPERTIES").orNull?.let { File(it) },
    mbRepoRoot.resolve("out/keys/keystore.properties"),
    rootDir.resolve(".keys/keystore.properties"),
).firstOrNull { it.isFile }

android {
    namespace = "org.example.mobilebench.nativeapp"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.example.mobilebench.nativeapp"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        // arm64-v8a-only measurement builds (design §13.1). The only native library in the APK comes from
        // androidx.graphics:graphics-path (a Compose dependency); it is packaged for arm64-v8a only.
        ndk { abiFilters += "arm64-v8a" }
    }

    signingConfigs {
        if (mbKeystoreProperties != null) {
            create("mbLocal") {
                val props = Properties().apply { mbKeystoreProperties.inputStream().use { load(it) } }
                storeFile = mbKeystoreProperties.parentFile.resolve(props.getProperty("storeFile"))
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
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (mbKeystoreProperties != null) {
                signingConfig = signingConfigs.getByName("mbLocal")
            }
        }
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // The launcher icon is the framework default on purpose (design §13.2: no icons).
        disable += "MissingApplicationIcon"
        // Measurement builds are arm64-v8a only (design §13.1); the APK has no native code anyway.
        disable += "ChromeOsAbiSupport"
    }

    testOptions {
        unitTests.all {
            it.systemProperty("mb.assetsDir", mbGeneratedAssets.path)
            it.systemProperty("mb.goldenFile", mbGolden.path)
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(verifyBenchAssets, VerifyBenchAssets::outputDir)
    }
}

dependencyLocking {
    lockAllConfigurations()
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.navigation:navigation-compose:2.10.2")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")

    testImplementation("junit:junit:4.13.2")
    // Real org.json for JVM unit tests (the Android platform provides it at run time).
    testImplementation("org.json:json:20260814")
}
