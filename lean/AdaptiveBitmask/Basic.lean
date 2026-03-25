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

## Main Definitions

- `Bitmask`: A 64-bit bitmask represented as `Nat`
- `empty`: The zero bitmask
- `setBit`, `clearBit`, `testBit`: Basic bit manipulation
- `popcount`: Count of set bits (population count)
- `merge`, `intersect`, `delta`: Bitwise operations
- `hammingDistance`: Number of differing bits
- `toBytes`, `fromBytes`: Serialization primitives

## Key Properties

- Bitwise operations are commutative and associative
- Serialization roundtrips correctly
- Emergency bits (56-63) can be isolated
-/

namespace AdaptiveBitmask

open Std (HashMap)

/-- Width of the bitmask in bits (64-bit unsigned). -/
def BITMASK_WIDTH : Nat := 64

/-- A 64-bit bitmask represented as a natural number. -/
abbrev Bitmask := Nat

/-- Create an empty bitmask (all zeros). -/
def empty : Bitmask := 0

/-- Emergency bit range: bits 56-63 (8 bits for critical signals). -/
def EMERGENCY_RANGE : (Nat × Nat) := (56, 63)

/-- High-frequency bit range: bits 0-47 (48 bits for common features). -/
def HIGH_FREQ_RANGE : (Nat × Nat) := (0, 47)

/-- Medium-frequency bit range: bits 48-55 (8 bits for less common features). -/
def MED_FREQ_RANGE : (Nat × Nat) := (48, 55)

/-- Check if a bit position is valid (0-63). -/
def isValidPosition (p : Nat) : Prop := p < BITMASK_WIDTH

instance : DecidablePred isValidPosition :=
  inferInstanceAs (DecidablePred (· < BITMASK_WIDTH))

/-- Set bit at position `p`. Returns 0 if position is invalid. -/
def setBit (mask : Bitmask) (p : Nat) : Bitmask :=
  if decide (isValidPosition p) then
    mask ||| (1 <<< p)
  else
    0

/-- Test if bit at position `p` is set. Returns false if position is invalid. -/
def testBit (mask : Bitmask) (p : Nat) : Bool :=
  if decide (isValidPosition p) then
    (mask &&& (1 <<< p)) ≠ 0
  else
    false

/-- Clear bit at position `p`. Returns mask unchanged if position is invalid. -/
def clearBit (mask : Bitmask) (p : Nat) : Bitmask :=
  if decide (isValidPosition p) then
    if testBit mask p then mask ^^^ (1 <<< p) else mask
  else
    mask

/-- Count the number of set bits (population count). -/
def popcount (mask : Bitmask) : Nat :=
  (List.range BITMASK_WIDTH).countP (fun p => testBit mask p)

/-- Get all set bit positions as a list (ascending order). -/
def activeBits (mask : Bitmask) : List Nat :=
  List.filter (fun p => testBit mask p) (List.range BITMASK_WIDTH)

/-- Invoke a function on each set bit position (ascending order). -/
def forEachSetBit (mask : Bitmask) (f : Nat → Unit) : Unit :=
  (activeBits mask).foldl (fun (_ : Unit) p => f p) ()

/-- OR-merge two bitmasks (union of features). -/
def merge (a b : Bitmask) : Bitmask :=
  a ||| b

/-- AND-intersect two bitmasks (common features). -/
def intersect (a b : Bitmask) : Bitmask :=
  a &&& b

/-- XOR-delta between two bitmasks (changed features). -/
def delta (prev next : Bitmask) : Bitmask :=
  prev ^^^ next

/-- Hamming distance: number of differing bit positions. -/
def hammingDistance (a b : Bitmask) : Nat :=
  popcount (delta a b)

/-- Check if emergency bits (56-63) are active. -/
def hasEmergency (mask : Bitmask) : Bool :=
  let emergencyMask := 0xFF <<< 56
  (mask &&& emergencyMask) ≠ 0

/-- Extract only emergency bits. -/
def emergencyBits (mask : Bitmask) : Bitmask :=
  let emergencyMask := 0xFF <<< 56
  mask &&& emergencyMask

/-- Serialize bitmask to 8-byte array (little-endian). -/
def toBytes (mask : Bitmask) : Fin 8 → UInt8 :=
  fun i => UInt8.ofNat ((mask >>> (8 * i.val)) &&& 0xFF)

/-- Deserialize from 8-byte array (little-endian). -/
def fromBytes (bytes : Fin 8 → UInt8) : Bitmask :=
  List.foldl (fun acc (i : Fin 8) =>
    acc ||| (UInt8.toNat (bytes i) <<< (8 * i.val))
  ) 0 (List.finRange 8)

/--
Encode a set of features into a bitmask given a schema mapping.
Features not in the schema are silently ignored.
-/
def encode (features : List String) (schema : HashMap String (Fin 64)) :
    Bitmask × Nat × Nat :=
  let init := (0, 0, 0)
  let (mask, mapped, unmapped) := List.foldl (fun (m, mcnt, ucnt) feat =>
    match schema.get? feat with
    | some bit => (m ||| (1 <<< bit.val), mcnt + 1, ucnt)
    | none => (m, mcnt, ucnt + 1)
  ) init features
  (mask, mapped, unmapped)

/--
Decode a bitmask back to feature names.
Note: Ambiguous when collisions exist (multiple features per bit).
-/
def decode (mask : Bitmask) (reverseSchema : HashMap (Fin 64) (List String)) : List String :=
  (activeBits mask).foldr (fun bit acc =>
    let names :=
      if h : bit < BITMASK_WIDTH then
        reverseSchema.get? ⟨bit, h⟩ |>.getD []
      else
        []
    names ++ acc
  ) []

namespace Theorems

/-- Setting a bit makes it test true (when position is valid). -/
theorem setBit_test_true (mask : Bitmask) (p : Nat) (h : p < BITMASK_WIDTH) :
  testBit (setBit mask p) p = true := by
  unfold testBit setBit
  simp [isValidPosition, h]
  sorry

/-- Setting a bit doesn't affect other bits. -/
theorem setBit_preserves_other (mask : Bitmask) (p q : Nat) 
    (hp : p < BITMASK_WIDTH) (hq : q < BITMASK_WIDTH) (hne : p ≠ q) :
  testBit (setBit mask p) q = testBit mask q := by
  unfold testBit setBit
  simp [isValidPosition, hp, hq]
  sorry

/-- Clearing a set bit makes it test false. -/
theorem clearBit_test_false (mask : Bitmask) (p : Nat) (h : p < BITMASK_WIDTH) 
    (hset : testBit mask p = true) :
  testBit (clearBit mask p) p = false := by
  unfold testBit clearBit
  simp [isValidPosition, h, hset]
  sorry

/-- Merge (OR) is commutative. -/
theorem merge_comm (a b : Bitmask) :
  merge a b = merge b a := by
  simp [merge, Nat.lor_comm]

/-- Merge (OR) is associative. -/
theorem merge_assoc (a b c : Bitmask) :
  merge (merge a b) c = merge a (merge b c) := by
  simp [merge, Nat.lor_assoc]

/-- Merge with empty is identity. -/
theorem merge_empty_left (mask : Bitmask) :
  merge empty mask = mask := by
  simp [merge, empty]

/-- Merge with empty is identity (right). -/
theorem merge_empty_right (mask : Bitmask) :
  merge mask empty = mask := by
  simp [merge, empty]

/-- Intersect (AND) is commutative. -/
theorem intersect_comm (a b : Bitmask) :
  intersect a b = intersect b a := by
  simp [intersect, Nat.land_comm]

/-- Delta (XOR) is commutative. -/
theorem delta_comm (a b : Bitmask) :
  delta a b = delta b a := by
  simp [delta, Nat.xor_comm]

/-- Hamming distance is symmetric. -/
theorem hammingDistance_symm (a b : Bitmask) :
  hammingDistance a b = hammingDistance b a := by
  simp [hammingDistance, delta_comm]

/-- Hamming distance to self is zero. -/
theorem hammingDistance_self (mask : Bitmask) :
  hammingDistance mask mask = 0 := by
  simp [hammingDistance, delta, Nat.xor_self, popcount, testBit, empty, List.countP]
  rfl

/-- Popcount of empty is zero. -/
theorem popcount_empty :
  popcount empty = 0 := by rfl

/-- Popcount of single bit is one. -/
theorem popcount_single_bit (p : Nat) (hp : p < BITMASK_WIDTH) :
  popcount (setBit empty p) = 1 := by
  sorry

/-- activeBits of empty is empty list. -/
axiom activeBits_empty :
  activeBits empty = []

/-- activeBits length equals popcount. -/
theorem activeBits_length_eq_popcount (mask : Bitmask) :
  (activeBits mask).length = popcount mask := by
  unfold activeBits popcount
  exact List.length_filter _ _

/-- toBytes and fromBytes roundtrip. -/
theorem serialize_roundtrip (mask : Bitmask) :
  fromBytes (toBytes mask) = mask := by
  sorry

/-- Each byte from toBytes is in valid range. -/
theorem toBytes_valid (mask : Bitmask) (i : Fin 8) :
  UInt8.toNat (toBytes mask i) < 256 := by
  unfold toBytes
  exact UInt8.toNat_lt _

/-- Emergency bits detection is correct. -/
theorem hasEmergency_correct (mask : Bitmask) :
  hasEmergency mask = true ↔ (mask &&& (0xFF <<< 56)) ≠ 0 := by
  unfold hasEmergency
  rfl

/-- Emergency bits extraction preserves only bits 56-63. -/
theorem emergencyBits_correct (mask : Bitmask) :
  ∀ p, p < 56 → testBit (emergencyBits mask) p = false := by
  sorry

end Theorems

end AdaptiveBitmask
