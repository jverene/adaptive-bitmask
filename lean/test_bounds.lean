import AdaptiveBitmask.Coordinator
import Mathlib.Data.Real.Basic

theorem test_bounds (messages : List BitmaskMessage) (p : Nat) :
  0 ≤ computeConfidence messages p ∧ computeConfidence messages p ≤ 1 := by
  unfold computeConfidence
  split
  · simp
  · constructor
    · apply div_nonneg
      · exact Nat.cast_nonneg _
      · exact Nat.cast_nonneg _
    · rename_i h1
      have h2 : ((messages.filter (fun msg => AdaptiveBitmask.testBit msg.mask p)).length : Real) ≤ (messages.length : Real) :=
        Nat.cast_le.mpr (List.length_filter_le _ _)
      have h3 : (messages.length : Real) > 0 := by
        apply Nat.cast_pos.mpr
        apply Nat.pos_of_ne_zero
        intro h
        apply h1
        exact List.isEmpty_iff_length_eq_zero.mpr h
      exact (div_le_one h3).mpr h2
