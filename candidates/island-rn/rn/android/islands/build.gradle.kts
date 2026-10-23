// React Native islands packaged as one AAR (brownfield scaffold of @callstack/react-native-brownfield 6.0.1,
// adapted): Hermes bytecode bundle + autolinked native modules (the island BenchKit forwarder), published to the
// candidate-local Maven directory rn/build/maven (never to ~/.m2), consumed by the island host app.
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.callstack.react.brownfield")
    `maven-publish`
    id("com.facebook.react")
}

fun resolveRootProjectInt(name: String): Int {
    val extraProperties = rootProject.extensions.extraProperties
    val value =
        when {
            extraProperties.has(name) -> extraProperties.get(name)
            rootProject.findProperty(name) != null -> rootProject.findProperty(name)
            rootProject.findProperty("android.$name") != null -> rootProject.findProperty("android.$name")
            else -> error("Unable to resolve root project property '$name' for Brownfield Android packaging.")
        }
    return when (value) {
        is Int -> value
        is Number -> value.toInt()
        is String -> value.toInt()
        else -> value.toString().toInt()
    }
}

publishing {
    publications {
        create<MavenPublication>("mavenAar") {
            groupId = "org.example.mobilebench.islandrn"
            artifactId = "islands"
            version = "0.0.1"
            afterEvaluate {
                from(components.getByName("default"))
            }
        }
    }
    repositories {
        maven {
            name = "mbLocal"
            url = uri(rootProject.layout.projectDirectory.dir("../build/maven"))
        }
    }
}

reactBrownfield {
    missingDimensionStrategies = listOf()
}

react {
    autolinkLibrariesWithApp()
}

android {
    namespace = "org.example.mobilebench.islandrn.rn"
    compileSdk = resolveRootProjectInt("compileSdkVersion")

    defaultConfig {
        minSdk = 24

        buildConfigField(
            "boolean",
            "IS_EDGE_TO_EDGE_ENABLED",
            properties["edgeToEdgeEnabled"].toString()
        )
        buildConfigField(
            "boolean",
            "IS_NEW_ARCHITECTURE_ENABLED",
            properties["newArchEnabled"].toString()
        )
        buildConfigField("boolean", "IS_HERMES_ENABLED", properties["hermesEnabled"].toString())

        consumerProguardFiles("consumer-rules.pro")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            // The host app minifies (R8) the whole APK; the library itself is not minified.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    publishing {
        multipleVariants {
            allVariants()
        }
    }
}

dependencies {
    api("com.facebook.react:react-android:0.88.0")
    api("com.facebook.react:hermes-android:0.88.0")
}
