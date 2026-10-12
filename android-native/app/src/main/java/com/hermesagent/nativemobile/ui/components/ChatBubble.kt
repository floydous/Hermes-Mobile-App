package com.hermesagent.nativemobile.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.HermesUserBubble
import com.hermesagent.nativemobile.ui.theme.HermesUserBubbleBorder
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.util.EnvelopeCleaner

@Composable
fun ChatBubble(
    message: LiveMessage,
    onEditMessage: ((LiveMessage) -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val isUser = message.role == "user"
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current

    var showActionSheet by remember { mutableStateOf(false) }
    var isPressed by remember { mutableStateOf(false) }

    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.96f else 1f,
        animationSpec = tween(120),
        label = "bubbleSquish"
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
    ) {
        // Anchored Action Pill Sheet on Long-Press
        AnimatedVisibility(
            visible = showActionSheet,
            enter = fadeIn(tween(150)),
            exit = fadeOut(tween(150))
        ) {
            Row(
                modifier = Modifier
                    .shadow(8.dp, RoundedCornerShape(9999.dp), ambientColor = Color(0x18000000), spotColor = Color(0x18000000))
                    .clip(RoundedCornerShape(9999.dp))
                    .background(HermesPanel)
                    .border(1.dp, HermesBorder, RoundedCornerShape(9999.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Copy Action Button
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(9999.dp))
                        .clickable {
                            showActionSheet = false
                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(ClipData.newPlainText("Hermes Message", message.content))
                            Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
                        }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ContentCopy,
                        contentDescription = "Copy",
                        tint = HermesText,
                        modifier = Modifier.size(14.dp)
                    )
                    Text(
                        text = "Copy",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesText
                    )
                }

                // Edit Action Button (User prompts only)
                if (isUser && onEditMessage != null) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(9999.dp))
                            .clickable {
                                showActionSheet = false
                                onEditMessage(message)
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Edit,
                            contentDescription = "Edit",
                            tint = HermesText,
                            modifier = Modifier.size(14.dp)
                        )
                        Text(
                            text = "Edit",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = HermesText
                        )
                    }
                }
            }
        }

        // Message Bubble Container with long press detector
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
                            showActionSheet = !showActionSheet
                        },
                        onTap = {
                            if (showActionSheet) {
                                showActionSheet = false
                            }
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
                        text = message.content,
                        fontSize = 15.sp,
                        color = HermesText,
                        lineHeight = 22.sp
                    )
                }
            } else {
                // Assistant message: clean typography
                Column(
                    modifier = Modifier
                        .fillMaxWidth(0.92f)
                        .padding(vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
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

                    val display = EnvelopeCleaner.clean(message.displayContent ?: message.content)
                    MarkdownContent(content = display)
                }
            }
        }
    }
}
