import { lazy, Suspense } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { LicenseGate } from '@/components/LicenseGate';

const StudioCanvas = lazy(() =>
  import('@/components/StudioCanvas').then((module) => ({
    default: module.StudioCanvas,
  })),
);

function StudioCanvasFallback() {
  return <div className="studio-boot-screen">正在进入工作区...</div>;
}

export default function App() {
  return (
    <LicenseGate>
      <AuthGate>
        <Suspense fallback={<StudioCanvasFallback />}>
          <StudioCanvas />
        </Suspense>
      </AuthGate>
    </LicenseGate>
  );
}
