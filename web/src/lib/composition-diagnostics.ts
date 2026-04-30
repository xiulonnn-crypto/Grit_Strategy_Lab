import type {
  ApiCompositionStatusDiagnosis,
  ApiCompositionStatusAction,
} from '../types';

export type CompositionDiagnosisTone = 'good' | 'info' | 'warning' | 'danger' | 'neutral';

export function fallbackDiagnosisFromEvidenceGrade(grade?: string | null): ApiCompositionStatusDiagnosis {
  const normalized = String(grade ?? '').trim().toUpperCase();
  if (normalized === 'C') {
    return {
      status: '失效',
      issue_type: '异常降级补值',
      diagnosis_type: 'legacy_evidence_grade_c',
      diagnosis_label: '失效：异常降级补值',
      frontend_explanation: '当前组合仍在使用旧版证据等级，系统需要重新生成明确状态标签。',
      action: '刷新诊断或修复数据来源。',
      resolution_criteria: '重新生成明确状态标签，且不再依赖异常估算。',
      actions: [{ label: '刷新诊断', action_key: 'refresh_diagnostics', action_kind: 'execute' }],
    };
  }
  if (normalized === 'B') {
    return {
      status: '待校准',
      issue_type: '审计元数据真空',
      diagnosis_type: 'legacy_evidence_grade_b',
      diagnosis_label: '待校准：审计元数据真空',
      frontend_explanation: '系统缺少足够质量指标，暂时无法判断组合是否可靠。',
      action: '执行完整性校验或信度刷新。',
      resolution_criteria: '重新生成明确状态标签。',
      actions: [{ label: '刷新诊断', action_key: 'refresh_diagnostics', action_kind: 'execute' }],
    };
  }
  return {
    status: '稳健',
    issue_type: '证据链完整',
    diagnosis_type: 'legacy_evidence_grade_a',
    diagnosis_label: '稳健：证据链完整',
    frontend_explanation: '当前组合的收益、来源和冻结记录都可以追溯。',
    action: '查看详情或继续回测/配置实验。',
    resolution_criteria: '无需处理。',
    actions: [],
  };
}

export function primaryCompositionDiagnosis<T extends {
  diagnoses?: ApiCompositionStatusDiagnosis[];
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  evidence_grade?: string | null;
}>(item: T): ApiCompositionStatusDiagnosis {
  return item.primary_diagnosis ?? item.diagnoses?.[0] ?? fallbackDiagnosisFromEvidenceGrade(item.evidence_grade);
}

export function diagnosisTone(diagnosis?: ApiCompositionStatusDiagnosis | null): CompositionDiagnosisTone {
  if (!diagnosis) return 'neutral';
  if (diagnosis.status === '失效') return 'danger';
  if (diagnosis.status === '待校准') return 'warning';
  if (diagnosis.status === '稳健') return 'good';
  return 'info';
}

export function diagnosisNeedsAction(diagnosis?: ApiCompositionStatusDiagnosis | null): boolean {
  return diagnosis?.status === '待校准' || diagnosis?.status === '失效';
}

export function statusFilterFromDiagnosis(diagnosis?: ApiCompositionStatusDiagnosis | null): 'A' | 'B' | 'C' | null {
  if (!diagnosis) return null;
  if (diagnosis.status === '失效') return 'C';
  if (diagnosis.status === '待校准') return 'B';
  if (diagnosis.status === '稳健') return 'A';
  return null;
}

export function normalizedDiagnosisActions(diagnosis?: ApiCompositionStatusDiagnosis | null): ApiCompositionStatusAction[] {
  return (diagnosis?.actions ?? []).filter((action) => action.enabled !== false);
}
