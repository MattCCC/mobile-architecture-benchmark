package org.example.mobilebench.kmpapp.domain

/** Platform SHA-256 over the same canonical UTF-8 bytes on both targets. */
object Sha256 { fun hex(text: String): String = sha256Hex(text) }
internal expect fun sha256Hex(text: String): String
