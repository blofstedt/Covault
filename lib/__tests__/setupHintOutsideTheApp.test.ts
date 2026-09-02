import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSetupSteps } from '../notificationAccessSetup';

/**
 * The instructions stop existing at the moment they are needed.
 *
 * Every step of the capture setup is a button that hands the screen to
 * Android's Settings — and the sentence explaining what to do there was on the
 * screen the user just left. The step that matters most is the one where a
 * switch REFUSES TO MOVE: told in advance that this is expected, a user carries
 * on; arriving at a dead switch with nothing on screen to say so, they conclude
 * the app is broken and stop. That is what the app's first user reported.
 *
 * An app cannot draw over Settings — Android blocks overlays there, which is
 * how tapjacking is prevented — so a Toast posted on the way out is the only
 * surface left. These tests pin that it exists, that its words live in one
 * place, and that a Play Store install is never promised a refusal that is not
 * coming.
 */
const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const GUIDE = read('components/NotificationAccessGuide.tsx');
const JAVA = read('android-custom/CovaultNotificationPlugin.java');
const SETTINGS = read(
  'components/dashboard_components/settings_modal_components/NotificationSettingsSection.tsx',
);

describe('the hint shown once the user is inside Settings', () => {
  it('exists, and is posted before the screen is handed over', () => {
    // Queued after the intent, it races the transition and can land behind it.
    expect(JAVA).toContain('private void showHint(PluginCall call)');
    const requestAccess = JAVA.slice(
      JAVA.indexOf('public void requestAccess(PluginCall call)'),
      JAVA.indexOf('boolean opened = false;'),
    );
    expect(requestAccess).toContain('showHint(call)');
  });

  it('is posted from the UI thread, where a Toast can exist at all', () => {
    // A plugin method does not run on a Looper thread; Toast.makeText there
    // throws, and the trip would still happen with no hint and no clue why.
    expect(JAVA).toContain('runOnUiThread');
    expect(JAVA).toContain('Toast.LENGTH_LONG');
  });

  it('takes its words from the app, so there is one set of them and not two', () => {
    // Every other pair of mirrored strings in this project needs a test to stop
    // it drifting. This one does not have to be a pair.
    expect(GUIDE).toContain('const STEP_HINT');
    expect(JAVA).toContain('call.getString("hint")');
    expect(JAVA).not.toContain('will refuse');
  });

  it('warns that the switch is going to refuse, which is the whole problem', () => {
    expect(GUIDE).toMatch(/listener:\s*"[^"]*refuse[^"]*"/);
  });

  it('points at the ⋮ for the step no intent can open', () => {
    expect(GUIDE).toContain('Tap the ⋮ at the top right');
  });

  it('never opens a page without saying why', () => {
    // openAppInfo and openAppNotificationSettings both leave the app too.
    for (const method of ['openAppInfo', 'openAppNotificationSettings']) {
      const body = JAVA.slice(JAVA.indexOf(`public void ${method}(PluginCall call)`));
      expect(body.slice(0, 200)).toContain('showHint(call)');
    }
  });
});

describe('a Play Store install', () => {
  const fromStore = {
    listenerGranted: false,
    canPostNotifications: false,
    restrictedApplies: false,
    listenerAttempted: true,
    restrictedVisited: false,
  };

  it('is never sent after the restricted-settings unlock', () => {
    // Installed by a store, Android does not hold notification access behind
    // anything. Sending the user to an overflow menu for an item that is not
    // there is worse than saying nothing.
    const ids = buildSetupSteps(fromStore).map((step) => step.id);
    expect(ids).toEqual(['listener', 'post']);
  });

  it('is never promised a refusal that is not coming', () => {
    // The sideloaded copy leads with "it will refuse". On a store install the
    // switch simply works, and a user waiting for a refusal that never arrives
    // is stuck for the opposite reason.
    expect(GUIDE).toContain('UNBLOCKED_LISTENER_HINT');
    expect(GUIDE).toContain('!state.restrictedApplies');
  });

  it('still gets the notification-permission step, which every install needs', () => {
    expect(buildSetupSteps(fromStore).map((s) => s.id)).toContain('post');
  });
});

describe("Covault's own switch", () => {
  it('says why it stayed off instead of looking broken', () => {
    // Tapping it opens the steps; the switch itself cannot move until Android
    // grants access. A control that ignores a tap reads as a broken control,
    // and the next thing anybody does is tap it again.
    expect(SETTINGS).toContain('This switch stays off until Android grants access');
  });
});
