package org.example.mobilebench.islandhost.domain

/** Display formatting without locale APIs (design §7.7). */
object Format {
    const val OPTION_KEYS = "ABC"

    /** Fixed-point value with scale 100: 1234 -> "12.34". */
    fun value(v: Long): String {
        require(v >= 0) { "negative value $v" }
        val whole = v / 100
        val frac = (v % 100).toInt()
        return if (frac < 10) "$whole.0$frac" else "$whole.$frac"
    }

    fun value(v: Int): String = value(v.toLong())

    /** Label width: max(3, number of digits of n - 1). */
    fun labelWidth(itemCount: Int): Int = maxOf(3, digits(maxOf(itemCount - 1, 0)))

    fun digits(x: Int): Int {
        var d = 1
        var y = x
        while (y >= 10) {
            y /= 10
            d++
        }
        return d
    }

    /** "Item 042" for index 42 and width 3. */
    fun itemLabel(index: Int, width: Int): String {
        val s = index.toString()
        val pad = width - s.length
        return if (pad > 0) "Item " + "0".repeat(pad) + s else "Item $s"
    }

    fun optionKey(option: Int): Char = OPTION_KEYS[option]

    /** Option button / detail value text: "A 12.34". */
    fun optionText(option: Int, value: Int): String = "${optionKey(option)} ${value(value)}"
}
