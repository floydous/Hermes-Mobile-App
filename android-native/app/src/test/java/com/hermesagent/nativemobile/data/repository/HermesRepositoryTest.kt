package com.hermesagent.nativemobile.data.repository

import com.hermesagent.nativemobile.data.api.HermesApiClient
import com.hermesagent.nativemobile.data.gateway.HermesGatewayClient
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.data.model.LiveSession
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HermesRepositoryTest {

    @Test
    fun testActiveTurnDataStructure() {
        val turn = ActiveTurn(
            sessionId = "sess-1",
            profile = "researcher",
            status = "thinking",
            statusText = "Piecing together…",
            streamingText = "Here is what I found"
        )

        assertEquals("sess-1", turn.sessionId)
        assertEquals("researcher", turn.profile)
        assertEquals("thinking", turn.status)
        assertEquals("Here is what I found", turn.streamingText)
    }

    @Test
    fun testOptimisticUserMessageCreation() {
        val prompt = "Tell me about quantum computing"
        val userMsg = LiveMessage(
            id = -12345L,
            role = "user",
            content = prompt,
            timestamp = System.currentTimeMillis(),
            local = true
        )

        assertEquals("user", userMsg.role)
        assertEquals(prompt, userMsg.content)
        assertTrue(userMsg.local)
    }
}
