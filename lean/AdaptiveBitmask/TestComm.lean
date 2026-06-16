import AdaptiveBitmask.Coordinator

namespace AdaptiveBitmask.TestCommTheorems

open AdaptiveBitmask

private lemma foldl_or_init (ys : List BitmaskMessage) (a : BitVec 64) :
    List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) a ys =
    a ||| List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 ys := by
  induction ys generalizing a with
  | nil =>
    simp [BitVec.or_zero]
  | cons y ys ih =>
    simp
    rw [ih (a ||| y.mask)]
    rw [ih y.mask]
    rw [BitVec.or_assoc]

private lemma foldl_or_append (xs ys : List BitmaskMessage) :
    List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 (xs ++ ys) =
    List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 xs |||
    List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 ys := by
  induction xs with
  | nil =>
    simp [BitVec.zero_or]
  | cons x xs _ih =>
    simp
    rw [foldl_or_init ys (List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) x.mask xs)]
    simp

/-- OR-aggregation over lists is order-independent. -/
theorem aggregate_list_comm (msgs1 msgs2 : List BitmaskMessage) :
  List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 (msgs1 ++ msgs2) =
  List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 (msgs2 ++ msgs1) := by
  rw [foldl_or_append, foldl_or_append, BitVec.or_comm]

end AdaptiveBitmask.TestCommTheorems
