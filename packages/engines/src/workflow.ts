import type { WorkflowDefinition, WorkflowProgress, WorkflowStep } from '@agent-platform/domain';

function looksLikeTrackingRef(value: string): boolean {
  const v = value.trim();
  if (v.length < 6) return false;
  if (!/\d/.test(v)) return false;
  if (/\s/.test(v) && !/^ACO[- ]?\d{4,}$/i.test(v)) return false;
  const blocked = /^(shipment|shipping|track|tracking|book|quote|package|container|services?)$/i;
  if (blocked.test(v)) return false;
  return /^(?:ACO[- ]?\d{4,}|(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,})$/i.test(v.replace(/\s+/g, ''));
}

function validate(step: WorkflowStep, value: string): string | null {
  const v = value.trim();
  if (!v && step.required !== false) return 'Please provide a value.';
  switch (step.validator) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Please enter a valid email.';
    case 'phone':
      return v.replace(/\D/g, '').length >= 7 ? null : 'Please enter a valid phone number.';
    case 'number':
      return Number.isFinite(Number(v)) ? null : 'Please enter a number.';
    case 'choice':
      if (!step.choices?.length) return null;
      return step.choices.some((c) => c.toLowerCase() === v.toLowerCase())
        ? null
        : `Please choose one of: ${step.choices.join(', ')}`;
    case 'tracking_ref':
      return looksLikeTrackingRef(v)
        ? null
        : 'Please enter a valid tracking or reference number (example: ACO-123456).';
    default:
      return null;
  }
}

export class WorkflowEngine {
  start(def: WorkflowDefinition): { progress: WorkflowProgress; message: string } {
    return this.startWithPrefill(def, {});
  }

  startWithPrefill(
    def: WorkflowDefinition,
    prefill: Record<string, string>,
  ): { progress: WorkflowProgress; message: string } {
    const progress: WorkflowProgress = {
      workflowId: def.id,
      intent: def.intent,
      status: 'active',
      stepIndex: 0,
      data: { ...prefill },
      lastError: null,
    };

    while (progress.stepIndex < def.steps.length) {
      const step = def.steps[progress.stepIndex]!;
      const value = prefill[step.id]?.trim();
      if (!value || validate(step, value)) break;
      progress.data[step.id] = value;
      progress.stepIndex += 1;
    }

    if (progress.stepIndex >= def.steps.length) {
      progress.status = 'complete';
      return { progress, message: def.completionMessage };
    }

    const lines: string[] = [];
    if (def.intro) lines.push(def.intro);
    const signedInAs = prefill.contact_name?.trim();
    if (signedInAs) {
      lines.push(`You're signed in as **${signedInAs}**. I'll use your account details where I can.`);
    }
    lines.push(def.steps[progress.stepIndex]!.prompt);
    return { progress, message: lines.filter(Boolean).join('\n\n') };
  }

  advance(
    def: WorkflowDefinition,
    progress: WorkflowProgress,
    userInput: string,
  ): { progress: WorkflowProgress; message: string; complete: boolean } {
    if (progress.status !== 'active') {
      return { progress, message: 'This workflow is already finished.', complete: true };
    }

    const lower = userInput.trim().toLowerCase();
    if (['cancel', 'stop', 'never mind', 'nevermind'].includes(lower)) {
      progress.status = 'cancelled';
      return { progress, message: 'Okay, I cancelled that request. How else can I help?', complete: true };
    }
    if (['restart', 'start over', 'reset'].includes(lower)) {
      const restarted = this.start(def);
      return { progress: restarted.progress, message: restarted.message, complete: false };
    }

    const step = def.steps[progress.stepIndex];
    if (!step) {
      progress.status = 'complete';
      return { progress, message: def.completionMessage, complete: true };
    }

    const err = validate(step, userInput);
    if (err) {
      progress.lastError = err;
      return {
        progress,
        message: `${err}${step.help ? `\n${step.help}` : ''}\n\n${step.prompt}`,
        complete: false,
      };
    }

    progress.data[step.id] = userInput.trim();
    progress.lastError = null;
    progress.stepIndex += 1;

    if (progress.stepIndex >= def.steps.length) {
      progress.status = 'complete';
      return { progress, message: def.completionMessage, complete: true };
    }

    const next = def.steps[progress.stepIndex]!;
    return { progress, message: next.prompt, complete: false };
  }
}
