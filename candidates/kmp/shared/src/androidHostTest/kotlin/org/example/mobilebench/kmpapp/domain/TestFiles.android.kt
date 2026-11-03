package org.example.mobilebench.kmpapp.domain
import java.io.File
internal actual fun readTestFile(path: String): String = File(TEST_ROOT, path).readText()
