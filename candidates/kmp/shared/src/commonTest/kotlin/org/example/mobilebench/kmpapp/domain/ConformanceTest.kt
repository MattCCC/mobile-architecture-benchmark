package org.example.mobilebench.kmpapp.domain

import kotlinx.serialization.json.*
import kotlin.test.*

class ConformanceTest {
    @Test fun allProfilesAndCheckpointsMatchGolden() {
        val golden = Json.parseToJsonElement(readTestFile("../../fixtures/v1/golden.json")).jsonObject
        for ((name, entry) in golden.getValue("profiles").jsonObject) {
            val g = entry.jsonObject
            val fixtureText = readTestFile("generated/assets/fixtures/$name.json")
            assertEquals(g.getValue("sha256").jsonPrimitive.content, Sha256.hex(fixtureText))
            val m = StateModel(name, Fixture.parse(fixtureText, name))
            val states = g.getValue("stateDigests").jsonArray.associate {
                it.jsonObject.getValue("seq").jsonPrimitive.int to it.jsonObject.getValue("digest").jsonPrimitive.content
            }
            val insights = g.getValue("insightsDigests").jsonArray.associate {
                it.jsonObject.getValue("seq").jsonPrimitive.int to it.jsonObject.getValue("digest").jsonPrimitive.content
            }
            fun check() {
                states[m.lastAppliedSeq]?.let { assertEquals(it, m.stateDigest(), "$name state ${m.lastAppliedSeq}") }
                insights[m.lastAppliedSeq]?.let { assertEquals(it, m.insights().digest(), "$name insights ${m.lastAppliedSeq}") }
            }
            check()
            readTestFile("generated/assets/fixtures/stream-$name.jsonl").lineSequence().filter { it.isNotEmpty() }.forEach { line ->
                val f = StreamFrame.parse(line) as StreamFrame.Update
                assertEquals(StateModel.Offer.APPLIED, m.offer(f.seq, f.item, f.v0, f.v1, f.v2))
                check()
            }
            assertEquals(10000, m.lastAppliedSeq)
            assertEquals(0L, m.gaps)
        }
    }
}

internal expect fun readTestFile(path: String): String
