package org.example.mobilebench.kmpapp.bench

import org.example.mobilebench.kmpapp.AppRuntime

/** Draw callbacks are emitted from Compose drawWithContent after drawing the content. */
object BenchKit {
    var gateArmed = false
    private var lastRoot = ""
    private var lastSummary = -1
    private var insightsPending = false
    fun reset() { lastRoot = ""; lastSummary = -1; insightsPending = false }
    fun mark(event: String, payload: String = "") = AppRuntime.host.event(event, payload)
    fun err(code: String) = mark("err", "code=$code")
    fun rootDrawn(route: String, top: Boolean, nav: Int, fg: Int) {
        val token = "$route;$nav;$fg"
        if (top && token != lastRoot) { lastRoot = token; mark("probe.root", token) }
    }
    fun rowDrawn(index: Int) { if (gateArmed) mark("probe.row", "$index") }
    fun listLayout(height: Int) { if (gateArmed && height > 0) mark("probe.layout", "$height") }
    fun summaryDrawn(rev: Int, selected: Int) {
        if (gateArmed || rev != lastSummary) { lastSummary = rev; mark("probe.summary", "$rev;$selected") }
    }
    fun insightsRequested() { insightsPending = true; mark("probe.insights.request") }
    fun insightsDrawn() {
        if (insightsPending) { insightsPending = false; mark("probe.insights.draw") }
    }
}
