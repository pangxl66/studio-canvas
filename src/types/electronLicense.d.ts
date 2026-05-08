import type { StudioLicenseApi } from './license';

declare global {
  interface Window {
    studioLicense?: StudioLicenseApi;
  }
}

export {};
