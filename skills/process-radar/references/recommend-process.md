# Match the recorded task requirements

Read this only after outputting the nine estimated context answers and the seven-dimension assessment derived from them.

Only now read [catalog.json](catalog.json), containing six reference profiles and their rationales. Its numbers describe intended use, not verified product capabilities. Keep `pendingRevision` outside active recommendations.

Use the recorded scores to compare the approaches, not merely as decoration for an intuitive recommendation:

- For the first six dimensions, compare **required support** with the support described by each process. A shortfall needs an explanation, an adaptation, or a capability check. Surplus support earns no extra credit and may add overhead.
- The seventh comparison is asymmetric: **Automatic Verifier Available** describes the task, while **Needs Strong Verifier** describes process dependence. Dependence above availability flags a mismatch. Establish whether checks cover the actual delegated outcome and stopping condition; passing regression tests does not settle architecture or taste. Strong available checks permit automation but do not require it.
- Check hard constraints regardless of the profile. A fixed local model, actual budget enforcement, and shipped harness features require evidence; catalog scores cannot certify them. Unknown task scores remain unresolved, not silently satisfied.
- Consider every active reference for fit, then explain the best fit and nearest viable alternative using their decisive score matches, shortfalls, and tradeoffs. These coarse scores are comparison signals, not exact capability thresholds. Never select by total score, polygon area, or symmetric nearest-shape distance.
- Prefer the simplest adequate process, considering setup, human attention, maintenance, and coordination overhead. Consider a small adaptation of the user's current process before replacing it. A custom or hybrid process is valid; explain which scored requirements justify each addition. Do not default to Playbooks.

Keep the recommendation concise and after both assessment tables. Cite the decisive task scores and explain how the recommended process meets them, what remains uncertain, and why it fits better than the alternative. Carry low-confidence input estimates into the recommendation; state which assumptions could change it without requiring the user to confirm them first. Add first actions or a handoff prompt only when useful. If no mismatch is supported, say so.
