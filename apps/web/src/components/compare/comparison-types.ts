export type ComparisonDirection = "left" | "right";

export interface ChoiceFeedbackState {
  direction: ComparisonDirection;
  id: number;
  isExiting: boolean;
}
