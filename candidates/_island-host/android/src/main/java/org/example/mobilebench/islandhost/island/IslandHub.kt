package org.example.mobilebench.islandhost.island

import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.activity.ComponentActivity
import org.example.mobilebench.islandhost.AppStore
import org.example.mobilebench.islandhost.bench.BenchKit
import org.example.mobilebench.islandhost.bench.IslandBenchApi
import org.json.JSONException
import org.json.JSONObject

/**
 * Host side of the island protocol (the same JSON messages for every runtime). Main thread only.
 *
 * Host to island (every message carries the island instance id `sid`):
 * - `init` / `snap`: the island's full state. Detail: `i`, `g`, `v` (three values); Insights: `top` ([item, A]),
 *   `b` (five bucket counts), `src`, `ver`, `open`, `idg`. Both: `k` (detail | insights), `n` (item count),
 *   `s` (last applied seq), `tk` (screen-root probe token), `xr` (1: emit `xr.js` per received update).
 *   `init` is passed when the island view is created; `snap` answers the island's `ready`.
 * - `v`: new values of the Detail item (`s`, `v`); `ins`: new Insights (`s`, `top`, `b`).
 * - `tk`: new screen-root probe token (`k`); `idg`: Insights checkpoint digest text (`x`).
 * Island to host:
 * - `ready`: the island root is mounted (answered with `snap`, so nothing sent while the runtime was loading is lost);
 * - `mark` (`e`, `p`) and `probe` (`kind`, `i`, `tk`): for runtimes without a synchronous native call.
 */
object IslandHub : IslandHost {
    lateinit var embedding: IslandEmbedding
    var store: AppStore? = null

    private val main = Handler(Looper.getMainLooper())
    private var nextSid = 1
    private var insightsOpens = 0

    private class Open(
        val sid: Int,
        val kind: IslandKind,
        val index: Int,
        val route: String,
        val view: View,
        val source: IslandSource?,
        val openNo: Int,
    )

    private val open = LinkedHashMap<Int, Open>()

    val insightsOpen: Boolean get() = open.values.any { it.kind == IslandKind.INSIGHTS }

    /** Creates the island view for a Detail(index) or Insights destination. */
    fun open(activity: ComponentActivity, kind: IslandKind, index: Int): View {
        val s = checkNotNull(store) { "no session" }
        val sid = nextSid++
        val route = if (kind == IslandKind.DETAIL) "detail/$index" else "insights"
        var source: IslandSource? = null
        var openNo = 0
        if (kind == IslandKind.INSIGHTS) {
            source = embedding.insightsSource()
            BenchKit.insightsSource(source.src)
            openNo = ++insightsOpens
        } else {
            IslandBenchApi.currentDetailRoute = route
        }
        val token = BenchKit.tokenFor(route, s.navSeq)
        val view = embedding.createView(activity, sid, kind, state("init", sid, kind, index, s, token, source, openNo))
        open[sid] = Open(sid, kind, index, route, view, source, openNo)
        return view
    }

    fun close(view: View) {
        val entry = open.values.firstOrNull { it.view === view } ?: return
        open.remove(entry.sid)
        if (entry.kind == IslandKind.DETAIL && IslandBenchApi.currentDetailRoute == entry.route) {
            IslandBenchApi.currentDetailRoute = null
        }
        embedding.release(view, entry.sid)
    }

    /** A stream update was applied to the store (called by `AppStore.offer`). */
    fun onApplied(seq: Int, item: Int, v0: Int, v1: Int, v2: Int) {
        if (open.isEmpty()) return
        val s = store ?: return
        var marked = false
        for (o in open.values) {
            val message = when (o.kind) {
                IslandKind.DETAIL -> if (o.index == item) "{\"t\":\"v\",\"sid\":${o.sid},\"s\":$seq,\"v\":[$v0,$v1,$v2]}" else null
                IslandKind.INSIGHTS -> StringBuilder(160).apply {
                    append("{\"t\":\"ins\",\"sid\":").append(o.sid).append(",\"s\":").append(seq)
                    appendInsights(this, s)
                    append('}')
                }.toString()
            } ?: continue
            if (!marked && BenchKit.config.xr) {
                marked = true
                BenchKit.mark("xr.native", "s=$seq")
            }
            embedding.send(o.view, o.sid, message)
        }
    }

    /** The top route or the foreground sequence changed: the top island draws its new token. */
    fun onTokenChanged() {
        val s = store ?: return
        for (o in open.values) {
            if (o.route == s.topRoute) {
                embedding.send(o.view, o.sid, "{\"t\":\"tk\",\"sid\":${o.sid},\"k\":\"${BenchKit.tokenFor(o.route, s.navSeq)}\"}")
            }
        }
    }

    /** Checkpoint: the Insights digest element text changed. */
    fun onInsightsDigest(text: String) {
        for (o in open.values) {
            if (o.kind == IslandKind.INSIGHTS) {
                embedding.send(o.view, o.sid, "{\"t\":\"idg\",\"sid\":${o.sid},\"x\":\"$text\"}")
            }
        }
    }

    override fun onIslandMessage(sid: Int, message: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) handle(sid, message) else main.post { handle(sid, message) }
    }

    private fun handle(sid: Int, message: String) {
        val m = try {
            JSONObject(message)
        } catch (e: JSONException) {
            BenchKit.err("unexpected-exception")
            return
        }
        when (m.optString("t")) {
            "ready" -> {
                val o = open[sid] ?: return
                val s = store ?: return
                val token = BenchKit.tokenFor(o.route, s.navSeq)
                embedding.send(o.view, sid, state("snap", sid, o.kind, o.index, s, token, o.source, o.openNo))
            }
            "mark" -> BenchKit.markFromIsland(m.optString("e"), m.optString("p"))
            "probe" -> IslandBenchApi.probeDrawn(m.optString("kind"), m.optInt("i", -1), m.optString("tk"))
            else -> Unit
        }
    }

    private fun state(
        type: String,
        sid: Int,
        kind: IslandKind,
        index: Int,
        s: AppStore,
        token: String,
        source: IslandSource?,
        openNo: Int,
    ): String {
        val m = s.model
        val sb = StringBuilder(256)
        sb.append("{\"t\":\"").append(type).append("\",\"sid\":").append(sid)
        sb.append(",\"k\":\"").append(kind.wire).append("\",\"n\":").append(m.itemCount)
        sb.append(",\"s\":").append(m.lastAppliedSeq).append(",\"tk\":\"").append(token).append('"')
        sb.append(",\"xr\":").append(if (BenchKit.config.xr) 1 else 0)
        when (kind) {
            IslandKind.DETAIL -> {
                sb.append(",\"i\":").append(index).append(",\"g\":").append(m.groups[index])
                sb.append(",\"v\":[").append(m.value(index, 0)).append(',').append(m.value(index, 1)).append(',')
                    .append(m.value(index, 2)).append(']')
            }
            IslandKind.INSIGHTS -> {
                appendInsights(sb, s)
                sb.append(",\"src\":\"").append(source?.src ?: "embedded").append('"')
                sb.append(",\"ver\":\"").append(source?.version ?: "1").append('"')
                sb.append(",\"open\":").append(openNo)
                sb.append(",\"idg\":\"").append(s.insightsDigestText).append('"')
            }
        }
        sb.append('}')
        return sb.toString()
    }

    private fun appendInsights(sb: StringBuilder, s: AppStore) {
        val ins = s.model.insights()
        sb.append(",\"top\":[")
        for (k in ins.topItems.indices) {
            if (k > 0) sb.append(',')
            sb.append('[').append(ins.topItems[k]).append(',').append(ins.topValues[k]).append(']')
        }
        sb.append("],\"b\":[")
        for (k in ins.buckets.indices) {
            if (k > 0) sb.append(',')
            sb.append(ins.buckets[k])
        }
        sb.append(']')
    }
}
