package com.jkperformance.app.net

// Pure text helpers for guide blocks and message bubbles, kept free of Android
// so the unit tests can run them on the JVM. Nothing here produces markup: a
// guide is never HTML (F14); the two inline markers become styled runs.

/** A run of guide text with its inline style. */
data class TextRun(val text: String, val bold: Boolean = false, val italic: Boolean = false)

object GuideText {
    /**
     * Tokenises `**bold**` and `_italic_` (an underscore pair at word
     * boundaries, so snake_case and 5_000 stay as written). Unclosed markers
     * stay literal. Anything else, including `<b>`, is plain text.
     */
    fun runs(text: String): List<TextRun> {
        val out = mutableListOf<TextRun>()
        val plain = StringBuilder()
        fun flush() {
            if (plain.isNotEmpty()) {
                out += TextRun(plain.toString())
                plain.clear()
            }
        }
        var i = 0
        while (i < text.length) {
            if (text.startsWith("**", i)) {
                val end = text.indexOf("**", i + 2)
                if (end > i + 2) {
                    flush()
                    italics(text.substring(i + 2, end)).forEach { out += it.copy(bold = true) }
                    i = end + 2
                    continue
                }
            }
            val italicEnd = italicClose(text, i)
            if (italicEnd != null) {
                flush()
                out += TextRun(text.substring(i + 1, italicEnd), italic = true)
                i = italicEnd + 1
                continue
            }
            plain.append(text[i])
            i++
        }
        flush()
        return out
    }

    /** Italic runs inside a bold run. */
    private fun italics(text: String): List<TextRun> {
        val out = mutableListOf<TextRun>()
        val plain = StringBuilder()
        var i = 0
        while (i < text.length) {
            val end = italicClose(text, i)
            if (end != null) {
                if (plain.isNotEmpty()) out += TextRun(plain.toString()).also { plain.clear() }
                out += TextRun(text.substring(i + 1, end), italic = true)
                i = end + 1
            } else {
                plain.append(text[i])
                i++
            }
        }
        if (plain.isNotEmpty()) out += TextRun(plain.toString())
        return out
    }

    /** When `text[at]` opens an italic run, the index of its closing underscore. */
    private fun italicClose(text: String, at: Int): Int? {
        if (text[at] != '_') return null
        if (at > 0 && text[at - 1].isLetterOrDigit()) return null
        if (at + 1 >= text.length || text[at + 1].isWhitespace() || text[at + 1] == '_') return null
        var j = at + 1
        while (j < text.length) {
            j = text.indexOf('_', j)
            if (j < 0) return null
            val closesWord = j + 1 >= text.length || !text[j + 1].isLetterOrDigit()
            if (closesWord && !text[j - 1].isWhitespace()) return j
            j++
        }
        return null
    }

    /** The plain words (for accessibility and previews): markers removed. */
    fun plain(text: String): String = runs(text).joinToString("") { it.text }
}

object Links {
    private val url = Regex("""https://[^\s<>"]+""", RegexOption.IGNORE_CASE)
    private const val TRAILING = ".,;:!?'\")]}"

    /**
     * The https links in a message, as index ranges into it. Plain http is
     * left as text (the apps open https only). Trailing punctuation is not
     * part of the link, except a closing bracket that has its opening one.
     */
    fun find(text: String): List<IntRange> = url.findAll(text).mapNotNull { m ->
        var end = m.range.last
        while (end > m.range.first) {
            val c = text[end]
            if (c !in TRAILING) break
            if (c == ')' && text.substring(m.range.first, end).count { it == '(' } > text.substring(m.range.first, end).count { it == ')' }) break
            end--
        }
        val range = m.range.first..end
        // "https://" alone is not a link.
        if (range.last - range.first + 1 <= "https://".length) null else range
    }.toList()

    /** Whether a guide or kit link may be opened (https only, like the server's own check). */
    fun isSafe(url: String?): Boolean = url != null && url.startsWith("https://", ignoreCase = true) && url.length > 8 && url.none { it.isWhitespace() }
}
