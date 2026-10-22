package org.example.mobilebench.benchkit

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
import org.json.JSONObject
import java.lang.ref.WeakReference
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Android BenchKit core of the RN wrapper (design §6.1-§6.3): markers as zero-length atrace slices
 * `mb|event|n|payload` plus a logcat mirror (tag `MobileBench`) for the driver-visible set, the FUI gate, probe
 * tokens, lifecycle (`launch`, `bg`, `fg`), accessibility state (`a11y`) and `reportFullyDrawn()`.
 *
 * Stand-in until the shared C-ABI core (instrumentation/android-benchkit) exists; the TurboModule and the probe then
 * forward to it unchanged. The mirror line adds `t=<elapsedRealtimeNanos> w=<wall us>` after the payload
 * (PoC addition for pre-harness checks); the mirror is never the timing source of the harness.
 */
object BenchKitCore {
  private const val TAG = "MobileBench"
  private val CONTROL_SET = setOf(
    "fui", "resume", "restore", "remote.ready", "remote.error", "state", "err", "a11y", "launch",
    "proc.anchor", "ctr",
  )
  private const val ROW_DP = 72

  private val lock = Any()
  private val counts = HashMap<String, Int>()
  private val mainHandler = Handler(Looper.getMainLooper())

  @Volatile private var journeyId = "-"
  @Volatile private var mirrorAll = false
  private var launchConfig: Map<String, String> = emptyMap()
  private var installed = false
  private var firstActivitySeen = false
  private var startedActivities = 0
  private var wasBackground = false
  private var fgSeqValue = 0
  private var activity: WeakReference<Activity>? = null
  private var a11yManager: AccessibilityManager? = null

  // Session state (re-armed by sessionStart and by a new activity in a live process).
  private var fuiDone = false
  private var listHeightDp = -1
  private var kReq = 0
  private val drawnRows = HashSet<Int>()
  private var summaryDrawn = false
  private var selectedCount = 0
  private var selectionRevision = 0
  private var navSeq = 0
  private var navRoute = "list"
  private val lastTokens = HashMap<String, String>()

  fun install(app: Application) {
    synchronized(lock) {
      if (installed) return
      installed = true
    }
    app.registerActivityLifecycleCallbacks(Lifecycle)
    val am = app.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
    a11yManager = am
    am?.addAccessibilityStateChangeListener { enabled -> mark("a11y", "on=${if (enabled) 1 else 0}") }
  }

  // ---------------------------------------------------------------- markers

  fun mark(event: String, payload: String): Long {
    val n: Int
    synchronized(lock) {
      n = (counts[event] ?: 0) + 1
      counts[event] = n
    }
    val p = sanitize(payload)
    val t = SystemClock.elapsedRealtimeNanos()
    val section = "mb|$event|$n|$p"
    Trace.beginSection(if (section.length > 127) section.substring(0, 127) else section)
    Trace.endSection()
    if (mirrorAll || event in CONTROL_SET) {
      val shown = if (p.isEmpty()) "-" else p
      Log.i(TAG, "MB $journeyId $event $n $shown t=$t w=${System.currentTimeMillis() * 1000}")
    }
    return t
  }

  fun count(event: String): Int = synchronized(lock) { counts[event] ?: 0 }

  private fun sanitize(payload: String): String {
    val sb = StringBuilder(minOf(payload.length, 64))
    for (c in payload) {
      if (sb.length >= 64) break
      if (c.code in 0x21..0x7e && c != '|') sb.append(c)
    }
    return sb.toString()
  }

  // ---------------------------------------------------------------- launch configuration and lifecycle

  fun launchConfigJson(): String = synchronized(lock) { JSONObject(launchConfig as Map<*, *>).toString() }

  fun fgSeq(): Int = synchronized(lock) { fgSeqValue }

  private fun captureLaunch(a: Activity, saved: Bundle?) {
    val extras = a.intent?.extras
    val config = HashMap<String, String>()
    if (extras != null) {
      for (key in extras.keySet()) {
        if (key.startsWith("mb.")) {
          @Suppress("DEPRECATION")
          config[key] = extras.get(key)?.toString() ?: ""
        }
      }
    }
    val first: Boolean
    synchronized(lock) {
      first = !firstActivitySeen
      firstActivitySeen = true
      if (first || config.isNotEmpty()) {
        launchConfig = config
        journeyId = config["mb.journey"]?.takeIf { Regex("^[A-Za-z0-9._-]{1,64}$").matches(it) } ?: "-"
        mirrorAll = config["mb.markerMirror"] == "all"
      }
      if (!first) {
        // Activity-warm start in a live process (design §31 item 6a): the gate re-arms.
        rearmLocked()
      }
    }
    mark("launch", "ss=${if (saved != null) 1 else 0}")
    if (first) {
      val ps = if (Build.VERSION.SDK_INT >= 24) Process.getStartElapsedRealtime() else 0L
      mark("proc.anchor", "ps=$ps;now=${SystemClock.elapsedRealtime()}")
      val on = a11yManager?.isEnabled == true
      mark("a11y", "on=${if (on) 1 else 0}")
    }
  }

  private object Lifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(a: Activity, savedInstanceState: Bundle?) {
      synchronized(lock) { activity = WeakReference(a) }
      captureLaunch(a, savedInstanceState)
    }

    override fun onActivityStarted(a: Activity) {
      var fg = -1
      synchronized(lock) {
        startedActivities += 1
        if (startedActivities == 1 && wasBackground) {
          wasBackground = false
          fgSeqValue += 1
          fg = fgSeqValue
        }
      }
      if (fg >= 0) mark("fg", "fg=$fg")
    }

    override fun onActivityResumed(a: Activity) {
      synchronized(lock) { activity = WeakReference(a) }
    }

    override fun onActivityPaused(a: Activity) {}

    override fun onActivityStopped(a: Activity) {
      var bg = false
      var fg = 0
      synchronized(lock) {
        startedActivities = max(0, startedActivities - 1)
        if (startedActivities == 0) {
          wasBackground = true
          bg = true
          fg = fgSeqValue
        }
      }
      if (bg) mark("bg", "fg=$fg")
    }

    override fun onActivitySaveInstanceState(a: Activity, outState: Bundle) {}

    override fun onActivityDestroyed(a: Activity) {
      synchronized(lock) {
        if (activity?.get() === a) activity = null
      }
    }
  }

  // ---------------------------------------------------------------- session, gate and tokens

  private fun rearmLocked() {
    fuiDone = false
    listHeightDp = -1
    kReq = 0
    drawnRows.clear()
    summaryDrawn = false
    selectionRevision = 0
    navSeq = 0
    navRoute = "list"
    lastTokens.clear()
  }

  fun sessionStart(selected: Int) {
    synchronized(lock) {
      rearmLocked()
      selectedCount = selected
    }
  }

  fun selectionChanged(selected: Int): Int = synchronized(lock) {
    selectedCount = selected
    selectionRevision += 1
    selectionRevision
  }

  fun navStart(route: String): Int = synchronized(lock) {
    navSeq += 1
    navRoute = route
    navSeq
  }

  fun restoreToken(route: String, anchor: Int): String = "restore:$route:$anchor"

  /** List container height from the native list probe (px) or the JS fallback (dp). Returns kReq. */
  fun listHeightPx(px: Int, density: Float): Int = listHeight((px / density).roundToInt())

  fun listHeight(h: Int): Int {
    synchronized(lock) {
      if (listHeightDp >= 0) return kReq
      listHeightDp = h
      kReq = max(1, h / ROW_DP)
    }
    mark("list.layout", "h=$h;k=${kReq}")
    checkGate()
    return kReq
  }

  fun probeDrawn(kind: String, index: Int, token: String) {
    var event: String? = null
    var payload = ""
    synchronized(lock) {
      when (kind) {
        "row" -> {
          if (fuiDone || token != "fui0") return
          drawnRows.add(index)
        }
        "summary" -> {
          if (token == "fui0") {
            if (fuiDone) return
            summaryDrawn = true
          } else if (token.startsWith("rev:") && lastTokens["summary"] != token) {
            lastTokens["summary"] = token
            event = "resp"
            payload = "rev=${token.substring(4)};sel=$selectedCount"
          } else {
            return
          }
        }
        "screen" -> {
          val key = "screen:$index"
          if (lastTokens[key] == token) return
          lastTokens[key] = token
          when {
            token.startsWith("nav:") -> {
              event = "screen"
              payload = "r=$navRoute;nav=${token.substring(4)}"
            }
            token.startsWith("fg:") -> {
              event = "resume"
              payload = "r=$navRoute;fg=${token.substring(3)}"
            }
            token.startsWith("restore:") -> {
              val parts = token.split(':')
              event = "restore"
              payload = "r=${parts.getOrElse(1) { "" }};a=${parts.getOrElse(2) { "" }}"
            }
            else -> return
          }
        }
        "insights" -> {
          val key = "insights:$index"
          if (!token.startsWith("ready:") || lastTokens[key] == token) return
          lastTokens[key] = token
          event = "remote.ready"
          payload = "v=${token.split(':').getOrElse(1) { "" }}"
        }
        else -> return
      }
    }
    val e = event
    if (e != null) {
      mark(e, payload)
    } else {
      checkGate()
    }
  }

  private fun checkGate() {
    val payload: String
    synchronized(lock) {
      if (fuiDone || kReq <= 0 || !summaryDrawn) return
      for (i in 0 until kReq) {
        if (!drawnRows.contains(i)) return
      }
      fuiDone = true
      payload = "rows=$kReq;h=$listHeightDp;sel=$selectedCount;seq=0"
    }
    mark("fui", payload)
    fullyDrawn()
  }

  /** `Activity.reportFullyDrawn()` posted to the main thread (design §6.2). */
  fun fullyDrawn() {
    mainHandler.post {
      val a = synchronized(lock) { activity?.get() }
      try {
        a?.reportFullyDrawn()
      } catch (e: SecurityException) {
        mark("err", "code=unexpected-exception")
      }
    }
  }

  fun publishState(k: Int, seq: Int, digest: String, counters: String) {
    mark("state", "k=$k;s=$seq;d=${digest.take(16)}")
    mark("ctr", counters)
  }
}
