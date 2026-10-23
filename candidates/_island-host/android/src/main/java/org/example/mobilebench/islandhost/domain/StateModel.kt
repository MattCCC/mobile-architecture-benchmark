package org.example.mobilebench.islandhost.domain

/**
 * Observable application state of one session (design §7, §8.5, §8.6): values, selection, last applied
 * update, aggregates and stream counters. Pure Kotlin, single-threaded (main thread in the app).
 */
class StateModel(val profile: String, fixture: Fixture) {
    val itemCount: Int = fixture.itemCount
    val groups: IntArray = fixture.groups
    val values: IntArray = fixture.values.copyOf()
    val selection: IntArray = fixture.selection.copyOf()

    var lastAppliedSeq: Int = 0
        private set
    var selectedCount: Int = 0
        private set
    var total: Long = 0
        private set
    var selectionRevision: Int = 0
        private set

    // Stream counters reported in the `ctr` checkpoint marker.
    var received: Long = 0
        private set
    var applied: Long = 0
        private set
    var duplicates: Long = 0
        private set
    var gaps: Long = 0
        private set

    init {
        recomputeAggregates()
    }

    enum class Offer { APPLIED, DUPLICATE, GAP }

    fun value(item: Int, option: Int): Int = values[item * 3 + option]

    /** Applies update [seq] if it is the next one (client rules, design §7.5). */
    fun offer(seq: Int, item: Int, v0: Int, v1: Int, v2: Int): Offer {
        received++
        if (seq <= lastAppliedSeq) {
            duplicates++
            return Offer.DUPLICATE
        }
        if (seq > lastAppliedSeq + 1 || item !in 0 until itemCount) {
            gaps++
            return Offer.GAP
        }
        val base = item * 3
        val sel = selection[item]
        if (sel >= 0) {
            total -= values[base + sel]
        }
        values[base] = v0
        values[base + 1] = v1
        values[base + 2] = v2
        if (sel >= 0) {
            total += values[base + sel]
        }
        lastAppliedSeq = seq
        applied++
        return Offer.APPLIED
    }

    /** Selection rule (design §8.5). Returns the selected option of [item] after the tap, or -1. */
    fun toggle(item: Int, option: Int): Int {
        val current = selection[item]
        if (current == option) {
            selection[item] = -1
            selectedCount--
            total -= value(item, option)
        } else {
            if (current >= 0) {
                total -= value(item, current)
            } else {
                selectedCount++
            }
            selection[item] = option
            total += value(item, option)
        }
        selectionRevision++
        return selection[item]
    }

    /** Replaces values, selection and last seq with a restoration record (design §8.8). */
    fun restore(record: RestoreRecord) {
        require(record.values.size == values.size) { "record has ${record.values.size / 3} items" }
        record.values.copyInto(values)
        selection.fill(-1)
        record.selection.forEach { (i, o) -> selection[i] = o }
        lastAppliedSeq = record.lastSeq
        recomputeAggregates()
    }

    fun selectedItems(): List<Int> = (0 until itemCount).filter { selection[it] >= 0 }

    private fun recomputeAggregates() {
        var count = 0
        var sum = 0L
        for (i in 0 until itemCount) {
            val o = selection[i]
            if (o >= 0) {
                count++
                sum += values[i * 3 + o]
            }
        }
        selectedCount = count
        total = sum
    }

    /** Canonical state text mb-state-v1 (design §7.6). */
    fun stateText(): String {
        val sb = StringBuilder(64 + values.size * 5 + selectedCount * 7)
        sb.append("mb-state-v1\nprofile=").append(profile)
        sb.append("\nseq=").append(lastAppliedSeq)
        sb.append("\nvalues=")
        for (k in values.indices) {
            if (k > 0) sb.append(',')
            sb.append(values[k])
        }
        sb.append("\nselection=")
        var first = true
        for (i in 0 until itemCount) {
            val o = selection[i]
            if (o >= 0) {
                if (!first) sb.append(',')
                sb.append(i).append(':').append(Format.optionKey(o))
                first = false
            }
        }
        sb.append('\n')
        return sb.toString()
    }

    fun stateDigest(): String = Sha256.hex(stateText())

    fun insights(): Insights = Insights.compute(lastAppliedSeq, values, itemCount)
}
