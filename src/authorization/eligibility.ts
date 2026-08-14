import type {
  RewardEligibilityDecision,
  RewardEligibilityInput,
  RewardEligibilityService,
} from "./authorization-types.js";

export class TestRewardEligibilityService implements RewardEligibilityService {
  public constructor(
    private readonly eligible: boolean = true,
    private readonly reason: string = "PHASE_4A_EXPLICIT_TEST_ELIGIBILITY",
  ) {}

  public evaluate(
    input: RewardEligibilityInput,
  ): Promise<RewardEligibilityDecision> {
    void input;
    return Promise.resolve({
      eligible: this.eligible,
      reason: this.reason,
      source: "TEST_ELIGIBILITY",
    });
  }
}

export class ProductionEligibilityNotImplementedService
implements RewardEligibilityService {
  public evaluate(
    input: RewardEligibilityInput,
  ): Promise<RewardEligibilityDecision> {
    void input;
    return Promise.resolve({
      eligible: false,
      reason: "PRODUCTION_ELIGIBILITY_NOT_IMPLEMENTED",
      source: "PRODUCTION_ELIGIBILITY",
    });
  }
}
