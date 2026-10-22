package org.example.mobilebench.nativeapp.domain

import org.example.mobilebench.nativeapp.bench.LaunchConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DomainTest {
    private val fixtureText = """
        {
          "schema": "mobilebench.fixture/1.0.0",
          "fixtureVersion": "1.0.0",
          "profile": "small",
          "seed": 42,
          "generator": { "prng": "mulberry32", "algorithmVersion": 1 },
          "valueScale": 100,
          "valueRange": [100, 9999],
          "items": [
            { "i": 0, "g": 1, "v": [100, 9999, 1234] },
            { "i": 1, "g": 7, "v": [5000, 200, 300] },
            { "i": 2, "g": 0, "v": [5000, 4000, 300] }
          ],
          "selection": [
            { "i": 1, "o": 2 }
          ]
        }
    """.trimIndent()

    private fun model() = StateModel("small", Fixture.parse(fixtureText, "small"))

    @Test
    fun formatsWithoutLocale() {
        assertEquals("1.00", Format.value(100))
        assertEquals("99.99", Format.value(9999))
        assertEquals("12.05", Format.value(1205))
        assertEquals("0.07", Format.value(7))
        assertEquals("1913.27", Format.value(191327L))
        assertEquals("Item 042", Format.itemLabel(42, Format.labelWidth(300)))
        assertEquals("Item 0042", Format.itemLabel(42, Format.labelWidth(3000)))
        assertEquals("Item 007", Format.itemLabel(7, Format.labelWidth(30)))
        assertEquals("B 12.34", Format.optionText(1, 1234))
    }

    @Test
    fun selectionRulesReplaceAndToggle() {
        val m = model()
        assertEquals(1, m.selectedCount)
        assertEquals(300L, m.total)
        assertEquals(0, m.toggle(0, 0)) // select A of item 0
        assertEquals(2, m.selectedCount)
        assertEquals(400L, m.total)
        assertEquals(1, m.toggle(0, 1)) // B replaces A
        assertEquals(2, m.selectedCount)
        assertEquals(10299L, m.total)
        assertEquals(-1, m.toggle(0, 1)) // deselect
        assertEquals(1, m.selectedCount)
        assertEquals(300L, m.total)
        assertEquals(3, m.selectionRevision)
        assertTrue(m.stateText().endsWith("selection=1:C\n"))
    }

    @Test
    fun updatesFollowClientRules() {
        val m = model()
        m.toggle(2, 0)
        assertEquals(StateModel.Offer.APPLIED, m.offer(1, 2, 111, 222, 333))
        assertEquals(300L + 111L, m.total)
        assertEquals(StateModel.Offer.DUPLICATE, m.offer(1, 2, 444, 555, 666))
        assertEquals(StateModel.Offer.GAP, m.offer(3, 0, 444, 555, 666))
        assertEquals(1, m.lastAppliedSeq)
        assertEquals(3L, m.received)
        assertEquals(1L, m.applied)
        assertEquals(1L, m.duplicates)
        assertEquals(1L, m.gaps)
        assertEquals(
            "mb-state-v1\nprofile=small\nseq=1\nvalues=100,9999,1234,5000,200,300,111,222,333\nselection=1:C,2:A\n",
            m.stateText(),
        )
    }

    @Test
    fun insightsOrderAndBuckets() {
        val ins = model().insights()
        // A values: 100, 5000, 5000 -> ties keep the lower index first.
        assertEquals(listOf(1, 2, 0), ins.topItems.toList())
        assertEquals(listOf(5000, 5000, 100), ins.topValues.toList())
        // B values 9999 -> bucket 4, 200 -> 0, 4000 -> 1 (floor((4000 - 100) * 5 / 9900) = 1).
        assertEquals(listOf(1, 1, 0, 0, 1), ins.buckets.toList())
        assertEquals("mb-insights-v1\nseq=0\ntop=1:5000,2:5000,0:100\nbuckets=1,1,0,0,1\n", ins.text())
    }

    @Test
    fun restoreRecordRoundTrip() {
        val m = model()
        m.toggle(0, 1)
        m.offer(1, 2, 111, 222, 333)
        val record = RestoreRecord.capture(m, listOf("list", "detail/2"), 1)
        val text = record.serialize()
        assertEquals(
            "{\"v\":2,\"route\":[\"list\",\"detail/2\"],\"anchor\":1,\"selection\":[[0,1],[1,2]],\"lastSeq\":1," +
                "\"values\":[[100,9999,1234],[5000,200,300],[111,222,333]]}\n",
            text,
        )
        val restored = model()
        restored.restore(RestoreRecord.parse(text, 3))
        assertEquals(m.stateDigest(), restored.stateDigest())
        assertEquals(m.total, restored.total)
        assertEquals(m.selectedCount, restored.selectedCount)
    }

    @Test
    fun restoreRecordRejectsInvalidInput() {
        val bad = listOf(
            "not json",
            "{\"v\":1,\"route\":[\"list\"],\"anchor\":0,\"selection\":[],\"lastSeq\":0}",
            "{\"v\":2,\"route\":[\"detail/1\"],\"anchor\":0,\"selection\":[],\"lastSeq\":0,\"values\":[[100,100,100],[100,100,100],[100,100,100]]}",
            "{\"v\":2,\"route\":[\"list\",\"detail/9\"],\"anchor\":0,\"selection\":[],\"lastSeq\":0,\"values\":[[100,100,100],[100,100,100],[100,100,100]]}",
            "{\"v\":2,\"route\":[\"list\"],\"anchor\":0,\"selection\":[],\"lastSeq\":0,\"values\":[[100,100,100]]}",
        )
        bad.forEach { text ->
            try {
                RestoreRecord.parse(text, 3)
                fail("accepted: $text")
            } catch (e: RestoreException) {
                // expected
            }
        }
    }

    @Test
    fun streamFramesParse() {
        assertEquals(StreamFrame.Update(17, 42, 1234, 567, 8910), StreamFrame.parse("{\"t\":\"u\",\"s\":17,\"i\":42,\"v\":[1234,567,8910]}"))
        assertEquals(StreamFrame.End(600), StreamFrame.parse("{\"t\":\"e\",\"last\":600}"))
        assertEquals(StreamFrame.Checkpoint(3, 417), StreamFrame.parse("{\"t\":\"c\",\"k\":3,\"last\":417}"))
        assertEquals(StreamFrame.Resume(418), StreamFrame.parse("{\"t\":\"r\",\"from\":418}"))
        try {
            StreamFrame.parse("{\"t\":\"x\"}")
            fail("unknown frame accepted")
        } catch (e: StreamProtocolException) {
            // expected
        }
    }

    @Test
    fun fixtureValidation() {
        try {
            Fixture.parse(fixtureText, "representative")
            fail("profile mismatch accepted")
        } catch (e: FixtureException) {
            // expected
        }
        try {
            Fixture.parse(fixtureText.replace("9999, 1234", "10000, 1234"), "small")
            fail("out-of-range value accepted")
        } catch (e: FixtureException) {
            // expected
        }
    }

    @Test
    fun launchConfigValidation() {
        val ok = LaunchConfig.parse(mapOf("mb.profile" to "small", "mb.journey" to "j-1", "mb.restore" to "1", "mb.other" to "x"))
        assertTrue(ok.isValid)
        assertEquals("small", ok.profile)
        assertEquals("j-1", ok.journey)
        assertTrue(ok.restore)
        assertEquals(listOf("mb.other"), ok.unknown)

        val defaults = LaunchConfig.parse(emptyMap())
        assertTrue(defaults.isValid)
        assertEquals("representative", defaults.profile)
        assertFalse(defaults.restore)
        assertEquals("control", defaults.markerMirror)

        assertFalse(LaunchConfig.parse(mapOf("mb.profile" to "huge")).isValid)
        assertFalse(LaunchConfig.parse(mapOf("mb.restore" to "yes")).isValid)
        assertFalse(LaunchConfig.parse(mapOf("mb.journey" to "has space")).isValid)
        assertFalse(LaunchConfig.parse(mapOf("mb.server" to "ws://example.org:8787")).isValid)
        // Valid values this candidate does not support fail loudly.
        assertFalse(LaunchConfig.parse(mapOf("mb.server" to "ws://localhost:8787")).isValid)
        assertFalse(LaunchConfig.parse(mapOf("mb.bridgeBench" to "sync")).isValid)
        assertTrue(LaunchConfig.parse(mapOf("mb.semantics" to "on", "mb.markerMirror" to "all")).isValid)
    }
}
