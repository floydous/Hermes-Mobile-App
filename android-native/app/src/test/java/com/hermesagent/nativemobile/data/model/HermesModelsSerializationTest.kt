package com.hermesagent.nativemobile.data.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class HermesModelsSerializationTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    @Test
    fun testLiveMessageSerializationWithUsageAndTokens() {
        val jsonString = """
        {
            "id": 101,
            "role": "assistant",
            "content": "Hello user",
            "display_content": null,
            "display_kind": null,
            "tool_name": null,
            "tool_status": null,
            "duration_s": 1.25,
            "reasoning": "Quick thought",
            "timestamp": 1728500000000,
            "token_count": 42,
            "usage": {
                "model": "nous-hermes-3",
                "input": 120,
                "output": 42,
                "reasoning": 15,
                "prompt": 120,
                "completion": 42,
                "total": 162,
                "calls": 1,
                "avg_tps": 33.6,
                "avg_latency_s": 1.25
            },
            "row_id": 999,
            "local": false
        }
        """.trimIndent()

        val message = json.decodeFromString<LiveMessage>(jsonString)
        assertEquals(101L, message.id)
        assertEquals("assistant", message.role)
        assertEquals("Hello user", message.content)
        assertEquals(42L, message.tokenCount)
        assertNotNull(message.usage)
        assertEquals(162L, message.usage?.total)
        assertEquals(33.6, message.usage?.avgTps!!, 0.01)
        assertEquals(999L, message.rowId)
    }

    @Test
    fun testLiveProfileAndCanonicalSessionSerialization() {
        val jsonString = """
        {
            "name": "researcher",
            "display_name": "Deep Researcher",
            "avatar": null,
            "model": "nous-hermes-3",
            "provider": "local",
            "system": "You are a research agent",
            "canonical_session": {
                "id": "20261012_res123",
                "title": "Bot Chat",
                "preview": "Recent discovery",
                "profile": "researcher",
                "last_active": 1728500000000
            }
        }
        """.trimIndent()

        val profile = json.decodeFromString<LiveProfile>(jsonString)
        assertEquals("researcher", profile.name)
        assertEquals("Deep Researcher", profile.displayName)
        assertNotNull(profile.canonicalSession)
        assertEquals("20261012_res123", profile.canonicalSession?.id)
        assertEquals("Bot Chat", profile.canonicalSession?.title)
    }

    @Test
    fun testClarifyRequestSerialization() {
        val jsonString = """
        {
            "requestId": "cr-987",
            "sessionId": "sess-abc",
            "questions": [
                {
                    "qid": "q1",
                    "question": "Which architecture?",
                    "choices": ["Monolithic", "Microservices"],
                    "multi_select": false
                }
            ]
        }
        """.trimIndent()

        val clarify = json.decodeFromString<ClarifyRequest>(jsonString)
        assertEquals("cr-987", clarify.requestId)
        assertEquals("sess-abc", clarify.sessionId)
        assertEquals(1, clarify.questions.size)
        assertEquals("Which architecture?", clarify.questions[0].question)
        assertEquals(2, clarify.questions[0].choices?.size)
    }
}
