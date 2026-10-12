package com.hermesagent.nativemobile.ui.screens

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
import com.hermesagent.nativemobile.data.model.CronJob
import com.hermesagent.nativemobile.ui.theme.AccentGreen
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.ui.theme.Zinc100
import com.hermesagent.nativemobile.ui.theme.Zinc400
import com.hermesagent.nativemobile.ui.theme.Zinc800
import com.hermesagent.nativemobile.ui.theme.Zinc850
import com.hermesagent.nativemobile.ui.theme.Zinc900

@Composable
fun TaskListScreen(
    tasks: List<CronJob>,
    onTaskClick: (CronJob) -> Unit,
    modifier: Modifier = Modifier
) {
    if (tasks.isEmpty()) {
        Box(
            modifier = modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No scheduled tasks configured",
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
            items(tasks, key = { it.jobId }) { task ->
                TaskCardRow(
                    task = task,
                    onClick = { onTaskClick(task) }
                )
            }
        }
    }
}

@Composable
fun TaskCardRow(
    task: CronJob,
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
                    text = task.name ?: task.jobId,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Zinc100
                )

                if (task.enabled) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(AccentGreen)
                    )
                }
            }

            Text(
                text = task.schedule ?: "Every hour",
                fontSize = 13.sp,
                color = Zinc400
            )

            if (!task.promptPreview.isNullOrBlank()) {
                Text(
                    text = task.promptPreview,
                    fontSize = 12.sp,
                    color = Zinc400,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
