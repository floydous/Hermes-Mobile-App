package com.hermesagent.nativemobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.HermesUserBubble
import com.hermesagent.nativemobile.ui.theme.HermesUserBubbleBorder
import com.hermesagent.nativemobile.util.EnvelopeCleaner

@Composable
fun ChatBubble(
    message: LiveMessage,
    modifier: Modifier = Modifier
) {
    val isUser = message.role == "user"

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 5.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
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
