package com.hermesagent.nativemobile.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.ui.theme.AccentGreen
import com.hermesagent.nativemobile.ui.theme.AccentRed
import com.hermesagent.nativemobile.ui.theme.Zinc700
import com.hermesagent.nativemobile.ui.theme.Zinc800
import com.hermesagent.nativemobile.ui.theme.Zinc900

@Composable
fun TopHeaderBar(
    title: String,
    isConnected: Boolean,
    onHostClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val statusColor by animateColorAsState(
        targetValue = if (isConnected) AccentGreen else AccentRed,
        animationSpec = tween(300),
        label = "statusColor"
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground
        )

        // Host Node Button
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(Zinc900)
                .border(1.dp, Zinc800, RoundedCornerShape(999.dp))
                .clickable { onHostClick() }
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(statusColor)
            )
            Text(
                text = "Host Node",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}
