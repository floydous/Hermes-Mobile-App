package com.hermesagent.nativemobile.data.api

import com.hermesagent.nativemobile.data.model.CronJob
import com.hermesagent.nativemobile.data.model.CronList
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.data.model.LiveProfile
import com.hermesagent.nativemobile.data.model.LiveSession
import com.hermesagent.nativemobile.util.RemoteLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class HermesApiClient(
    private val endpointProvider: () -> String,
    private val authHeadersProvider: () -> Map<String, String> = { emptyMap() },
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private fun buildRequest(path: String): Request.Builder {
        val base = endpointProvider().trimEnd('/')
        val url = if (path.startsWith("/")) "$base$path" else "$base/$path"
        val builder = Request.Builder().url(url)
        for ((k, v) in authHeadersProvider()) {
            builder.addHeader(k, v)
        }
        return builder
    }

    suspend fun getProfiles(): List<LiveProfile> = withContext(Dispatchers.IO) {
        val path = "/api/profiles"
        RemoteLogger.d("ApiClient", "GET $path")
        try {
            val request = buildRequest(path).get().build()
            client.newCall(request).execute().use { response ->
                RemoteLogger.d("ApiClient", "GET $path -> HTTP ${response.code}")
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string() ?: "[]"
                val element = json.parseToJsonElement(body)
                if (element is JsonObject && element.containsKey("profiles")) {
                    json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(LiveProfile.serializer()), element["profiles"]!!)
                } else {
                    json.decodeFromString<List<LiveProfile>>(body)
                }
            }
        } catch (e: Exception) {
            RemoteLogger.w("ApiClient", "GET $path failed: ${e.message}")
            emptyList()
        }
    }

    suspend fun getSessions(limit: Int = 100, offset: Int = 0): List<LiveSession> = withContext(Dispatchers.IO) {
        val path = "/api/profiles/sessions?limit=$limit&offset=$offset&min_messages=1&archived=exclude&order=recent&profile=all&exclude_sources=cron,kanban,tool,oneshot"
        RemoteLogger.d("ApiClient", "GET $path")
        try {
            val request = buildRequest(path).get().build()
            client.newCall(request).execute().use { response ->
                RemoteLogger.d("ApiClient", "GET sessions -> HTTP ${response.code}")
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string() ?: "{}"
                val element = json.parseToJsonElement(body)
                if (element is JsonObject && element.containsKey("sessions")) {
                    val sessionsObj = element["sessions"]
                    if (sessionsObj is JsonObject && sessionsObj.containsKey("sessions")) {
                        json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(LiveSession.serializer()), sessionsObj["sessions"]!!)
                    } else if (sessionsObj != null) {
                        json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(LiveSession.serializer()), sessionsObj)
                    } else {
                        emptyList()
                    }
                } else {
                    emptyList()
                }
            }
        } catch (e: Exception) {
            RemoteLogger.w("ApiClient", "GET sessions failed: ${e.message}")
            emptyList()
        }
    }

    suspend fun getSessionMessages(sessionId: String, limit: Int = 50, offset: Int = 0): List<LiveMessage> = withContext(Dispatchers.IO) {
        if (sessionId.startsWith("draft:") || sessionId.startsWith("session-client-")) {
            return@withContext emptyList()
        }
        val encoded = URLEncoder.encode(sessionId, "UTF-8")
        val path = "/api/sessions/$encoded/messages?limit=$limit&offset=$offset"
        RemoteLogger.d("ApiClient", "GET $path")
        try {
            val request = buildRequest(path).get().build()
            client.newCall(request).execute().use { response ->
                RemoteLogger.d("ApiClient", "GET messages -> HTTP ${response.code}")
                if (response.code == 404) return@withContext emptyList()
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string() ?: "[]"
                val element = json.parseToJsonElement(body)
                if (element is JsonObject && element.containsKey("messages")) {
                    json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(LiveMessage.serializer()), element["messages"]!!)
                } else {
                    json.decodeFromString<List<LiveMessage>>(body)
                }
            }
        } catch (e: Exception) {
            RemoteLogger.w("ApiClient", "GET messages failed: ${e.message}")
            emptyList()
        }
    }

    suspend fun deleteSession(sessionId: String): Boolean = withContext(Dispatchers.IO) {
        val encoded = URLEncoder.encode(sessionId, "UTF-8")
        val path = "/api/sessions/$encoded"
        try {
            val request = buildRequest(path).delete().build()
            client.newCall(request).execute().use { response ->
                response.isSuccessful
            }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun triggerCronJob(jobId: String, profile: String? = null): Boolean = withContext(Dispatchers.IO) {
        val encoded = URLEncoder.encode(jobId, "UTF-8")
        val query = if (!profile.isNullOrBlank()) "?profile=${URLEncoder.encode(profile, "UTF-8")}" else ""
        val path = "/api/cron/jobs/$encoded/trigger$query"
        RemoteLogger.d("ApiClient", "POST $path")
        try {
            val request = buildRequest(path).post(okhttp3.RequestBody.create(null, ByteArray(0))).build()
            client.newCall(request).execute().use { response ->
                RemoteLogger.d("ApiClient", "POST $path -> HTTP ${response.code}")
                response.isSuccessful
            }
        } catch (e: Exception) {
            RemoteLogger.e("ApiClient", "Failed to trigger cron job", e)
            false
        }
    }

    suspend fun getCronJobs(): List<CronJob> = withContext(Dispatchers.IO) {
        val path = "/api/cron/jobs"
        try {
            val request = buildRequest(path).get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string() ?: "{}"
                val list = json.decodeFromString<CronList>(body)
                list.jobs
            }
        } catch (e: Exception) {
            emptyList()
        }
    }
}
