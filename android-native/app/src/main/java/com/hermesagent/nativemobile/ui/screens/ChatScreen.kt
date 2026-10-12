package com.hermesagent.nativemobile.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.data.model.LiveSession
import com.hermesagent.nativemobile.data.repository.ActiveTurn
import com.hermesagent.nativemobile.ui.components.ChatBubble
import com.hermesagent.nativemobile.ui.theme.AccentAmber
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.ui.theme.Zinc100
import com.hermesagent.nativemobile.ui.theme.Zinc400
import com.hermesagent.nativemobile.ui.theme.Zinc700
import com.hermesagent.nativemobile.ui.theme.Zinc800
import com.hermesagent.nativemobile.ui.theme.Zinc850
import com.hermesagent.nativemobile.ui.theme.Zinc900

@Composable
fun ChatScreen(
    session: LiveSession,
    messages: List<LiveMessage>,
    activeTurn: ActiveTurn?,
    onBackClick: () -> Unit,
    onSendMessage: (String) -> Unit,
    onClearChat: () -> Unit,
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
            .background(Zinc900)
            .imePadding()
    ) {
        // Chat Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
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
                        tint = White
                    )
                }
                Text(
                    text = session.title.ifBlank { "Chat" },
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Zinc100
                )
            }

            // Clear chat button
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(Zinc850)
                    .clickable { onClearChat() }
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text(
                    text = "Clear",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = Zinc400
                )
            }
        }

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
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(AccentAmber)
                        )
                        Text(
                            text = activeTurn.statusText,
                            fontSize = 14.sp,
                            color = AccentAmber,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }

        // Bottom Composer Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Zinc850)
                    .border(1.dp, Zinc800, RoundedCornerShape(24.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                if (inputText.isBlank()) {
                    Text(
                        text = "Message Hermes…",
                        fontSize = 15.sp,
                        color = Zinc400
                    )
                }
                BasicTextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    textStyle = TextStyle(
                        fontSize = 15.sp,
                        color = White
                    ),
                    cursorBrush = SolidColor(White),
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Send Button
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(if (inputText.isNotBlank()) White else Zinc800)
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
                    tint = if (inputText.isNotBlank()) Zinc900 else Zinc700,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}
