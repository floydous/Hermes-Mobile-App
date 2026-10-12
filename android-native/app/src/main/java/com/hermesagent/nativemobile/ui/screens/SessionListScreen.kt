package com.hermesagent.nativemobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.LiveSession
import com.hermesagent.nativemobile.ui.theme.HermesBg
import com.hermesagent.nativemobile.ui.theme.HermesBorderSubtle
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.ui.theme.White

@Composable
fun SessionListScreen(
    sessions: List<LiveSession>,
    profiles: List<com.hermesagent.nativemobile.data.model.LiveProfile> = emptyList(),
    onSessionClick: (LiveSession) -> Unit,
    modifier: Modifier = Modifier
) {
    if (sessions.isEmpty()) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(HermesBg),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No active conversations",
                color = HermesMuted,
                fontSize = 14.sp
            )
        }
    } else {
        LazyColumn(
            modifier = modifier
                .fillMaxSize()
                .background(HermesBg),
            contentPadding = PaddingValues(bottom = 90.dp)
        ) {
            items(sessions, key = { it.id }) { session ->
                val profile = profiles.find { it.name == session.profile }
                SessionRow(
                    session = session,
                    profile = profile,
                    onClick = { onSessionClick(session) }
                )
                HorizontalDivider(color = HermesBorderSubtle, thickness = 1.dp)
            }
        }
    }
}

@Composable
fun SessionRow(
    session: LiveSession,
    profile: com.hermesagent.nativemobile.data.model.LiveProfile?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Session Avatar
        com.hermesagent.nativemobile.ui.components.BotAvatar(
            profile = profile,
            fallbackName = session.profile,
            size = 44.dp
        )

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = session.title.ifBlank { "Untitled Session" },
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesText,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                if (session.unread && session.unreadCount > 0) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(9999.dp))
                            .background(HermesText)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = "${session.unreadCount}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = White
                        )
                    }
                }
            }

            Text(
                text = session.preview.ifBlank { "No messages yet" },
                fontSize = 13.sp,
                color = HermesMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
