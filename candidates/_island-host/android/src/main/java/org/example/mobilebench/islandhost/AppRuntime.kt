package org.example.mobilebench.islandhost

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import java.io.File
import java.io.IOException
import org.example.mobilebench.islandhost.bench.BenchKit
import org.example.mobilebench.islandhost.domain.Fixture
import org.example.mobilebench.islandhost.domain.FixtureException
import org.example.mobilebench.islandhost.domain.RestoreException
import org.example.mobilebench.islandhost.domain.RestoreRecord
import org.example.mobilebench.islandhost.domain.StateModel
import org.example.mobilebench.islandhost.island.EmbeddingProvider
import org.example.mobilebench.islandhost.island.IslandEmbedding
import org.example.mobilebench.islandhost.island.IslandHub
import org.example.mobilebench.islandhost.stream.ReplaySource
import org.example.mobilebench.islandhost.stream.StreamController

/**
 * Process-wide session orchestration (design §8.3, §8.8), shared by every island candidate: fixture loading,
 * optional restoration, stream start after FUI / restore / resume, checkpoints and the background restoration
 * record. The data layer is native; islands render from the state the hub sends them. Main thread only.
 */
object AppRuntime : BenchKit.Listener {
    private lateinit var app: Application
    private var fixture: Fixture? = null

    /** The island runtime of this candidate (provided by the candidate's own sources). */
    val embedding: IslandEmbedding by lazy { EmbeddingProvider.create() }

    var store: AppStore? = null
        private set
    private var stream: StreamController? = null
    var fatalError: String? = null
        private set

    /** The stream may connect only after FUI or after the restored screen was drawn (design §7.5, §8.8). */
    private var streamAllowed = false

    private val RATES = mapOf("small" to 5, "representative" to 20, "stress" to 100)

    fun install(application: Application) {
        app = application
        IslandHub.embedding = embedding
        BenchKit.listener = this
        BenchKit.setStateProvider { (store?.model?.selectedCount ?: 0) to (store?.model?.lastAppliedSeq ?: 0) }
        BenchKit.setRevisionProvider { store?.model?.selectionRevision ?: 0 }
        BenchKit.install(application, MainActivity::class.java, embedding.remoteCapable)
        embedding.onAppCreate(application, IslandHub)
    }

    override fun onMainActivityCreated(activity: Activity, savedInstanceState: Bundle?, firstInProcess: Boolean) {
        BenchKit.resetNavigation()
        if (firstInProcess) {
            startProcessSession()
            if (fatalError == null && BenchKit.config.engine == "prewarm" && activity is ComponentActivity) {
                embedding.prewarm(activity)
            }
        } else if (savedInstanceState == null && fatalError == null) {
            // Activity-warm start (A3): new session from the fixture at seq 0 (design §8.3, §31 item 6a).
            fixture?.let { newSession(StateModel(it.profile, it), listOf("list"), 0, restored = false) }
        }
    }

    private fun startProcessSession() {
        val config = BenchKit.config
        if (!config.isValid) {
            fail("launch-config-invalid")
            return
        }
        val fx = try {
            val text = app.assets.open("fixtures/${config.profile}.json").use { it.readBytes().toString(Charsets.UTF_8) }
            Fixture.parse(text, config.profile)
        } catch (e: IOException) {
            fail("fixture-invalid")
            return
        } catch (e: FixtureException) {
            fail("fixture-invalid")
            return
        }
        fixture = fx
        val model = StateModel(config.profile, fx)
        if (config.restore) {
            try {
                val record = RestoreRecord.parse(recordFile().readText(Charsets.UTF_8), fx.itemCount)
                model.restore(record)
                newSession(model, record.route, record.anchor, restored = true)
                return
            } catch (e: IOException) {
                BenchKit.err("persist-read")
            } catch (e: RestoreException) {
                BenchKit.err("persist-read")
            }
        }
        newSession(model, listOf("list"), 0, restored = false)
    }

    private fun newSession(model: StateModel, routes: List<String>, anchor: Int, restored: Boolean) {
        stream?.dispose()
        val s = AppStore(model, routes, anchor)
        store = s
        IslandHub.store = s
        streamAllowed = false
        val profile = model.profile
        val source = ReplaySource(
            openStream = { app.assets.open("fixtures/stream-$profile.jsonl") },
            ratePerSecond = RATES.getValue(profile),
        )
        stream = StreamController(s, source, ::checkpoint)
        if (restored) {
            BenchKit.disarmFuiGate()
            BenchKit.setPendingRestore(routes.last(), anchor)
        } else {
            BenchKit.armFuiGate(model.itemCount)
        }
    }

    private fun fail(code: String) {
        fatalError = code
        BenchKit.err(code)
    }

    override fun onFui() {
        streamAllowed = true
        stream?.connect()
    }

    override fun onRestoreDrawn() {
        streamAllowed = true
        stream?.connect()
    }

    override fun onResumeDrawn() {
        if (streamAllowed) stream?.connect()
    }

    override fun onForeground(fgSeq: Int) {
        store?.fgSeq = fgSeq
        IslandHub.onTokenChanged()
    }

    override fun onBackground() {
        val s = store ?: return
        writeRecord(s)
        stream?.close("background")
        checkpoint(0)
    }

    /** Checkpoint (design §6.6): digest, counters, digest element texts. */
    fun checkpoint(k: Int) {
        val s = store ?: return
        val m = s.model
        val digest = m.stateDigest()
        BenchKit.publishState(k, m.lastAppliedSeq, digest, m.received, m.applied, m.duplicates, m.gaps, s.rowRenders)
        s.digestText = "k=$k;seq=${m.lastAppliedSeq};d=${digest.substring(0, 12)}"
        if (IslandHub.insightsOpen) {
            s.insightsDigestText = m.insights().digest().substring(0, 12)
            IslandHub.onInsightsDigest(s.insightsDigestText)
        }
    }

    private fun recordFile(): File = File(app.filesDir, "mobilebench/restore-v2.json")

    private fun writeRecord(s: AppStore) {
        try {
            val record = RestoreRecord.capture(s.model, s.routeStack, s.anchor)
            val target = recordFile()
            target.parentFile?.mkdirs()
            val tmp = File(target.parentFile, "restore-v2.json.tmp")
            tmp.writeText(record.serialize(), Charsets.UTF_8)
            if (!tmp.renameTo(target)) {
                BenchKit.err("persist-write")
            }
        } catch (e: IOException) {
            BenchKit.err("persist-write")
        }
    }
}
