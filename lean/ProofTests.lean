import AdaptiveBitmask.Coordinator
open AdaptiveBitmask

theorem confidence_all_set_test (messages : List BitmaskMessage) (p : Nat) 
    (h : ∀ msg ∈ messages, AdaptiveBitmask.testBit msg.mask p = true) :
  messages ≠ [] → computeConfidence messages p = 1 := by
  intro h_not_empty
  unfold computeConfidence
  cases messages
  · contradiction
  · rename_i hd tl
    have h_filter : ((hd :: tl).filter (fun msg => AdaptiveBitmask.testBit msg.mask p)) = hd :: tl := by
      apply List.filter_eq_self.mpr
      intro a ha
      exact h a ha
    simp only [List.isEmpty_cons, h_filter]
    -- wait, we might have an `if` expression to resolve first
    dsimp
    apply div_self
    simp [Nat.cast_add_one_ne_zero]
