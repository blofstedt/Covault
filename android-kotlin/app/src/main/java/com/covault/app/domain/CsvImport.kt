package com.covault.app.domain

import com.covault.app.data.model.BudgetCategory
import com.covault.app.data.model.SystemCategories
import com.covault.app.data.model.Transaction
import com.covault.app.data.model.TransactionLabel
import com.covault.app.data.model.TransactionSource
import java.time.Instant
import java.util.UUID

/**
 * Parses a CSV (the format produced by [CsvExport]: Date, Vendor, Amount,
 * Category, Type) into domain [Transaction]s. Pure and unit-tested; the UI
 * layer handles the file picker and the bulk insert.
 *
 * Rows with a missing/invalid amount are skipped. An unknown category maps to
 * "Other". Assumes fields do not contain embedded newlines.
 */
object CsvImport {

    data class Result(val transactions: List<Transaction>, val skipped: Int)

    fun parse(
        csv: String,
        budgets: List<BudgetCategory>,
        userId: String,
        userName: String,
    ): Result {
        val budgetIdByName = budgets.associate { it.name.lowercase() to it.id }
        val otherId = budgets.firstOrNull { it.name.equals("Other", ignoreCase = true) }?.id
            ?: SystemCategories.OTHER.id

        val out = mutableListOf<Transaction>()
        var skipped = 0

        csv.split('\n')
            .map { it.trimEnd('\r') }
            .filter { it.isNotBlank() }
            .forEachIndexed { index, line ->
                val f = splitCsvLine(line)
                // Skip the header row if present.
                if (index == 0 && f.getOrNull(0).equals("Date", ignoreCase = true)) return@forEachIndexed
                if (f.size < 3) { skipped++; return@forEachIndexed }

                val date = f[0].trim()
                val vendor = f[1].trim()
                val amount = f.getOrNull(2)?.trim()?.toDoubleOrNull()
                if (amount == null || vendor.isEmpty() || date.isEmpty()) { skipped++; return@forEachIndexed }

                val categoryName = f.getOrNull(3)?.trim().orEmpty()
                val budgetId = budgetIdByName[categoryName.lowercase()] ?: otherId
                val label = if (f.getOrNull(4)?.trim().equals("AUTOMATIC", ignoreCase = true)) {
                    TransactionLabel.AUTOMATIC
                } else {
                    TransactionLabel.MANUAL
                }

                out.add(
                    Transaction(
                        id = UUID.randomUUID().toString(),
                        userId = userId,
                        vendor = vendor,
                        amount = amount,
                        date = date.take(10) + "T12:00:00.000Z",
                        budgetId = budgetId,
                        label = label,
                        createdAt = Instant.now().toString(),
                        source = TransactionSource.IMPORT,
                        userName = userName,
                    ),
                )
            }

        return Result(out, skipped)
    }

    private fun splitCsvLine(line: String): List<String> {
        val out = mutableListOf<String>()
        val sb = StringBuilder()
        var inQuotes = false
        var i = 0
        while (i < line.length) {
            val c = line[i]
            when {
                inQuotes && c == '"' && i + 1 < line.length && line[i + 1] == '"' -> {
                    sb.append('"'); i++
                }
                c == '"' -> inQuotes = !inQuotes
                c == ',' && !inQuotes -> { out.add(sb.toString()); sb.clear() }
                else -> sb.append(c)
            }
            i++
        }
        out.add(sb.toString())
        return out
    }
}
