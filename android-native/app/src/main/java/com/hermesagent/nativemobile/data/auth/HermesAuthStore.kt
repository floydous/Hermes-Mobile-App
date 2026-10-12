package com.hermesagent.nativemobile.data.auth

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class HermesAuthStore(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("hermes_auth_prefs", Context.MODE_PRIVATE)

    private val _endpointFlow = MutableStateFlow(getEndpoint())
    val endpointFlow: StateFlow<String> = _endpointFlow.asStateFlow()

    fun getEndpoint(): String {
        return prefs.getString("endpoint", "http://10.0.0.130:9119")?.trim()?.trimEnd('/') ?: "http://10.0.0.130:9119"
    }

    fun setEndpoint(endpoint: String) {
        val clean = endpoint.trim().trimEnd('/')
        prefs.edit().putString("endpoint", clean).apply()
        _endpointFlow.value = clean
    }

    fun getAccessToken(): String? {
        return prefs.getString("access_token", null)
    }

    fun setAccessToken(token: String?) {
        prefs.edit().putString("access_token", token).apply()
    }

    fun getBasicAuthHeader(): String? {
        return prefs.getString("basic_auth", null)
    }

    fun setBasicAuthHeader(header: String?) {
        prefs.edit().putString("basic_auth", header).apply()
    }

    fun clearAuth() {
        prefs.edit()
            .remove("access_token")
            .remove("basic_auth")
            .apply()
    }
}
