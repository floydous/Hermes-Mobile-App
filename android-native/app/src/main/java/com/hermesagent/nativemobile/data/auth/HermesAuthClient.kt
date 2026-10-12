package com.hermesagent.nativemobile.data.auth

import com.hermesagent.nativemobile.util.RemoteLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

class InMemoryCookieJar : CookieJar {
    private val cookieStore = mutableMapOf<String, MutableList<Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val list = cookieStore.getOrPut(url.host) { mutableListOf() }
        for (c in cookies) {
            list.removeAll { it.name == c.name }
            list.add(c)
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        return cookieStore[url.host] ?: emptyList()
    }
}

class HermesAuthClient(
    private val cookieJar: InMemoryCookieJar = InMemoryCookieJar(),
    private val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    suspend fun probeGateway(endpoint: String): GatewayProbeResult = withContext(Dispatchers.IO) {
        val base = endpoint.trim().trimEnd('/')
        RemoteLogger.d("AuthClient", "Probing gateway at: $base/api/status")
        val req = Request.Builder().url("$base/api/status").get().build()
        try {
            client.newCall(req).execute().use { response ->
                RemoteLogger.d("AuthClient", "Probe HTTP ${response.code}")
                if (!response.isSuccessful && response.code != 401) {
                    throw IOException("Gateway probe returned HTTP ${response.code}")
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
                    supportsPassword = supportsPassword || flows.contains("password") || flows.contains("native_pkce"),
                    authFlows = flows
                )
            }
        } catch (e: Exception) {
            RemoteLogger.e("AuthClient", "Probe exception", e)
            throw e
        }
    }

    suspend fun loginWithPassword(endpoint: String, user: String, pass: String): String = withContext(Dispatchers.IO) {
        val base = endpoint.trim().trimEnd('/')
        RemoteLogger.d("AuthClient", "Starting native password login for user: $user at: $base")

        // 1. Full PKCE Native Authorize Flow with Cookie Jar
        try {
            val random = SecureRandom()
            val verifierBytes = ByteArray(32)
            random.nextBytes(verifierBytes)
            val verifier = android.util.Base64.encodeToString(verifierBytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)

            val md = MessageDigest.getInstance("SHA-256")
            val challengeBytes = md.digest(verifier.toByteArray(Charsets.US_ASCII))
            val challenge = android.util.Base64.encodeToString(challengeBytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)

            val stateBytes = ByteArray(24)
            random.nextBytes(stateBytes)
            val state = android.util.Base64.encodeToString(stateBytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)

            val redirect = URLEncoder.encode("http://127.0.0.1:1/callback", "UTF-8")
            val authUrl = "$base/auth/native/authorize?provider=basic&code_challenge=$challenge&code_challenge_method=S256&redirect_uri=$redirect&state=$state"

            RemoteLogger.d("AuthClient", "Step 1: GET $authUrl")
            val authReq = Request.Builder().url(authUrl).get().build()
            client.newCall(authReq).execute().use { res ->
                RemoteLogger.d("AuthClient", "Step 1 authorize status: ${res.code}")
            }

            // Step 2: POST /auth/password-login (sends cookie jar with PKCE session)
            val loginPayload = """{"provider":"basic","username":"$user","password":"$pass"}"""
            val loginReq = Request.Builder()
                .url("$base/auth/password-login")
                .post(loginPayload.toRequestBody("application/json".toMediaType()))
                .build()

            RemoteLogger.d("AuthClient", "Step 2: POST /auth/password-login")
            client.newCall(loginReq).execute().use { loginRes ->
                val loginBody = loginRes.body?.string() ?: ""
                RemoteLogger.d("AuthClient", "Step 2 login status: ${loginRes.code}, body: $loginBody")
                if (loginRes.isSuccessful) {
                    val loginJson = json.parseToJsonElement(loginBody).jsonObject
                    val nextUrl = loginJson["next"]?.jsonPrimitive?.content
                    if (nextUrl != null && nextUrl.contains("code=")) {
                        val code = nextUrl.substringAfter("code=").substringBefore("&")
                        RemoteLogger.d("AuthClient", "Step 3: Redeeming authorization code for token")
                        val tokenPayload = """{"code":"$code","code_verifier":"$verifier"}"""
                        val tokenReq = Request.Builder()
                            .url("$base/auth/native/token")
                            .post(tokenPayload.toRequestBody("application/json".toMediaType()))
                            .build()

                        client.newCall(tokenReq).execute().use { tokenRes ->
                            val tokenBody = tokenRes.body?.string() ?: ""
                            RemoteLogger.d("AuthClient", "Step 3 token status: ${tokenRes.code}, body: $tokenBody")
                            if (tokenRes.isSuccessful) {
                                val tokenJson = json.parseToJsonElement(tokenBody).jsonObject
                                val accessToken = tokenJson["access_token"]?.jsonPrimitive?.content
                                if (!accessToken.isNullOrBlank()) {
                                    RemoteLogger.i("AuthClient", "Successfully obtained bearer access token via PKCE!")
                                    return@withContext accessToken
                                }
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            RemoteLogger.w("AuthClient", "PKCE flow failed, falling back to HTTP Basic header", e)
        }

        // Fallback: direct HTTP Basic Auth header
        val credentials = "$user:$pass"
        val basic = "Basic " + android.util.Base64.encodeToString(credentials.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
        RemoteLogger.i("AuthClient", "Using fallback Basic Auth header")
        basic
    }

    suspend fun mintWsTicket(endpoint: String, token: String): String? = withContext(Dispatchers.IO) {
        val base = endpoint.trim().trimEnd('/')
        RemoteLogger.d("AuthClient", "Minting WS ticket at: $base/api/auth/ws-ticket")
        val reqBuilder = Request.Builder().url("$base/api/auth/ws-ticket").post("{}".toRequestBody("application/json".toMediaType()))
        if (token.startsWith("Basic ")) {
            reqBuilder.addHeader("Authorization", token)
        } else {
            reqBuilder.addHeader("Authorization", "Bearer $token")
        }

        try {
            client.newCall(reqBuilder.build()).execute().use { res ->
                val body = res.body?.string() ?: ""
                RemoteLogger.d("AuthClient", "Mint WS ticket HTTP ${res.code}, body: $body")
                if (!res.isSuccessful) return@withContext null
                val obj = json.parseToJsonElement(body).jsonObject
                obj["ticket"]?.jsonPrimitive?.content
            }
        } catch (e: Exception) {
            RemoteLogger.e("AuthClient", "Failed to mint WS ticket", e)
            null
        }
    }

    suspend fun extractSessionToken(endpoint: String): String? = withContext(Dispatchers.IO) {
        val base = endpoint.trim().trimEnd('/')
        RemoteLogger.d("AuthClient", "Extracting session token from index at: $base/")
        try {
            val req = Request.Builder().url(base).get().build()
            client.newCall(req).execute().use { res ->
                val html = res.body?.string() ?: ""
                val marker = "window.__HERMES_SESSION_TOKEN__="
                if (html.contains(marker)) {
                    val after = html.substringAfter(marker).trim()
                    val tokenStr = after.substringBefore(";").trim().trim('"')
                    if (tokenStr.isNotBlank()) {
                        RemoteLogger.d("AuthClient", "Found __HERMES_SESSION_TOKEN__")
                        return@withContext tokenStr
                    }
                }
                null
            }
        } catch (e: Exception) {
            RemoteLogger.d("AuthClient", "No session token on index: ${e.message}")
            null
        }
    }
}
