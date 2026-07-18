package com.covault.app.di

import com.covault.app.data.remote.SupabaseClientProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.github.jan.supabase.SupabaseClient
import javax.inject.Singleton

/**
 * Hilt module that exposes the singleton [SupabaseClient]. Repositories
 * and DAOs declare a constructor injection for `SupabaseClient` and get
 * this exact instance.
 */
@Module
@InstallIn(SingletonComponent::class)
object SupabaseModule {

    @Provides
    @Singleton
    fun provideSupabaseClient(): SupabaseClient = SupabaseClientProvider.build()
}
