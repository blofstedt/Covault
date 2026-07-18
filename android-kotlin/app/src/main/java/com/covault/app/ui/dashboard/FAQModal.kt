package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * FAQ modal. Port of `components/dashboard_components/FAQModal.tsx`.
 * The original is a single hardcoded list of Q&As about Covault
 * (account, sharing, privacy, etc.). We keep the same content.
 */
@Composable
fun FAQModal(onClose: () -> Unit) {
    var openIndex by remember { mutableStateOf<Int?>(null) }
    val faqs = remember { FAQS }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.5f))
            .padding(16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(40.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "Frequently Asked",
                        style = TextStyle(
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = onClose,
                        modifier = Modifier
                            .size(40.dp)
                            .background(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(50),
                            ),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Close,
                            contentDescription = "Close",
                            tint = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                faqs.forEachIndexed { i, faq ->
                    val isOpen = openIndex == i
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(
                                width = 1.dp,
                                color = MaterialTheme.colorScheme.outlineVariant,
                                shape = RoundedCornerShape(16.dp),
                            )
                            .padding(12.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { openIndex = if (isOpen) null else i },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = faq.first,
                                style = TextStyle(
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface,
                                ),
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                text = if (isOpen) "−" else "+",
                                style = TextStyle(
                                    fontSize = 16.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                ),
                            )
                        }
                        if (isOpen) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = faq.second,
                                style = TextStyle(
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                ),
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}

private val FAQS = listOf(
    "How does Covault keep my data private?" to
        "Your transactions live in a private Supabase database, accessible only with your signed-in session. " +
        "We never sell or share your data.",
    "Can I share my vault with a partner?" to
        "Yes. Open Settings -> Vault Sharing and enter your partner's email. They'll receive an invite; " +
        "once accepted, your transactions merge into a single shared view.",
    "What's the difference between Solo and Couples mode?" to
        "Solo mode is just you; Couples mode merges your transactions with your partner's and tracks " +
        "your income contribution separately.",
    "How does the bank notification listener work?" to
        "After you grant the Notification Access permission, Covault reads incoming bank notifications " +
        "and proposes transactions for your review. Nothing is auto-saved without your tap.",
    "What if I cancel my subscription?" to
        "You keep all your data; premium-only features (notification listener, discretionary shield) " +
        "deactivate. Re-subscribe any time to re-enable them.",
    "How do I export my data?" to
        "Settings -> Export downloads a CSV of every transaction. Settings -> Import accepts a CSV in " +
        "the same shape to bring data back in.",
)
