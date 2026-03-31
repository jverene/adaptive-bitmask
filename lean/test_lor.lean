def main : IO Unit := pure ()

theorem aggregate_idempotent (mask : Nat) : mask ||| mask = mask := by
  simp
