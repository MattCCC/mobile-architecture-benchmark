@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package org.example.mobilebench.kmpapp.domain
import kotlinx.cinterop.*
import platform.posix.*
internal actual fun readTestFile(path: String): String {
    val file = fopen("$TEST_ROOT/$path", "rb") ?: error("missing test file $path")
    try {
        val buffer = ByteArray(8192)
        return buildString {
            buffer.usePinned { pinned ->
                while (true) {
                    val line = fgets(pinned.addressOf(0), buffer.size, file) ?: break
                    append(line.toKString())
                }
                check(ferror(file) == 0)
            }
        }
    } finally { fclose(file) }
}
