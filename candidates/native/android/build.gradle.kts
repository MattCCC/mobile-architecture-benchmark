// Fully native Android candidate: Kotlin + Jetpack Compose.
// Versions are pinned exactly; resolved versions are recorded in the Gradle lockfiles
// (buildscript-gradle.lockfile, app/gradle.lockfile).

buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // AGP 9 compiles Kotlin itself ("built-in Kotlin"); this pins the Kotlin Gradle plugin it uses.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
    configurations.classpath {
        resolutionStrategy.activateDependencyLocking()
    }
}

plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
}
