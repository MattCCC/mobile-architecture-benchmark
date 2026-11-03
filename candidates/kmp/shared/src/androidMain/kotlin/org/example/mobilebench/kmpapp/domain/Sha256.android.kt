package org.example.mobilebench.kmpapp.domain
import java.security.MessageDigest
internal actual fun sha256Hex(text: String): String = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        .joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
