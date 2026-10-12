package com.hermesagent.nativemobile.util

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

object RemoteLogger {
    private const val LOG_URL = "http://192.168.100.37:8765/"

    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .writeTimeout(3, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.IO)

    fun d(tag: String, message: String) {
        log("DEBUG", tag, message, null)
    }

    fun i(tag: String, message: String) {
        log("INFO", tag, message, null)
    }

    fun w(tag: String, message: String, throwable: Throwable? = null) {
        log("WARN", tag, message, throwable)
    }

    fun e(tag: String, message: String, throwable: Throwable? = null) {
        log("ERROR", tag, message, throwable)
    }

    private fun log(level: String, tag: String, message: String, throwable: Throwable?) {
        val text = buildString {
            append("[$level][$tag] ").append(message)
            if (throwable != null) {
                append("\n").append(throwable.stackTraceToString())
            }
        }
        android.util.Log.println(
            when (level) {
                "ERROR" -> android.util.Log.ERROR
                "WARN" -> android.util.Log.WARN
                "INFO" -> android.util.Log.INFO
                else -> android.util.Log.DEBUG
            },
            tag,
            text
        )

        scope.launch {
            try {
                val body = text.toRequestBody("text/plain; charset=utf-8".toMediaType())
                val req = Request.Builder().url(LOG_URL).post(body).build()
                client.newCall(req).execute().close()
            } catch (_: Exception) {
                // Ignore network failure when PC is unreachable
            }
        }
    }
}
