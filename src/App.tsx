import { lazy, Suspense, useEffect, useState } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { LicenseGate } from '@/components/LicenseGate';
import { StudioErrorBoundary } from '@/components/StudioErrorBoundary';

const StudioCanvas = lazy(() =>
  import('@/components/StudioCanvas').then((module) => ({
    default: module.StudioCanvas,
  })),
);
const ScriptAnalysisWorkspace = lazy(() =>
  import('@/components/ScriptAnalysisWorkspace').then((module) => ({
    default: module.ScriptAnalysisWorkspace,
  })),
);

type WorkspaceMode = 'canvas' | 'script-analysis';

function StudioCanvasFallback() {
  return <div className="studio-boot-screen">正在进入工作区...</div>;
}

export default function App() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() =>
    window.location.hash === '#script-analysis' ? 'script-analysis' : 'canvas',
  );

  useEffect(() => {
    const onHashChange = () => {
      setWorkspaceMode(window.location.hash === '#script-analysis' ? 'script-analysis' : 'canvas');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const openCanvas = () => {
    if (window.location.hash) {
      window.history.pushState('', document.title, window.location.pathname + window.location.search);
    }
    setWorkspaceMode('canvas');
  };

  const openScriptAnalysis = () => {
    window.location.hash = 'script-analysis';
    setWorkspaceMode('script-analysis');
  };

  return (
    <StudioErrorBoundary>
      <LicenseGate>
        <AuthGate>
          <Suspense fallback={<StudioCanvasFallback />}>
            {workspaceMode === 'script-analysis' ? (
              <ScriptAnalysisWorkspace onBackToCanvas={openCanvas} />
            ) : (
              <>
                <StudioCanvas />
                <button className="studio-module-launcher nodrag nopan" type="button" onClick={openScriptAnalysis}>
                  剧本分析
                </button>
              </>
            )}
          </Suspense>
        </AuthGate>
      </LicenseGate>
    </StudioErrorBoundary>
  );
}
