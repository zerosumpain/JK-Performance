package com.jkperformance.app.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RichTextTest {
    @Test
    fun boldAndItalic() {
        assertEquals(
            listOf(TextRun("Eat "), TextRun("30–60 g", bold = true), TextRun(" of carbs per hour.")),
            GuideText.runs("Eat **30–60 g** of carbs per hour."),
        )
        assertEquals(
            listOf(TextRun("Tick it; "), TextRun("partly done", italic = true), TextRun(" counts.")),
            GuideText.runs("Tick it; _partly done_ counts."),
        )
    }

    @Test
    fun italicInsideBold() {
        assertEquals(
            listOf(TextRun("very ", bold = true), TextRun("slow", bold = true, italic = true)),
            GuideText.runs("**very _slow_**"),
        )
    }

    @Test
    fun underscoresInsideWordsStay() {
        assertEquals(listOf(TextRun("snake_case and 5_000 stay")), GuideText.runs("snake_case and 5_000 stay"))
        assertEquals(listOf(TextRun("a _ b _ c")), GuideText.runs("a _ b _ c"))
    }

    @Test
    fun unclosedMarkersStayLiteral() {
        assertEquals(listOf(TextRun("**not bold")), GuideText.runs("**not bold"))
        assertEquals(listOf(TextRun("_open only")), GuideText.runs("_open only"))
        assertEquals(listOf(TextRun("****")), GuideText.runs("****"))
    }

    @Test
    fun htmlIsJustText() {
        val runs = GuideText.runs("<b>hi</b> <script>alert(1)</script>")
        assertEquals(1, runs.size)
        assertEquals("<b>hi</b> <script>alert(1)</script>", runs.single().text)
        assertEquals("Eat 30 g now", GuideText.plain("Eat **30 g** _now_"))
    }

    @Test
    fun linksAreHttpsOnly() {
        val text = "Today's plan: https://jk.example.com/plan/ce_1.2.abc. Old: http://x.example.com"
        val found = Links.find(text).map { text.substring(it) }
        assertEquals(listOf("https://jk.example.com/plan/ce_1.2.abc"), found)
    }

    @Test
    fun linkTrailingPunctuationAndBrackets() {
        val a = "See (https://example.com/a)."
        assertEquals(listOf("https://example.com/a"), Links.find(a).map { a.substring(it) })
        val b = "Wiki https://en.wikipedia.org/wiki/Taper_(running)!"
        assertEquals(listOf("https://en.wikipedia.org/wiki/Taper_(running)"), Links.find(b).map { b.substring(it) })
        assertTrue(Links.find("just https:// here").isEmpty())
        val two = "https://a.example.com and https://b.example.com/x?y=1"
        assertEquals(2, Links.find(two).size)
    }

    @Test
    fun safeLinks() {
        assertTrue(Links.isSafe("https://www.runnersneed.com/"))
        assertFalse(Links.isSafe("http://www.runnersneed.com/"))
        assertFalse(Links.isSafe("javascript:alert(1)"))
        assertFalse(Links.isSafe(null))
        assertFalse(Links.isSafe("https://"))
    }
}
