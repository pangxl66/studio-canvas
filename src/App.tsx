import { lazy, Suspense } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { LicenseGate } from '@/components/LicenseGate';
import { StudioErrorBoundary } from '@/components/StudioErrorBoundary';

const StudioCanvas = lazy(() =>
  import('@/components/StudioCanvas').then((module) => ({
    default: module.StudioCanvas,
  })),
);

function StudioCanvasFallback() {
  return (
    <div className="studio-boot-screen" role="status" aria-live="polite">
      <div className="studio-boot-screen__card">
        <div className="studio-boot-screen__eyebrow">STUDIO CANVAS</div>
        <div className="studio-boot-screen__title">正在进入工作区</div>
        <p className="studio-boot-screen__subtitle">正在加载画布模块、恢复项目状态和同步云端配置。</p>
        <div className="studio-boot-screen__steps" aria-label="启动状态">
          <span>加载界面</span>
          <span>连接云端</span>
          <span>恢复项目</span>
        </div>
        <div className="studio-boot-screen__hint">首次访问可能需要几秒。</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StudioErrorBoundary>
      <LicenseGate>
        <AuthGate>
          <Suspense fallback={<StudioCanvasFallback />}>
            <StudioCanvas />
          </Suspense>
        </AuthGate>
      </LicenseGate>
    </StudioErrorBoundary>
  );
}
