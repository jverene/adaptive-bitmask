import Mathlib.Data.Real.Basic
import Mathlib.Tactic.Linarith
import Mathlib.Tactic.Positivity

noncomputable def computeConfidence_test (voters : Nat) (total : Nat) : Real :=
  if total = 0 then 0 else (voters : Real) / (total : Real)

theorem confidence_bounds_test (voters total : Nat) (h : voters ≤ total) :
  0 ≤ computeConfidence_test voters total ∧ computeConfidence_test voters total ≤ 1 := by
  unfold computeConfidence_test
  split
  · simp
  · constructor
    · positivity
    · rename_i h1
      have h2 : (voters : Real) ≤ (total : Real) := Nat.cast_le.mpr h
      have h3 : (total : Real) > 0 := Nat.cast_pos.mpr (Nat.pos_of_ne_zero h1)
      exact (div_le_one h3).mpr h2
