package com.hermesagent.nativemobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hermesagent.nativemobile.data.model.ClarifyRequest
import com.hermesagent.nativemobile.ui.theme.White
import com.hermesagent.nativemobile.ui.theme.Zinc100
import com.hermesagent.nativemobile.ui.theme.Zinc400
import com.hermesagent.nativemobile.ui.theme.Zinc800
import com.hermesagent.nativemobile.ui.theme.Zinc850
import com.hermesagent.nativemobile.ui.theme.Zinc900

@Composable
fun ClarifyCard(
    request: ClarifyRequest,
    onSubmit: (Map<String, String>) -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier
) {
    var selectedChoices by remember { mutableStateOf(mapOf<String, String>()) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Zinc900)
            .border(1.dp, Zinc800, RoundedCornerShape(20.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Clarification Needed",
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = White
            )

            Text(
                text = "Skip",
                fontSize = 13.sp,
                color = Zinc400,
                modifier = Modifier
                    .clickable { onSkip() }
                    .padding(4.dp)
            )
        }

        request.questions.forEach { q ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = q.question,
                    fontSize = 14.sp,
                    color = Zinc100
                )

                q.choices?.forEach { choice ->
                    val isSelected = selectedChoices[q.qid] == choice
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (isSelected) Zinc800 else Zinc850)
                            .border(1.dp, if (isSelected) White else Zinc800, RoundedCornerShape(12.dp))
                            .clickable {
                                selectedChoices = selectedChoices + (q.qid to choice)
                            }
                            .padding(horizontal = 14.dp, vertical = 10.dp)
                    ) {
                        Text(
                            text = choice,
                            fontSize = 13.sp,
                            color = if (isSelected) White else Zinc400
                        )
                    }
                }
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(White)
                .clickable { onSubmit(selectedChoices) }
                .padding(vertical = 12.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "Continue",
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = Zinc900
            )
        }
    }
}
