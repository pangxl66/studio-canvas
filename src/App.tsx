import { AuthGate } from '@/components/AuthGate';
import { LicenseGate } from '@/components/LicenseGate';
import { StudioCanvas } from '@/components/StudioCanvas';

export default function App() {
  return (
    <LicenseGate>
      <AuthGate>
        <StudioCanvas />
      </AuthGate>
    </LicenseGate>
  );
}
