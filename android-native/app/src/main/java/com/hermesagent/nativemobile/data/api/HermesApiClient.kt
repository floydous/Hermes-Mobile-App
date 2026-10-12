package com.hermesagent.nativemobile.data.api

import com.hermesagent.nativemobile.data.model.CronJob
import com.hermesagent.nativemobile.data.model.CronList
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.data.model.LiveProfile
import com.hermesagent.nativemobile.data.model.LiveSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class HermesApiClient(
    private val endpointProvider: () -> String,
    private val authHeadersProvider: () -> Map<String, String> = { emptyMap() },
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
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
        val request = buildRequest("/api/profiles").get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Failed to fetch profiles: HTTP ${response.code}")
            val body = response.body?.string() ?: "[]"
            // Handles both {"profiles": [...]} and direct list [...]
            val element = json.parseToJsonElement(body)
            if (element is JsonObject && element.containsKey("profiles")) {
                json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(LiveProfile.serializer()), element["profiles"]!!)
            } else {
                json.decodeFromString<List<LiveProfile>>(body)
            }
        }
    }

    suspend fun getSessions(limit: Int = 100, offset: Int = 0): List<LiveSession> = withContext(Dispatchers.IO) {
        val path = "/api/profiles/sessions?limit=$limit&offset=$offset&min_messages=1&archived=exclude&order=recent&profile=all&exclude_sources=cron,kanban,tool,oneshot"
        val request = buildRequest(path).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Failed to fetch sessions: HTTP ${response.code}")
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
    }

    suspend fun getSessionMessages(sessionId: String, limit: Int = 50, offset: Int = 0): List<LiveMessage> = withContext(Dispatchers.IO) {
        val encoded = URLEncoder.encode(sessionId, "UTF-8")
        val path = "/api/sessions/$encoded/messages?limit=$limit&offset=$offset"
        val request = buildRequest(path).get().build()
        client.newCall(request).execute().use { response ->
            if (response.code == 404) return@withContext emptyList()
            if (!response.isSuccessful) throw IOException("Failed to fetch session messages: HTTP ${response.code}")
            val body = response.body?.string() ?: "[]"
            val element = json.parseToJsonElement(body)
            if (element is JsonObject && element.containsKey("messages")) {
                json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(LiveMessage.serializer()), element["messages"]!!)
            } else {
                json.decodeFromString<List<LiveMessage>>(body)
            }
        }
    }

    suspend fun deleteSession(sessionId: String): Boolean = withContext(Dispatchers.IO) {
        val encoded = URLEncoder.encode(sessionId, "UTF-8")
        val path = "/api/sessions/$encoded"
        val request = buildRequest(path).delete().build()
        client.newCall(request).execute().use { response ->
            response.isSuccessful
        }
    }

    suspend fun getCronJobs(): List<CronJob> = withContext(Dispatchers.IO) {
        val request = buildRequest("/api/cron/jobs").get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext emptyList()
            val body = response.body?.string() ?: "{}"
            val list = json.decodeFromString<CronList>(body)
            list.jobs
        }
    }
}
