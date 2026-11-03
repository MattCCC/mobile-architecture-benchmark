@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package org.example.mobilebench.kmpapp.domain
import kotlinx.cinterop.*
import platform.CoreCrypto.CC_SHA256
internal actual fun sha256Hex(text: String): String {
    val bytes = text.encodeToByteArray()
    val digest = UByteArray(32)
    digest.usePinned { out ->
        if (bytes.isEmpty()) CC_SHA256(null, 0u, out.addressOf(0))
        else bytes.usePinned { CC_SHA256(it.addressOf(0), bytes.size.toUInt(), out.addressOf(0)) }
    }
    return digest.joinToString("") { it.toString(16).padStart(2, '0') }
}
