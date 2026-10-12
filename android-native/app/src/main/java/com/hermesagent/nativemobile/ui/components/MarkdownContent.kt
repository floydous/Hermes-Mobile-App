package com.hermesagent.nativemobile.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.hermesagent.nativemobile.ui.theme.AccentGreen
import com.hermesagent.nativemobile.ui.theme.HermesBorder
import com.hermesagent.nativemobile.ui.theme.HermesBorderSubtle
import com.hermesagent.nativemobile.ui.theme.HermesMuted
import com.hermesagent.nativemobile.ui.theme.HermesSecondary
import com.hermesagent.nativemobile.ui.theme.HermesSurface
import com.hermesagent.nativemobile.ui.theme.HermesText
import com.hermesagent.nativemobile.util.EnvelopeCleaner

sealed class MarkdownNode {
    data class TextNode(val text: String) : MarkdownNode()
    data class CodeBlockNode(val language: String, val code: String) : MarkdownNode()
    data class ImageNode(val url: String, val alt: String) : MarkdownNode()
    data class ListNode(val items: List<String>) : MarkdownNode()
}

fun parseMarkdownNodes(raw: String): List<MarkdownNode> {
    val cleaned = EnvelopeCleaner.clean(raw)
    val nodes = mutableListOf<MarkdownNode>()
    val lines = cleaned.lines()
    var i = 0

    while (i < lines.size) {
        val line = lines[i]

        // Check for fenced code block: ```lang
        if (line.trim().startsWith("```")) {
            val lang = line.trim().removePrefix("```").trim().ifBlank { "text" }
            val codeLines = mutableListOf<String>()
            i++
            while (i < lines.size && !lines[i].trim().startsWith("```")) {
                codeLines.add(lines[i])
                i++
            }
            nodes.add(MarkdownNode.CodeBlockNode(language = lang, code = codeLines.joinToString("\n")))
            i++
            continue
        }

        // Check for Markdown Image: ![alt](url)
        val imageMatch = Regex("""^!\[(.*?)\]\((.*?)\)$""").find(line.trim())
        if (imageMatch != null) {
            val alt = imageMatch.groupValues[1]
            val url = imageMatch.groupValues[2]
            nodes.add(MarkdownNode.ImageNode(url = url, alt = alt))
            i++
            continue
        }

        // Bulleted lists: - item or * item
        if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
            val listItems = mutableListOf<String>()
            while (i < lines.size && (lines[i].trim().startsWith("- ") || lines[i].trim().startsWith("* "))) {
                listItems.add(lines[i].trim().removePrefix("- ").removePrefix("* "))
                i++
            }
            nodes.add(MarkdownNode.ListNode(listItems))
            continue
        }

        // Regular paragraph / text line
        if (line.isNotBlank()) {
            val textLines = mutableListOf<String>()
            while (i < lines.size && lines[i].isNotBlank() && !lines[i].trim().startsWith("```") && !lines[i].trim().startsWith("- ")) {
                textLines.add(lines[i])
                i++
            }
            nodes.add(MarkdownNode.TextNode(textLines.joinToString("\n")))
            continue
        }

        i++
    }

    return nodes
}

fun renderInlineFormatting(text: String): AnnotatedString {
    return buildAnnotatedString {
        var cursor = 0
        val pattern = Regex("""(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))""")
        val matches = pattern.findAll(text).toList()

        for (match in matches) {
            // Append leading plain text
            if (match.range.first > cursor) {
                append(text.substring(cursor, match.range.first))
            }

            val value = match.value
            when {
                value.startsWith("**") && value.endsWith("**") -> {
                    pushStyle(SpanStyle(fontWeight = FontWeight.Bold))
                    if (value.length > 4) {
                        append(value.substring(2, value.length - 2))
                    }
                    pop()
                }
                value.startsWith("*") && value.endsWith("*") -> {
                    pushStyle(SpanStyle(fontStyle = FontStyle.Italic))
                    if (value.length > 2) {
                        append(value.substring(1, value.length - 1))
                    }
                    pop()
                }
                value.startsWith("`") && value.endsWith("`") -> {
                    pushStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Color(0x18000000)))
                    if (value.length > 2) {
                        append(" ${value.substring(1, value.length - 1)} ")
                    }
                    pop()
                }
                value.startsWith("[") && value.contains("](") -> {
                    val linkText = value.substringAfter("[").substringBefore("]")
                    pushStyle(SpanStyle(color = Color(0xFF2563EB), fontWeight = FontWeight.Medium))
                    append(linkText)
                    pop()
                }
                else -> append(value)
            }
            cursor = match.range.last + 1
        }

        if (cursor < text.length) {
            append(text.substring(cursor))
        }
    }
}

@Composable
fun MarkdownContent(
    content: String,
    modifier: Modifier = Modifier
) {
    val nodes = remember(content) { parseMarkdownNodes(content) }
    val context = LocalContext.current

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        nodes.forEach { node ->
            when (node) {
                is MarkdownNode.TextNode -> {
                    Text(
                        text = renderInlineFormatting(node.text),
                        fontSize = 15.sp,
                        color = HermesText,
                        lineHeight = 22.sp
                    )
                }
                is MarkdownNode.CodeBlockNode -> {
                    CodeBlock(
                        language = node.language,
                        code = node.code,
                        onCopy = {
                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(ClipData.newPlainText("Code", node.code))
                            Toast.makeText(context, "Code copied", Toast.LENGTH_SHORT).show()
                        }
                    )
                }
                is MarkdownNode.ImageNode -> {
                    AsyncImage(
                        model = node.url,
                        contentDescription = node.alt,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
                    )
                }
                is MarkdownNode.ListNode -> {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        node.items.forEach { item ->
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.Top
                            ) {
                                Text(text = "•", fontSize = 15.sp, color = HermesMuted)
                                Text(
                                    text = renderInlineFormatting(item),
                                    fontSize = 15.sp,
                                    color = HermesText,
                                    lineHeight = 22.sp
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CodeBlock(
    language: String,
    code: String,
    onCopy: () -> Unit,
    modifier: Modifier = Modifier
) {
    var copied by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(HermesSurface)
            .border(1.dp, HermesBorder, RoundedCornerShape(12.dp))
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0x08000000))
                .border(width = 1.dp, color = HermesBorderSubtle, shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp))
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = language.uppercase(),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = HermesMuted
            )

            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable {
                        onCopy()
                        copied = true
                    }
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Icon(
                    imageVector = if (copied) Icons.Default.Check else Icons.Default.ContentCopy,
                    contentDescription = "Copy",
                    tint = if (copied) AccentGreen else HermesSecondary,
                    modifier = Modifier.size(13.dp)
                )
                Text(
                    text = if (copied) "Copied" else "Copy",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (copied) AccentGreen else HermesSecondary
                )
            }
        }

        // Code body
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(12.dp)
        ) {
            Text(
                text = code,
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                color = HermesText,
                lineHeight = 18.sp
            )
        }
    }
}
