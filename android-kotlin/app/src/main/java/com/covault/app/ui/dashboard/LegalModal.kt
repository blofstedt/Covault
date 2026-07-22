package com.covault.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private data class LegalSection(val heading: String, val lines: List<String>)

/** Privacy Policy screen. */
@Composable
fun PrivacyPolicyModal(onClose: () -> Unit) =
    LegalScreen("Privacy Policy", "Last updated: February 10, 2026", privacySections, onClose)

/** Terms of Service screen. */
@Composable
fun TermsModal(onClose: () -> Unit) =
    LegalScreen("Terms of Service", "Last updated: February 10, 2026", termsSections, onClose)

@Composable
private fun LegalScreen(
    title: String,
    subtitle: String,
    sections: List<LegalSection>,
    onClose: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.5f)),
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.systemBars),
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 12.dp, top = 16.dp, bottom = 8.dp),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
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

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 32.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    items(sections) { section ->
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = section.heading,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            section.lines.forEach { line ->
                                if (line.startsWith("• ")) {
                                    Text(
                                        text = line,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(start = 8.dp),
                                    )
                                } else {
                                    Text(
                                        text = line,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private const val CONTACT_EMAIL = "mostlydecentdev@gmail.com"

private val privacySections = listOf(
    LegalSection(
        "1. Introduction",
        listOf(
            "Welcome to Covault (\"we\", \"our\", or \"us\"). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains what information we collect, how we use it, and what rights you have in relation to it.",
        ),
    ),
    LegalSection(
        "2. Information We Collect",
        listOf(
            "We may collect the following types of information when you use our application:",
            "• Account Information: When you sign up, we collect your name, email address, and authentication credentials via third-party providers (e.g., Google).",
            "• Financial Data: Budget categories, transaction amounts, and related financial information you enter into the app. This data is stored securely and is used solely to provide the budgeting service.",
            "• Usage Data: We may collect information about how you interact with the app, including device type and general usage patterns.",
            "• Device Information: We may collect device identifiers and push notification tokens for delivering notifications.",
        ),
    ),
    LegalSection(
        "3. How We Use Your Information",
        listOf(
            "• To provide, maintain, and improve the Covault budgeting service.",
            "• To authenticate your identity and manage your account.",
            "• To send you notifications related to your budgets and transactions (if enabled).",
            "• To generate insights and reports about your spending.",
            "• To respond to your requests or questions.",
        ),
    ),
    LegalSection(
        "4. Data Storage and Security",
        listOf(
            "Your data is stored using Supabase, a secure cloud database platform. We use industry-standard security measures, including encryption in transit and at rest, to protect your personal information. However, no method of electronic transmission or storage is 100% secure, and we cannot guarantee absolute security.",
        ),
    ),
    LegalSection(
        "5. Third-Party Services",
        listOf(
            "We use the following third-party services to operate the app:",
            "• Google (Authentication): For sign-in via OAuth.",
            "• Supabase: For data storage and authentication.",
            "These services have their own privacy policies, and we encourage you to review them.",
        ),
    ),
    LegalSection(
        "6. Data Sharing",
        listOf(
            "We do not sell, trade, or rent your personal information to third parties. We may share data only in the following circumstances:",
            "• With your consent or at your direction (e.g., linking a partner account).",
            "• To comply with legal obligations or respond to lawful requests.",
            "• To protect our rights, privacy, safety, or property.",
        ),
    ),
    LegalSection(
        "7. Your Rights",
        listOf(
            "Depending on your location, you may have the right to:",
            "• Access the personal data we hold about you.",
            "• Request correction or deletion of your personal data.",
            "• Withdraw consent for data processing at any time.",
            "• Request a copy of your data in a portable format.",
            "To exercise any of these rights, please contact us at the email address provided below.",
        ),
    ),
    LegalSection(
        "8. Local Storage",
        listOf(
            "We use on-device storage to save your preferences (such as theme settings). We do not use tracking cookies for advertising purposes.",
        ),
    ),
    LegalSection(
        "9. Children's Privacy",
        listOf(
            "Covault is not intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13.",
        ),
    ),
    LegalSection(
        "10. Changes to This Policy",
        listOf(
            "We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the \"Last updated\" date above.",
        ),
    ),
    LegalSection(
        "11. Contact Us",
        listOf("If you have any questions about this Privacy Policy, please contact us at $CONTACT_EMAIL."),
    ),
)

private val termsSections = listOf(
    LegalSection(
        "1. Acceptance of Terms",
        listOf(
            "By accessing or using Covault (\"the Service\"), you agree to be bound by these Terms of Service (\"Terms\"). If you do not agree to these Terms, please do not use the Service.",
        ),
    ),
    LegalSection(
        "2. Description of Service",
        listOf(
            "Covault is a personal budgeting application that allows users to track income, expenses, and budget categories. The Service may include features such as transaction capture, partner account linking, notifications, and financial reporting.",
        ),
    ),
    LegalSection(
        "3. User Accounts",
        listOf(
            "• You must provide accurate and complete information when creating an account.",
            "• You are responsible for maintaining the security of your account credentials.",
            "• You are responsible for all activity that occurs under your account.",
            "• You must notify us immediately of any unauthorized use of your account.",
        ),
    ),
    LegalSection(
        "4. Acceptable Use",
        listOf(
            "You agree not to:",
            "• Use the Service for any unlawful purpose or in violation of any applicable laws.",
            "• Attempt to gain unauthorized access to the Service or its systems.",
            "• Interfere with or disrupt the integrity or performance of the Service.",
            "• Upload or transmit viruses, malware, or other harmful code.",
            "• Reverse engineer, decompile, or disassemble any part of the Service.",
            "• Use the Service to harass, abuse, or harm others.",
        ),
    ),
    LegalSection(
        "5. Financial Information Disclaimer",
        listOf(
            "Covault is a budgeting tool provided for informational and organizational purposes only. The Service does not constitute financial, investment, tax, or legal advice. You should consult with qualified professionals regarding your financial decisions. We are not responsible for any financial decisions you make based on the information provided by the Service.",
        ),
    ),
    LegalSection(
        "6. Intellectual Property",
        listOf(
            "All content, features, and functionality of the Service, including but not limited to text, graphics, logos, and software, are the property of Covault and are protected by copyright, trademark, and other intellectual property laws. You may not reproduce, distribute, or create derivative works without our prior written consent.",
        ),
    ),
    LegalSection(
        "7. User Data",
        listOf(
            "You retain ownership of all data you input into the Service. By using the Service, you grant us a limited license to store, process, and display your data solely for the purpose of providing and improving the Service. Please refer to our Privacy Policy for more details on how we handle your data.",
        ),
    ),
    LegalSection(
        "8. Service Availability",
        listOf(
            "We strive to keep the Service available at all times, but we do not guarantee uninterrupted or error-free operation. We may modify, suspend, or discontinue any part of the Service at any time without prior notice. We are not liable for any downtime or service interruptions.",
        ),
    ),
    LegalSection(
        "9. Limitation of Liability",
        listOf(
            "To the fullest extent permitted by law, Covault and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, profits, or goodwill, arising out of or related to your use of the Service.",
        ),
    ),
    LegalSection(
        "10. Disclaimer of Warranties",
        listOf(
            "The Service is provided \"as is\" and \"as available\" without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.",
        ),
    ),
    LegalSection(
        "11. Termination",
        listOf(
            "We reserve the right to suspend or terminate your account at our sole discretion, without notice, for conduct that we determine violates these Terms or is harmful to the Service, other users, or third parties. Upon termination, your right to use the Service will immediately cease.",
        ),
    ),
    LegalSection(
        "12. Changes to These Terms",
        listOf(
            "We may update these Terms from time to time. We will notify you of any changes by posting the updated Terms on this page and updating the \"Last updated\" date. Your continued use of the Service after changes are posted constitutes your acceptance of the revised Terms.",
        ),
    ),
    LegalSection(
        "13. Governing Law",
        listOf(
            "These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles.",
        ),
    ),
    LegalSection(
        "14. Contact Us",
        listOf("If you have any questions about these Terms of Service, please contact us at $CONTACT_EMAIL."),
    ),
)
