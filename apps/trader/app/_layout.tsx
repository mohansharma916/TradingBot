import { Slot, useRouter, usePathname } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { colors, RiskBanner } from '@trading-bot/ui';
import { useWorkstation, WorkstationProvider } from '../src/hooks/useWorkstation';
import { TradeMode } from '@trading-bot/contracts';
import { mainNavigation } from '../src/features/daily-bot/config';

export default function RootLayout() {
  return <WorkstationProvider><WorkstationShell /></WorkstationProvider>;
}

function WorkstationShell() {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { state, snapshot, emergencyStop, isAuthenticated, checkingSession, pending, error, login, logout, selectMode } = useWorkstation();
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const isDesktop = width >= 900;

  if (checkingSession) return <SafeAreaView style={styles.loginRoot}><ActivityIndicator color={colors.cyan} /><Text style={styles.navText}>Checking owner session…</Text></SafeAreaView>;
  if (!isAuthenticated) return <SafeAreaView style={styles.loginRoot}>
    <View style={styles.loginCard}>
      <Text style={styles.brandTitle}>PERSONAL TRADING WORKSTATION</Text>
      <Text style={styles.loginTitle}>Owner Sign In</Text>
      <Text style={styles.navText}>Sign in to manage your account. Trading starts in Testing mode.</Text>
      <Text style={styles.navText}>Username</Text>
      <TextInput accessibilityLabel="Owner username" value={username} onChangeText={setUsername} autoCapitalize="none" style={styles.loginInput} />
      <Text style={styles.navText}>Password</Text>
      <TextInput accessibilityLabel="Owner password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" style={styles.loginInput} />
      {error && <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Sign in" disabled={!!pending || !username || !password}
        onPress={() => { void login(username, password).then(() => setPassword('')); }} style={styles.modeButton}>
        <Text style={styles.navText}>{pending === 'login' ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>
    </View>
  </SafeAreaView>;

  const navigation = mainNavigation.map((item, index) => <Pressable key={item.href}
    accessibilityRole="button" accessibilityLabel={item.name}
    accessibilityState={{ selected: pathname === item.href }}
    onPress={() => router.push(item.href as never)}
    style={[styles.navItem, !isDesktop && styles.mobileNavItem,
      pathname === item.href && styles.activeNavItem]}>
    <Text style={styles.navIcon}>{item.icon}</Text>
    <Text style={[styles.navText, pathname === item.href && { color: colors.cyan }]}>{item.name}</Text>
    {isDesktop && index === 0 && <Text style={styles.mainLabel}>MAIN</Text>}
  </Pressable>);

  return <SafeAreaView style={styles.root}>
    <View style={styles.topbar}>
      <View style={styles.modeControls}>
        {([{ mode: TradeMode.PAPER, label: 'Testing' }, { mode: TradeMode.APPROVAL, label: 'Live' }] as const).map((item) =>
          <Pressable key={item.mode} accessibilityRole="button" accessibilityLabel={`${item.label} mode`}
            accessibilityState={{ selected: snapshot?.mode === item.mode }} disabled={!!pending || !snapshot}
            onPress={() => { void selectMode(item.mode); }} style={[styles.modeButton, snapshot?.mode === item.mode && styles.activeNavItem]}>
            <Text style={styles.navText}>{item.label}</Text>
          </Pressable>)}
        {pending === 'mode' && <ActivityIndicator color={colors.cyan} />}
      </View>
      <Text style={styles.navText}>
        {snapshot?.funds.status === 'VERIFIED' ? `${snapshot.funds.source === 'LIVE_BROKER' ? 'Upstox funds' : 'Virtual testing funds'}: ₹${snapshot.funds.availableCash.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'Funds unavailable'}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" disabled={!!pending} onPress={() => { void logout(); }}><Text style={styles.navText}>Sign out</Text></Pressable>
    </View>
    {error && <View style={styles.errorBanner}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View>}
    {Platform.OS === 'web' ? <RiskBanner mode={state.mode} riskState={state.riskState}
      egressIpVerified={state.egressIpVerified} onEmergencyStop={emergencyStop} /> :
      <View style={styles.nativeBanner}>
        <Text style={styles.navText}>MODE: {state.mode} · RISK: {state.riskState}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Emergency freeze" onPress={emergencyStop} style={styles.emergency}>
          <Text style={styles.emergencyText}>EMERGENCY FREEZE</Text>
        </Pressable>
      </View>}
    <View style={styles.body}>
      {isDesktop && <View style={styles.sidebar}>
        <View style={styles.brand}>
          <Text style={styles.brandTitle}>F&O WORKSTATION</Text>
          <Text style={styles.brandSubtitle}>Personal Trading Bot</Text>
        </View>
        <View accessibilityRole="menu" style={styles.menu}>{navigation}</View>
        <Text style={styles.footer}>Upstox Adapter: V3{'\n'}{snapshot?.label === 'LIVE' ? 'Live account selected' : 'Virtual account selected'}</Text>
      </View>}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Slot />
      </ScrollView>
    </View>
    {!isDesktop && <View style={styles.mobileBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mobileMenu}>
        {navigation}
      </ScrollView>
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: 12, backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: 1 },
  modeControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modeButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  errorBanner: { padding: 12, backgroundColor: colors.lossMuted },
  errorText: { color: colors.loss, fontSize: 13 },
  loginRoot: { flex: 1, minHeight: '100%', backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  loginCard: { width: '100%', maxWidth: 420, padding: 24, gap: 14, backgroundColor: colors.surface, borderRadius: 10 },
  loginTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  loginInput: { color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 6 },
  root: { flex: 1, minHeight: '100%', backgroundColor: colors.background },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
  sidebar: { width: 230, backgroundColor: colors.surface, borderRightWidth: 1,
    borderRightColor: colors.border, padding: 14, gap: 12 },
  brand: { padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 },
  brandTitle: { color: colors.cyan, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  brandSubtitle: { color: colors.textMuted, fontSize: 12 },
  menu: { gap: 5 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12,
    paddingHorizontal: 10, borderWidth: 1, borderColor: 'transparent', borderRadius: 7 },
  activeNavItem: { backgroundColor: 'rgba(6,182,212,0.12)', borderColor: 'rgba(6,182,212,0.3)' },
  navIcon: { fontSize: 18 },
  navText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  mainLabel: { color: colors.cyan, fontSize: 8, fontWeight: '700', marginLeft: 'auto' },
  footer: { marginTop: 'auto', padding: 10, color: colors.textMuted, fontSize: 11, lineHeight: 18 },
  content: { flex: 1 },
  contentContainer: { padding: 22, minHeight: '100%' },
  mobileBar: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  mobileMenu: { paddingHorizontal: 8, paddingVertical: 8, gap: 6 },
  mobileNavItem: { flexDirection: 'column', paddingVertical: 6, minWidth: 76, gap: 3 },
  nativeBanner: { backgroundColor: colors.surfaceSubtle, padding: 10, gap: 10,
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
  emergency: { padding: 8, backgroundColor: colors.loss, borderRadius: 4 },
  emergencyText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
});
