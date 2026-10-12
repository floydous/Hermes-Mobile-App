package com.hermesagent.nativemobile.data.gateway

import com.hermesagent.nativemobile.data.model.JsonRpcError
import com.hermesagent.nativemobile.data.model.JsonRpcRequest
import com.hermesagent.nativemobile.data.model.JsonRpcResponse
import com.hermesagent.nativemobile.util.RemoteLogger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

data class GatewayEvent(
    val type: String,
    val payload: JsonObject = JsonObject(emptyMap()),
    val sessionId: String? = null,
    val turnId: String? = null,
    val messageId: String? = null,
    val seq: Int? = null,
    val isTerminal: Boolean = false
) {
    companion object {
        val TERMINAL_TYPES = setOf("message.complete", "turn.end", "turn.error", "error")
    }
}

class GatewayRpcException(
    val method: String,
    message: String,
    val code: Int = 0,
    val data: JsonElement? = null
) : Exception(message)

data class SubmitPromptOptions(
    val truncateMessageId: String? = null,
    val truncateRowId: Long? = null,
    val truncateOrdinal: Int? = null
)

class HermesGatewayClient(
    private val endpointProvider: () -> String,
    private val authHeadersProvider: () -> Map<String, String> = { emptyMap() },
    private val ticketProvider: suspend () -> String? = { null },
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // Keep alive for WebSocket
        .build()
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private var webSocket: WebSocket? = null
    private val nextId = AtomicLong(1)
    private val pendingCalls = ConcurrentHashMap<Long, CompletableDeferred<JsonElement>>()

    private val _events = MutableSharedFlow<GatewayEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<GatewayEvent> = _events.asSharedFlow()

    private val readyDeferred = CompletableDeferred<Unit>()
    private var heartbeatJob: Job? = null
    private var isConnected = false

    private val resolvedSessions = ConcurrentHashMap<String, String>()

    suspend fun connect() {
        if (isConnected && webSocket != null) return

        val endpoint = endpointProvider().trimEnd('/')
        val wsBase = if (endpoint.startsWith("https://")) {
            endpoint.replaceFirst("https://", "wss://") + "/api/ws"
        } else {
            endpoint.replaceFirst("http://", "ws://") + "/api/ws"
        }

        val ticket = try { ticketProvider() } catch (_: Exception) { null }
        val wsUrl = if (!ticket.isNullOrBlank()) {
            if (ticket.startsWith("token:")) {
                "$wsBase?token=${ticket.removePrefix("token:")}"
            } else {
                "$wsBase?ticket=$ticket"
            }
        } else {
            wsBase
        }

        val requestBuilder = Request.Builder().url(wsUrl)
        for ((k, v) in authHeadersProvider()) {
            requestBuilder.addHeader(k, v)
        }

        RemoteLogger.d("GatewayClient", "Connecting to WebSocket: $wsUrl")
        val deferred = CompletableDeferred<Unit>()

        webSocket = client.newWebSocket(requestBuilder.build(), object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                RemoteLogger.i("GatewayClient", "WebSocket OPEN to $wsUrl, HTTP ${response.code}")
                isConnected = true
                deferred.complete(Unit)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                RemoteLogger.d("GatewayClient", "WS INBOUND: ${text.take(120)}")
                handleInboundMessage(text)
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                RemoteLogger.w("GatewayClient", "WebSocket CLOSING: code=$code, reason=$reason")
                ws.close(code, reason)
                handleDisconnected()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                RemoteLogger.e("GatewayClient", "WebSocket FAILURE: HTTP ${response?.code}, error=${t.message}", t)
                handleDisconnected()
                if (!deferred.isCompleted) {
                    deferred.completeExceptionally(t)
                }
            }
        })

        deferred.await()
    }

    private fun handleDisconnected() {
        isConnected = false
        heartbeatJob?.cancel()
        heartbeatJob = null
        for ((_, call) in pendingCalls) {
            call.completeExceptionally(Exception("Hermes Gateway connection lost"))
        }
        pendingCalls.clear()
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && isConnected) {
                delay(20_000) // 20s heartbeat keep-alive
                try {
                    call("ping", timeoutMs = 5000)
                } catch (_: Exception) {
                    // Gateway heartbeat failed or timed out
                }
            }
        }
    }

    private fun handleInboundMessage(raw: String) {
        val lines = raw.lines().filter { it.isNotBlank() }
        for (line in lines) {
            val element = try {
                json.parseToJsonElement(line).jsonObject
            } catch (_: Exception) {
                continue
            }

            // 1. JSON-RPC responses (has id as number matching pending call)
            val idLong = element["id"]?.jsonPrimitive?.content?.toLongOrNull()
            if (idLong != null && pendingCalls.containsKey(idLong)) {
                val call = pendingCalls.remove(idLong)
                val errorElement = element["error"]
                if (errorElement != null && errorElement is JsonObject) {
                    val code = errorElement["code"]?.jsonPrimitive?.intOrNull ?: 0
                    val msg = errorElement["message"]?.jsonPrimitive?.content ?: "RPC failed"
                    call?.completeExceptionally(GatewayRpcException("rpc", msg, code, errorElement["data"]))
                } else {
                    val result = element["result"] ?: JsonObject(emptyMap())
                    call?.complete(result)
                }
                continue
            }

            // 2. Event notifications (method == "event")
            val method = element["method"]?.jsonPrimitive?.content
            if (method == "event") {
                val params = element["params"]?.jsonObject ?: continue
                val type = params["type"]?.jsonPrimitive?.content ?: continue
                val payload = params["payload"]?.jsonObject ?: JsonObject(emptyMap())
                val sessionId = params["session_id"]?.jsonPrimitive?.content
                    ?: params["sid"]?.jsonPrimitive?.content
                    ?: payload["session_id"]?.jsonPrimitive?.content

                val turnId = params["turn_id"]?.jsonPrimitive?.content ?: payload["turn_id"]?.jsonPrimitive?.content
                val msgId = params["message_id"]?.jsonPrimitive?.content ?: payload["message_id"]?.jsonPrimitive?.content
                val seq = params["seq"]?.jsonPrimitive?.intOrNull

                val event = GatewayEvent(
                    type = type,
                    payload = payload,
                    sessionId = sessionId,
                    turnId = turnId,
                    messageId = msgId,
                    seq = seq,
                    isTerminal = GatewayEvent.TERMINAL_TYPES.contains(type)
                )

                if (type == "gateway.ready") {
                    scope.launch {
                        advertiseCapabilities()
                        startHeartbeat()
                        if (!readyDeferred.isCompleted) {
                            readyDeferred.complete(Unit)
                        }
                    }
                }

                scope.launch {
                    _events.emit(event)
                }
            }

            // 3. Server-initiated request frames (srq-...)
            val srqId = element["id"]?.jsonPrimitive?.content
            if (srqId != null && srqId.startsWith("srq-") && method != null) {
                // Route clarify or tool confirmation requests
                val params = element["params"]?.jsonObject ?: JsonObject(emptyMap())
                val event = GatewayEvent(
                    type = method,
                    payload = params,
                    sessionId = params["session_id"]?.jsonPrimitive?.content,
                    messageId = srqId
                )
                scope.launch {
                    _events.emit(event)
                }
            }
        }
    }

    private suspend fun advertiseCapabilities() {
        val payload = buildJsonObject {
            put("client", "hermes-mobile-native")
            put("version", "1.0.0")
            putJsonObject("features") {
                put("tools.clarify", true)
                put("tools.command", true)
            }
        }
        try {
            call("client.capabilities", payload, timeoutMs = 5000)
        } catch (_: Exception) {}
    }

    suspend fun call(method: String, params: JsonElement? = null, timeoutMs: Long = 25000): JsonElement {
        val id = nextId.getAndIncrement()
        val deferred = CompletableDeferred<JsonElement>()
        pendingCalls[id] = deferred

        val requestObj = buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", id)
            put("method", method)
            if (params != null) {
                put("params", params)
            }
        }

        val sent = webSocket?.send(json.encodeToString(JsonElement.serializer(), requestObj)) ?: false
        if (!sent) {
            pendingCalls.remove(id)
            throw Exception("Failed to send RPC request $method: WebSocket not open")
        }

        return withTimeout(timeoutMs) {
            deferred.await()
        }
    }

    suspend fun listProfiles(): List<com.hermesagent.nativemobile.data.model.LiveProfile> {
        val params = buildJsonObject {
            put("include_sessions", true)
        }
        val result = call("profiles.list", params).jsonObject
        val profilesElement = result["profiles"] ?: return emptyList()
        return json.decodeFromJsonElement(
            kotlinx.serialization.builtins.ListSerializer(com.hermesagent.nativemobile.data.model.LiveProfile.serializer()),
            profilesElement
        )
    }

    suspend fun createSession(profile: String, title: String = "New chat"): com.hermesagent.nativemobile.data.model.LiveSession {
        val params = buildJsonObject {
            put("profile", profile)
            put("title", title)
            put("hidden", false)
            put("follow_profile_config", true)
        }
        val result = call("session.create", params).jsonObject
        val sid = result["stored_session_id"]?.jsonPrimitive?.content
            ?: result["session_id"]?.jsonPrimitive?.content
            ?: result["id"]?.jsonPrimitive?.content
            ?: "session-client-${System.currentTimeMillis()}"

        val runtimeId = result["session_id"]?.jsonPrimitive?.content
        if (runtimeId != null) {
            resolvedSessions[sid] = runtimeId
            resolvedSessions[runtimeId] = sid
        }

        return com.hermesagent.nativemobile.data.model.LiveSession(
            id = sid,
            title = title,
            profile = profile,
            lastActive = System.currentTimeMillis().toDouble()
        )
    }

    suspend fun resumeSession(sessionId: String, profile: String? = null): String {
        val params = buildJsonObject {
            put("session_id", sessionId)
            if (profile != null) put("profile", profile)
        }
        val result = call("session.resume", params).jsonObject
        val runtimeSessionId = result["session_id"]?.jsonPrimitive?.content
            ?: result["sid"]?.jsonPrimitive?.content
            ?: sessionId

        resolvedSessions[sessionId] = runtimeSessionId
        resolvedSessions[runtimeSessionId] = sessionId
        return runtimeSessionId
    }

    suspend fun submitPrompt(sessionId: String, prompt: String, options: SubmitPromptOptions = SubmitPromptOptions()): JsonElement {
        val resolvedSid = resolvedSessions[sessionId] ?: sessionId
        val params = buildJsonObject {
            put("session_id", resolvedSid)
            put("text", prompt)
            if (options.truncateRowId != null) {
                put("confirm_truncate", true)
                put("truncate_before_row_id", options.truncateRowId)
                if (options.truncateRowId == 0L || options.truncateRowId == 1L) {
                    put("confirm_empty_truncate", true)
                }
            } else if (options.truncateMessageId != null) {
                put("confirm_truncate", true)
                put("truncate_before_message_id", options.truncateMessageId)
            }
            if (options.truncateOrdinal != null) {
                put("confirm_truncate", true)
                put("truncate_ordinal", options.truncateOrdinal)
            }
        }
        return call("prompt.submit", params)
    }

    suspend fun interruptSession(sessionId: String) {
        val resolvedSid = resolvedSessions[sessionId] ?: sessionId
        val params = buildJsonObject {
            put("session_id", resolvedSid)
        }
        call("session.interrupt", params, timeoutMs = 5000)
    }

    fun respondToServerRequest(id: String, result: JsonElement? = null, error: JsonRpcError? = null) {
        val socket = webSocket ?: return
        val frame = if (error != null) {
            buildJsonObject {
                put("jsonrpc", "2.0")
                put("id", id)
                put("error", buildJsonObject {
                    put("code", error.code)
                    put("message", error.message)
                })
            }
        } else {
            buildJsonObject {
                put("jsonrpc", "2.0")
                put("id", id)
                put("result", result ?: buildJsonObject {})
            }
        }
        socket.send(json.encodeToString(JsonElement.serializer(), frame) + "\n")
    }

    suspend fun answerClarify(requestId: String, answers: Map<String, String>) {
        val resultPayload = buildJsonObject {
            put("answers", buildJsonObject {
                for ((k, v) in answers) {
                    put(k, v)
                }
            })
        }
        respondToServerRequest(requestId, resultPayload)
    }

    fun getResolvedSessionId(sessionId: String): String {
        return resolvedSessions[sessionId] ?: sessionId
    }
}
