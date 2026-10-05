import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import GuidedTour from '../app/components/tour';
import TourDemoScreen from '../app/components/tour/TourDemoScreen';
import { queryClient } from '../app/lib/cache/queryClient';
import type { TourStage } from '../app/components/tour/tourSteps';
import CalendarFixture from './CalendarFixture';
import '../app/index.css';

const tourStages: TourStage[] = ['home', 'budget', 'add', 'review', 'settings'];
const params = new URLSearchParams(window.location.search);
const screen = params.get('screen');
const isOnboarding = screen === 'onboarding';
const stage = tourStages.find((candidate) => candidate === screen) ?? 'home';
const fixture = params.get('fixture') === 'empty' ? 'empty' : 'populated';
const theme = params.get('theme') === 'light' ? 'light' : 'dark';
const rootElement = document.getElementById('root');

document.documentElement.classList.toggle('dark', theme === 'dark');

if (!rootElement) throw new Error('The visual-check page has no root element.');

createRoot(rootElement).render(
  <QueryClientProvider client={queryClient}>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: theme === 'dark' ? '#020617' : '#f8fafc',
      }}
    >
      {isOnboarding ? (
        <GuidedTour surface="demo" onFinish={() => {}} />
      ) : screen === 'calendar' ? (
        <CalendarFixture />
      ) : (
        <TourDemoScreen stage={stage} fixture={fixture} />
      )}
    </div>
  </QueryClientProvider>,
);
