import Mathlib.Data.Real.Basic
noncomputable def theoreticalCollisionRate (m : Nat) : Real :=
  1 - (1 - 1/64 : Real) ^ (m - 1)

theorem collision_rate_bounds (m : Nat) :
  0 ≤ theoreticalCollisionRate m ∧ theoreticalCollisionRate m ≤ 1 := by
  unfold theoreticalCollisionRate
  constructor
  · apply sub_nonneg.mpr
    apply pow_le_one
    · norm_num
    · norm_num
    · norm_num
  · linarith [pow_nonneg (show (0:Real) ≤ 1 - 1/64 by norm_num) (m-1)]
