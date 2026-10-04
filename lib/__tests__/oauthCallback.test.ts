import { describe, expect, it } from 'vitest';
import { captureOAuthCallback, callbackRecoveryMessage, clearOAuthCallbackParameters } from '../oauthCallback';

describe('OAuth callback recovery', () => {
  it('preserves unrelated query and fragment values when clearing a denied callback', () => {
    const url = new URL('http://127.0.0.1:4173/?keep=one&keep=two#error=access_denied&error_description=private&theme=light');
    const callback = captureOAuthCallback(url);
    if (!callback) throw new Error('Expected a callback.');
    expect(callbackRecoveryMessage(callback, {
      initializationFailed: true, sessionFailed: false, hasSession: false,
    })).toBe('Google sign-in was cancelled. You can try again.');
    expect(clearOAuthCallbackParameters(url, callback)).toBe('http://127.0.0.1:4173/?keep=one&keep=two#theme=light');
  });

  it('explains an unsuccessful code callback even without an SDK error', () => {
    const url = new URL('http://localhost:4173/?code=unusable&tab=review#section');
    const callback = captureOAuthCallback(url);
    if (!callback) throw new Error('Expected a callback.');
    expect(callbackRecoveryMessage(callback, {
      initializationFailed: false, sessionFailed: false, hasSession: false,
    })).toBe("We couldn't finish Google sign-in. Please try again.");
    expect(clearOAuthCallbackParameters(url, callback)).toBe('http://localhost:4173/?tab=review#section');
  });

  it('retains a later callback while clearing this callback’s consumed error', () => {
    const callback = captureOAuthCallback(new URL('http://localhost:4173/?code=old&error=failed'));
    if (!callback) throw new Error('Expected a callback.');
    expect(clearOAuthCallbackParameters(new URL('http://localhost:4173/?code=new&error=failed&keep=1'), callback))
      .toBe('http://localhost:4173/?code=new&keep=1');
  });

  it('accepts a successful session and ignores an ordinary application URL', () => {
    const callback = captureOAuthCallback(new URL('http://localhost:4173/?code=valid'));
    if (!callback) throw new Error('Expected a callback.');
    expect(callbackRecoveryMessage(callback, {
      initializationFailed: false, sessionFailed: false, hasSession: true,
    })).toBeNull();
    expect(captureOAuthCallback(new URL('http://localhost:4173/?tab=review#section'))).toBeNull();
  });
});
