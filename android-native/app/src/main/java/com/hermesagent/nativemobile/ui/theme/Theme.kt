package com.hermesagent.nativemobile.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Light Theme (Signature Hermes Mobile iOS HIG / xAI Monochrome Zinc Design)
val HermesBgLight = Color(0xFFF9FAFB)
val HermesPanelLight = Color(0xFFFFFFFF)
val HermesSurfaceLight = Color(0xFFF4F4F5)
val HermesTextLight = Color(0xFF09090B)
val HermesSecondaryLight = Color(0xFF52525B)
val HermesMutedLight = Color(0xFF71717A)
val HermesBorderLight = Color(0x14000000)
val HermesUserBubbleLight = Color(0xFFE4E4E7)

// Grey Theme (Dark Neutral Palette)
val HermesBgGrey = Color(0xFF202124)
val HermesPanelGrey = Color(0xFF292A2D)
val HermesSurfaceGrey = Color(0xFF34363A)
val HermesTextGrey = Color(0xFFF1F2F4)
val HermesSecondaryGrey = Color(0xFFD2D5DA)
val HermesMutedGrey = Color(0xFF9DA2AB)
val HermesBorderGrey = Color(0x1FFFFFFF)
val HermesAccentGrey = Color(0xFF8C91FF)
val HermesUserBubbleGrey = Color(0xFF25272B)

// Aurora Theme (Deep Navy with Cyan Accents)
val HermesBgAurora = Color(0xFF070D18)
val HermesPanelAurora = Color(0xFF101A2B)
val HermesSurfaceAurora = Color(0xFF18263A)
val HermesTextAurora = Color(0xFFF3F7FF)
val HermesSecondaryAurora = Color(0xFFC9D8EB)
val HermesMutedAurora = Color(0xFF8BA3BF)
val HermesBorderAurora = Color(0x298EC2FF)
val HermesAccentAurora = Color(0xFF74D7C2)
val HermesUserBubbleAurora = Color(0xFF18283D)

val LightScheme = lightColorScheme(
    primary = HermesTextLight,
    onPrimary = White,
    primaryContainer = HermesSurfaceLight,
    onPrimaryContainer = HermesTextLight,
    secondary = HermesSecondaryLight,
    onSecondary = White,
    background = HermesBgLight,
    onBackground = HermesTextLight,
    surface = HermesPanelLight,
    onSurface = HermesTextLight,
    surfaceVariant = HermesSurfaceLight,
    onSurfaceVariant = HermesMutedLight,
    outline = HermesBorderLight
)

val GreyScheme = darkColorScheme(
    primary = HermesAccentGrey,
    onPrimary = Black,
    primaryContainer = HermesSurfaceGrey,
    onPrimaryContainer = HermesTextGrey,
    secondary = HermesSecondaryGrey,
    onSecondary = Black,
    background = HermesBgGrey,
    onBackground = HermesTextGrey,
    surface = HermesPanelGrey,
    onSurface = HermesTextGrey,
    surfaceVariant = HermesSurfaceGrey,
    onSurfaceVariant = HermesMutedGrey,
    outline = HermesBorderGrey
)

val AuroraScheme = darkColorScheme(
    primary = HermesAccentAurora,
    onPrimary = Black,
    primaryContainer = HermesSurfaceAurora,
    onPrimaryContainer = HermesTextAurora,
    secondary = HermesSecondaryAurora,
    onSecondary = Black,
    background = HermesBgAurora,
    onBackground = HermesTextAurora,
    surface = HermesPanelAurora,
    onSurface = HermesTextAurora,
    surfaceVariant = HermesSurfaceAurora,
    onSurfaceVariant = HermesMutedAurora,
    outline = HermesBorderAurora
)

// Dynamic theme accessors
var CurrentThemeName = "light"

fun getThemeColorScheme(themeName: String): ColorScheme {
    return when (themeName.lowercase()) {
        "grey" -> GreyScheme
        "aurora" -> AuroraScheme
        else -> LightScheme
    }
}

fun getUserBubbleColor(themeName: String): Color {
    return when (themeName.lowercase()) {
        "grey" -> HermesUserBubbleGrey
        "aurora" -> HermesUserBubbleAurora
        else -> HermesUserBubbleLight
    }
}

fun getBackgroundColor(themeName: String): Color {
    return when (themeName.lowercase()) {
        "grey" -> HermesBgGrey
        "aurora" -> HermesBgAurora
        else -> HermesBgLight
    }
}

fun getSurfaceColor(themeName: String): Color {
    return when (themeName.lowercase()) {
        "grey" -> HermesPanelGrey
        "aurora" -> HermesPanelAurora
        else -> HermesPanelLight
    }
}

fun getBorderColor(themeName: String): Color {
    return when (themeName.lowercase()) {
        "grey" -> HermesBorderGrey
        "aurora" -> HermesBorderAurora
        else -> HermesBorderLight
    }
}

fun getTextColor(themeName: String): Color {
    return when (themeName.lowercase()) {
        "grey" -> HermesTextGrey
        "aurora" -> HermesTextAurora
        else -> HermesTextLight
    }
}

fun getMutedColor(themeName: String): Color {
    return when (themeName.lowercase()) {
        "grey" -> HermesMutedGrey
        "aurora" -> HermesMutedAurora
        else -> HermesMutedLight
    }
}

@Composable
fun HermesTheme(
    themeName: String = "light",
    content: @Composable () -> Unit
) {
    CurrentThemeName = themeName
    val colorScheme = getThemeColorScheme(themeName)

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
