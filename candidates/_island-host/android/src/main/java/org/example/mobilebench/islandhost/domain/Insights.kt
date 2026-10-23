package org.example.mobilebench.islandhost.domain

/**
 * Derived Insights (design §7.1, §7.6): top 5 items by option A (descending, ties by lower index) and the
 * distribution of option B over 5 equal buckets of [100, 9999].
 */
class Insights(val seq: Int, val topItems: IntArray, val topValues: IntArray, val buckets: IntArray) {
    fun text(): String {
        val sb = StringBuilder("mb-insights-v1\nseq=").append(seq).append("\ntop=")
        for (k in topItems.indices) {
            if (k > 0) sb.append(',')
            sb.append(topItems[k]).append(':').append(topValues[k])
        }
        sb.append("\nbuckets=")
        for (k in buckets.indices) {
            if (k > 0) sb.append(',')
            sb.append(buckets[k])
        }
        sb.append('\n')
        return sb.toString()
    }

    fun digest(): String = Sha256.hex(text())

    companion object {
        const val TOP = 5

        fun bucketOf(b: Int): Int = minOf(4, (b - 100) * 5 / 9900)

        fun compute(seq: Int, values: IntArray, itemCount: Int): Insights {
            val k = minOf(TOP, itemCount)
            val topItems = IntArray(k) { -1 }
            val topValues = IntArray(k) { Int.MIN_VALUE }
            val buckets = IntArray(5)
            for (i in 0 until itemCount) {
                val a = values[i * 3]
                buckets[bucketOf(values[i * 3 + 1])]++
                // Insert into the sorted top list; equal values keep the lower index first.
                var pos = k
                while (pos > 0 && a > topValues[pos - 1]) {
                    pos--
                }
                if (pos < k) {
                    for (j in k - 1 downTo pos + 1) {
                        topValues[j] = topValues[j - 1]
                        topItems[j] = topItems[j - 1]
                    }
                    topValues[pos] = a
                    topItems[pos] = i
                }
            }
            return Insights(seq, topItems, topValues, buckets)
        }
    }
}
