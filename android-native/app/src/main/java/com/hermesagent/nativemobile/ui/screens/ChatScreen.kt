package com.hermesagent.nativemobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.ClarifyRequest
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.data.model.LiveSession
import com.hermesagent.nativemobile.data.repository.ActiveTurn
import com.hermesagent.nativemobile.ui.components.ChatBubble
import com.hermesagent.nativemobile.ui.components.ClarifyCard
import com.hermesagent.nativemobile.ui.theme.AccentIndigo
import com.hermesagent.nativemobile.ui.theme.HermesBg
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesBorderSubtle
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesQuiet
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.White

@Composable
fun ChatScreen(
    session: LiveSession,
    messages: List<LiveMessage>,
    activeTurn: ActiveTurn?,
    pendingClarify: ClarifyRequest?,
    onBackClick: () -> Unit,
    onSendMessage: (String) -> Unit,
    onClearChat: () -> Unit,
    onClarifySubmit: (Map<String, String>) -> Unit,
    onClarifySkip: () -> Unit,
    modifier: Modifier = Modifier
) {
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Auto-scroll on new message
    LaunchedEffect(messages.size, activeTurn?.streamingText?.length) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(HermesBg)
            .imePadding()
    ) {
        // Chat Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(HermesBg)
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                IconButton(onClick = onBackClick) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = HermesText
                    )
                }
                Column {
                    Text(
                        text = session.title.ifBlank { "Chat" },
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesText
                    )
                    Text(
                        text = session.profile,
                        fontSize = 12.sp,
                        color = HermesMuted
                    )
                }
            }

            // Clear chat pill button
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(9999.dp))
                    .background(Color(0x0A000000))
                    .border(1.dp, Color(0x12000000), RoundedCornerShape(9999.dp))
                    .clickable { onClearChat() }
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text(
                    text = "Clear",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = HermesSecondary
                )
            }
        }
        HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)

        // Messages List
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            items(messages, key = { it.id }) { msg ->
                ChatBubble(message = msg)
            }

            // In-flight streaming response
            if (activeTurn != null && activeTurn.streamingText.isNotBlank()) {
                item(key = "streaming-active") {
                    ChatBubble(
                        message = LiveMessage(
                            id = 0L,
                            role = "assistant",
                            content = activeTurn.streamingText
                        )
                    )
                }
            }

            // Active thinking indicator
            if (activeTurn != null && activeTurn.streamingText.isBlank()) {
                item(key = "thinking-indicator") {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(9999.dp))
                                .background(HermesSurface)
                                .border(1.dp, HermesBorder, RoundedCornerShape(9999.dp))
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(
                                text = activeTurn.statusText,
                                fontSize = 13.sp,
                                color = AccentIndigo,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
            }
        }

        // Bottom Action Area: Either Clarify Card or Text Composer
        if (pendingClarify != null) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                ClarifyCard(
                    request = pendingClarify,
                    onSubmit = onClarifySubmit,
                    onSkip = onClarifySkip
                )
            }
        } else {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(HermesBg)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Floating Composer Pill
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .shadow(4.dp, RoundedCornerShape(24.dp), ambientColor = Color(0x0F000000), spotColor = Color(0x0F000000))
                        .clip(RoundedCornerShape(24.dp))
                        .background(HermesPanel)
                        .border(1.dp, HermesBorder, RoundedCornerShape(24.dp))
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                ) {
                    if (inputText.isBlank()) {
                        Text(
                            text = "Message Hermes…",
                            fontSize = 15.sp,
                            color = HermesQuiet
                        )
                    }
                    BasicTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        textStyle = TextStyle(
                            fontSize = 15.sp,
                            color = HermesText
                        ),
                        cursorBrush = SolidColor(HermesText),
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                // Send Button
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .shadow(2.dp, CircleShape)
                        .clip(CircleShape)
                        .background(if (inputText.isNotBlank()) HermesText else HermesSurface)
                        .border(1.dp, if (inputText.isNotBlank()) HermesText else HermesBorder, CircleShape)
                        .clickable(enabled = inputText.isNotBlank()) {
                            val prompt = inputText.trim()
                            if (prompt.isNotBlank()) {
                                onSendMessage(prompt)
                                inputText = ""
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = if (inputText.isNotBlank()) White else HermesQuiet,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
}
