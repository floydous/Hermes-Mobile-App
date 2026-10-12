package com.hermesagent.nativemobile.data.gateway

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HermesGatewayClientTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun testEventTerminalClassification() {
        val completeEvent = GatewayEvent(
            type = "message.complete",
            sessionId = "sess-123",
            isTerminal = GatewayEvent.TERMINAL_TYPES.contains("message.complete")
        )
        assertTrue(completeEvent.isTerminal)

        val chunkEvent = GatewayEvent(
            type = "message.chunk",
            sessionId = "sess-123",
            isTerminal = GatewayEvent.TERMINAL_TYPES.contains("message.chunk")
        )
        assertTrue(!chunkEvent.isTerminal)
    }

    @Test
    fun testSubmitPromptSerializationWithRowId() {
        val options = SubmitPromptOptions(truncateRowId = 42L, truncateMessageId = "msg-1")
        val params = buildJsonObject {
            put("session_id", "sess-123")
            put("text", "Hello world")
            if (options.truncateRowId != null) {
                put("confirm_truncate", true)
                put("truncate_before_row_id", options.truncateRowId!!)
            } else if (options.truncateMessageId != null) {
                put("confirm_truncate", true)
                put("truncate_before_message_id", options.truncateMessageId!!)
            }
        }

        assertEquals(42L, params["truncate_before_row_id"]?.jsonPrimitive?.content?.toLong())
        // When truncateRowId is present, truncate_before_message_id must be suppressed
        assertTrue(!params.containsKey("truncate_before_message_id"))
    }

    @Test
    fun testBidirectionalSessionMapping() {
        val client = HermesGatewayClient(endpointProvider = { "http://10.0.0.130:9119" })
        assertEquals("canonical-1", client.getResolvedSessionId("canonical-1"))
    }
}
