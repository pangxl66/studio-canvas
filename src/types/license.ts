export type LicenseMode = 'development' | 'production';

export interface LicenseStatus {
  active: boolean;
  activatedAt?: string;
  appVersion: string;
  configured: boolean;
  devUnlockAvailable: boolean;
  deviceId: string;
  expiresAt?: string;
  isDesktop: boolean;
  lastVerifiedAt?: string;
  licenseKeyMasked?: string;
  message?: string;
  mode: LicenseMode;
  owner?: string;
  plan?: string;
  source?: 'remote' | 'local-dev';
}

export interface StudioLicenseApi {
  activate: (licenseKey: string) => Promise<LicenseStatus>;
  deactivate: () => Promise<LicenseStatus>;
  getStatus: () => Promise<LicenseStatus>;
  isDesktop: true;
}
