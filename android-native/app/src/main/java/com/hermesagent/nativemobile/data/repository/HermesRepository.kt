package com.hermesagent.nativemobile.data.repository

import com.hermesagent.nativemobile.data.api.HermesApiClient
import com.hermesagent.nativemobile.data.auth.HermesAuthClient
import com.hermesagent.nativemobile.data.auth.HermesAuthStore
import com.hermesagent.nativemobile.data.gateway.GatewayEvent
import com.hermesagent.nativemobile.data.gateway.HermesGatewayClient
import com.hermesagent.nativemobile.data.gateway.SubmitPromptOptions
import com.hermesagent.nativemobile.data.model.ClarifyRequest
import com.hermesagent.nativemobile.data.model.CronJob
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.data.model.LiveProfile
import com.hermesagent.nativemobile.data.model.LiveSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.ConcurrentHashMap

data class ActiveTurn(
    val sessionId: String,
    val profile: String,
    val status: String = "thinking",
    val statusText: String = "Thinking…",
    val streamingText: String = "",
    val startedAt: Long = System.currentTimeMillis()
)

class HermesRepository(
    private val authStore: HermesAuthStore,
    private val authClient: HermesAuthClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _profiles = MutableStateFlow<List<LiveProfile>>(emptyList())
    val profiles: StateFlow<List<LiveProfile>> = _profiles.asStateFlow()

    private val _sessions = MutableStateFlow<List<LiveSession>>(emptyList())
    val sessions: StateFlow<List<LiveSession>> = _sessions.asStateFlow()

    private val _cronJobs = MutableStateFlow<List<CronJob>>(emptyList())
    val cronJobs: StateFlow<List<CronJob>> = _cronJobs.asStateFlow()

    private val _activeTurns = MutableStateFlow<Map<String, ActiveTurn>>(emptyMap())
    val activeTurns: StateFlow<Map<String, ActiveTurn>> = _activeTurns.asStateFlow()

    private val _currentSessionMessages = MutableStateFlow<List<LiveMessage>>(emptyList())
    val currentSessionMessages: StateFlow<List<LiveMessage>> = _currentSessionMessages.asStateFlow()

    private val _pendingClarify = MutableStateFlow<ClarifyRequest?>(null)
    val pendingClarify: StateFlow<ClarifyRequest?> = _pendingClarify.asStateFlow()

    private val _connectionStatus = MutableStateFlow("disconnected") // "connecting", "connected", "disconnected"
    val connectionStatus: StateFlow<String> = _connectionStatus.asStateFlow()

    private val messageCache = ConcurrentHashMap<String, List<LiveMessage>>()
    private val inFlightTurns = ConcurrentHashMap.newKeySet<String>()

    private var apiClient: HermesApiClient = createApiClient()
    private var gatewayClient: HermesGatewayClient = createGatewayClient()

    init {
        setupGatewayListener()
    }

    private fun getAuthHeaders(): Map<String, String> {
        val headers = mutableMapOf<String, String>()
        val token = authStore.getAccessToken()
        val basic = authStore.getBasicAuthHeader()
        if (!token.isNullOrBlank()) {
            headers["Authorization"] = "Bearer $token"
        } else if (!basic.isNullOrBlank()) {
            headers["Authorization"] = basic
        }
        return headers
    }

    private fun createApiClient(): HermesApiClient {
        return HermesApiClient(
            endpointProvider = { authStore.getEndpoint() },
            authHeadersProvider = { getAuthHeaders() }
        )
    }

    private fun createGatewayClient(): HermesGatewayClient {
        return HermesGatewayClient(
            endpointProvider = { authStore.getEndpoint() },
            authHeadersProvider = { getAuthHeaders() },
            ticketProvider = {
                val ep = authStore.getEndpoint()
                val token = authStore.getAccessToken() ?: authStore.getBasicAuthHeader()
                if (!token.isNullOrBlank()) {
                    authClient.mintWsTicket(ep, token)
                } else {
                    val sessionToken = authClient.extractSessionToken(ep)
                    if (!sessionToken.isNullOrBlank()) "token:$sessionToken" else null
                }
            }
        )
    }

    private fun setupGatewayListener() {
        scope.launch {
            gatewayClient.events.collect { event ->
                handleGatewayEvent(event)
            }
        }
    }

    suspend fun updateEndpoint(newEndpoint: String, username: String? = null, password: String? = null) {
        authStore.setEndpoint(newEndpoint)
        if (!username.isNullOrBlank() && !password.isNullOrBlank()) {
            try {
                val token = authClient.loginWithPassword(newEndpoint, username, password)
                if (token.startsWith("Basic ")) {
                    authStore.setBasicAuthHeader(token)
                } else {
                    authStore.setAccessToken(token)
                }
            } catch (_: Exception) {}
        }
        apiClient = createApiClient()
        gatewayClient = createGatewayClient()
        setupGatewayListener()
        refresh()
    }

    suspend fun refresh() {
        _connectionStatus.value = "connecting"
        try {
            // 1. Connect WebSocket gateway
            gatewayClient.connect()
            _connectionStatus.value = "connected"
        } catch (_: Exception) {
            // Gateway connect failed or still attempting
        }

        // 2. Fetch Profiles via WebSocket RPC profiles.list (with HTTP /api/profiles fallback)
        try {
            val profs = try {
                gatewayClient.listProfiles()
            } catch (_: Exception) {
                apiClient.getProfiles()
            }
            if (profs.isNotEmpty()) {
                _profiles.value = profs
                _connectionStatus.value = "connected"
            }
        } catch (_: Exception) {}

        // 3. Fetch Sessions via REST
        try {
            val sess = apiClient.getSessions()
            _sessions.value = sess
            if (sess.isNotEmpty()) {
                _connectionStatus.value = "connected"
            }
        } catch (_: Exception) {}

        // 4. Fetch Cron Jobs via REST
        try {
            val jobs = apiClient.getCronJobs()
            _cronJobs.value = jobs
        } catch (_: Exception) {}

        if (_profiles.value.isEmpty() && _sessions.value.isEmpty()) {
            _connectionStatus.value = "disconnected"
        }
    }

    suspend fun createNewSession(profile: String = "default", title: String = "New chat"): LiveSession {
        return try {
            val session = gatewayClient.createSession(profile, title)
            _sessions.value = listOf(session) + _sessions.value.filter { it.id != session.id }
            session
        } catch (e: Exception) {
            com.hermesagent.nativemobile.util.RemoteLogger.e("Repository", "Failed to create session", e)
            val fallback = LiveSession(
                id = "session-client-${System.currentTimeMillis()}",
                title = title,
                profile = profile,
                lastActive = System.currentTimeMillis()
            )
            _sessions.value = listOf(fallback) + _sessions.value
            fallback
        }
    }

    suspend fun loadSession(session: LiveSession): List<LiveMessage> {
        val cached = messageCache[session.id]
        if (cached != null && cached.isNotEmpty()) {
            _currentSessionMessages.value = cached
        }

        val remote = apiClient.getSessionMessages(session.id)
        val isTurnActive = inFlightTurns.contains(session.id) || inFlightTurns.contains(session.profile)

        val finalMessages = if (remote.isEmpty() && isTurnActive && cached != null && cached.isNotEmpty()) {
            cached
        } else {
            remote
        }

        messageCache[session.id] = finalMessages
        _currentSessionMessages.value = finalMessages
        return finalMessages
    }

    suspend fun submitMessage(session: LiveSession, prompt: String, rowId: Long? = null) {
        val userMsg = LiveMessage(
            id = -System.currentTimeMillis(),
            role = "user",
            content = prompt,
            timestamp = System.currentTimeMillis(),
            local = true
        )

        val updated = _currentSessionMessages.value + userMsg
        _currentSessionMessages.value = updated
        messageCache[session.id] = updated

        inFlightTurns.add(session.id)
        inFlightTurns.add(session.profile)

        val turn = ActiveTurn(
            sessionId = session.id,
            profile = session.profile,
            status = "thinking",
            statusText = "Thinking…"
        )
        _activeTurns.value = _activeTurns.value + (session.profile to turn)

        val options = SubmitPromptOptions(truncateRowId = rowId)
        try {
            gatewayClient.submitPrompt(session.id, prompt, options)
        } catch (e: Exception) {
            inFlightTurns.remove(session.id)
            inFlightTurns.remove(session.profile)
            _activeTurns.value = _activeTurns.value - session.profile
            throw e
        }
    }

    private fun handleGatewayEvent(event: GatewayEvent) {
        val sid = event.sessionId ?: return
        if (event.type == "request.clarify" || event.type == "clarify") {
            val reqId = event.messageId ?: "cr-${System.currentTimeMillis()}"
            _pendingClarify.value = ClarifyRequest(
                requestId = reqId,
                sessionId = sid
            )
        } else if (event.type == "message.delta") {
            val text = event.payload["text"]?.jsonPrimitive?.contentOrNull ?: ""
            val existing = _activeTurns.value.values.find { it.sessionId == sid }
            if (existing != null) {
                val updated = existing.copy(streamingText = existing.streamingText + text)
                _activeTurns.value = _activeTurns.value + (existing.profile to updated)
            }
        } else if (event.isTerminal) {
            inFlightTurns.remove(sid)
            val existing = _activeTurns.value.values.find { it.sessionId == sid }
            if (existing != null) {
                inFlightTurns.remove(existing.profile)
                _activeTurns.value = _activeTurns.value - existing.profile
            }
            scope.launch {
                try {
                    val messages = apiClient.getSessionMessages(sid)
                    if (messages.isNotEmpty()) {
                        messageCache[sid] = messages
                        _currentSessionMessages.value = messages
                    }
                } catch (_: Exception) {}
            }
        }
    }

    suspend fun submitClarifyAnswer(requestId: String, answers: Map<String, String>) {
        gatewayClient.answerClarify(requestId, answers)
        _pendingClarify.value = null
    }

    suspend fun skipClarify(requestId: String) {
        gatewayClient.answerClarify(requestId, emptyMap())
        _pendingClarify.value = null
    }

    suspend fun clearSession(sessionId: String, profile: String) {
        inFlightTurns.remove(sessionId)
        inFlightTurns.remove(profile)
        _activeTurns.value = _activeTurns.value - profile
        messageCache.remove(sessionId)
        _currentSessionMessages.value = emptyList()

        try {
            apiClient.deleteSession(sessionId)
        } catch (_: Exception) {}
        refresh()
    }
}
