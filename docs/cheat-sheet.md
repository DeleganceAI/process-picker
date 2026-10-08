# Process Radar — speaker cheat sheet

Dustin's intended-use profiles for a talk. These are subjective comparisons, not benchmarks, guarantees, or an inventory of every supported feature. Larger area is not better. The approaches can be combined.

## How to read the numbers

Use 0, 25, 50, 75, and 100 as broad positions on a dimension. They are not percentages or measured performance. A 100 is not inherently desirable. Needs Strong Verifier points toward greater dependence on automatic checks. Human Worker and Human Can Replan describe different kinds of involvement.

The scores preserve the last confirmed talk baseline. Rationale has been reconstructed from the discussion. These are archetypes and intended experiences, not a current audit of any product. Scores for Alinery do not establish what a particular released version supports.

## Dimensions

| Dimension | 0 means | 100 means |
| --- | --- | --- |
| Human Worker | Difficult to assign a human work within the process. | Work can be handed to humans as naturally as it can be given to AI. |
| Human Can Replan | Direction is set upfront; ongoing human replanning is peripheral. | Inspecting work, adjusting context, and changing direction are central to the experience. |
| Understandable | Very difficult for a human to form a mental model of the process. | Easy to form a mental model of roles, possible paths, and handoffs. |
| Reuse | A task-specific process is worked out for this particular task. | The process is a maintained asset, repeatedly applied and adapted. |
| Budget Enforceable | Explicit resource allocation and enforcement receive little attention. | Easy to enforce token, time, and money budgets across the run and its jobs. |
| Model/Harness Freedom | The process assumes a particular model and harness. | Easy to choose and combine different models and harnesses by role. |
| Needs Strong Verifier | The process can proceed through methods and human judgment without a reliable automatic verifier. | The intended mode of use depends heavily on reliably checking success automatically. |

## Scores at a glance

| Approach | Human Worker | Human Can Replan | Understandable | Reuse | Budget Enforceable | Model/Harness Freedom | Needs Strong Verifier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Plain Harness | 50 | 100 | 25 | 0 | 25 | 75 | 0 |
| /goal | 0 | 0 | 0 | 0 | 0 | 50 | 100 |
| Dynamic Workflows | 25 | 25 | 25 | 25 | 0 | 25 | 0 |
| Workflows | 50 | 75 | 75 | 100 | 25 | 75 | 25 |
| Programmed Loops and Graphs | 100 | 25 | 100 | 100 | 100 | 100 | 0 |
| Playbooks + Alinery | 50 | 100 | 100 | 100 | 100 | 100 | 0 |

## Plain Harness

Interactive coding, directed by the person at the keyboard.

Signature: Follow discoveries together.

Example: An interactive coding session with a chosen harness and model.

Tradeoff: The human keeps the overall method in their head; coordination and reuse are mostly manual.

- **Human Worker — 50.** The person can write code, make decisions, and review work throughout the session. Assigning a distinct human job is mostly informal. This inherited score is worth revisiting now that worker and supervisor are separate concepts.
- **Human Can Replan — 100.** Redirection is central to interactive coding. The person can change instructions, bring in context, and follow discoveries as they happen.
- **Understandable — 25.** The user understands the request, but the agent develops much of its actual method at runtime. Visibility into a conversation does not make its future process explicit.
- **Reuse — 0.** The overall method emerges within the particular conversation. There is no maintained task-level process in this baseline.
- **Budget Enforceable — 25.** The person can choose a cheaper model, watch usage, and stop work. Deliberate allocation and enforcement across jobs remain mostly manual.
- **Model/Harness Freedom — 75.** The person can choose a harness and model. Coordinating several different harnesses or models across separate jobs takes manual work.
- **Needs Strong Verifier — 0.** Human inspection and judgment can guide progress. Evolving intent, taste, and exploratory work do not require an automatic success test.

## /goal

Set an outcome and let the agent keep working toward it.

Signature: Persist toward a target.

Example: Goal-driven, largely unattended execution inside a supporting coding harness.

Tradeoff: A weak success signal makes unattended progress and stopping difficult to trust.

- **Human Worker — 0.** The intended interaction is to define the goal and delegate. Regularly assigning work back to humans is peripheral to that mode.
- **Human Can Replan — 0.** The goal sets direction upfront and the run is mostly hands-off. This describes the intended experience, not an inability to interrupt or change a goal.
- **Understandable — 0.** The destination is stated, while the agent decides how to get there. A clear goal alone does not give the user a mental model of the execution path.
- **Reuse — 0.** Repeating a goal does not preserve a maintained, inspectable method for achieving it. The agent works out the process for each task.
- **Budget Enforceable — 0.** The central idea is continued work until the goal is satisfied. Explicit allocation across jobs is peripheral to this comparison; some implementations still have run caps.
- **Model/Harness Freedom — 50.** There is some choice of supporting harness and model, but a run generally operates inside the selected setup rather than mixing harnesses by role.
- **Needs Strong Verifier — 100.** For this talk's hands-off archetype, trustworthy automatic progress and success checks are central. This is dependence on a verifier, not a claim that goal modes always verify correctly.

## Dynamic Workflows

Generate an executable process for the task at hand.

Signature: Make a task-specific process explicit.

Example: The Claude Code dynamic-workflow example discussed in the talk; not every dynamic graph system.

Tradeoff: The generated process still needs inspection, and changing its shape during execution is less central than launching it.

- **Human Worker — 25.** Humans can review the generated process and its output. Ongoing human jobs play a smaller role in the intended end-to-end execution.
- **Human Can Replan — 25.** The script can be inspected and revised before launch or rerun. Collaboratively reshaping it while it runs is less central to the example being compared.
- **Understandable — 25.** An explicit script improves visibility, but the person still has to learn a newly generated process for each task.
- **Reuse — 25.** A generated script can be saved and rerun. Its starting point is the current task rather than a maintained library of methods.
- **Budget Enforceable — 0.** Explicit resource allocation and enforcement are peripheral to this example's intended experience. Stopping a run or having an incidental timeout does not earn a high score here.
- **Model/Harness Freedom — 25.** This score is scoped to the Claude Code example, with a relatively fixed harness and some model choice. It is not a general limit of generated programs.
- **Needs Strong Verifier — 0.** A generated process can execute its phases and finish without a global automatic success test. It can organize exploratory or judgment-driven work.

## Workflows

Follow a reusable, prompt-defined sequence of phases.

Signature: Carry a familiar method into the next task.

Example: Research → Plan → Implement, or a prompt-defined development procedure.

Tradeoff: Prompts describe the method; following it still depends on the agents and the person managing the handoffs.

- **Human Worker — 50.** People contribute reviews and decisions at phase boundaries. Arbitrary human job assignment is less central than these recurring contributions.
- **Human Can Replan — 75.** Checkpoints provide natural places to adapt instructions and redirect work. The established phases still frame the process.
- **Understandable — 75.** Named, familiar phases make the method legible. The details within each phase still rely on prompts and agent judgment.
- **Reuse — 100.** A deliberately maintained method is repeatedly applied and adapted to different tasks.
- **Budget Enforceable — 25.** Phase boundaries make manual resource checks convenient, while allocation and enforcement are mostly outside the prompt-defined procedure.
- **Model/Harness Freedom — 75.** The method can be carried across models and harnesses. Its execution still depends on how reliably a particular setup follows the prompts.
- **Needs Strong Verifier — 25.** Tentative inherited score: tests or build checks may serve as phase gates, while process and human review do most of the work. Mere use of tests does not establish dependence; 0 is also defensible under the current definition.

## Programmed Loops and Graphs

Author the process and execute its control structure.

Signature: Encode the coordination explicitly.

Example: A purpose-built graph or loop with jobs, conditions, state, and handoffs.

Tradeoff: Unplanned changes to a running process can require engineering work, even when planned human interventions are well supported.

- **Human Worker — 100.** Human jobs can be explicit parts of the program: request input, wait for work, accept an output, and continue.
- **Human Can Replan — 25.** Planned intervention is straightforward to encode. Unplanned changes to the structure of a running program often require extra work; this is separate from including a human node.
- **Understandable — 100.** Authored roles, dependencies, and possible paths can be inspected ahead of time. This score assumes a legible process, not that every large graph is easy to understand.
- **Reuse — 100.** The program is a maintained process that can be run repeatedly with new inputs.
- **Budget Enforceable — 100.** The process can be engineered around explicit run-level and job-level resource limits. This describes a deliberately budgeted implementation, not automatic support in every framework.
- **Model/Harness Freedom — 100.** Different jobs can use different models, tools, or full harnesses through explicit integration.
- **Needs Strong Verifier — 0.** A graph can organize research, human judgment, and a prescribed method without a global success oracle. Loops do not have to be optimization searches.

## Playbooks + Alinery

Run a reusable process that the human can inspect and steer.

Signature: Call an audible as the work unfolds.

Example: A Playbook for complex engineering: focused jobs, artifacts, parallel work, review, and revision.

Tradeoff: Requires process design and human attention. These talk scores describe the intended experience, not verified feature parity across released versions.

- **Human Worker — 50.** The process can ask the user and teammates for review, answers, and contributions. 100 is reserved for arbitrary human jobs being as natural to assign as AI jobs.
- **Human Can Replan — 100.** Inspecting artifacts, adjusting context, following discoveries, and redirecting work are central to the experience.
- **Understandable — 100.** Explicit roles, handoffs, and possible paths give the person a mental model of the process. Process visibility does not prove that an output is correct.
- **Reuse — 100.** Playbooks are maintained, customized, reapplied, and improved through experience with earlier runs.
- **Budget Enforceable — 100.** Resource limits across tasks and jobs are part of the intended process design. This is the talk's profile rather than an audit of shipped enforcement features.
- **Model/Harness Freedom — 100.** The intended design combines models and harnesses by focused role, creating places for smaller, local, and open models to contribute. Current product support must be checked separately.
- **Needs Strong Verifier — 0.** Process, artifacts, independent checks, and human judgment can guide work whose intent evolves. No strong automatic end-condition verifier is required.

## Pending decisions

The source chart's title was changed to Skill-guided Coding while retaining the earlier Plain Harness values. The discussed revision was Human Worker 25, Understandable 50, and Reuse 75, with other values retained. This app preserves the last confirmed Plain Harness scores and makes the pending change explicit.

Proposed profile (not active): Human Worker 25; Human Can Replan 100; Understandable 50; Reuse 75; Budget Enforceable 25; Model/Harness Freedom 75; Needs Strong Verifier 0.

Workflows at 25 on Needs Strong Verifier is the most tentative existing score. Tests being useful is not the same as depending on a strong verifier; a score of 0 can be defended. Plain Harness at 50 on Human Worker is also worth revisiting under the more precise worker-versus-supervisor distinction.

## Remember when presenting

- Programmed loops and graphs score higher for explicit human jobs; Playbooks + Alinery score higher for ongoing human replanning. These are different claims.
- The task radar is a proposed process, not an importance chart. The app uses contextual LLM judgment, not total score or polygon area, to recommend a starting approach.
- A maintained process can be inspected and followed without proving its outputs correct.
- High stakes call for appropriate validation and responsibility. They do not magically make a strong automatic verifier available.

Generated from `data/catalog.json`. Edit that source and run `npm run docs` to keep the demo and cheat sheet aligned.
