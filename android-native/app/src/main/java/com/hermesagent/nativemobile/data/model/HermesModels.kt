package com.hermesagent.nativemobile.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class LiveProfile(
    val name: String,
    @SerialName("display_name") val displayName: String? = null,
    val avatar: String? = null,
    val model: String? = null,
    val provider: String? = null,
    val system: String? = null,
    @SerialName("canonical_session") val canonicalSession: LiveSession? = null,
    @SerialName("last_session") val lastSession: LiveSession? = null
)

@Serializable
data class LiveSession(
    val id: String,
    val title: String = "",
    val preview: String = "",
    val profile: String = "default",
    val source: String? = null,
    val model: String? = null,
    val unread: Boolean = false,
    @SerialName("unread_count") val unreadCount: Int = 0,
    @SerialName("message_count") val messageCount: Int = 0,
    @SerialName("last_active") val lastActive: Double? = null,
    @SerialName("resolved_id") val resolvedId: String? = null
)

@Serializable
data class LiveMessage(
    val id: Long = 0L,
    val role: String, // "user", "assistant", "tool", "system"
    val content: String? = null,
    @SerialName("display_content") val displayContent: String? = null,
    @SerialName("display_kind") val displayKind: String? = null,
    @SerialName("tool_name") val toolName: String? = null,
    @SerialName("tool_status") val toolStatus: String? = null, // "running", "done", "failed"
    @SerialName("duration_s") val durationS: Double? = null,
    val reasoning: String? = null,
    val timestamp: Double? = null,
    @SerialName("token_count") val tokenCount: Long? = null,
    val usage: LiveUsage? = null,
    @SerialName("row_id") val rowId: Long? = null,
    val local: Boolean = false
) {
    val text: String get() = displayContent ?: content ?: ""
}

@Serializable
data class LiveUsage(
    val model: String? = null,
    val input: Long = 0L,
    val output: Long = 0L,
    val reasoning: Long = 0L,
    val prompt: Long = 0L,
    val completion: Long = 0L,
    val total: Long = 0L,
    val calls: Long = 0L,
    @SerialName("avg_tps") val avgTps: Double? = null,
    @SerialName("avg_latency_s") val avgLatencyS: Double? = null
)

@Serializable
data class JsonRpcRequest(
    val jsonrpc: String = "2.0",
    val id: Long,
    val method: String,
    val params: JsonElement? = null
)

@Serializable
data class JsonRpcResponse(
    val jsonrpc: String = "2.0",
    val id: Long? = null,
    val result: JsonElement? = null,
    val error: JsonRpcError? = null,
    val method: String? = null,
    val params: JsonElement? = null
)

@Serializable
data class JsonRpcError(
    val code: Int = 0,
    val message: String = "",
    val data: JsonElement? = null
)

@Serializable
data class ClarifyQuestion(
    val qid: String,
    val question: String,
    val choices: List<String>? = null,
    @SerialName("multi_select") val multiSelect: Boolean = false
)

@Serializable
data class ClarifyRequest(
    val requestId: String,
    val sessionId: String,
    val questions: List<ClarifyQuestion> = emptyList()
)

@Serializable
data class ClarifyHistoryResponse(
    val question: String,
    @SerialName("choices_offered") val choicesOffered: List<String>? = null,
    val status: String, // "answered", "skipped", "unanswered"
    @SerialName("user_response") val userResponse: String? = null
)

@Serializable
data class CronJob(
    @SerialName("job_id") val jobId: String,
    val id: String? = null,
    val name: String? = null,
    val prompt: String? = null,
    @SerialName("prompt_preview") val promptPreview: String? = null,
    val schedule: String? = null,
    val enabled: Boolean = true,
    val state: String? = null,
    @SerialName("next_run_at") val nextRunAt: String? = null,
    @SerialName("last_run_at") val lastRunAt: String? = null,
    @SerialName("last_status") val lastStatus: String? = null,
    @SerialName("last_error") val lastError: String? = null,
    val deliver: String? = null,
    val model: String? = null,
    val provider: String? = null,
    val profile: String? = null
)

@Serializable
data class CronList(
    val jobs: List<CronJob> = emptyList(),
    val scoped: String? = null
)

@Serializable
data class ModelProvider(
    val name: String,
    val slug: String,
    val models: List<String> = emptyList(),
    @SerialName("featured_models") val featuredModels: List<String> = emptyList(),
    val authenticated: Boolean = false
)

@Serializable
data class Capability(
    val name: String,
    val description: String? = null,
    val label: String? = null,
    @SerialName("tool_count") val toolCount: Int = 0,
    val enabled: Boolean = true
)

@Serializable
data class ProfileDetails(
    val name: String,
    val description: String? = null,
    val soul: String? = null,
    val skills: List<Capability> = emptyList(),
    val toolsets: List<Capability> = emptyList()
)
