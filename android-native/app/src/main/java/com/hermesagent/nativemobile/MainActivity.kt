package com.hermesagent.nativemobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
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
import com.hermesagent.nativemobile.data.auth.HermesAuthClient
import com.hermesagent.nativemobile.data.auth.HermesAuthStore
import com.hermesagent.nativemobile.data.model.LiveProfile
import com.hermesagent.nativemobile.data.model.LiveSession
import com.hermesagent.nativemobile.data.repository.HermesRepository
import com.hermesagent.nativemobile.ui.components.BottomNavIsland
import com.hermesagent.nativemobile.ui.components.NavigationTab
import com.hermesagent.nativemobile.ui.components.TopHeaderBar
import com.hermesagent.nativemobile.ui.screens.BotListScreen
import com.hermesagent.nativemobile.ui.screens.ChatScreen
import com.hermesagent.nativemobile.ui.screens.SessionListScreen
import com.hermesagent.nativemobile.ui.screens.SettingsScreen
import com.hermesagent.nativemobile.ui.screens.TaskListScreen
import com.hermesagent.nativemobile.ui.theme.HermesBg
import com.hermesagent.nativemobile.ui.theme.HermesTheme
import com.hermesagent.nativemobile.util.RemoteLogger
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val authStore by lazy { HermesAuthStore(this) }
    private val authClient by lazy { HermesAuthClient() }
    private val repository by lazy { HermesRepository(authStore, authClient) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        RemoteLogger.i("MainActivity", "Hermes Native Mobile starting up...")

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            RemoteLogger.e("CrashHandler", "Uncaught exception on thread ${thread.name}", throwable)
        }

        setContent {
            var themeName by remember { mutableStateOf(authStore.getTheme()) }
            var uiScale by remember { mutableFloatStateOf(authStore.getUiScale()) }

            val density = LocalDensity.current
            val scaledDensity = Density(
                density = density.density * uiScale,
                fontScale = density.fontScale * uiScale
            )

            CompositionLocalProvider(LocalDensity provides scaledDensity) {
                HermesTheme(themeName = themeName) {
                    MainAppScreen(
                        authStore = authStore,
                        repository = repository,
                        currentTheme = themeName,
                        currentScale = uiScale,
                        onThemeChange = {
                            themeName = it
                            authStore.setTheme(it)
                        },
                        onScaleChange = {
                            uiScale = it
                            authStore.setUiScale(it)
                        }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MainAppScreen(
    authStore: HermesAuthStore,
    repository: HermesRepository,
    currentTheme: String = "light",
    currentScale: Float = 1.15f,
    onThemeChange: (String) -> Unit = {},
    onScaleChange: (Float) -> Unit = {}
) {
    val scope = rememberCoroutineScope()
    val pagerState = rememberPagerState(initialPage = 0, pageCount = { 3 })
    var selectedSession by remember { mutableStateOf<LiveSession?>(null) }
    var isSettingsOpen by remember { mutableStateOf(false) }
    var showNewChatBotPicker by remember { mutableStateOf(false) }

    val connectionStatus by repository.connectionStatus.collectAsState()
    val profiles by repository.profiles.collectAsState()
    val sessions by repository.sessions.collectAsState()
    val cronJobs by repository.cronJobs.collectAsState()
    val activeTurns by repository.activeTurns.collectAsState()
    val messages by repository.currentSessionMessages.collectAsState()
    val pendingClarify by repository.pendingClarify.collectAsState()

    val currentTab = when (pagerState.currentPage) {
        0 -> NavigationTab.BOTS
        1 -> NavigationTab.SESSIONS
        else -> NavigationTab.TASKS
    }

    LaunchedEffect(Unit) {
        RemoteLogger.d("MainAppScreen", "Refreshing repository on mount")
        repository.refresh()
    }

    // Android Hardware Back Navigation Hierarchy
    BackHandler(enabled = isSettingsOpen || selectedSession != null) {
        when {
            selectedSession != null -> selectedSession = null
            isSettingsOpen -> isSettingsOpen = false
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = com.hermesagent.nativemobile.ui.theme.getBackgroundColor(currentTheme)
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(com.hermesagent.nativemobile.ui.theme.getBackgroundColor(currentTheme))
        ) {
            when {
                // 1. Dedicated Settings & Connection Screen
                isSettingsOpen -> {
                    SettingsScreen(
                        authStore = authStore,
                        repository = repository,
                        onBack = { isSettingsOpen = false },
                        onThemeChanged = onThemeChange,
                        onScaleChanged = onScaleChange
                    )
                }

                // 2. Active 1-on-1 Chat Screen
                selectedSession != null -> {
                val session = selectedSession!!
                val turn = activeTurns[session.profile]
                val currentProfile = profiles.find { it.name == session.profile }

                ChatScreen(
                    session = session,
                    messages = messages,
                    activeTurn = turn,
                    pendingClarify = if (pendingClarify?.sessionId == session.id) pendingClarify else null,
                    profile = currentProfile,
                    onBackClick = { selectedSession = null },
                        onSendMessage = { prompt, rowId ->
                            scope.launch {
                                try {
                                    repository.submitMessage(session, prompt, rowId)
                                } catch (e: Exception) {
                                    RemoteLogger.e("ChatScreen", "Failed to submit message", e)
                                }
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
                }

                // 3. Main Multi-tab Roster with Horizontal Swiping Pager
                else -> {
                    Column(modifier = Modifier.fillMaxSize()) {
                        TopHeaderBar(
                            isConnected = connectionStatus == "connected",
                            isConnecting = connectionStatus == "connecting",
                            currentTab = currentTab,
                            onHostClick = { isSettingsOpen = true },
                            onSearchClick = { /* Search */ },
                            onSettingsClick = { isSettingsOpen = true },
                            onNewSessionClick = {
                                if (profiles.size > 1) {
                                    showNewChatBotPicker = true
                                } else {
                                    scope.launch {
                                        try {
                                            val defaultProfile = profiles.firstOrNull()?.name ?: "default"
                                            val newSession = repository.createNewSession(defaultProfile, "New chat")
                                            selectedSession = newSession
                                            repository.loadSession(newSession)
                                        } catch (e: Exception) {
                                            RemoteLogger.e("MainAppScreen", "Error creating new session", e)
                                        }
                                    }
                                }
                            }
                        )

                        // 120Hz Native Horizontal Pager for Tabs (Bots ⟷ Sessions ⟷ Tasks)
                        HorizontalPager(
                            state = pagerState,
                            modifier = Modifier.weight(1f)
                        ) { pageIndex ->
                            when (pageIndex) {
                                0 -> {
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
                                1 -> {
                                    SessionListScreen(
                                        sessions = sessions,
                                        profiles = profiles,
                                        onSessionClick = { session ->
                                            selectedSession = session
                                            scope.launch {
                                                repository.loadSession(session)
                                            }
                                        }
                                    )
                                }
                                2 -> {
                                    TaskListScreen(
                                        tasks = cronJobs,
                                        onTaskClick = { /* Task details */ },
                                        onTriggerTask = { job ->
                                            scope.launch {
                                                repository.triggerTask(job.jobId, job.profile)
                                            }
                                        }
                                    )
                                }
                            }
                        }

                        // Floating Bottom Island
                        BottomNavIsland(
                            currentTab = currentTab,
                            onTabSelected = { tab ->
                                scope.launch {
                                    pagerState.animateScrollToPage(tab.ordinal)
                                }
                            }
                        )
                    }
                }
            }

            // New Chat Bot Picker Dialog
            if (showNewChatBotPicker) {
                Dialog(onDismissRequest = { showNewChatBotPicker = false }) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(20.dp))
                            .background(com.hermesagent.nativemobile.ui.theme.HermesPanel)
                            .border(1.dp, com.hermesagent.nativemobile.ui.theme.HermesBorder, RoundedCornerShape(20.dp))
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "New chat with",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = com.hermesagent.nativemobile.ui.theme.HermesText
                        )
                        profiles.forEach { profile ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable {
                                        showNewChatBotPicker = false
                                        scope.launch {
                                            val newSession = repository.createNewSession(profile.name, "New chat")
                                            selectedSession = newSession
                                            repository.loadSession(newSession)
                                        }
                                    }
                                    .padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                com.hermesagent.nativemobile.ui.components.BotAvatar(
                                    profile = profile,
                                    fallbackName = profile.name,
                                    size = 36.dp
                                )
                                Text(
                                    text = profile.displayName ?: profile.name,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = com.hermesagent.nativemobile.ui.theme.HermesText
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
