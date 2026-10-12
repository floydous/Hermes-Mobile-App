package com.hermesagent.nativemobile.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.HermesUserBubble
import com.hermesagent.nativemobile.ui.theme.HermesUserBubbleBorder
import com.hermesagent.nativemobile.util.EnvelopeCleaner

@Composable
fun ChatBubble(
    message: LiveMessage,
    onLongPress: (LiveMessage) -> Unit,
    modifier: Modifier = Modifier
) {
    val isUser = message.role == "user"
    val haptic = LocalHapticFeedback.current
    var isPressed by remember { mutableStateOf(false) }

    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.96f else 1f,
        animationSpec = tween(120),
        label = "bubbleSquish"
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Box(
            modifier = Modifier
                .scale(scale)
                .pointerInput(message.id) {
                    detectTapGestures(
                        onPress = {
                            isPressed = true
                            tryAwaitRelease()
                            isPressed = false
                        },
                        onLongPress = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onLongPress(message)
                        }
                    )
                }
        ) {
            if (isUser) {
                // User message bubble: signature Hermes light zinc bubble (#E4E4E7)
                Box(
                    modifier = Modifier
                        .widthIn(max = 310.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(HermesUserBubble)
                        .border(1.dp, HermesUserBubbleBorder, RoundedCornerShape(20.dp))
                        .padding(horizontal = 16.dp, vertical = 11.dp)
                ) {
                    Text(
                        text = message.content ?: message.displayContent ?: "",
                        fontSize = 15.sp,
                        color = HermesText,
                        lineHeight = 22.sp
                    )
                }
            } else {
                // Assistant message: White bubble with border and shadow matching React Hermes 1:1
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.92f)
                        .shadow(2.dp, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp), ambientColor = Color(0x06000000), spotColor = Color(0x06000000))
                        .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp))
                        .background(HermesPanel)
                        .border(1.dp, HermesBorder, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp))
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (message.toolName != null) {
                            // Tool activity capsule
                            Row(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(9999.dp))
                                    .background(HermesSurface)
                                    .border(1.dp, HermesBorder, RoundedCornerShape(9999.dp))
                                    .padding(horizontal = 10.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "${message.toolName} ${if (message.toolStatus == "done") "✓" else "…"}",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = HermesSecondary
                                )
                            }
                        }

                        val display = EnvelopeCleaner.clean(message.displayContent ?: message.content ?: "")
                        MarkdownContent(content = display)
                    }
                }
            }
        }
    }
}
