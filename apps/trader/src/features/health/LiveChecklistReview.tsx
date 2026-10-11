import { useCallback, useEffect, useRef, useState } from 'react';
import { GoLiveChecklist } from '@trading-bot/contracts';
import { Badge, colors, spacing, borderRadius, typography } from '@trading-bot/ui';
import { apiClient } from '../../services/api';
import { formatErrorMessage } from '@trading-bot/client-sdk';

const failureMessage = (failure: unknown) => formatErrorMessage(failure) || 'Checklist confirmation is unavailable.';

export default function LiveChecklistReview() {
  const [checklist, setChecklist] = useState<GoLiveChecklist | null>(null);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [ownerName, setOwnerName] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++revision.current;
    try {
      const result = await apiClient.getGoLiveChecklist();
      if (mounted.current && version === revision.current) { setChecklist(result); setAvailable(true); }
    } catch (failure) {
      if (mounted.current && version === revision.current) { setError(failureMessage(failure)); setAvailable(false); }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => { if (!locked.current) void refresh(); }, 10000);
    return () => { mounted.current = false; ++revision.current; clearInterval(timer); };
  }, [refresh]);

  const verify = async (id: string) => {
    const entered = (evidence[id] || '').trim();
    if (locked.current || !available || entered.length < 12) return;
    locked.current = true; ++revision.current; setPending(id); setError(null); setNotice(null);
    try {
      const item = await apiClient.signOffChecklistItem(id, entered);
      if (item.id !== id || !item.passed) throw new Error('The API did not confirm this checklist item.');
      const result = await apiClient.getGoLiveChecklist();
      if (!result.items.some((candidate) => candidate.id === id && candidate.passed)) throw new Error('Checklist verification is no longer valid. Refresh and review the item.');
      if (mounted.current) { setChecklist(result); setAvailable(true); setNotice(`Evidence recorded for ${item.title}.`); }
    } catch (failure) { if (mounted.current) { setError(failureMessage(failure)); setAvailable(false); } }
    finally { locked.current = false; if (mounted.current) setPending(null); }
  };

  const allConfirmed = !!checklist?.allPassed && checklist.items.length > 0 && checklist.items.every((item) => item.passed);
  const signOff = async () => {
    if (locked.current || !available || !allConfirmed || !ownerName.trim()) return;
    locked.current = true; ++revision.current; setPending('owner-sign-off'); setError(null); setNotice(null);
    try {
      const result = await apiClient.signOffGoLiveChecklist(ownerName.trim());
      if (!result.allPassed || !result.signedOffAt || !result.signedOffBy) throw new Error('The API did not confirm owner sign-off.');
      if (mounted.current) { setChecklist(result); setAvailable(true); setNotice('Owner sign-off recorded by the API.'); }
    } catch (failure) { if (mounted.current) { setError(failureMessage(failure)); setAvailable(false); } }
    finally { locked.current = false; if (mounted.current) setPending(null); }
  };

  const controlStyle = { backgroundColor: colors.surfaceElevated, color: colors.textPrimary,
    border: `1px solid ${colors.border}`, borderRadius: borderRadius.sm, padding: spacing.sm };
  return <section aria-label="Live execution checklist" style={{ backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing.lg,
    display: 'flex', flexDirection: 'column', gap: spacing.md }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0, fontSize: typography.fontSize.md }}>Live Execution Checklist</h2>
      <button disabled={!!pending} onClick={() => { setError(null); void refresh(); }} style={controlStyle}>Refresh Checklist</button>
    </div>
    <p style={{ margin: 0, color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
      Review each requirement and enter the evidence you personally verified. Recording evidence does not certify regulatory compliance or guarantee fills. Live entries also require verified funds, fresh quotes, arming, and owner approval.
    </p>
    {error && <div role="alert" style={{ color: colors.loss }}>{error}</div>}
    {notice && <div role="status" style={{ color: colors.cyan }}>{notice}</div>}
    {!available && <div style={{ color: colors.textMuted }}>Checklist confirmation unavailable. Refresh before making changes.</div>}
    {!checklist && <div style={{ color: colors.textMuted }}>Waiting for the API checklist.</div>}
    {checklist?.items.map((item) => <article key={item.id} aria-label={item.title} style={{ ...controlStyle, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' }}>
        <strong>{item.title}</strong><Badge label={item.passed ? 'API CONFIRMED' : 'PENDING VERIFICATION'} variant={item.passed ? 'success' : 'warning'} />
      </div>
      <div style={{ color: colors.textSecondary, fontSize: typography.fontSize.sm }}>{item.description}</div>
      {item.evidence && <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>Recorded evidence: {item.evidence}</div>}
      {item.verifiedAt && <div style={{ color: colors.textMuted, fontSize: typography.fontSize.xs }}>Recorded at: {new Date(item.verifiedAt).toLocaleString()}</div>}
      <label style={{ color: colors.textSecondary, fontSize: typography.fontSize.sm }}>
        Your verification evidence
        <textarea aria-label={`Evidence for ${item.title}`} value={evidence[item.id] || ''}
          disabled={!!pending} onChange={(event) => setEvidence((current) => ({ ...current, [item.id]: event.target.value }))}
          placeholder="Describe the check, result, date, and any reference. Minimum 12 characters."
          rows={3} style={{ ...controlStyle, boxSizing: 'border-box', display: 'block', width: '100%', marginTop: spacing.xs }} />
      </label>
      <button aria-label={`Verify ${item.title}`} disabled={!!pending || !available || (evidence[item.id] || '').trim().length < 12}
        onClick={() => { void verify(item.id); }} style={{ ...controlStyle, alignSelf: 'flex-start' }}>{pending === item.id ? 'Verifying…' : 'Verify & Record Evidence'}</button>
    </article>)}
    <label style={{ color: colors.textSecondary }}>
      Owner name for final sign-off
      <input aria-label="Owner name for checklist sign-off" value={ownerName} disabled={!!pending}
        onChange={(event) => setOwnerName(event.target.value)} style={{ ...controlStyle, display: 'block', marginTop: spacing.xs }} />
    </label>
    <button disabled={!!pending || !available || !allConfirmed || !ownerName.trim()}
      onClick={() => { void signOff(); }} style={{ ...controlStyle, alignSelf: 'flex-start' }}>{pending === 'owner-sign-off' ? 'Recording sign-off…' : 'Record Owner Sign-Off'}</button>
    {!allConfirmed && <div style={{ color: colors.textMuted }}>Final sign-off requires every checklist item to be confirmed by the API.</div>}
    {checklist?.signedOffAt && <div style={{ color: colors.cyan }}>Recorded owner sign-off: {checklist.signedOffBy} · {new Date(checklist.signedOffAt).toLocaleString()}</div>}
  </section>;
}
