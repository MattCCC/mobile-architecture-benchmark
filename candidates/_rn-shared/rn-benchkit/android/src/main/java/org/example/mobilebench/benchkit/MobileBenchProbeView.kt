package org.example.mobilebench.benchkit

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View

/**
 * 1 x 1 dp opaque draw probe painted white (the parent background). `onDraw` reports the current token to the
 * core; a token change calls `invalidate()` so the next frame draws it (design §6.2 "forced draw on token change").
 * Kind `list` never draws: it fills the list container and reports the container height at native layout.
 */
class MobileBenchProbeView(context: Context) : View(context) {
  private val paint = Paint().apply {
    color = Color.WHITE
    style = Paint.Style.FILL
  }
  private var heightPx = -1

  var kind: String = ""
    set(value) {
      field = value
      setWillNotDraw(value == KIND_LIST)
      reportListHeight()
    }

  var index: Int = 0

  var token: String = ""
    set(value) {
      if (field != value) {
        field = value
        if (kind != KIND_LIST) {
          invalidate()
        }
      }
    }

  init {
    setWillNotDraw(false)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    heightPx = h
    reportListHeight()
  }

  private fun reportListHeight() {
    if (kind == KIND_LIST && heightPx > 0) {
      BenchKitCore.listHeightPx(heightPx, resources.displayMetrics.density)
    }
  }

  override fun onDraw(canvas: Canvas) {
    if (kind == KIND_LIST) return
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    BenchKitCore.probeDrawn(kind, index, token)
  }

  companion object {
    const val KIND_LIST = "list"
  }
}
