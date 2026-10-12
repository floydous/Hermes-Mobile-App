package com.hermesagent.nativemobile.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.ui.theme.AccentGreen
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesPanel
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText

@Composable
fun AgentDispatchCard(
    agentHandle: String,
    taskSummary: String,
    isCompleted: Boolean,
    subTools: List<String> = emptyList(),
    modifier: Modifier = Modifier
) {
    var isExpanded by remember { mutableStateOf(false) }
    val rotation by animateFloatAsState(targetValue = if (isExpanded) 90f else 0f, label = "chevron")

    Column(
        modifier = modifier
            .fillMaxWidth()
            .shadow(2.dp, RoundedCornerShape(16.dp), ambientColor = Color(0x0A000000), spotColor = Color(0x0A000000))
            .clip(RoundedCornerShape(16.dp))
            .background(HermesPanel)
            .border(1.dp, HermesBorder, RoundedCornerShape(16.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Dispatched task header: Avatar + Handle + Chevron
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { isExpanded = !isExpanded },
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(HermesSurface)
                        .border(1.dp, HermesBorder, CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = agentHandle.take(1).uppercase(),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = HermesText
                    )
                }

                Text(
                    text = "@$agentHandle",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = HermesText
                )
            }

            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = "Expand",
                tint = HermesMuted,
                modifier = Modifier
                    .size(20.dp)
                    .rotate(rotation)
            )
        }

        // Summary text
        Text(
            text = taskSummary,
            fontSize = 13.sp,
            color = HermesSecondary,
            maxLines = if (isExpanded) Int.MAX_VALUE else 3
        )

        // Subtool Tree Branch Visualization (└)
        if (subTools.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                subTools.forEach { tool ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            text = "└",
                            fontSize = 13.sp,
                            color = HermesMuted
                        )
                        Text(
                            text = tool,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = HermesSecondary
                        )
                    }
                }
            }
        }

        // Completed footer badge
        if (isCompleted) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "✓ Completed",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = AccentGreen
                )
            }
        }
    }
}
