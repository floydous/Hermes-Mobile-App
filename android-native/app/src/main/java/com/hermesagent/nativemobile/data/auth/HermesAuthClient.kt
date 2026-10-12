package com.hermesagent.nativemobile.data.auth

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

data class GatewayProbeResult(
    val version: String? = null,
    val authRequired: Boolean = false,
    val supportsPassword: Boolean = false,
    val authFlows: List<String> = emptyList()
)

class HermesAuthClient(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    suspend fun probeGateway(endpoint: String): GatewayProbeResult = withContext(Dispatchers.IO) {
        val base = endpoint.trim().trimEnd('/')
        val req = Request.Builder().url("$base/api/status").get().build()
        client.newCall(req).execute().use { response ->
            if (!response.isSuccessful && response.code != 401) {
                throw IOException("Gateway probe failed: HTTP ${response.code}")
            }
            val body = response.body?.string() ?: "{}"
            val element = try { json.parseToJsonElement(body).jsonObject } catch (_: Exception) { JsonObject(emptyMap()) }

            val version = element["version"]?.jsonPrimitive?.content
            val authRequired = element["auth_required"]?.jsonPrimitive?.booleanOrNull ?: false
            val flows = element["auth_flows"]?.jsonArray?.mapNotNull { it.jsonPrimitive.content } ?: emptyList()
            val providers = element["auth_providers"]?.jsonArray ?: emptyList()
            val supportsPassword = providers.any { p ->
                try {
                    val obj = p.jsonObject
                    obj["type"]?.jsonPrimitive?.content == "password" || obj["id"]?.jsonPrimitive?.content == "basic"
                } catch (_: Exception) { false }
            }

            GatewayProbeResult(
                version = version,
                authRequired = authRequired,
                supportsPassword = supportsPassword || flows.contains("password"),
                authFlows = flows
            )
        }
    }

    suspend fun loginWithPassword(endpoint: String, user: String, pass: String): String = withContext(Dispatchers.IO) {
        val base = endpoint.trim().trimEnd('/')

        // 1. Try Hermes PKCE Flow (RFC 8252 loopback authorization code flow)
        try {
            val random = SecureRandom()
            val verifierBytes = ByteArray(32)
            random.nextBytes(verifierBytes)
            val verifier = Base64.encodeToString(verifierBytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

            val md = MessageDigest.getInstance("SHA-256")
            val challengeBytes = md.digest(verifier.toByteArray(Charsets.US_ASCII))
            val challenge = Base64.encodeToString(challengeBytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

            val stateBytes = ByteArray(24)
            random.nextBytes(stateBytes)
            val state = Base64.encodeToString(stateBytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

            val redirect = URLEncoder.encode("http://127.0.0.1:1/callback", "UTF-8")
            val authUrl = "$base/auth/native/authorize?provider=basic&code_challenge=$challenge&code_challenge_method=S256&redirect_uri=$redirect&state=$state"

            val authReq = Request.Builder().url(authUrl).get().build()
            client.newCall(authReq).execute().close()

            val loginPayload = """{"provider":"basic","username":"$user","password":"$pass"}"""
            val loginReq = Request.Builder()
                .url("$base/auth/password-login")
                .post(loginPayload.toRequestBody("application/json".toMediaType()))
                .build()

            client.newCall(loginReq).execute().use { loginRes ->
                if (loginRes.isSuccessful) {
                    val loginBody = loginRes.body?.string() ?: ""
                    val loginJson = json.parseToJsonElement(loginBody).jsonObject
                    val nextUrl = loginJson["next"]?.jsonPrimitive?.content
                    if (nextUrl != null && nextUrl.contains("code=")) {
                        val code = nextUrl.substringAfter("code=").substringBefore("&")
                        val tokenPayload = """{"code":"$code","code_verifier":"$verifier"}"""
                        val tokenReq = Request.Builder()
                            .url("$base/auth/native/token")
                            .post(tokenPayload.toRequestBody("application/json".toMediaType()))
                            .build()

                        client.newCall(tokenReq).execute().use { tokenRes ->
                            if (tokenRes.isSuccessful) {
                                val tokenBody = tokenRes.body?.string() ?: ""
                                val tokenJson = json.parseToJsonElement(tokenBody).jsonObject
                                val accessToken = tokenJson["access_token"]?.jsonPrimitive?.content
                                if (!accessToken.isNullOrBlank()) {
                                    return@withContext accessToken
                                }
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // Fall back to direct Basic Auth
        }

        // 2. Direct HTTP Basic Auth token
        val credentials = "$user:$pass"
        val basic = "Basic " + Base64.encodeToString(credentials.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        basic
    }

    suspend fun mintWsTicket(endpoint: String, token: String): String? = withContext(Dispatchers.IO) {
        val base = endpoint.trim().trimEnd('/')
        val reqBuilder = Request.Builder().url("$base/api/auth/ws-ticket").post("{}".toRequestBody("application/json".toMediaType()))
        if (token.startsWith("Basic ")) {
            reqBuilder.addHeader("Authorization", token)
        } else {
            reqBuilder.addHeader("Authorization", "Bearer $token")
        }

        try {
            client.newCall(reqBuilder.build()).execute().use { res ->
                if (!res.isSuccessful) return@withContext null
                val body = res.body?.string() ?: ""
                val obj = json.parseToJsonElement(body).jsonObject
                obj["ticket"]?.jsonPrimitive?.content
            }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun extractSessionToken(endpoint: String): String? = withContext(Dispatchers.IO) {
        val base = endpoint.trim().trimEnd('/')
        try {
            val req = Request.Builder().url(base).get().build()
            client.newCall(req).execute().use { res ->
                val html = res.body?.string() ?: ""
                val marker = "window.__HERMES_SESSION_TOKEN__="
                if (html.contains(marker)) {
                    val after = html.substringAfter(marker).trim()
                    val tokenStr = after.substringBefore(";").trim().trim('"')
                    if (tokenStr.isNotBlank()) return@withContext tokenStr
                }
                null
            }
        } catch (_: Exception) {
            null
        }
    }
}
