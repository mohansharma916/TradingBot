import { Slot, useRouter, usePathname } from 'expo-router';
import {
  Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { colors, RiskBanner } from '@trading-bot/ui';
import { useWorkstation } from '../src/hooks/useWorkstation';
import { mainNavigation } from '../src/features/daily-bot/config';

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { state, emergencyStop } = useWorkstation();
  const isDesktop = width >= 900;

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
        <Text style={styles.footer}>Upstox Adapter: V3{'\n'}Default: PAPER Mode</Text>
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
