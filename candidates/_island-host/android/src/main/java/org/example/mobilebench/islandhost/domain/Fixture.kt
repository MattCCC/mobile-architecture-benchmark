package org.example.mobilebench.islandhost.domain

import org.json.JSONException
import org.json.JSONObject

class FixtureException(message: String) : Exception(message)

/**
 * Parsed fixture (format mobilebench.fixture/1.0.0, design §7.2). Values are flat: item i, option o at
 * index i * 3 + o. [selection] holds the selected option per item, or -1.
 */
class Fixture(
    val profile: String,
    val fixtureVersion: String,
    val groups: IntArray,
    val values: IntArray,
    val selection: IntArray,
) {
    val itemCount: Int get() = groups.size

    companion object {
        const val SCHEMA = "mobilebench.fixture/1.0.0"
        const val VALUE_MIN = 100
        const val VALUE_MAX = 9999

        fun parse(text: String, expectedProfile: String): Fixture {
            try {
                return parseOrThrow(JSONObject(text), expectedProfile)
            } catch (e: JSONException) {
                throw FixtureException("fixture is not valid JSON: ${e.message}")
            }
        }

        private fun parseOrThrow(root: JSONObject, expectedProfile: String): Fixture {
            val schema = root.getString("schema")
            if (schema != SCHEMA) {
                throw FixtureException("unexpected schema $schema")
            }
            val profile = root.getString("profile")
            if (profile != expectedProfile) {
                throw FixtureException("profile $profile != requested $expectedProfile")
            }
            if (root.getInt("valueScale") != 100) {
                throw FixtureException("valueScale must be 100")
            }
            val items = root.getJSONArray("items")
            val n = items.length()
            if (n < 1) {
                throw FixtureException("no items")
            }
            val groups = IntArray(n)
            val values = IntArray(n * 3)
            for (k in 0 until n) {
                val item = items.getJSONObject(k)
                if (item.getInt("i") != k) {
                    throw FixtureException("item $k has index ${item.getInt("i")}")
                }
                val g = item.getInt("g")
                if (g !in 0..7) {
                    throw FixtureException("item $k group $g out of range")
                }
                groups[k] = g
                val v = item.getJSONArray("v")
                if (v.length() != 3) {
                    throw FixtureException("item $k has ${v.length()} values")
                }
                for (o in 0 until 3) {
                    val x = v.getInt(o)
                    if (x !in VALUE_MIN..VALUE_MAX) {
                        throw FixtureException("item $k value $x out of range")
                    }
                    values[k * 3 + o] = x
                }
            }
            val selection = IntArray(n) { -1 }
            val sel = root.getJSONArray("selection")
            for (k in 0 until sel.length()) {
                val e = sel.getJSONObject(k)
                val i = e.getInt("i")
                val o = e.getInt("o")
                if (i !in 0 until n || o !in 0..2 || selection[i] != -1) {
                    throw FixtureException("invalid selection entry $k")
                }
                selection[i] = o
            }
            return Fixture(profile, root.getString("fixtureVersion"), groups, values, selection)
        }
    }
}
