package org.example.mobilebench.nativeapp.domain

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

class RestoreException(message: String) : Exception(message)

/**
 * Restoration record v2 (design §8.8):
 * `{"v":2,"route":["list","detail/21"],"anchor":20,"selection":[[i,o],...],"lastSeq":n,"values":[[a,b,c],...]}`
 */
class RestoreRecord(
    val route: List<String>,
    val anchor: Int,
    /** (item, option) pairs sorted by item index. */
    val selection: List<Pair<Int, Int>>,
    val lastSeq: Int,
    /** Flat values, item i option o at i * 3 + o. */
    val values: IntArray,
) {
    /** Compact canonical JSON with a trailing LF (fixed key order, integers only). */
    fun serialize(): String {
        val sb = StringBuilder(64 + values.size * 6)
        sb.append("{\"v\":2,\"route\":[")
        route.forEachIndexed { k, r ->
            if (k > 0) sb.append(',')
            sb.append('"').append(r).append('"')
        }
        sb.append("],\"anchor\":").append(anchor)
        sb.append(",\"selection\":[")
        selection.forEachIndexed { k, (i, o) ->
            if (k > 0) sb.append(',')
            sb.append('[').append(i).append(',').append(o).append(']')
        }
        sb.append("],\"lastSeq\":").append(lastSeq)
        sb.append(",\"values\":[")
        for (i in 0 until values.size / 3) {
            if (i > 0) sb.append(',')
            sb.append('[').append(values[i * 3]).append(',').append(values[i * 3 + 1]).append(',')
                .append(values[i * 3 + 2]).append(']')
        }
        sb.append("]}\n")
        return sb.toString()
    }

    companion object {
        private val ROUTE = Regex("^(list|selection|insights|detail/(0|[1-9][0-9]{0,6}))$")

        fun capture(model: StateModel, route: List<String>, anchor: Int): RestoreRecord =
            RestoreRecord(
                route = route,
                anchor = anchor,
                selection = model.selectedItems().map { it to model.selection[it] },
                lastSeq = model.lastAppliedSeq,
                values = model.values.copyOf(),
            )

        fun parse(text: String, itemCount: Int): RestoreRecord {
            try {
                val root = JSONObject(text)
                val v = root.getInt("v")
                if (v != 2) {
                    throw RestoreException("record version $v")
                }
                val routeArr = root.getJSONArray("route")
                val route = (0 until routeArr.length()).map { routeArr.getString(it) }
                if (route.isEmpty() || route[0] != "list" || route.any { !ROUTE.matches(it) }) {
                    throw RestoreException("invalid route $route")
                }
                route.filter { it.startsWith("detail/") }.forEach {
                    if (it.removePrefix("detail/").toInt() >= itemCount) {
                        throw RestoreException("route item out of range: $it")
                    }
                }
                val anchor = root.getInt("anchor")
                if (anchor !in 0 until itemCount) {
                    throw RestoreException("anchor $anchor out of range")
                }
                val selArr = root.getJSONArray("selection")
                val seen = BooleanArray(itemCount)
                val selection = (0 until selArr.length()).map { k ->
                    val e: JSONArray = selArr.getJSONArray(k)
                    val i = e.getInt(0)
                    val o = e.getInt(1)
                    if (i !in 0 until itemCount || o !in 0..2 || seen[i]) {
                        throw RestoreException("invalid selection entry $k")
                    }
                    seen[i] = true
                    i to o
                }
                val lastSeq = root.getInt("lastSeq")
                if (lastSeq < 0) {
                    throw RestoreException("lastSeq $lastSeq")
                }
                val valArr = root.getJSONArray("values")
                if (valArr.length() != itemCount) {
                    throw RestoreException("record has ${valArr.length()} items, fixture $itemCount")
                }
                val values = IntArray(itemCount * 3)
                for (i in 0 until itemCount) {
                    val row = valArr.getJSONArray(i)
                    if (row.length() != 3) {
                        throw RestoreException("item $i has ${row.length()} values")
                    }
                    for (o in 0 until 3) {
                        val x = row.getInt(o)
                        if (x !in Fixture.VALUE_MIN..Fixture.VALUE_MAX) {
                            throw RestoreException("item $i value $x out of range")
                        }
                        values[i * 3 + o] = x
                    }
                }
                return RestoreRecord(route, anchor, selection.sortedBy { it.first }, lastSeq, values)
            } catch (e: JSONException) {
                throw RestoreException("record is not valid JSON: ${e.message}")
            } catch (e: NumberFormatException) {
                throw RestoreException("record route is invalid: ${e.message}")
            }
        }
    }
}
