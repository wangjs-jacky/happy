# Right Swipe Panel Retrospective

Date: 2026-07-04

Related work:

- PR #79: `feat(app): add right swipe panel gesture`
- PR #29: `feat(sidebar): 手机端侧边栏卡片栈横滑（含 drawerType slide 修复）`
- Implementation entry point: `packages/happy-app/sources/components/RightSwipePanelHost.tsx`

## What Went Wrong

The right swipe panel was treated as a new drawer-like component for too long. The actual requirement was narrower and more constrained: mirror the existing mobile left-sidebar card-slide interaction on the right side.

That difference mattered. A drawer overlay, an edge gesture, and a full-screen filmstrip/card-slide interaction have different answers for:

- which view owns the gesture
- whether the main content moves or the panel overlays it
- whether the scrim follows the moving card
- how the gesture competes with the existing left drawer
- when haptic feedback fires
- which animation and velocity rules define the final hand feel

The original left-sidebar work had already solved the most important product questions. PR #29 documented that mobile sidebar behavior should use a card-stack/filmstrip model, `drawerType: 'slide'`, and a full-screen open gesture. That history should have been read before writing any right-side code.

## Failure Modes

### 1. Historical implementation was not treated as specification

The first implementation path started from a generic right panel instead of the existing left sidebar interaction. For an asymmetric feature this might be acceptable, but for a mirrored interaction it is wrong. The historical PR, code, and commit messages were part of the requirement.

The correct first step should have been:

1. Find the existing left-sidebar implementation.
2. Read the PR/commit that introduced the mobile card-slide behavior.
3. Extract the interaction model.
4. Mirror that model to the right side.
5. Only then write code.

### 2. The view model was wrong

Early versions behaved like an overlay or edge drawer. The desired model was a filmstrip:

- main content and right panel sit side-by-side
- gesture progress translates the whole strip
- the main content is not covered by a static panel
- the scrim belongs to the moving main card, so it moves with the card

The visible separator line bug came from this mistake. A static boundary appeared because the mask/panel relationship was modeled as overlay composition instead of moving-card composition.

### 3. Gesture ownership was debugged by patching symptoms

When a red strip appeared but the panel did not move, that was already enough evidence that the gesture architecture was wrong. The response should have been to stop local threshold tuning and return to the left drawer model.

Repeated symptom patches created these intermediate failures:

- only a narrow right-side region could start the gesture
- the global right-to-left gesture did not match the left drawer
- the panel moved but felt different from the left side
- haptics fired after the close animation instead of at release decision time

Those were not independent bugs. They all came from not defining the interaction state machine first.

### 4. Haptics were treated as a side effect instead of part of the interaction

For this feature, haptic timing is part of the hand feel. The correct event is the release decision: the moment the system commits to opening or closing. Triggering haptics after the spring finishes feels inverted because the feedback arrives after the user's decision has already been visually resolved.

The rule should be:

- fire haptics immediately when release logic chooses a settled state
- do not wait for the animation callback
- keep click/tap open/close haptics immediate as well

### 5. OTA was used as primary QA instead of final confirmation

Real-device validation is still required for React Native gestures and haptics, but it should not replace basic agent-side regression. Before a preview OTA, the implementation should have already passed a structured checklist.

## Correct Model For Similar Work

When implementing the mirrored version of an existing interaction, use this sequence:

1. **Recover history**
   - Search merged PRs and commits for the original interaction.
   - Read both the code and the PR description.
   - Treat the prior behavior as the source of truth unless the new requirement explicitly changes it.

2. **Write a behavior map**
   - Existing left behavior: full-screen right swipe opens left sidebar.
   - Mirrored right behavior: full-screen left swipe opens right panel.
   - Identify which parts should be identical: gesture activation, progress mapping, settle thresholds, velocity projection, spring, haptics.
   - Identify which parts intentionally differ: panel content, width, close affordance, platform gates.

3. **Implement the same view model**
   - Prefer the established card-slide/filmstrip model.
   - Avoid overlay drawers unless the existing interaction is also overlay based.
   - Put scrims and masks in the same coordinate space as the moving card.

4. **Model the gesture as a state machine**
   - idle closed
   - deciding direction
   - active dragging
   - release decision
   - spring settle
   - idle open
   - close gesture/tap

5. **Run a regression checklist before OTA**
   - Use OTA for final device confirmation, not for discovering basic structure bugs.

## Regression Checklist For Mobile Gesture Work

Before publishing a preview OTA for this class of change:

- Confirm the implementation references the historical analogue by PR or commit.
- Confirm the main view model matches the analogue: overlay vs slide vs filmstrip.
- Confirm gesture activation area: full-screen if the analogue is full-screen.
- Confirm opposite-direction gestures still delegate correctly to existing drawers or scroll views.
- Confirm closed-state and open-state gestures both work.
- Confirm the moving content, panel, mask, and scrim share the intended coordinate space.
- Confirm there are no debug strips, hard dividers, temporary colors, or logging artifacts.
- Confirm release thresholds and velocity projection are either copied from the analogue or intentionally documented.
- Confirm haptics fire on the decision event, not after animation completion.
- Confirm click/tap open and close paths have matching haptic behavior.
- Run typecheck.
- For UI changes, record the exact device checks requested from the user and explain what was already self-checked.

## Concrete Lessons

The main failure was not lack of code ability. It was using a from-scratch implementation loop for a feature whose desired behavior already existed in the codebase.

For future mirrored features, the default rule is:

> Historical implementation first, code second.

If two consecutive user reports describe the same class of failure, stop patching symptoms. Re-read the original implementation and rebuild the behavior model before making another change.

