import Mathlib.Data.Nat.Bits
import Mathlib.Data.Nat.Bitwise
import Mathlib.Data.Nat.Count
import Mathlib.Data.Fin.Basic
import Mathlib.Data.Real.Basic
import Std.Data.HashMap

/-!
# Core Bitmask Primitives

This module formalizes the 64-bit bitmask operations that form the foundation
of the Adaptive Bitmask Protocol.
-/

namespace AdaptiveBitmask

open Std (HashMap)

def BITMASK_WIDTH : Nat := 64
abbrev Bitmask := Nat
def empty : Bitmask := 0
def EMERGENCY_RANGE : (Nat × Nat) := (56, 63)
def HIGH_FREQ_RANGE : (Nat × Nat) := (0, 47)
def MED_FREQ_RANGE : (Nat × Nat) := (48, 55)

def isValidPosition (p : Nat) : Prop := p < BITMASK_WIDTH

instance : DecidablePred isValidPosition :=
  inferInstanceAs (DecidablePred (· < BITMASK_WIDTH))

def setBit (mask : Bitmask) (p : Nat) : Bitmask :=
  if decide (isValidPosition p) then mask ||| (1 <<< p) else 0

def testBit (mask : Bitmask) (p : Nat) : Bool :=
  if decide (isValidPosition p) then (mask &&& (1 <<< p)) ≠ 0 else false

def clearBit (mask : Bitmask) (p : Nat) : Bitmask :=
  if decide (isValidPosition p) then
    if testBit mask p then mask ^^^ (1 <<< p) else mask
  else
    mask

def popcount (mask : Bitmask) : Nat :=
  (List.range BITMASK_WIDTH).countP (fun p => testBit mask p)

def activeBits (mask : Bitmask) : List Nat :=
  List.filter (fun p => testBit mask p) (List.range BITMASK_WIDTH)

def forEachSetBit (mask : Bitmask) (f : Nat → Unit) : Unit :=
  (activeBits mask).foldl (fun (_ : Unit) p => f p) ()

def merge (a b : Bitmask) : Bitmask := a ||| b
def intersect (a b : Bitmask) : Bitmask := a &&& b
def delta (prev next : Bitmask) : Bitmask := prev ^^^ next
def hammingDistance (a b : Bitmask) : Nat := popcount (delta a b)

def hasEmergency (mask : Bitmask) : Bool :=
  let emergencyMask := 0xFF <<< 56
  (mask &&& emergencyMask) ≠ 0

def emergencyBits (mask : Bitmask) : Bitmask :=
  let emergencyMask := 0xFF <<< 56
  mask &&& emergencyMask

def toBytes (mask : Bitmask) : Fin 8 → UInt8 :=
  fun i => UInt8.ofNat ((mask >>> (8 * i.val)) &&& 0xFF)

def fromBytes (bytes : Fin 8 → UInt8) : Bitmask :=
  List.foldl (fun acc (i : Fin 8) =>
    acc ||| (UInt8.toNat (bytes i) <<< (8 * i.val))
  ) 0 (List.finRange 8)

def encode (features : List String) (schema : HashMap String (Fin 64)) :
    Bitmask × Nat × Nat :=
  let init := (0, 0, 0)
  let (mask, mapped, unmapped) := List.foldl (fun (m, mcnt, ucnt) feat =>
    match schema.get? feat with
    | some bit => (m ||| (1 <<< bit.val), mcnt + 1, ucnt)
    | none => (m, mcnt, ucnt + 1)
  ) init features
  (mask, mapped, unmapped)

def decode (mask : Bitmask) (reverseSchema : HashMap (Fin 64) (List String)) : List String :=
  (activeBits mask).foldr (fun bit acc =>
    let names :=
      if h : bit < BITMASK_WIDTH then
        reverseSchema.get? ⟨bit, h⟩ |>.getD []
      else
        []
    names ++ acc
  ) []

/-- (1 <<< p) &&& (1 <<< q) ≠ 0 ↔ p = q -/
lemma pow2_and_pow2_ne_zero_ffff {p q : Nat} : (1 <<< p &&& 1 <<< q) ≠ 0 ↔ p = q := by
  by_cases heq : p = q
  · rw [heq]
    simp
  · simp [Nat.one_shiftLeft, Nat.two_pow_and, Nat.testBit_two_pow]; omega

/-- Setting a bit doesn't affect other bits. -/
theorem setBit_preserves_other (mask : Bitmask) (p q : Nat)
    (hp : p < BITMASK_WIDTH) (hq : q < BITMASK_WIDTH) (hne : p ≠ q) :
    testBit (setBit mask p) q = testBit mask q := by
  simp only [BITMASK_WIDTH] at hp hq; simp only [testBit, setBit, isValidPosition, BITMASK_WIDTH]
  simp [hp, hq]; rw [Nat.and_or_distrib_right, show 1 <<< p &&& 1 <<< q = 0 from
    not_not.mp (mt pow2_and_pow2_ne_zero_ffff.mp hne)]; simp

/-- Clearing a set bit makes it test false. -/
theorem clearBit_test_false (mask : Bitmask) (p : Nat) (h : p < BITMASK_WIDTH)
    (hset : testBit mask p = true) :
    testBit (clearBit mask p) p = false := by
  simp only [BITMASK_WIDTH] at h
  simp only [testBit, clearBit, isValidPosition, BITMASK_WIDTH] at hset ⊢; simp [h] at hset ⊢
  rw [if_neg hset]; rw [Nat.and_xor_distrib_right, Nat.and_self]
  rw [Nat.one_shiftLeft] at hset ⊢; rw [Nat.land_comm mask, Nat.two_pow_and] at hset ⊢
  simp at hset; rw [hset]; simp [Nat.xor_self]

/-- Merge (OR) is commutative. -/
theorem merge_comm (a b : Bitmask) : merge a b = merge b a := by
  simp [merge, Nat.lor_comm]

/-- Merge (OR) is associative. -/
theorem merge_assoc (a b c : Bitmask) :
    merge (merge a b) c = merge a (merge b c) := by
  simp [merge, Nat.lor_assoc]

/-- Merge with empty is identity. -/
theorem merge_empty_left (mask : Bitmask) : merge empty mask = mask := by
  simp [merge, empty]

/-- Merge with empty is identity (right). -/
theorem merge_empty_right (mask : Bitmask) : merge mask empty = mask := by
  rw [merge_comm, merge_empty_left]

/-- Intersect (AND) is commutative. -/
theorem intersect_comm (a b : Bitmask) : intersect a b = intersect b a := by
  simp [intersect, Nat.land_comm]

/-- Delta (XOR) is commutative. -/
theorem delta_comm (a b : Bitmask) : delta a b = delta b a := by
  simp [delta, Nat.xor_comm]

/-- Hamming distance is symmetric. -/
theorem hammingDistance_symm (a b : Bitmask) :
    hammingDistance a b = hammingDistance b a := by
  simp [hammingDistance, delta_comm]

/-- Hamming distance to self is zero. -/
theorem hammingDistance_self (mask : Bitmask) :
    hammingDistance mask mask = 0 := by
  simp [hammingDistance, delta, Nat.xor_self, popcount, testBit]

/-- Popcount of empty is zero. -/
theorem popcount_empty : popcount empty = 0 := by rfl

/-- Popcount of single bit is one. -/
theorem popcount_single_bit (p : Nat) (hp : p < BITMASK_WIDTH) :
    popcount (setBit empty p) = 1 := by
  simp only [BITMASK_WIDTH] at hp
  simp only [popcount, BITMASK_WIDTH]
  have key : ∀ q, testBit (setBit empty p) q = (q == p) := by
    intro q
    by_cases hqp : q = p
    · subst hqp
      simp [testBit, setBit, isValidPosition, BITMASK_WIDTH, empty, hp, Nat.and_self]
    · have hbeq : (q == p) = false := by simp [hqp]
      rw [hbeq]
      by_cases hq : q < BITMASK_WIDTH
      · rw [setBit_preserves_other empty p q hp hq (Ne.symm hqp)]
        simp [testBit, isValidPosition, BITMASK_WIDTH, empty]
      · simp only [BITMASK_WIDTH] at hq; simp [testBit, isValidPosition, BITMASK_WIDTH]; omega
  simp_rw [key, ← List.count_eq_countP]
  rw [List.count_range, if_pos hp]

/-- activeBits of empty is empty list. -/
theorem activeBits_empty : activeBits empty = [] := by rfl

/-- activeBits length equals popcount. -/
theorem activeBits_length_eq_popcount (mask : Bitmask) :
    (activeBits mask).length = popcount mask := by
  dsimp [activeBits, popcount]
  rw [List.countP_eq_length_filter]

/-- Each byte from toBytes is in valid range. -/
theorem toBytes_valid (mask : Bitmask) (i : Fin 8) :
    UInt8.toNat (toBytes mask i) < 256 := by
  dsimp [toBytes]
  exact UInt8.toNat_lt _

/-- Emergency bits detection is correct. -/
theorem hasEmergency_correct (mask : Bitmask) :
    hasEmergency mask = true ↔ (mask &&& (0xFF <<< 56)) ≠ 0 := by
  dsimp [hasEmergency]
  simp

/-- Emergency bits extraction preserves only bits 56-63. -/
theorem emergencyBits_correct (mask : Bitmask) :
    ∀ p, p < 56 → testBit (emergencyBits mask) p = false := by
  intro p hp
  simp [testBit, emergencyBits, isValidPosition, BITMASK_WIDTH]; intro _
  rw [Nat.land_assoc, show (18374686479671623680 : Nat) = 0xFF <<< 56 from rfl]
  rw [Nat.one_shiftLeft, Nat.land_comm (0xFF <<< 56), Nat.two_pow_and,
      show (0xFF : Nat) <<< 56 = 255 * 2^56 from rfl, Nat.testBit_mul_two_pow]
  simp [show ¬(56 ≤ p) from by omega]

/-- toBytes and fromBytes roundtrip. -/
private lemma shiftRight_and_shiftLeft (a k m : Nat) :
    ((a >>> k) &&& m) <<< k = a &&& (m <<< k) := by
  apply Nat.eq_of_testBit_eq; intro i
  simp only [Nat.testBit_and, Nat.testBit_shiftLeft, Nat.testBit_shiftRight]
  by_cases hik : k ≤ i
  · simp [hik, show k + (i - k) = i from by omega]
  · simp [show ¬(i ≥ k) from by omega]

theorem serialize_roundtrip (mask : Bitmask) (h : mask < 2 ^ BITMASK_WIDTH) :
    fromBytes (toBytes mask) = mask := by
  simp only [BITMASK_WIDTH] at h
  simp only [fromBytes, toBytes]
  simp [List.finRange, List.foldl]
  -- Simplify n % 256 &&& 255 = n &&& 255 using mod idempotence
  simp only [show (255 : Nat) = 2 ^ 8 - 1 from rfl, show (256 : Nat) = 2 ^ 8 from rfl,
    Nat.and_two_pow_sub_one_eq_mod, Nat.mod_mod]
  -- Each term (mask >>> 8i % 2^8) <<< 8i = mask &&& (2^8-1) <<< 8i
  -- by shiftRight_and_shiftLeft
  simp only [← Nat.and_two_pow_sub_one_eq_mod, shiftRight_and_shiftLeft]
  -- Now goal: mask &&& 255 ||| mask &&& (255 <<< 8) ||| ... = mask
  -- Factor out mask using AND-OR distributivity
  rw [← Nat.and_or_distrib_left, ← Nat.and_or_distrib_left, ← Nat.and_or_distrib_left,
      ← Nat.and_or_distrib_left, ← Nat.and_or_distrib_left, ← Nat.and_or_distrib_left,
      ← Nat.and_or_distrib_left]
  -- Now goal: mask &&& (255 ||| 255 <<< 8 ||| ... ||| 255 <<< 56) = mask
  rw [show (255 : Nat) ||| 255 <<< 8 ||| 255 <<< 16 ||| 255 <<< 24 |||
    255 <<< 32 ||| 255 <<< 40 ||| 255 <<< 48 ||| 255 <<< 56 = 2 ^ 64 - 1 from by decide]
  rw [Nat.and_two_pow_sub_one_eq_mod, Nat.mod_eq_of_lt h]

end AdaptiveBitmask
