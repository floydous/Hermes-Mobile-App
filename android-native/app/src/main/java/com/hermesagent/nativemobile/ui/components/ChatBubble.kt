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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveMessage
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.ui.theme.Zinc100
import com.hermesagent.nativemobile.ui.theme.Zinc400
import com.hermesagent.nativemobile.ui.theme.Zinc800
import com.hermesagent.nativemobile.ui.theme.Zinc850

@Composable
fun ChatBubble(
    message: LiveMessage,
    modifier: Modifier = Modifier
) {
    val isUser = message.role == "user"

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        if (isUser) {
            // User message bubble: styled monochrome rounded bubble
            Box(
                modifier = Modifier
                    .widthIn(max = 300.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Zinc800)
                    .border(1.dp, Zinc850, RoundedCornerShape(20.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Text(
                    text = message.content,
                    fontSize = 15.sp,
                    color = White,
                    lineHeight = 22.sp
                )
            }
        } else {
            // Assistant / tool message: clean left-aligned typography
            Column(
                modifier = Modifier
                    .fillMaxWidth(0.92f)
                    .padding(vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (message.toolName != null) {
                    // Tool pill
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(Zinc850)
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "${message.toolName} ${if (message.toolStatus == "done") "✓" else "…"}",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = Zinc400
                        )
                    }
                }

                Text(
                    text = message.displayContent ?: message.content,
                    fontSize = 15.sp,
                    color = Zinc100,
                    lineHeight = 22.sp
                )
            }
        }
    }
}
