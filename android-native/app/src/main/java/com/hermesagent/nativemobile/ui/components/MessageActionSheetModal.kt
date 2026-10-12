package com.hermesagent.nativemobile.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.HermesUserBubble
import com.hermesagent.nativemobile.ui.theme.HermesUserBubbleBorder
import com.hermesagent.nativemobile.util.EnvelopeCleaner

@Composable
fun MessageActionSheetModal(
    message: LiveMessage,
    onDismiss: () -> Unit,
    onEdit: (LiveMessage) -> Unit
) {
    val context = LocalContext.current
    val isUser = message.role == "user"

    BackHandler {
        onDismiss()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0x8C000000))
            .pointerInput(Unit) {
                detectTapGestures { onDismiss() }
            },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .pointerInput(Unit) {
                    detectTapGestures {}
                },
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Cloned Message Bubble Highlighted
            if (isUser) {
                Box(
                    modifier = Modifier
                        .widthIn(max = 310.dp)
                        .shadow(16.dp, RoundedCornerShape(20.dp), ambientColor = Color(0x33000000), spotColor = Color(0x33000000))
                        .clip(RoundedCornerShape(20.dp))
                        .background(HermesUserBubble)
                        .border(1.dp, HermesUserBubbleBorder, RoundedCornerShape(20.dp))
                        .padding(horizontal = 16.dp, vertical = 11.dp)
                ) {
                    Text(
                        text = message.text,
                        fontSize = 15.sp,
                        color = HermesText,
                        lineHeight = 22.sp
                    )
                }
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.92f)
                        .shadow(16.dp, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp), ambientColor = Color(0x33000000), spotColor = Color(0x33000000))
                        .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp))
                        .background(HermesPanel)
                        .border(1.dp, HermesBorder, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 4.dp))
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                ) {
                    val display = EnvelopeCleaner.clean(message.text)
                    MarkdownContent(content = display)
                }
            }

            // Anchored Action Buttons Pill Bar
            Row(
                modifier = Modifier
                    .shadow(12.dp, RoundedCornerShape(9999.dp), ambientColor = Color(0x25000000), spotColor = Color(0x25000000))
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
                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(ClipData.newPlainText("Hermes Message", message.text))
                            Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
                            onDismiss()
                        }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ContentCopy,
                        contentDescription = "Copy",
                        tint = HermesText,
                        modifier = Modifier.size(15.dp)
                    )
                    Text(
                        text = "Copy",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesText
                    )
                }

                // Edit Action Button (User Prompts Only)
                if (isUser) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(9999.dp))
                            .clickable {
                                onEdit(message)
                                onDismiss()
                            }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Edit,
                            contentDescription = "Edit",
                            tint = HermesText,
                            modifier = Modifier.size(15.dp)
                        )
                        Text(
                            text = "Edit",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = HermesText
                        )
                    }
                }
            }
        }
    }
}
