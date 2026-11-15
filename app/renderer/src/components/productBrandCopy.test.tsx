import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ appName: 'Veneta MemoAi' }));

vi.mock('@/lib/productBrand', () => ({
  get APP_NAME() {
    return state.appName;
  },
}));

vi.mock('@/i18n', () => ({ t: (key: string) => key }));

vi.mock('@/hooks/useSettings', () => {
  const query = (data: unknown) => ({ data });
  const mutation = () => ({ mutate: vi.fn() });
  return {
    useMarkPrivacyNoticeSeen: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
    useTelemetrySetting: () => query({ telemetry_enabled: false }),
    useSetTelemetry: mutation,
    useLaunchOnLoginSetting: () => query(true),
    useSetLaunchOnLogin: mutation,
    useNotificationsSetting: () => query(true),
    useSetNotifications: mutation,
    usePremeetingNotificationsSetting: () => query(true),
    useSetPremeetingNotifications: mutation,
    useAutoInstallWhenIdleSetting: () => query(true),
    useSetAutoInstallWhenIdle: mutation,
    useAutoDetectMeetingsSetting: () => query(true),
    useSetAutoDetectMeetings: mutation,
    useDockIconSetting: () => query(false),
    useSetDockIcon: mutation,
    useMicrophoneSetting: () => query({ device_id: null, label: null }),
    useSetMicrophone: mutation,
    useRecordHotkeySetting: () => query({ enabled: true, registered: true }),
    useSetRecordHotkey: mutation,
    useSetShowMenuBarIcon: mutation,
    useSetSilenceAutoStopEnabled: mutation,
    useSetSilenceAutoStopMinutes: mutation,
    useSetSystemAudio: mutation,
    useSetUserName: mutation,
    useShowMenuBarIconSetting: () => query(true),
    useSilenceAutoStopSetting: () => query({ enabled: true, minutes: 15, supportedMinutes: [2, 5, 10, 15, 30] }),
    useSystemAudioSetting: () => query(true),
    useSystemAudioSupport: () => query({ supported: true, osVersion: '14.4', platform: 'darwin' }),
    useUserName: () => ({ data: '', isPending: false, isPlaceholderData: false }),
  };
});

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'system', setTheme: vi.fn() }) }));
vi.mock('@/hooks/useAudioInputDevices', () => ({ useAudioInputDevices: () => [] }));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useGoogleCalendarAuth: () => ({ status: { data: { connected: false } }, connect: { mutateAsync: vi.fn() }, cancel: { mutate: vi.fn() }, disconnect: { mutate: vi.fn() } }),
  useOutlookCalendarAuth: () => ({ status: { data: { connected: false } }, connect: { mutateAsync: vi.fn() }, cancel: { mutate: vi.fn() }, disconnect: { mutate: vi.fn() } }),
  useAppleCalendar: () => ({ status: { data: { enabled: false, available: true } }, connect: { mutate: vi.fn() }, disconnect: { mutate: vi.fn() } }),
}));

import { PrivacyConsentModal } from './PrivacyConsentModal';
import { GeneralTab } from '@/routes/settings/GeneralTab';

afterEach(() => {
  cleanup();
  state.appName = 'Veneta MemoAi';
});

describe('product-branded launch-on-login copy', () => {
  it('uses the Veneta product name in both privacy and General settings', () => {
    render(<><PrivacyConsentModal open /><GeneralTab /></>);

    const descriptions = screen.getAllByText(/Start .* automatically when you log in/);
    expect(descriptions).toHaveLength(2);
    for (const description of descriptions) {
      expect(description.textContent).toContain('Veneta MemoAi');
      expect(description.textContent).not.toContain('Steno');
    }
    expect(screen.getByText(/Which input device Veneta MemoAi records from/)).toBeTruthy();
    expect(screen.getByText(/Show a Veneta MemoAi icon in the (menu bar|system tray)/)).toBeTruthy();
  });

  it('keeps the generic build copy as Steno', () => {
    state.appName = 'Steno';
    render(<><PrivacyConsentModal open /><GeneralTab /></>);

    for (const description of screen.getAllByText(/Start .* automatically when you log in/)) {
      expect(description.textContent).toContain('Steno');
    }
    expect(screen.getByText(/Which input device Steno records from/)).toBeTruthy();
    expect(screen.getByText(/Show a Steno icon in the (menu bar|system tray)/)).toBeTruthy();
  });
});
