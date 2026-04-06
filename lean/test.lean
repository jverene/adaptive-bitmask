import Mathlib.Data.List.Basic

theorem stale_count_bound {α} (l : List α) (p : α → Bool) :
  (l.filter p).length ≤ l.length := by
  exact List.length_filter_le p l
