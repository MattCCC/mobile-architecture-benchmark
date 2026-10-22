package org.example.mobilebench.nativeapp

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.example.mobilebench.nativeapp.domain.Format
import org.example.mobilebench.nativeapp.domain.StateModel
import org.example.mobilebench.nativeapp.domain.StreamFrame
import org.example.mobilebench.nativeapp.stream.StreamStatus

/** Per-row Compose state, so one update recomposes only its row (design §8.6). */
class RowUi(v0: Int, v1: Int, v2: Int, selected: Int) {
    var v0 by mutableIntStateOf(v0)
    var v1 by mutableIntStateOf(v1)
    var v2 by mutableIntStateOf(v2)
    var selected by mutableIntStateOf(selected)

    fun value(option: Int): Int = when (option) {
        0 -> v0
        1 -> v1
        else -> v2
    }
}

/**
 * UI-facing state of one session: wraps [StateModel] and exposes Compose state. Main thread only.
 */
class AppStore(val model: StateModel, val initialRoutes: List<String>, val initialAnchor: Int) {
    val itemCount: Int = model.itemCount
    val labelWidth: Int = Format.labelWidth(itemCount)
    val rows: Array<RowUi> = Array(itemCount) { i ->
        RowUi(model.value(i, 0), model.value(i, 1), model.value(i, 2), model.selection[i])
    }

    var selectedCount by mutableIntStateOf(model.selectedCount)
        private set
    var total by mutableLongStateOf(model.total)
        private set
    var selectionRevision by mutableIntStateOf(model.selectionRevision)
        private set
    val selectedItems = mutableStateListOf<Int>().apply { addAll(model.selectedItems()) }

    var status by mutableStateOf(StreamStatus.CONNECTING)
    var digestText by mutableStateOf("-")
    var insightsDigestText by mutableStateOf("-")
    var fgSeq by mutableIntStateOf(0)

    // Navigation state reported by the nav host (token sources for the root probes).
    var topRoute by mutableStateOf(initialRoutes.last())
    var navSeq by mutableIntStateOf(0)
    var routeStack: List<String> = initialRoutes

    /** Index of the first visible List row (restoration anchor). */
    var anchor: Int = initialAnchor
    var insightsVisible = false

    private var restoredStack: List<String>? = if (initialRoutes.size > 1) initialRoutes else null

    /** The restored route stack, returned once to the first navigation host of the session. */
    fun consumeRestoredStack(): List<String>? = restoredStack.also { restoredStack = null }

    /** Row compositions (implementation-quality counter, `ctr rows=`). */
    var rowRenders: Long = 0

    fun label(index: Int): String = Format.itemLabel(index, labelWidth)

    fun offer(frame: StreamFrame.Update): StateModel.Offer {
        val result = model.offer(frame.seq, frame.item, frame.v0, frame.v1, frame.v2)
        if (result == StateModel.Offer.APPLIED) {
            val row = rows[frame.item]
            row.v0 = frame.v0
            row.v1 = frame.v1
            row.v2 = frame.v2
            if (model.selection[frame.item] >= 0) {
                total = model.total
            }
        }
        return result
    }

    fun toggle(item: Int, option: Int) {
        val after = model.toggle(item, option)
        rows[item].selected = after
        selectedCount = model.selectedCount
        total = model.total
        val pos = selectedItems.binarySearch(item)
        if (after >= 0 && pos < 0) {
            selectedItems.add(-pos - 1, item)
        } else if (after < 0 && pos >= 0) {
            selectedItems.removeAt(pos)
        }
        selectionRevision = model.selectionRevision
    }
}
