@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package org.example.mobilebench.kmpapp

import androidx.compose.ui.Modifier
import androidx.compose.ui.window.ComposeUIViewController
import kotlinx.cinterop.*
import platform.Foundation.*
import platform.UIKit.UIViewController
import platform.posix.*
import platform.darwin.*
import org.example.mobilebench.kmpapp.ui.AppRoot
import org.example.mobilebench.kmpapp.ui.ErrorScreen

actual fun Modifier.resourceTags(): Modifier = this
fun mainViewController(): UIViewController = ComposeUIViewController {
    val store = AppRuntime.store
    if (store == null) ErrorScreen(AppRuntime.fatalError ?: "unexpected-exception") else AppRoot(store)
}

class IosHost(private val sink: (String, String) -> Unit) : HostServices {
    private fun assetPath(name: String) = "${NSBundle.mainBundle.resourcePath}/fixtures/$name"
    private fun recordPath(): String {
        val base = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, true).first() as String
        val dir = "$base/mobilebench"
        check(NSFileManager.defaultManager.createDirectoryAtPath(dir, true, null, null))
        return "$dir/restore-v2.json"
    }
    private fun read(path: String): String {
        val reader = FileReader(path)
        return try { buildString { while (true) append(reader.next() ?: break) } } finally { reader.close() }
    }
    override fun asset(name: String) = read(assetPath(name))
    override fun replay(name: String): ReplayReader = FileReader(assetPath(name))
    override fun readRecord() = read(recordPath())
    override fun writeRecord(text: String) {
        val target = recordPath()
        val tmp = "$target.tmp"
        val file = fopen(tmp, "wb") ?: error("open restore")
        val bytes = text.encodeToByteArray()
        try {
            bytes.usePinned { check(fwrite(it.addressOf(0), 1u, bytes.size.toULong(), file) == bytes.size.toULong()) }
            check(fflush(file) == 0)
        } finally { fclose(file) }
        check(rename(tmp, target) == 0)
    }
    override fun nowNanos(): Long = clock_gettime_nsec_np(CLOCK_UPTIME_RAW.toUInt()).toLong()
    override fun event(name: String, payload: String) = sink(name, payload)
}

private class FileReader(path: String) : ReplayReader {
    private val file = fopen(path, "rb") ?: error("open $path")
    private val buffer = ByteArray(8192)
    override fun next(): String? = buffer.usePinned { pinned ->
        val line = StringBuilder()
        while (true) {
            val result = fgets(pinned.addressOf(0), buffer.size, file)
            if (result == null) {
                check(ferror(file) == 0) { "read failed" }
                return@usePinned if (line.isEmpty()) null else line.toString()
            }
            val chunk = result.toKString()
            line.append(chunk)
            if (chunk.endsWith('\n')) return@usePinned line.toString()
        }
        @Suppress("UNREACHABLE_CODE") null
    }
    override fun close() { fclose(file) }
}
