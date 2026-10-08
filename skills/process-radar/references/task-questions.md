# Estimate the task context

Answer these nine questions before reading the dimension rubric or comparing processes. Use the task request, conversation, and other relevant context already available. Do not ask the user to answer them, conduct extra discovery to fill them, or wait for confirmation. This step does not authorize additional history access.

Preserve this order and wording:

1. **Expertise:** How well can you judge the domain and the software?
2. **Audience:** Who will use it, and is it a prototype or something people will rely on?
3. **Consequences:** Could failure cause injury, financial loss, privacy exposure, or major disruption?
4. **Checks:** How will you know the result is good enough?
5. **Uncertainty:** Is the work well understood, or will the direction emerge as you go?
6. **Time and effort:** How urgently do you need progress, and what time or spending limits matter?
7. **Human oversight:** Who can review or steer the work, and how available are they?
8. **Constraints:** Any local-model, privacy, provider, or tooling requirements?
9. **Reuse:** Is this a one-off task or a process you expect to repeat?

Output one short answer for each question with `stated` or `inferred` and high, medium, or low confidence. An answer may contain both known facts and an explicit assumption. When details are missing, provide a best-effort working estimate at low confidence, naming what is unestablished. Do not leave a question for the user or make answering it a prerequisite to scoring.

Ground expertise in supplied experience or demonstrated task knowledge, not writing style. Distinguish domain judgment from software judgment, and reviewer competence from reviewer availability. Distinguish existing checks from hoped-for checks. A high-consequence task does not itself provide a reliable automatic verifier. Urgency does not establish a numerical budget. A guess about a local-model preference, a deadline, or an available reviewer is not a hard constraint or a confirmed resource.

For a retrospective, estimate these answers from what was knowable at the decision under review, and label gaps. Later outcomes may inform the review, but must not be used to rewrite what the task required at that earlier moment.
