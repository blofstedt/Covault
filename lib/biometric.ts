import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';

export interface BiometricStatus {
  isAvailable: boolean;
  biometryType: 'fingerprint' | 'face' | 'iris' | 'none';
  isEnrolled: boolean;
}

/**
 * Check if biometric authentication is available on this device
 */
export async function checkBiometricAvailability(): Promise<BiometricStatus> {
  // Only available on native platforms
  if (!Capacitor.isNativePlatform()) {
    return {
      isAvailable: false,
      biometryType: 'none',
      isEnrolled: false
    };
  }

  try {
    const result = await BiometricAuth.checkBiometry();

    let biometryType: BiometricStatus['biometryType'] = 'none';

    switch (result.biometryType) {
      case BiometryType.touchId:
      case BiometryType.fingerprintAuthentication:
        biometryType = 'fingerprint';
        break;
      case BiometryType.faceId:
      case BiometryType.faceAuthentication:
        biometryType = 'face';
        break;
      case BiometryType.irisAuthentication:
        biometryType = 'iris';
        break;
      default:
        biometryType = 'none';
    }

    return {
      isAvailable: result.isAvailable,
      biometryType,
      isEnrolled: result.isAvailable && !result.reason // If available and no reason, then enrolled
    };
  } catch (error) {
    console.error('Error checking biometric availability:', error);
    return {
      isAvailable: false,
      biometryType: 'none',
      isEnrolled: false
    };
  }
}

/**
 * Prompt for biometric authentication
 */
export async function authenticateWithBiometric(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, error: 'Biometric auth only available on mobile devices' };
  }

  try {
    await BiometricAuth.authenticate({
      reason: 'Unlock your Covault',
      cancelTitle: 'Use Password',
      allowDeviceCredential: true, // Allow PIN/password as fallback
      iosFallbackTitle: 'Use Passcode',
      androidTitle: 'Covault Authentication',
      androidSubtitle: 'Verify your identity to access your vault',
      androidConfirmationRequired: false
    });

    return { success: true };
  } catch (error: any) {
    console.error('Biometric authentication failed:', error);

    // Handle specific error cases
    if (error.code === 'userCancel') {
      return { success: false, error: 'Authentication cancelled' };
    }
    if (error.code === 'biometryNotAvailable') {
      return { success: false, error: 'Biometric authentication not available' };
    }
    if (error.code === 'biometryNotEnrolled') {
      return { success: false, error: 'No biometrics enrolled on this device' };
    }

    return { success: false, error: error.message || 'Authentication failed' };
  }
}

/**
 * Check if biometric auth should be used (stored preference)
 */
export function isBiometricEnabled(): boolean {
  return localStorage.getItem('covault_biometric_enabled') === 'true';
}

/**
 * Enable or disable biometric auth preference
 */
export function setBiometricEnabled(enabled: boolean): void {
  localStorage.setItem('covault_biometric_enabled', enabled ? 'true' : 'false');
}

/**
 * Store that user has completed biometric setup
 */
export function markBiometricSetupComplete(): void {
  localStorage.setItem('covault_biometric_setup', 'true');
}

/**
 * Check if biometric setup has been shown
 */
export function hasBiometricSetupBeenShown(): boolean {
  return localStorage.getItem('covault_biometric_setup') === 'true';
}
