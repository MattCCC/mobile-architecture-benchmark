package org.example.mobilebench.nativeapp.domain

import java.security.MessageDigest

object Sha256 {
    private val HEX = "0123456789abcdef".toCharArray()

    /** Lowercase hex SHA-256 of the UTF-8 bytes of [text]. */
    fun hex(text: String): String = hex(text.toByteArray(Charsets.UTF_8))

    fun hex(bytes: ByteArray): String {
        val d = MessageDigest.getInstance("SHA-256").digest(bytes)
        val out = CharArray(d.size * 2)
        d.forEachIndexed { k, b ->
            val x = b.toInt() and 0xff
            out[k * 2] = HEX[x ushr 4]
            out[k * 2 + 1] = HEX[x and 0x0f]
        }
        return String(out)
    }
}
