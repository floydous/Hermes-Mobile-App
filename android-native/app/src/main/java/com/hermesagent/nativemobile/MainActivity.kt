package com.hermesagent.nativemobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.hermesagent.nativemobile.data.api.HermesApiClient
import com.hermesagent.nativemobile.data.gateway.HermesGatewayClient
import com.hermesagent.nativemobile.data.model.LiveProfile
import com.hermesagent.nativemobile.data.model.LiveSession
import com.hermesagent.nativemobile.data.repository.HermesRepository
import com.hermesagent.nativemobile.ui.components.BottomNavIsland
import com.hermesagent.nativemobile.ui.components.NavigationTab
import com.hermesagent.nativemobile.ui.components.TopHeaderBar
import com.hermesagent.nativemobile.ui.screens.BotListScreen
import com.hermesagent.nativemobile.ui.screens.ChatScreen
import com.hermesagent.nativemobile.ui.screens.SessionListScreen
import com.hermesagent.nativemobile.ui.screens.TaskListScreen
import com.hermesagent.nativemobile.ui.theme.HermesTheme
import com.hermesagent.nativemobile.ui.theme.Zinc950
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val endpoint = "http://10.0.0.130:9119"
    private val apiClient by lazy { HermesApiClient(endpointProvider = { endpoint }) }
    private val gatewayClient by lazy { HermesGatewayClient(endpointProvider = { endpoint }) }
    private val repository by lazy { HermesRepository(apiClient, gatewayClient) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            HermesTheme {
                MainAppScreen(repository = repository)
            }
        }
    }
}

@Composable
fun MainAppScreen(repository: HermesRepository) {
    val scope = rememberCoroutineScope()
    var currentTab by remember { mutableStateOf(NavigationTab.BOTS) }
    var selectedSession by remember { mutableStateOf<LiveSession?>(null) }
    var isConnected by remember { mutableStateOf(false) }

    val profiles by repository.profiles.collectAsState()
    val sessions by repository.sessions.collectAsState()
    val cronJobs by repository.cronJobs.collectAsState()
    val activeTurns by repository.activeTurns.collectAsState()
    val messages by repository.currentSessionMessages.collectAsState()
    val pendingClarify by repository.pendingClarify.collectAsState()

    LaunchedEffect(Unit) {
        try {
            repository.refresh()
            isConnected = true
        } catch (_: Exception) {
            isConnected = false
        }
    }

    // Handle Hardware Back Button
    BackHandler(enabled = selectedSession != null) {
        selectedSession = null
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = Zinc950
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(Zinc950)
        ) {
            if (selectedSession != null) {
                // Active 1-on-1 Chat Screen
                val session = selectedSession!!
                val turn = activeTurns[session.profile]

                ChatScreen(
                    session = session,
                    messages = messages,
                    activeTurn = turn,
                    pendingClarify = if (pendingClarify?.sessionId == session.id) pendingClarify else null,
                    onBackClick = { selectedSession = null },
                    onSendMessage = { prompt ->
                        scope.launch {
                            repository.submitMessage(session, prompt)
                        }
                    },
                    onClearChat = {
                        scope.launch {
                            repository.clearSession(session.id, session.profile)
                        }
                    },
                    onClarifySubmit = { answers ->
                        scope.launch {
                            pendingClarify?.let { req ->
                                repository.submitClarifyAnswer(req.requestId, answers)
                            }
                        }
                    },
                    onClarifySkip = {
                        scope.launch {
                            pendingClarify?.let { req ->
                                repository.skipClarify(req.requestId)
                            }
                        }
                    }
                )
            } else {
                // Main Multi-tab Roster Layout
                Column(modifier = Modifier.fillMaxSize()) {
                    TopHeaderBar(
                        title = "Hermes",
                        isConnected = isConnected,
                        onHostClick = {
                            scope.launch {
                                repository.refresh()
                            }
                        }
                    )

                    Box(modifier = Modifier.weight(1f)) {
                        AnimatedContent(
                            targetState = currentTab,
                            transitionSpec = {
                                if (targetState.ordinal > initialState.ordinal) {
                                    slideInHorizontally { width -> width } togetherWith slideOutHorizontally { width -> -width }
                                } else {
                                    slideInHorizontally { width -> -width } togetherWith slideOutHorizontally { width -> width }
                                }
                            },
                            label = "tabContent"
                        ) { tab ->
                            when (tab) {
                                NavigationTab.BOTS -> {
                                    BotListScreen(
                                        profiles = profiles,
                                        activeTurns = activeTurns,
                                        onBotClick = { profile, session ->
                                            val safeSession = session ?: LiveSession(
                                                id = "draft:${profile.name}",
                                                title = profile.displayName ?: profile.name,
                                                profile = profile.name
                                            )
                                            selectedSession = safeSession
                                            scope.launch {
                                                repository.loadSession(safeSession)
                                            }
                                        }
                                    )
                                }
                                NavigationTab.SESSIONS -> {
                                    SessionListScreen(
                                        sessions = sessions,
                                        onSessionClick = { session ->
                                            selectedSession = session
                                            scope.launch {
                                                repository.loadSession(session)
                                            }
                                        }
                                    )
                                }
                                NavigationTab.TASKS -> {
                                    TaskListScreen(
                                        tasks = cronJobs,
                                        onTaskClick = { /* View task details */ }
                                    )
                                }
                            }
                        }
                    }

                    BottomNavIsland(
                        currentTab = currentTab,
                        onTabSelected = { currentTab = it }
                    )
                }
            }
        }
    }
}
