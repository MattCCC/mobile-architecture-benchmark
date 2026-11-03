package org.example.mobilebench.islandbench

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View

/**
 * 1 x 1 dp opaque draw probe painted white (the parent background). `onDraw` reports the current token to the host's
 * marker core; a token change calls `invalidate()` so the next frame draws it (design §6.2 "forced draw on token
 * change"). Kind `list` reports layout height without drawing a container-sized backing store.
 */
class MobileBenchProbeView(context: Context) : View(context) {
    private val paint = Paint().apply {
        color = Color.WHITE
        style = Paint.Style.FILL
    }

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

    override fun onDraw(canvas: Canvas) {
        if (kind == KIND_LIST) return
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        HostBench.sink?.probeDrawn(kind, index, token)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        reportListHeight()
    }

    private fun reportListHeight() {
        if (kind == KIND_LIST && height > 0) {
            HostBench.sink?.probeDrawn("list", kotlin.math.floor(height / resources.displayMetrics.density).toInt(), "")
        }
    }

    companion object {
        const val KIND_LIST = "list"
    }
}
