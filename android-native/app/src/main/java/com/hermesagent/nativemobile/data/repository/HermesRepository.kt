package com.hermesagent.nativemobile.data.repository

import com.hermesagent.nativemobile.data.api.HermesApiClient
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
    val status: String = "thinking", // "thinking", "waiting", "done"
    val statusText: String = "Thinking…",
    val streamingText: String = "",
    val startedAt: Long = System.currentTimeMillis()
)

class HermesRepository(
    private val apiClient: HermesApiClient,
    private val gatewayClient: HermesGatewayClient
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

    private val messageCache = ConcurrentHashMap<String, List<LiveMessage>>()
    private val inFlightTurns = ConcurrentHashMap.newKeySet<String>()

    init {
        scope.launch {
            gatewayClient.events.collect { event ->
                handleGatewayEvent(event)
            }
        }
    }

    suspend fun refresh() {
        try {
            val profs = apiClient.getProfiles()
            _profiles.value = profs
        } catch (_: Exception) {}

        try {
            val sess = apiClient.getSessions()
            _sessions.value = sess
        } catch (_: Exception) {}

        try {
            val jobs = apiClient.getCronJobs()
            _cronJobs.value = jobs
        } catch (_: Exception) {}
    }

    suspend fun loadSession(session: LiveSession): List<LiveMessage> {
        val cached = messageCache[session.id]
        if (cached != null && cached.isNotEmpty()) {
            _currentSessionMessages.value = cached
        }

        val remote = apiClient.getSessionMessages(session.id)
        val isTurnActive = inFlightTurns.contains(session.id) || inFlightTurns.contains(session.profile)

        // Strict Mobile Rule: If turn is active and remote is empty, retain cached local messages
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

        // Optimistically commit message to current transcript
        val updated = _currentSessionMessages.value + userMsg
        _currentSessionMessages.value = updated
        messageCache[session.id] = updated

        // Mark turn as active
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
        if (event.type == "message.delta") {
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
            // Background reload of committed messages
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
