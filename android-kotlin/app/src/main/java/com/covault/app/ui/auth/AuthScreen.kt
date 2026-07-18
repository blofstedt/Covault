package com.covault.app.ui.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.covault.app.ui.components.CovaultLogoMark
import com.covault.app.ui.theme.CovaultTheme

/**
 * Login screen. Direct port of `components/Auth.tsx` to Compose.
 *
 *  - Brand mark + tagline at the top
 *  - "Connect with Google" CTA with the standard Google logo
 *  - Loading state with a spinner ("Opening Vault…")
 *  - Error banner that surfaces Supabase auth errors verbatim
 *  - Legal links (Privacy / Terms) to the existing Vercel-hosted pages
 *
 * The state machine is owned by [AuthViewModel]. The screen itself is
 * stateless from the ViewModel's perspective — every user action is
 * delegated up.
 */
@Composable
fun AuthScreen(
    onAuthSuccess: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel(),
) {
    val isLoggingIn by viewModel.isLoggingIn.collectAsStateWithLifecycle()
    val authError by viewModel.authError.collectAsStateWithLifecycle()
    val authState by viewModel.authState.collectAsStateWithLifecycle()

    // Once auth succeeds, hand control back to the navigator. We do this
    // here (rather than only in the top-level ViewModel) so the screen
    // doesn't need to know about navigation routes.
    if (authState is com.covault.app.data.repository.AuthState.Authenticated) {
        onAuthSuccess()
    }

    AuthContent(
        isLoggingIn = isLoggingIn,
        authError = authError,
        onGoogleLogin = viewModel::signInWithGoogle,
        onDismissError = viewModel::dismissError,
    )
}

@Composable
private fun AuthContent(
    isLoggingIn: Boolean,
    authError: String?,
    onGoogleLogin: () -> Unit,
    onDismissError: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.systemBars)
            .imePadding(),
    ) {
        // Decorative blurred blobs (matches the React `animate-blob` background)
        BackgroundBlobs()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp, vertical = 32.dp),
        ) {
            Spacer(Modifier.weight(1f))

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CovaultLogoMark(size = 120)
                Spacer(Modifier.height(24))
                Text(
                    text = "Covault",
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.ExtraBold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(8))
                Text(
                    text = "Budgeting for peace of mind.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.weight(1f))

            // Error banner (slide-in if visible, matches the React `slide-in-from-bottom-2` keyframe)
            AnimatedVisibility(
                visible = authError != null,
                enter = slideInVertically(initialOffsetY = { it }) + fadeIn(),
                exit = slideOutVertically(targetOffsetY = { it }) + fadeOut(),
            ) {
                authError?.let { ErrorBanner(message = it, onDismiss = onDismissError) }
            }
            if (authError != null) Spacer(Modifier.height(16))

            // CTA: spinner when logging in, otherwise the Google button
            if (isLoggingIn) {
                LoggingInState()
            } else {
                GoogleSignInButton(onClick = onGoogleLogin)
            }

            Spacer(Modifier.height(16))
            Text(
                text = "Secured by Supabase · AES-256",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8))

            // Legal links
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                LegalLink(label = "Privacy") {
                    uriHandler.openUri("https://covaultbudgeting.vercel.app/privacy")
                }
                Text(
                    text = "·",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
                LegalLink(label = "Terms") {
                    uriHandler.openUri("https://covaultbudgeting.vercel.app/terms")
                }
            }
            Spacer(Modifier.height(16))
        }
    }
}

@Composable
private fun BackgroundBlobs() {
    Box(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .size(384.dp)
                .align(Alignment.TopStart)
                .offset(x = (-48).dp, y = 64.dp)
                .blur(100.dp)
                .background(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
                            Color.Transparent,
                        ),
                    ),
                    shape = CircleShape,
                ),
        )
        Box(
            modifier = Modifier
                .size(384.dp)
                .align(Alignment.BottomEnd)
                .offset(x = 48.dp, y = (-64).dp)
                .blur(100.dp)
                .background(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.tertiary.copy(alpha = 0.18f),
                            Color.Transparent,
                        ),
                    ),
                    shape = CircleShape,
                ),
        )
    }
}

@Composable
private fun ErrorBanner(message: String, onDismiss: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onDismiss),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Security Alert".uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.8f),
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4))
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}

@Composable
private fun LoggingInState() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 16.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(
            color = MaterialTheme.colorScheme.primary,
            strokeWidth = 3.dp,
            modifier = Modifier.size(24.dp),
        )
        Spacer(Modifier.width(16))
        Text(
            text = "Opening Vault…",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
private fun GoogleSignInButton(onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp),
        shape = RoundedCornerShape(28.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
        border = androidx.compose.foundation.BorderStroke(
            width = 2.dp,
            color = MaterialTheme.colorScheme.outlineVariant,
        ),
    ) {
        GoogleLogo()
        Spacer(Modifier.width(16))
        Text(
            text = "Connect with Google",
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.titleSmall,
        )
    }
}

@Composable
private fun GoogleLogo() {
    // Inline 24x24 Google "G" mark using the React app's four brand colors.
    Row {
        listOf(
            Color(0xFF4285F4),  // blue
            Color(0xFF34A853),  // green
            Color(0xFFFBBC05),  // yellow
            Color(0xFFEA4335),  // red
        ).forEach { color ->
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .padding(end = 2.dp)
                    .background(color = color, shape = CircleShape),
            )
        }
    }
    // The actual Google logo is raster and trademarked — fall back to a
    // 4-dot color hint that signals "Google" without embedding the
    // proprietary mark. The text label is what users actually click on.
}

@Composable
private fun LegalLink(label: String, onClick: () -> Unit) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Preview(showBackground = true, name = "Auth")
@Composable
private fun AuthScreenPreview() {
    CovaultTheme {
        AuthContent(
            isLoggingIn = false,
            authError = null,
            onGoogleLogin = {},
            onDismissError = {},
        )
    }
}

@Preview(showBackground = true, name = "Auth — loading")
@Composable
private fun AuthScreenLoadingPreview() {
    CovaultTheme {
        AuthContent(
            isLoggingIn = true,
            authError = null,
            onGoogleLogin = {},
            onDismissError = {},
        )
    }
}
