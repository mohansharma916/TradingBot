import { useState, useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { RiskBanner } from '@trading-bot/ui';
import { useWorkstation } from '../src/hooks/useWorkstation';

interface NavItem {
  name: string;
  href: string;
  icon: string;
}

const navItems: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: '📊' },
  { name: 'Markets', href: '/markets', icon: '📈' },
  { name: 'Strategies', href: '/strategies', icon: '⚡' },
  { name: 'Proposals', href: '/proposals', icon: '🎯' },
  { name: 'Orders', href: '/orders', icon: '📑' },
  { name: 'Risk Center', href: '/risk', icon: '🛡️' },
  { name: 'Health', href: '/health', icon: '🩺' },
];

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { state, emergencyStop } = useWorkstation();
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined') {
        setIsDesktop(window.innerWidth >= 768);
      }
    };
    handleResize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
    return undefined;
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: colors.background,
        color: colors.textPrimary,
        fontFamily: typography.fontFamily.sans,
      }}
    >
      {/* Universal Risk & Safety Banner */}
      <RiskBanner
        mode={state.mode}
        riskState={state.riskState}
        egressIpVerified={state.egressIpVerified}
        onEmergencyStop={emergencyStop}
      />

      {/* Main Body Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Desktop Sidebar */}
        {isDesktop && (
          <aside
            style={{
              width: 220,
              backgroundColor: colors.surface,
              borderRight: `1px solid ${colors.border}`,
              display: 'flex',
              flexDirection: 'column',
              padding: spacing.md,
              gap: spacing.sm,
            }}
          >
            <div
              style={{
                padding: `${spacing.sm}px ${spacing.md}px`,
                marginBottom: spacing.sm,
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              <div
                style={{
                  fontSize: typography.fontSize.sm,
                  fontWeight: typography.fontWeight.bold,
                  letterSpacing: '0.08em',
                  color: colors.cyan,
                  textTransform: 'uppercase',
                }}
              >
                F&O Workstation
              </div>
              <div
                style={{
                  fontSize: typography.fontSize.xs,
                  color: colors.textMuted,
                  marginTop: 2,
                }}
              >
                Personal Trading Bot
              </div>
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href as any)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: spacing.md,
                      padding: `${spacing.sm}px ${spacing.md}px`,
                      borderRadius: borderRadius.md,
                      backgroundColor: isActive ? 'rgba(6, 182, 212, 0.12)' : 'transparent',
                      color: isActive ? colors.cyan : colors.textSecondary,
                      border: isActive ? `1px solid rgba(6, 182, 212, 0.3)` : '1px solid transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: typography.fontSize.sm,
                      fontWeight: isActive ? typography.fontWeight.semibold : typography.fontWeight.normal,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{item.icon}</span>
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </nav>

            <div style={{ marginTop: 'auto', padding: spacing.sm, fontSize: typography.fontSize.xs, color: colors.textMuted }}>
              Upstox Adapter: V3<br />
              Default: PAPER Mode
            </div>
          </aside>
        )}

        {/* Content Area */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: spacing.lg,
            marginBottom: isDesktop ? 0 : 64, // Margin for mobile bottom tabs
          }}
        >
          <Slot />
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      {!isDesktop && (
        <nav
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: 60,
            backgroundColor: colors.surface,
            borderTop: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            zIndex: 100,
          }}
        >
          {navItems.slice(0, 5).map((item) => {
            const isActive = pathname === item.href;
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href as any)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: isActive ? colors.cyan : colors.textMuted,
                  fontSize: typography.fontSize.xs,
                  cursor: 'pointer',
                  padding: spacing.xs,
                }}
              >
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
