plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("com.android.kotlin.multiplatform.library")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
}
kotlin {
    android {
        namespace = "org.example.mobilebench.kmpapp.shared"
        compileSdk = 37
        minSdk = 24
        withHostTestBuilder {}.configure {}
        compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
    }
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "BenchKmp"
            isStatic = true
            binaryOption("bundleId", "org.example.mobilebench.kmpapp.shared")
        }
    }
    sourceSets {
        commonMain.dependencies {
            implementation("org.jetbrains.compose.runtime:runtime:1.12.2")
            implementation("org.jetbrains.compose.foundation:foundation:1.12.2")
            implementation("org.jetbrains.compose.ui:ui:1.12.2")
            implementation("org.jetbrains.androidx.navigation:navigation-compose:2.10.0-rc01")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
        }
        commonTest.dependencies { implementation(kotlin("test")) }
    }
}


dependencyLocking { lockAllConfigurations() }

// Test-only path; application artifacts never contain a developer's checkout path.
val testPathDir = layout.buildDirectory.dir("generated/testPaths")
val generateTestPaths = tasks.register("generateTestPaths") {
    val candidateRoot = rootProject.projectDir.absolutePath
    inputs.property("candidateRoot", candidateRoot)
    outputs.dir(testPathDir)
    doLast {
        val out = testPathDir.get().file("TestRoot.kt").asFile
        out.parentFile.mkdirs()
        val escaped = candidateRoot.replace("\\", "\\\\").replace("\"", "\\\"")
        out.writeText("package org.example.mobilebench.kmpapp.domain\ninternal const val TEST_ROOT = \"$escaped\"\n")
    }
}
kotlin.sourceSets.commonTest { kotlin.srcDir(generateTestPaths.map { testPathDir.get() }) }
// AGP's KMP lint model does not retain the source-directory provider's task dependency.
tasks.matching { it.name.contains("lint", ignoreCase = true) }.configureEach { dependsOn(generateTestPaths) }
