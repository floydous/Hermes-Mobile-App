package com.hermesagent.nativemobile.util

import org.junit.Assert.assertEquals
import org.junit.Test

class EnvelopeCleanerTest {

    @Test
    fun testContextCompactionScrubbed() {
        val raw = "[CONTEXT COMPACTION — REFERENCE ONLY]\nPrevious summary...\n[/CONTEXT COMPACTION]\nHello assistant"
        val cleaned = EnvelopeCleaner.clean(raw)
        assertEquals("Hello assistant", cleaned)
    }

    @Test
    fun testModelSwitchScrubbed() {
        val raw = "[System: The active model for this chat has changed from A to B]\nHow are you?"
        val cleaned = EnvelopeCleaner.clean(raw)
        assertEquals("How are you?", cleaned)
    }

    @Test
    fun testOutOfBandScrubbed() {
        val raw = "[OUT-OF-BAND USER MESSAGE: Focus on code]\nPlease review this"
        val cleaned = EnvelopeCleaner.clean(raw)
        assertEquals("Please review this", cleaned)
    }
}
