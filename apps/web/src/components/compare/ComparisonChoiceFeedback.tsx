import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ChoiceFeedbackState } from "./comparison-types";

interface ComparisonChoiceFeedbackProps {
  feedback: ChoiceFeedbackState;
}

export function ComparisonChoiceFeedback({
  feedback
}: ComparisonChoiceFeedbackProps) {
  const directionLabel = feedback.direction === "left" ? "Left" : "Right";

  return (
    <div
      className={[
        "comparison-choice-feedback",
        `is-${feedback.direction}`,
        feedback.isExiting ? "is-exiting" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={`${directionLabel} item selected`}
    >
      <span
        className="comparison-choice-arrow"
        key={feedback.id}
        aria-hidden="true"
      >
        {feedback.direction === "left" ? <ArrowLeft /> : <ArrowRight />}
      </span>
      <span aria-hidden="true">Selected</span>
    </div>
  );
}
