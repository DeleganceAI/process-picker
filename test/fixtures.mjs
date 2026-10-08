// Deliberately authored test fixture, not an LLM-generated recommendation.
export const sampleTask = 'Redesign an uncertain subsystem with human review, local models, reusable phases, and strict limits. Tests cover regressions but not architectural fit.';
export const sampleResult = {
  summary: 'Explore a subsystem redesign with human judgment and a reusable process.',
  recommendedApproach: 'playbooks',
  reason: 'Start with an inspectable Playbook and preserve opportunities to change direction as the design becomes clearer.',
  tradeoff: 'You will spend time maintaining the process and reviewing decisions; this would be unnecessary overhead for a tiny one-off change.',
  profile: [
    { id: 'humanWorker', score: 50, reason: 'Assign architecture review and key decisions to the person responsible for the subsystem.' },
    { id: 'replan', score: 100, reason: 'The design is uncertain, so new findings should be able to redirect the process.' },
    { id: 'understandable', score: 100, reason: 'Make roles and handoffs visible so the human can keep a useful mental model.' },
    { id: 'reuse', score: 75, reason: 'Preserve a reusable method, while allowing this subsystem to need its own adaptations.' },
    { id: 'budgets', score: 100, reason: 'Set explicit limits for research and implementation jobs; verify the chosen implementation can enforce them.' },
    { id: 'freedom', score: 75, reason: 'Use local models for focused jobs where they perform adequately; model suitability still needs checking.' },
    { id: 'verifier', score: 0, reason: 'Tests cover regressions but do not resolve architectural fit. Progress should not depend on an automatic success oracle.' }
  ],
  alternative: { id: 'workflows', reason: 'Use a lighter prompt-defined method if manual handoffs are manageable and a few phases are enough.' },
  steps: ['Record the architectural constraints and open questions.', 'Assign bounded investigation jobs and review their artifacts.', 'Choose a direction, define focused checks, and revise the process as needed.'],
  assumptions: ['A responsible engineer is available to review decisions.', 'The intended model integrations and budget controls are available in the setup you choose.'],
  questions: ['Which architectural properties matter most to the people maintaining this subsystem?']
};
