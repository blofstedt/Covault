package com.covault.app.ui.onboarding

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.covault.app.ui.theme.CovaultTheme

/**
 * Onboarding flow. Direct port of `components/Onboarding.tsx`.
 *
 * Steps:
 *  1. INTRO_1 — "Spent vs. Projected" with a small bar-chart illustration
 *  2. INTRO_2 — "Sync & Forget" with a bell illustration
 *  3. CHOOSE_MODE — Solo vs. Couples buttons
 *  4. PARTNER_EMAIL — email input + Send Invite (or Skip)
 *
 * The step state lives in [OnboardingViewModel]. Animations between
 * steps are simple crossfades; Stage 4 can refine the motion.
 */
@Composable
fun OnboardingScreen(
    onComplete: () -> Unit,
    viewModel: OnboardingViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val isCompleting by viewModel.isCompleting.collectAsStateWithLifecycle()
    val hasCompleted by viewModel.hasCompleted.collectAsStateWithLifecycle()

    // When the VM flips the completion flag, hand control to the navigator.
    // Using a remembered lambda so the side effect fires once per flag flip.
    LaunchedEffect(hasCompleted) {
        if (hasCompleted) onComplete()
    }

    if (isCompleting) {
        // Brief shimmer state — Stage 4 may replace with a progress bar.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center,
        ) { Text("Setting up your vault…") }
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.systemBars)
            .imePadding()
            .padding(horizontal = 32.dp, vertical = 32.dp),
    ) {
        AnimatedContent(
            targetState = state.step,
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "onboarding-step",
        ) { step ->
            when (step) {
                OnboardingViewModel.Step.INTRO_1 -> IntroStep(
                    title = "Spent vs. Projected",
                    body = "Solid bars show current spending. Dashed bars project your future based on recurring bills.",
                    illustration = BarChartIllustration(),
                    onNext = viewModel::nextFromIntro,
                )
                OnboardingViewModel.Step.INTRO_2 -> IntroStep(
                    title = "Sync & Forget",
                    body = "Covault listens for banking notifications to auto-file transactions. You just review and confirm.",
                    illustration = BellIllustration(),
                    onNext = viewModel::nextFromIntro,
                )
                OnboardingViewModel.Step.CHOOSE_MODE -> ChooseModeStep(
                    onSolo = viewModel::chooseSolo,
                    onCouples = viewModel::chooseCouples,
                )
                OnboardingViewModel.Step.PARTNER_EMAIL -> PartnerEmailStep(
                    email = state.partnerEmail,
                    onEmailChange = viewModel::updatePartnerEmail,
                    onSend = viewModel::finishWithPartner,
                    onSkip = viewModel::skipPartner,
                    onBack = viewModel::backToChooseMode,
                )
            }
        }
    }

    // After the user finishes and `complete()` runs the coroutine, navigate.
    // Stage 3 has no real persistence yet, so we navigate on every
    // PARTNER_EMAIL -> Skip/Send transition immediately.
}

@Composable
private fun IntroStep(
    title: String,
    body: String,
    illustration: @Composable () -> Unit,
    onNext: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Spacer(Modifier.weight(1f))
        Box(
            modifier = Modifier
                .size(288.dp)
                .background(
                    color = MaterialTheme.colorScheme.surface,
                    shape = RoundedCornerShape(64.dp),
                )
                .border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.outlineVariant,
                    shape = RoundedCornerShape(64.dp),
                )
                .padding(48.dp),
            contentAlignment = Alignment.Center,
        ) {
            illustration()
        }
        Spacer(Modifier.height(32.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(16.dp))
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.weight(1f))

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Step dots (2 of them — both intro steps are visible in the dots)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DotIndicator(active = title.contains("Spent"))
                DotIndicator(active = title.contains("Sync"))
            }
            Spacer(Modifier.weight(1f))
            IconButton(
                onClick = onNext,
                modifier = Modifier
                    .size(80.dp)
                    .background(
                        color = MaterialTheme.colorScheme.primary,
                        shape = RoundedCornerShape(28.dp),
                    ),
            ) {
                Icon(
                    imageVector = Icons.Filled.ChevronRight,
                    contentDescription = "Next",
                    tint = MaterialTheme.colorScheme.onPrimary,
                )
            }
        }
    }
}

@Composable
private fun DotIndicator(active: Boolean) {
    Box(
        modifier = Modifier
            .height(8.dp)
            .width(if (active) 40.dp else 8.dp)
            .background(
                color = if (active) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(4.dp),
            ),
    )
}

@Composable
private fun ChooseModeStep(
    onSolo: () -> Unit,
    onCouples: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.weight(0.5f))
        Text(
            text = "Who is this for?",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8))
        Text(
            text = "Clarity for yourself or confidence together.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(48))

        ModeCard(
            title = "Just Me",
            subtitle = "Personal budget tracking.",
            accent = false,
            onClick = onSolo,
        )
        Spacer(Modifier.height(24))
        ModeCard(
            title = "Couples",
            subtitle = "Combined budgeting together.",
            accent = true,
            onClick = onCouples,
        )
        Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun ModeCard(
    title: String,
    subtitle: String,
    accent: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(48.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(
                width = 2.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(48.dp),
            ),
    ) {
        Row(
            modifier = Modifier.padding(32.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .background(
                        color = if (accent) MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(20.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = title.first().toString(),
                    style = MaterialTheme.typography.headlineSmall,
                    color = if (accent) MaterialTheme.colorScheme.onPrimaryContainer
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(24))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(4))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PartnerEmailStep(
    email: String,
    onEmailChange: (String) -> Unit,
    onSend: () -> Unit,
    onSkip: () -> Unit,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.weight(0.5f))
        Text(
            text = "Invite Partner",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8))
        Text(
            text = "Enter your partner's email to send an invite.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(48))

        BasicTextField(
            value = email,
            onValueChange = onEmailChange,
            textStyle = TextStyle(
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 24.sp,
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center,
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Done,
            ),
            singleLine = true,
            decorationBox = { inner ->
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center,
                ) {
                    if (email.isEmpty()) {
                        Text(
                            text = "partner@example.com",
                            style = TextStyle(
                                color = MaterialTheme.colorScheme.outline,
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Black,
                                textAlign = TextAlign.Center,
                            ),
                        )
                    }
                    inner()
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 24.dp),
        )
        // Underline
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(MaterialTheme.colorScheme.outlineVariant),
        )

        Spacer(Modifier.height(48))

        Button(
            onClick = onSend,
            enabled = email.contains("@"),
            modifier = Modifier
                .fillMaxWidth()
                .height(72.dp),
            shape = RoundedCornerShape(28.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) {
            Text(
                text = "Send Invite",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        Spacer(Modifier.height(16))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                text = "Go Back",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable(onClick = onBack),
            )
            Text(
                text = "Skip for now",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable(onClick = onSkip),
            )
        }

        Spacer(Modifier.weight(1f))
    }
}

// ---- Illustrations (Stage 3 stubs; Stage 4 replaces with proper SVGs) ---

@Composable
private fun BarChartIllustration() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.Bottom,
    ) {
        listOf(0.4f, 0.7f, 0.3f, 0.5f).forEach { factor ->
            Box(
                modifier = Modifier
                    .width(28.dp)
                    .height((120 * factor).dp)
                    .background(
                        color = MaterialTheme.colorScheme.primary,
                        shape = RoundedCornerShape(4.dp),
                    ),
            )
        }
    }
}

@Composable
private fun BellIllustration() {
    Box(
        modifier = Modifier
            .size(120.dp)
            .background(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = CircleShape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "🔔",
            style = MaterialTheme.typography.displayMedium,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun OnboardingScreenPreview() {
    CovaultTheme {
        OnboardingScreen(onComplete = {})
    }
}
