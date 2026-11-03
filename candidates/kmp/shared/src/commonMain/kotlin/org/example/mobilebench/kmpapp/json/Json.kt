package org.example.mobilebench.kmpapp.json

import kotlinx.serialization.json.*

class JSONException(message: String) : Exception(message)
private fun invalid(): Nothing = throw JSONException("missing field or invalid JSON type")
private fun parse(text: String): JsonObject = try {
    Json.parseToJsonElement(text) as? JsonObject ?: invalid()
} catch (e: IllegalArgumentException) { throw JSONException(e.message ?: "invalid JSON") }
private fun JsonElement?.integer(): Int {
    val p = this as? JsonPrimitive ?: invalid()
    if (p.isString) invalid()
    return p.intOrNull ?: invalid()
}
private fun JsonElement?.string(): String {
    val p = this as? JsonPrimitive ?: invalid()
    if (!p.isString) invalid()
    return p.content
}
class JSONObject(private val value: JsonObject) {
    constructor(text: String) : this(parse(text))
    fun getString(key: String) = value[key].string()
    fun getInt(key: String) = value[key].integer()
    fun getJSONArray(key: String) = JSONArray(value[key] as? JsonArray ?: invalid())
}
class JSONArray(private val value: JsonArray) {
    fun length() = value.size
    fun getInt(index: Int) = value.getOrNull(index).integer()
    fun getString(index: Int) = value.getOrNull(index).string()
    fun getJSONArray(index: Int) = JSONArray(value.getOrNull(index) as? JsonArray ?: invalid())
    fun getJSONObject(index: Int) = JSONObject(value.getOrNull(index) as? JsonObject ?: invalid())
}
