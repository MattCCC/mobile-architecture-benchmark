package org.example.mobilebench.nativeapp.bench

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.os.Trace
import android.util.Log
import android.view.accessibility.AccessibilityManager
import java.lang.ref.WeakReference

/**
 * Candidate-local stand-in for the core BenchKit (design §6.2, §6.3), with the same API and semantics, so the
 * shared `instrumentation/android-benchkit` library can replace it without UI changes.
 *
 * Markers: a zero-length atrace slice `mb|<event>|<n>|<payload>` (timing source, monotonic trace clock) and,
 * for the driver-visible set (all markers with `mb.markerMirror=all`), one logcat line
 * `MB <journeyId> <event> <n> <payload> t=<elapsedRealtimeNanos>` (tag MobileBench). The trailing `t=` is a
 * diagnostic monotonic timestamp for pre-harness pilot runs; the harness never uses the mirror for timing.
 *
 * All calls happen on the main thread.
 */
object BenchKit {
    const val TAG = "MobileBench"
    private val DRIVER_VISIBLE = setOf(
        "fui", "resume", "restore", "remote.ready", "remote.error", "state", "err", "a11y", "launch",
    )

    /** Callbacks into the app (stream start/reconnect, lifecycle work). */
    interface Listener {
        fun onFui()
        fun onResumeDrawn()
        fun onRestoreDrawn()
        fun onBackground()
        fun onForeground(fgSeq: Int)
        fun onMainActivityCreated(activity: Activity, savedInstanceState: Bundle?, firstInProcess: Boolean)
    }

    var config: LaunchConfig = LaunchConfig()
        private set
    var listener: Listener? = null
    private var stateProvider: () -> Pair<Int, Int> = { 0 to 0 } // (selected count, last applied seq)

    private val ordinals = HashMap<String, Int>()
    private val main = Handler(Looper.getMainLooper())
    private var activityRef: WeakReference<Activity>? = null
    private var activitiesCreated = 0
    private var started = 0
    private var backgroundedOnce = false
    var fgSeq: Int = 0
        private set

    fun nowNs(): Long = SystemClock.elapsedRealtimeNanos()

    fun install(app: Application, mainActivityClass: Class<out Activity>) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
                if (activity.javaClass != mainActivityClass) return
                activityRef = WeakReference(activity)
                val first = activitiesCreated == 0
                activitiesCreated++
                if (first) {
                    config = LaunchConfig.parse(extrasOf(activity))
                    val ss = if (savedInstanceState != null) 1 else 0
                    mark("launch", "ss=$ss;pst=${Process.getStartElapsedRealtime()}")
                    registerAccessibilityListener(app)
                    if (config.unknown.isNotEmpty()) {
                        mark("err", "code=launch-config-unknown-key;n=${config.unknown.size}")
                    }
                }
                listener?.onMainActivityCreated(activity, savedInstanceState, first)
            }

            override fun onActivityStarted(activity: Activity) {
                started++
                if (started == 1 && backgroundedOnce) {
                    fgSeq++
                    mark("fg", "fg=$fgSeq")
                    listener?.onForeground(fgSeq)
                }
            }

            override fun onActivityStopped(activity: Activity) {
                started--
                if (started == 0) {
                    backgroundedOnce = true
                    mark("bg", "fg=$fgSeq")
                    listener?.onBackground()
                }
            }

            override fun onActivityResumed(activity: Activity) {
                if (activity.javaClass == mainActivityClass) activityRef = WeakReference(activity)
            }

            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
    }

    private fun extrasOf(activity: Activity): Map<String, String?> {
        val extras = activity.intent?.extras ?: return emptyMap()
        return extras.keySet().filter { it.startsWith("mb.") }.associateWith { key ->
            @Suppress("DEPRECATION")
            extras.get(key)?.toString()
        }
    }

    private fun registerAccessibilityListener(context: Context) {
        val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager ?: return
        am.addAccessibilityStateChangeListener { enabled -> mark("a11y", "on=${if (enabled) 1 else 0}") }
        mark("a11y", "on=${if (am.isEnabled) 1 else 0}")
    }

    fun setStateProvider(provider: () -> Pair<Int, Int>) {
        stateProvider = provider
    }

    // ------------------------------------------------------------------ markers

    fun mark(event: String, payload: String = "") {
        val t = nowNs()
        val n = (ordinals[event] ?: 0) + 1
        ordinals[event] = n
        val p = payload.ifEmpty { "-" }
        try {
            Trace.beginSection(truncate("mb|$event|$n|$p"))
        } finally {
            Trace.endSection()
        }
        if (config.markerMirror == "all" || event in DRIVER_VISIBLE) {
            Log.i(TAG, "MB ${config.journey} $event $n $p t=$t")
        }
    }

    private fun truncate(name: String): String = if (name.length <= 127) name else name.substring(0, 127)

    fun err(code: String) = mark("err", "code=$code")

    /** System "fully drawn" signal (Activity.reportFullyDrawn), posted after the current frame. */
    fun fullyDrawn() {
        main.post { activityRef?.get()?.reportFullyDrawn() }
    }

    // ------------------------------------------------------------------ FUI gate (design §8.4)

    private var gateArmed = false
    private var gateDone = false
    private var gateH = -1
    private var gateRows = 0
    private val drawnRows = HashSet<Int>()
    private var summaryDrawnForGate = false
    private var lastRespRev = -1

    /** Arms the gate for a new root UI (cold start or activity-warm start). */
    fun armFuiGate(itemCount: Int) {
        gateArmed = true
        gateDone = false
        gateH = -1
        gateRows = itemCount
        drawnRows.clear()
        summaryDrawnForGate = false
    }

    fun disarmFuiGate() {
        gateArmed = false
    }

    val fuiReached: Boolean get() = gateDone

    /** List container height (dp, integer, floor) at its first layout. */
    fun listLayout(hDp: Int) {
        if (!gateArmed || gateH >= 0) return
        gateH = hDp
        gateRows = minOf(gateRows, maxOf(hDp / 72, 0))
        if (hDp / 72 < 1) {
            err("unexpected-exception")
        }
        checkGate()
    }

    /** Row probe draw callback. After FUI this is one boolean check. */
    fun rowDrawn(index: Int) {
        if (!gateArmed) return
        drawnRows.add(index)
        checkGate()
    }

    /** Summary probe draw callback; token `fui0` until FUI, then `rev:<selectionRevision>`. */
    fun summaryDrawn(selectionRevision: Int, selectedCount: Int) {
        if (gateArmed) {
            summaryDrawnForGate = true
            checkGate()
            return
        }
        if (!gateDone) return
        if (selectionRevision != lastRespRev) {
            lastRespRev = selectionRevision
            mark("resp", "rev=$selectionRevision;sel=$selectedCount")
        }
    }

    private fun checkGate() {
        if (gateH < 0 || !summaryDrawnForGate || gateRows < 1) return
        for (i in 0 until gateRows) {
            if (i !in drawnRows) return
        }
        gateArmed = false
        gateDone = true
        drawnRows.clear()
        val (sel, seq) = stateProvider()
        lastRespRev = currentRevision()
        mark("fui", "rows=$gateRows;h=$gateH;sel=$sel;seq=$seq")
        fullyDrawn()
        main.post { listener?.onFui() }
    }

    private var revisionProvider: () -> Int = { 0 }

    fun setRevisionProvider(provider: () -> Int) {
        revisionProvider = provider
    }

    private fun currentRevision(): Int = revisionProvider()

    // ------------------------------------------------------------------ screen roots (design §6.3)

    private var lastScreenNav = -1
    private var lastResumeFg = 0
    private var pendingRestoreRoute: String? = null
    private var pendingRestoreAnchor = 0

    /** A new navigation host starts at navSeq 0. */
    fun resetNavigation() {
        lastScreenNav = -1
    }

    fun setPendingRestore(route: String, anchor: Int) {
        pendingRestoreRoute = route
        pendingRestoreAnchor = anchor
    }

    /** Root probe of a screen; [isTop] = the screen is the current top route. */
    fun rootDrawn(route: String, isTop: Boolean, navSeq: Int, fgSeq: Int) {
        if (!isTop) return
        if (navSeq != lastScreenNav) {
            lastScreenNav = navSeq
            mark("screen", "r=$route;nav=$navSeq")
        }
        if (fgSeq != lastResumeFg) {
            lastResumeFg = fgSeq
            mark("resume", "r=$route;fg=$fgSeq")
            main.post { listener?.onResumeDrawn() }
        }
        val pr = pendingRestoreRoute
        if (pr != null && pr == route) {
            pendingRestoreRoute = null
            mark("restore", "r=$route;a=$pendingRestoreAnchor")
            main.post { listener?.onRestoreDrawn() }
        }
    }

    // ------------------------------------------------------------------ Insights (design §8.10)

    private var insightsOpen = 0
    private var insightsReady = 0

    fun insightsRequested() {
        insightsOpen++
        mark("remote.request")
        mark("remote.source", "src=embedded")
    }

    fun insightsDrawn() {
        if (insightsReady == insightsOpen) return
        insightsReady = insightsOpen
        mark("remote.ready", "v=1")
    }

    // ------------------------------------------------------------------ checkpoints (design §6.6)

    fun publishState(k: Int, seq: Int, digest: String, received: Long, applied: Long, dup: Long, gap: Long, rows: Long) {
        mark("state", "k=$k;s=$seq;d=${digest.substring(0, 16)}")
        mark("ctr", "r=$received;a=$applied;dup=$dup;gap=$gap;rows=$rows")
    }

    /** Diagnostic only: device API level for the README/pilot records. */
    val apiLevel: Int get() = Build.VERSION.SDK_INT
}
