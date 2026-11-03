package org.example.mobilebench.kmpapp

import androidx.compose.ui.Modifier

interface ReplayReader { fun next(): String?; fun close() }
/** OS services only; all state, scheduling, navigation and screens live in commonMain. */
interface HostServices {
    fun asset(name: String): String
    fun replay(name: String): ReplayReader
    fun readRecord(): String
    fun writeRecord(text: String)
    fun nowNanos(): Long
    fun event(name: String, payload: String)
}
expect fun Modifier.resourceTags(): Modifier
