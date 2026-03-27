import AdaptiveBitmask.Coordinator

namespace AdaptiveBitmask.Theorems

open AdaptiveBitmask

theorem aggregate_comm (msgs1 msgs2 : List BitmaskMessage) :
  List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 (msgs1 ++ msgs2) =
  List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 (msgs2 ++ msgs1) := by
  sorry

end AdaptiveBitmask.Theorems
