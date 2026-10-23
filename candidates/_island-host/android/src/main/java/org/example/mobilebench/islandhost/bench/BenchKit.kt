package org.example.mobilebench.islandhost.bench

import android.app.Activity
import android.app.Application
import android.content.Context
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
 * Candidate-local stand-in for the core BenchKit (design §6.2, §6.3), derived from the `native` candidate's copy and
 * shared by every island candidate: it is the only marker core of the process. Island runtimes report their markers
 * and draw probes through [IslandBenchApi] (synchronous where the runtime can call native code directly,
 * otherwise through host messages, see `island/IslandHub.kt`).
 *
 * Markers: a zero-length atrace slice `mb|<event>|<n>|<payload>` (timing source, monotonic trace clock) and,
 * for the driver-visible set (all markers with `mb.markerMirror=all`), one logcat line
 * `MB <journeyId> <event> <n> <payload> t=<elapsedRealtimeNanos>` (tag MobileBench). The trailing `t=` is a
 * diagnostic monotonic timestamp for pre-harness checks; the harness never uses the mirror for timing.
 *
 * [mark], [count], [nowNs], [launchConfigJson] and [fgSeq] may be called from any thread (island runtimes call
 * them from their own threads); every other call happens on the main thread.
 */
object BenchKit {
    const val TAG = "MobileBench"
    private val DRIVER_VISIBLE = setOf(
        "fui", "resume", "restore", "remote.ready", "remote.error", "state", "err", "a11y", "launch",
    )
    private val EVENT = Regex("^[a-z0-9.]{1,24}$")

    /** Callbacks into the app (stream start/reconnect, lifecycle work). */
    interface Listener {
        fun onFui()
        fun onResumeDrawn()
        fun onRestoreDrawn()
        fun onBackground()
        fun onForeground(fgSeq: Int)
        fun onMainActivityCreated(activity: Activity, savedInstanceState: Bundle?, firstInProcess: Boolean)
    }

    @Volatile
    var config: LaunchConfig = LaunchConfig()
        private set
    var listener: Listener? = null
    private var stateProvider: () -> Pair<Int, Int> = { 0 to 0 } // (selected count, last applied seq)

    private val lock = Any()
    private val ordinals = HashMap<String, Int>()
    private val main = Handler(Looper.getMainLooper())
    private var activityRef: WeakReference<Activity>? = null
    private var activitiesCreated = 0
    private var started = 0
    private var backgroundedOnce = false

    @Volatile
    var fgSeq: Int = 0
        private set

    fun nowNs(): Long = SystemClock.elapsedRealtimeNanos()

    fun install(app: Application, mainActivityClass: Class<out Activity>, remoteCapable: Boolean) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
                if (activity.javaClass != mainActivityClass) return
                activityRef = WeakReference(activity)
                val first = activitiesCreated == 0
                activitiesCreated++
                if (first) {
                    config = LaunchConfig.parse(extrasOf(activity), remoteCapable)
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

    /** The `mb.*` launch keys as one JSON object of strings (for island runtimes). */
    fun launchConfigJson(): String =
        config.raw.entries.joinToString(",", "{", "}") { (k, v) -> "\"${jsonEscape(k)}\":\"${jsonEscape(v)}\"" }

    // ------------------------------------------------------------------ markers

    fun mark(event: String, payload: String = "") {
        val t = nowNs()
        val p = sanitize(payload).ifEmpty { "-" }
        val n: Int
        synchronized(lock) {
            n = (ordinals[event] ?: 0) + 1
            ordinals[event] = n
        }
        try {
            Trace.beginSection(truncate("mb|$event|$n|$p"))
        } finally {
            Trace.endSection()
        }
        val c = config
        if (c.markerMirror == "all" || event in DRIVER_VISIBLE) {
            Log.i(TAG, "MB ${c.journey} $event $n $p t=$t")
        }
    }

    /** Marker from an island runtime; rejects names outside the marker alphabet (design §6.2). */
    fun markFromIsland(event: String, payload: String) {
        if (EVENT.matches(event)) mark(event, payload) else err("unexpected-exception")
    }

    /** How often [event] has been emitted in this process. */
    fun count(event: String): Int = synchronized(lock) { ordinals[event] ?: 0 }

    private fun truncate(name: String): String = if (name.length <= 127) name else name.substring(0, 127)

    private fun sanitize(payload: String): String {
        val sb = StringBuilder(minOf(payload.length, 64))
        for (ch in payload) {
            if (sb.length >= 64) break
            if (ch.code in 0x21..0x7e && ch != '|') sb.append(ch)
        }
        return sb.toString()
    }

    private fun jsonEscape(s: String): String {
        val sb = StringBuilder(s.length + 2)
        for (ch in s) {
            when {
                ch == '"' -> sb.append("\\\"")
                ch == '\\' -> sb.append("\\\\")
                ch.code < 0x20 -> sb.append(String.format("\\u%04x", ch.code))
                else -> sb.append(ch)
            }
        }
        return sb.toString()
    }

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
    private var topRoute = "list"
    private var topNav = 0

    /** A new navigation host starts at navSeq 0. */
    fun resetNavigation() {
        lastScreenNav = -1
        topRoute = "list"
        topNav = 0
    }

    /** The navigation host reports the top route at transition start (push and pop). */
    fun setTop(route: String, navSeq: Int) {
        topRoute = route
        topNav = navSeq
    }

    fun setPendingRestore(route: String, anchor: Int) {
        pendingRestoreRoute = route
        pendingRestoreAnchor = anchor
    }

    /** Token an island screen root must draw to report its current state (`restore:`, `fg:` or `nav:`). */
    fun tokenFor(route: String, navSeq: Int): String {
        val pr = pendingRestoreRoute
        return when {
            pr != null && pr == route -> "restore:$route:$pendingRestoreAnchor"
            fgSeq != lastResumeFg -> "fg:$fgSeq"
            else -> "nav:$navSeq"
        }
    }

    /** Root probe of a native screen; [isTop] = the screen is the current top route. */
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

    /**
     * Root probe of an island screen, drawn by the island runtime with the token the host gave it (main thread).
     * A token for an older state (another route, an older navSeq or fgSeq) is ignored.
     */
    fun tokenDrawn(route: String, token: String) {
        if (route != topRoute) return
        when {
            token.startsWith("nav:") -> {
                val n = token.substring(4).toIntOrNull() ?: return
                if (n == topNav && n != lastScreenNav) {
                    lastScreenNav = n
                    mark("screen", "r=$route;nav=$n")
                }
            }
            token.startsWith("fg:") -> {
                val n = token.substring(3).toIntOrNull() ?: return
                if (n == fgSeq && n != lastResumeFg) {
                    lastResumeFg = n
                    mark("resume", "r=$route;fg=$n")
                    main.post { listener?.onResumeDrawn() }
                }
            }
            token.startsWith("restore:") -> {
                val pr = pendingRestoreRoute
                if (pr != null && pr == route && token == "restore:$pr:$pendingRestoreAnchor") {
                    // Same order as a native screen's first draw: `screen` for the initial navSeq, then `restore`.
                    if (topNav != lastScreenNav) {
                        lastScreenNav = topNav
                        mark("screen", "r=$route;nav=$topNav")
                    }
                    pendingRestoreRoute = null
                    mark("restore", "r=$route;a=$pendingRestoreAnchor")
                    main.post { listener?.onRestoreDrawn() }
                }
            }
            else -> Unit
        }
    }

    // ------------------------------------------------------------------ Insights (design §8.10)

    private var insightsReadyToken: String? = null

    fun insightsRequested() {
        mark("remote.request")
    }

    fun insightsSource(src: String) {
        mark("remote.source", "src=$src")
    }

    /** Content probe of the Insights island: token `ready:<version>:<open>`, one `remote.ready` per open. */
    fun insightsReady(token: String) {
        if (!token.startsWith("ready:") || token == insightsReadyToken) return
        insightsReadyToken = token
        mark("remote.ready", "v=${token.split(':').getOrElse(1) { "" }}")
    }

    // ------------------------------------------------------------------ checkpoints (design §6.6)

    fun publishState(k: Int, seq: Int, digest: String, received: Long, applied: Long, dup: Long, gap: Long, rows: Long) {
        mark("state", "k=$k;s=$seq;d=${digest.substring(0, 16)}")
        mark("ctr", "r=$received;a=$applied;dup=$dup;gap=$gap;rows=$rows")
    }
}

/**
 * The synchronous marker API island runtimes call (the island embeddings adapt their runtime's instrumentation
 * wrapper to it). [probeDrawn] must be called on the main thread; the other calls are thread-safe.
 */
object IslandBenchApi {
    fun mark(event: String, payload: String) = BenchKit.markFromIsland(event, payload)

    fun nowNs(): Long = BenchKit.nowNs()

    fun count(event: String): Int = BenchKit.count(event)

    fun launchConfigJson(): String = BenchKit.launchConfigJson()

    fun fgSeq(): Int = BenchKit.fgSeq

    /** Kinds: `screen` (index = route index, token `nav:` / `fg:` / `restore:`), `insights` (token `ready:`). */
    fun probeDrawn(kind: String, index: Int, token: String) {
        when (kind) {
            // Route index numbering of the shared RN UI: 2 = detail, 3 = insights (the two island screens).
            "screen" -> when (index) {
                2 -> currentDetailRoute?.let { BenchKit.tokenDrawn(it, token) }
                3 -> BenchKit.tokenDrawn("insights", token)
                else -> Unit
            }
            "insights" -> BenchKit.insightsReady(token)
            else -> Unit
        }
    }

    /** Route of the Detail island currently on screen (`detail/<i>`), set by the island hub. */
    @Volatile
    var currentDetailRoute: String? = null
}
