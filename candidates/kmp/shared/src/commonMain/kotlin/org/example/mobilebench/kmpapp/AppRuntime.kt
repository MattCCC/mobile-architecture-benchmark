package org.example.mobilebench.kmpapp

import org.example.mobilebench.kmpapp.bench.BenchKit
import org.example.mobilebench.kmpapp.domain.*
import org.example.mobilebench.kmpapp.stream.StreamController

/** Shared session, including lifecycle, restoration and all authoritative state. Main thread only. */
object AppRuntime {
    lateinit var host: HostServices
        private set
    var store: AppStore? = null
        private set
    var fatalError: String? = null
        private set
    private var stream: StreamController? = null
    private var allowed = false
    private var fixture: Fixture? = null

    fun start(services: HostServices, profile: String, restore: Boolean, valid: Boolean) {
        stream?.dispose()
        host = services
        store = null
        fatalError = null
        if (!valid) { fail("launch-config-invalid"); return }
        val fx = try { Fixture.parse(host.asset("$profile.json"), profile) }
        catch (e: Exception) { fail("fixture-invalid"); return }
        fixture = fx
        val model = StateModel(profile, fx)
        if (restore) {
            try {
                val record = RestoreRecord.parse(host.readRecord(), fx.itemCount)
                model.restore(record)
                newSession(model, record.route, record.anchor, true)
                return
            } catch (e: Exception) { BenchKit.err("persist-read") }
        }
        newSession(model, listOf("list"), 0, false)
    }

    fun warmStart() { fixture?.let { newSession(StateModel(it.profile, it), listOf("list"), 0, false) } }
    private fun newSession(model: StateModel, routes: List<String>, anchor: Int, restored: Boolean) {
        stream?.dispose()
        val s = AppStore(model, routes, anchor)
        store = s
        allowed = false
        stream = StreamController(s, host, ::checkpoint)
        BenchKit.reset()
        BenchKit.gateArmed = !restored
        if (restored) host.event("gate.restore", "${routes.last()};$anchor")
        else host.event("gate.arm", "${model.itemCount}")
    }
    private fun fail(code: String) { fatalError = code; BenchKit.err(code) }
    fun ready() { BenchKit.gateArmed = false; allowed = true; stream?.connect() }
    fun resumeDrawn() { if (allowed) stream?.connect() }
    fun foreground(seq: Int) { store?.fgSeq = seq }
    fun background() {
        val s = store ?: return
        try { host.writeRecord(RestoreRecord.capture(s.model, s.routeStack, s.anchor).serialize()) }
        catch (e: Exception) { BenchKit.err("persist-write") }
        stream?.close("background")
        checkpoint(0)
    }
    fun checkpoint(k: Int) {
        val s = store ?: return
        val m = s.model
        val digest = m.stateDigest()
        BenchKit.mark("state", "k=$k;s=${m.lastAppliedSeq};d=${digest.take(16)}")
        BenchKit.mark("ctr", "r=${m.received};a=${m.applied};dup=${m.duplicates};gap=${m.gaps};rows=${s.rowRenders}")
        host.event("checkpoint", "")
        s.digestText = "k=$k;seq=${m.lastAppliedSeq};d=${digest.take(12)}"
        if (s.insightsVisible) s.insightsDigestText = m.insights().digest().take(12)
    }
    // Small scalar bridge for platform-owned instrumentation. UI/state remain in commonMain.
    fun selectedCount(): Int = store?.model?.selectedCount ?: 0
    fun lastSeq(): Int = store?.model?.lastAppliedSeq ?: 0
    fun revision(): Int = store?.model?.selectionRevision ?: 0
}
