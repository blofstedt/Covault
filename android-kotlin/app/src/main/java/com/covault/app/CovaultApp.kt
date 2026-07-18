package com.covault.app

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Application entry. Hilt scans this class for the [HiltAndroidApp] annotation
 * and generates the dependency graph at compile time.
 *
 * Stage 1: no-op. Stage 3 will add Supabase initialization here.
 */
@HiltAndroidApp
class CovaultApp : Application()
