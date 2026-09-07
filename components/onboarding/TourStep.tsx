import React from 'react';
import GuidedTour from '../tour/GuidedTour';

interface TourStepProps {
  onFinish: () => void;
}

/**
 * The last step of the intro: a spotlight walkthrough over a demo dashboard.
 *
 * This used to be three drawn sketches inside the ordinary step shell, for a
 * reason that still holds and is worth restating: a spotlight over the LIVE
 * dashboard would be circling an empty screen, because a brand-new user has
 * no spending in it yet, and a tour that lets taps through to real controls
 * can write a real transaction by accident.
 *
 * The demo screen answers both without giving up the spotlight — see
 * `components/tour/TourDemoScreen.tsx`. It is a likeness of a dashboard that
 * has been used for a month, marked as an example, and completely inert, so
 * the tour can point at the real shapes in their real places.
 *
 * No step shell around it: the tour covers the screen, carries its own
 * progress dots and its own way out, and is shown from Settings as well as
 * from here, where an intro step counter would be a lie.
 */
const TourStep: React.FC<TourStepProps> = ({ onFinish }) => (
  <GuidedTour onFinish={onFinish} finishLabel="Let's go" />
);

export default TourStep;
