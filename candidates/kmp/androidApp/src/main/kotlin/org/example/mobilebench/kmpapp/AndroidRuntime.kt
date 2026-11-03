package org.example.mobilebench.kmpapp

import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.io.File
import org.example.mobilebench.kmpapp.platform.BenchKit

object AndroidRuntime : BenchKit.Listener {
    private lateinit var host: AndroidHost
    fun install(app: Application) {
        host = AndroidHost(app)
        BenchKit.listener = this
        BenchKit.setStateProvider { AppRuntime.selectedCount() to AppRuntime.lastSeq() }
        BenchKit.setRevisionProvider { AppRuntime.revision() }
        BenchKit.install(app, MainActivity::class.java)
    }
    override fun onMainActivityCreated(activity: Activity, savedInstanceState: Bundle?, firstInProcess: Boolean) {
        BenchKit.resetNavigation()
        if (firstInProcess) {
            val c = BenchKit.config
            AppRuntime.start(host, c.profile, c.restore, c.isValid)
        } else if (savedInstanceState == null && AppRuntime.fatalError == null) AppRuntime.warmStart()
    }
    override fun onFui() = AppRuntime.ready()
    override fun onRestoreDrawn() = AppRuntime.ready()
    override fun onResumeDrawn() = AppRuntime.resumeDrawn()
    override fun onForeground(fgSeq: Int) = AppRuntime.foreground(fgSeq)
    override fun onBackground() = AppRuntime.background()
}

class AndroidHost(private val app: Application) : HostServices {
    override fun asset(name: String) = app.assets.open("fixtures/$name").bufferedReader().use { it.readText() }
    override fun replay(name: String): ReplayReader {
        val reader = app.assets.open("fixtures/$name").reader(Charsets.UTF_8).buffered(65536)
        return object : ReplayReader {
            override fun next() = reader.readLine()
            override fun close() = reader.close()
        }
    }
    private fun record() = File(app.filesDir, "mobilebench/restore-v2.json")
    override fun readRecord() = record().readText()
    override fun writeRecord(text: String) {
        val target = record()
        target.parentFile!!.mkdirs()
        val temp = File(target.parentFile, "restore-v2.json.tmp")
        temp.writeText(text)
        check(temp.renameTo(target)) { "atomic restore rename failed" }
    }
    override fun nowNanos() = BenchKit.nowNs()
    override fun event(name: String, payload: String) {
        when (name) {
            "gate.arm" -> BenchKit.armFuiGate(payload.toInt())
            "gate.restore" -> {
                val p = payload.split(';')
                BenchKit.disarmFuiGate(); BenchKit.setPendingRestore(p[0], p[1].toInt())
            }
            "probe.layout" -> BenchKit.listLayout(payload.toInt())
            "probe.row" -> BenchKit.rowDrawn(payload.toInt())
            "probe.summary" -> {
                val p = payload.split(';'); BenchKit.summaryDrawn(p[0].toInt(), p[1].toInt())
            }
            "probe.root" -> {
                val p = payload.split(';'); BenchKit.rootDrawn(p[0], true, p[1].toInt(), p[2].toInt())
            }
            "probe.insights.request" -> BenchKit.insightsRequested()
            "probe.insights.draw" -> BenchKit.insightsDrawn()
            "checkpoint" -> Unit
            else -> BenchKit.mark(name, payload)
        }
    }
}
