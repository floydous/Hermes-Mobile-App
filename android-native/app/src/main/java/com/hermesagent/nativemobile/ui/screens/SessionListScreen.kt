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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.ui.theme.Zinc100
import com.hermesagent.nativemobile.ui.theme.Zinc400
import com.hermesagent.nativemobile.ui.theme.Zinc800
import com.hermesagent.nativemobile.ui.theme.Zinc850
import com.hermesagent.nativemobile.ui.theme.Zinc900

@Composable
fun SessionListScreen(
    sessions: List<LiveSession>,
    onSessionClick: (LiveSession) -> Unit,
    modifier: Modifier = Modifier
) {
    if (sessions.isEmpty()) {
        Box(
            modifier = modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No active conversations",
                color = Zinc400,
                fontSize = 14.sp
            )
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(sessions, key = { it.id }) { session ->
                SessionCardRow(
                    session = session,
                    onClick = { onSessionClick(session) }
                )
            }
        }
    }
}

@Composable
fun SessionCardRow(
    session: LiveSession,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Zinc900)
            .border(1.dp, Zinc850, RoundedCornerShape(16.dp))
            .clickable { onClick() }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp)
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
                    color = Zinc100,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                if (session.unread && session.unreadCount > 0) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(White)
                            .padding(horizontal = 7.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = "${session.unreadCount}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Zinc900
                        )
                    }
                }
            }

            Text(
                text = session.preview.ifBlank { "No messages yet" },
                fontSize = 13.sp,
                color = Zinc400,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
