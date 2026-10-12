package com.hermesagent.nativemobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.auth.HermesAuthClient
import com.hermesagent.nativemobile.data.auth.HermesAuthStore
import com.hermesagent.nativemobile.data.repository.HermesRepository
import com.hermesagent.nativemobile.ui.theme.AccentGreen
import com.hermesagent.nativemobile.ui.theme.AccentRed
import com.hermesagent.nativemobile.ui.theme.HermesBg
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesBorderSubtle
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.util.RemoteLogger
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    authStore: HermesAuthStore,
    repository: HermesRepository,
    onBack: () -> Unit,
    onThemeChanged: (String) -> Unit = {},
    onScaleChanged: (Float) -> Unit = {},
    modifier: Modifier = Modifier
) {
    var subPage by remember { mutableStateOf<String?>("root") }

    if (subPage == "pairing") {
        PairingScreen(
            authStore = authStore,
            repository = repository,
            onBack = { subPage = "root" }
        )
    } else if (subPage == "appearance") {
        AppearanceSettingsScreen(
            currentTheme = authStore.getTheme(),
            currentScale = authStore.getUiScale(),
            onThemeChanged = { newTheme ->
                authStore.setTheme(newTheme)
                onThemeChanged(newTheme)
            },
            onScaleChanged = { newScale ->
                authStore.setUiScale(newScale)
                onScaleChanged(newScale)
            },
            onBack = { subPage = "root" }
        )
    } else {
        SettingsRootScreen(
            authStore = authStore,
            repository = repository,
            onBack = onBack,
            onOpenPairing = { subPage = "pairing" },
            onOpenAppearance = { subPage = "appearance" },
            modifier = modifier
        )
    }
}

@Composable
fun SettingsRootScreen(
    authStore: HermesAuthStore,
    repository: HermesRepository,
    onBack: () -> Unit,
    onOpenPairing: () -> Unit,
    onOpenAppearance: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val endpoint = authStore.getEndpoint()
    val isConnected = repository.connectionStatus.value == "connected"
    val profilesCount = repository.profiles.value.size
    val sessionsCount = repository.sessions.value.size

    var isSyncing by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(HermesBg)
            .verticalScroll(rememberScrollState())
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = HermesText
                )
            }
            Column {
                Text(
                    text = "Connection",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesText
                )
                Text(
                    text = "Hermes Desktop host",
                    fontSize = 12.sp,
                    color = HermesMuted
                )
            }
        }
        HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)

        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Connection Status Card (Matching React connection-card)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(4.dp, RoundedCornerShape(20.dp), ambientColor = Color(0x0A000000), spotColor = Color(0x0A000000))
                    .clip(RoundedCornerShape(20.dp))
                    .background(HermesPanel)
                    .border(1.dp, HermesBorder, RoundedCornerShape(20.dp))
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(if (isConnected) AccentGreen else AccentRed)
                    )
                    Text(
                        text = if (isConnected) "Connected" else "Not connected",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isConnected) AccentGreen else AccentRed
                    )
                }

                Text(
                    text = if (isConnected) "Your Hermes host" else "Saved host needs attention",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = HermesText
                )

                // Host URL code pill
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(HermesSurface)
                        .border(1.dp, HermesBorder, RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = endpoint.removePrefix("http://").removePrefix("https://"),
                        fontSize = 13.sp,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                        color = HermesText
                    )
                }

                if (isConnected) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text(
                            text = "$profilesCount Bots",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = HermesSecondary
                        )
                        Text(
                            text = "$sessionsCount Sessions",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = HermesSecondary
                        )
                    }
                }

                // Sync / Connect Button
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesText)
                        .clickable(enabled = !isSyncing) {
                            scope.launch {
                                isSyncing = true
                                repository.refresh()
                                isSyncing = false
                            }
                        }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (isSyncing) "Syncing…" else if (isConnected) "Sync now" else "Retry connection",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = White
                    )
                }
            }

            // Menu List (Matching React menu-list)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(2.dp, RoundedCornerShape(16.dp), ambientColor = Color(0x06000000), spotColor = Color(0x06000000))
                    .clip(RoundedCornerShape(16.dp))
                    .background(HermesPanel)
                    .border(1.dp, HermesBorder, RoundedCornerShape(16.dp))
            ) {
                MenuRow(
                    label = "Appearance",
                    trailing = "›",
                    onClick = onOpenAppearance
                )
                HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)
                MenuRow(
                    label = "Security & pairing",
                    trailing = if (isConnected) "Connected ›" else "Disconnected ›",
                    onClick = onOpenPairing
                )
                HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)
                MenuRow(
                    label = "About Hermes Mobile",
                    trailing = "0.1.1 ›",
                    onClick = {}
                )
            }
        }
    }
}

@Composable
fun MenuRow(
    label: String,
    trailing: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 15.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            color = HermesText
        )
        Text(
            text = trailing,
            fontSize = 14.sp,
            color = HermesMuted
        )
    }
}

@Composable
fun PairingScreen(
    authStore: HermesAuthStore,
    repository: HermesRepository,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var gatewayUrl by remember { mutableStateOf(authStore.getEndpoint()) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var isTesting by remember { mutableStateOf(false) }
    var isSaving by remember { mutableStateOf(false) }
    var testResult by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(false) }

    val authClient = remember { HermesAuthClient() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(HermesBg)
            .verticalScroll(rememberScrollState())
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = HermesText
                )
            }
            Column {
                Text(
                    text = "Security & pairing",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesText
                )
                Text(
                    text = "Private access for your mobile device",
                    fontSize = 12.sp,
                    color = HermesMuted
                )
            }
        }
        HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)

        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Pairing Card
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(4.dp, RoundedCornerShape(20.dp), ambientColor = Color(0x0A000000), spotColor = Color(0x0A000000))
                    .clip(RoundedCornerShape(20.dp))
                    .background(HermesPanel)
                    .border(1.dp, HermesBorder, RoundedCornerShape(20.dp))
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Wifi,
                        contentDescription = "Gateway",
                        tint = HermesText,
                        modifier = Modifier.size(20.dp)
                    )
                    Column {
                        Text(
                            text = "Verify your Windows gateway",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = HermesText
                        )
                        Text(
                            text = "Checks gateway status before saving.",
                            fontSize = 12.sp,
                            color = HermesMuted
                        )
                    }
                }

                // GATEWAY URL
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "GATEWAY URL",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesMuted
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(HermesSurface)
                            .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                            .padding(horizontal = 14.dp, vertical = 12.dp)
                    ) {
                        BasicTextField(
                            value = gatewayUrl,
                            onValueChange = { gatewayUrl = it; testResult = null },
                            textStyle = TextStyle(fontSize = 14.sp, color = HermesText),
                            cursorBrush = SolidColor(HermesText),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }

                // Test Gateway Button
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesSurface)
                        .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                        .clickable(enabled = !isTesting) {
                            scope.launch {
                                isTesting = true
                                testResult = null
                                try {
                                    val res = authClient.probeGateway(gatewayUrl)
                                    testResult = "Gateway reachable (version: ${res.version ?: "unknown"}, authRequired: ${res.authRequired})"
                                    isError = false
                                } catch (e: Exception) {
                                    testResult = "Could not reach gateway: ${e.message}"
                                    isError = true
                                } finally {
                                    isTesting = false
                                }
                            }
                        }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (isTesting) "Checking gateway…" else "Test gateway",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesText
                    )
                }

                // Credentials fields
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "USERNAME",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesMuted
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(HermesSurface)
                            .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                            .padding(horizontal = 14.dp, vertical = 12.dp)
                    ) {
                        BasicTextField(
                            value = username,
                            onValueChange = { username = it },
                            textStyle = TextStyle(fontSize = 14.sp, color = HermesText),
                            cursorBrush = SolidColor(HermesText),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "PASSWORD",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesMuted
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(HermesSurface)
                            .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                            .padding(horizontal = 14.dp, vertical = 12.dp)
                    ) {
                        BasicTextField(
                            value = password,
                            onValueChange = { password = it },
                            visualTransformation = PasswordVisualTransformation(),
                            textStyle = TextStyle(fontSize = 14.sp, color = HermesText),
                            cursorBrush = SolidColor(HermesText),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }

                // Sign in & connect Button
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(HermesText)
                        .clickable(enabled = !isSaving) {
                            scope.launch {
                                isSaving = true
                                RemoteLogger.i("PairingScreen", "Saving and connecting to: $gatewayUrl")
                                repository.updateEndpoint(gatewayUrl, username, password)
                                isSaving = false
                                onBack()
                            }
                        }
                        .padding(vertical = 13.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (isSaving) "Signing in and connecting…" else "Sign in & connect",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = White
                    )
                }

                if (testResult != null) {
                    Text(
                        text = testResult!!,
                        fontSize = 13.sp,
                        color = if (isError) AccentRed else AccentGreen
                    )
                }
            }
        }
    }
}
