import React from 'react';
import GuidedTour from '../tour/GuidedTour';

interface TourStepProps {
  onFinish: () => void;
}

/**
 * The last step of the intro: a spotlight walkthrough over an example
 * dashboard.
 *
 * The one place the tour does NOT point at the live screen. There is no
 * dashboard mounted during the intro, and a brand-new one would be a row of
 * zeroes anyway — a spotlight circling blanks, explaining what would have
 * been there. Replayed later from Settings it points at the real thing; see
 * `GuidedTour`'s `surface` prop.
 *
 * `TourDemoScreen` is not a drawing of a dashboard. It is the dashboard's own
 * components, laid out the way `Dashboard` lays them out, fed invented
 * figures and marked as an example — so what a new user is shown here is what
 * they are about to get.
 *
 * No step shell around it: the tour covers the screen, carries its own
 * progress dots and its own way out, and is shown from Settings as well as
 * from here, where an intro step counter would be a lie.
 */
const TourStep: React.FC<TourStepProps> = ({ onFinish }) => (
  <GuidedTour surface="demo" onFinish={onFinish} finishLabel="Let's go" />
);

export default TourStep;
