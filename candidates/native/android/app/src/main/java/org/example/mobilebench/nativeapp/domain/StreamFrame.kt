package org.example.mobilebench.nativeapp.domain

import org.json.JSONException
import org.json.JSONObject

/** Stream frames of the wire protocol (design §7.5). */
sealed class StreamFrame {
    data class Update(val seq: Int, val item: Int, val v0: Int, val v1: Int, val v2: Int) : StreamFrame()
    data class Hello(val from: Int) : StreamFrame()
    data class End(val last: Int) : StreamFrame()
    data class Checkpoint(val k: Int, val last: Int) : StreamFrame()
    data class Resume(val from: Int) : StreamFrame()

    companion object {
        /** Parses one text frame; throws [StreamProtocolException] on anything else. */
        fun parse(text: String): StreamFrame {
            try {
                val o = JSONObject(text)
                return when (val t = o.getString("t")) {
                    "u" -> {
                        val v = o.getJSONArray("v")
                        if (v.length() != 3) {
                            throw StreamProtocolException("update with ${v.length()} values")
                        }
                        Update(o.getInt("s"), o.getInt("i"), v.getInt(0), v.getInt(1), v.getInt(2))
                    }
                    "h" -> Hello(o.getInt("from"))
                    "e" -> End(o.getInt("last"))
                    "c" -> Checkpoint(o.getInt("k"), o.getInt("last"))
                    "r" -> Resume(o.getInt("from"))
                    else -> throw StreamProtocolException("unknown frame type $t")
                }
            } catch (e: JSONException) {
                throw StreamProtocolException("invalid frame: ${e.message}")
            }
        }
    }
}

class StreamProtocolException(message: String) : Exception(message)
