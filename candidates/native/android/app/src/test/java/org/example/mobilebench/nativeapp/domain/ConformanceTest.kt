package org.example.mobilebench.nativeapp.domain

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Conformance of the Kotlin state/digest port against fixtures/v1/golden.json (fixtures README, "Conformance
 * check for every port"): the bundled fixture and replay stream are applied and digested at seq 0, 100, 1000
 * and 10 000.
 */
class ConformanceTest {
    private val assetsDir = File(System.getProperty("mb.assetsDir") ?: "")
    private val golden = JSONObject(File(System.getProperty("mb.goldenFile") ?: "").readText())

    @Test
    fun everyProfileMatchesGoldenDigests() {
        assumeTrue("bundled assets missing: run make prepare-native", assetsDir.isDirectory)
        val profiles = golden.getJSONObject("profiles")
        profiles.keys().asSequence().sorted().forEach { name -> checkProfile(name, profiles.getJSONObject(name)) }
    }

    private fun checkProfile(name: String, g: JSONObject) {
        val fixtureFile = File(assetsDir, "$name.json")
        assertEquals("$name sha256", g.getString("sha256"), Sha256.hex(fixtureFile.readBytes()))
        val model = StateModel(name, Fixture.parse(fixtureFile.readText(), name))
        assertEquals(g.getInt("items"), model.itemCount)

        val seq0 = g.getJSONObject("seq0Summary")
        assertEquals(seq0.getInt("selectedCount"), model.selectedCount)
        assertEquals(seq0.getLong("total"), model.total)
        assertEquals(seq0.getString("totalText"), Format.value(model.total))

        val stateDigests = g.getJSONArray("stateDigests").let { a ->
            (0 until a.length()).associate { a.getJSONObject(it).getInt("seq") to a.getJSONObject(it).getString("digest") }
        }
        val insightsDigests = g.getJSONArray("insightsDigests").let { a ->
            (0 until a.length()).associate { a.getJSONObject(it).getInt("seq") to a.getJSONObject(it).getString("digest") }
        }
        assertEquals("$name seq 0", stateDigests[0], model.stateDigest())
        assertEquals("$name insights seq 0", insightsDigests[0], model.insights().digest())

        val streamFile = File(assetsDir, "stream-$name.jsonl")
        assertEquals("$name stream sha256", g.getJSONObject("stream").getString("sha256"), Sha256.hex(streamFile.readBytes()))
        streamFile.bufferedReader().useLines { lines ->
            lines.forEach { line ->
                val u = StreamFrame.parse(line) as StreamFrame.Update
                assertEquals(StateModel.Offer.APPLIED, model.offer(u.seq, u.item, u.v0, u.v1, u.v2))
                stateDigests[u.seq]?.let { assertEquals("$name seq ${u.seq}", it, model.stateDigest()) }
                insightsDigests[u.seq]?.let { assertEquals("$name insights seq ${u.seq}", it, model.insights().digest()) }
            }
        }
        assertEquals(10_000, model.lastAppliedSeq)
        assertEquals(10_000L, model.applied)
        assertEquals(0L, model.duplicates)
        assertEquals(0L, model.gaps)
    }
}
