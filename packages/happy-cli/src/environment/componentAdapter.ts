import type {
  ComponentObservation,
  ComponentPlan,
  DesiredComponentState,
  EnvironmentComponentId,
} from '@slopus/happy-wire';
import type { ProcessResult } from './processRunner';

export interface EnvironmentComponentAdapter {
  readonly id: EnvironmentComponentId;
  inspect(): Promise<ComponentObservation>;
  plan(desired: DesiredComponentState, observed: ComponentObservation, now: number): ComponentPlan;
  apply(approvedPlan: ComponentPlan): Promise<ProcessResult>;
}
