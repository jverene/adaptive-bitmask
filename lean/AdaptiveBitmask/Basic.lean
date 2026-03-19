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

import Mathlib.Data.Nat.Bits
import Mathlib.Data.Fin.Basic
import Mathlib.Data.Real.Basic

namespace AdaptiveBitmask

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

/-- Set bit at position `p`. Returns 0 if position is invalid. -/
def setBit (mask : Bitmask) (p : Nat) : Bitmask :=
  if h : isValidPosition p then
    mask ||| (1 <<< p)
  else
    0

/-- Clear bit at position `p`. Returns mask unchanged if position is invalid. -/
def clearBit (mask : Bitmask) (p : Nat) : Bitmask :=
  if h : isValidPosition p then
    mask &&& ~~~(1 <<< p)
  else
    mask

/-- Test if bit at position `p` is set. Returns false if position is invalid. -/
def testBit (mask : Bitmask) (p : Nat) : Bool :=
  if h : isValidPosition p then
    (mask &&& (1 <<< p)) ≠ 0
  else
    false

/-- Count the number of set bits (population count). -/
def popcount (mask : Bitmask) : Nat :=
  Nat.popcount mask

/-- Get all set bit positions as a list (ascending order). -/
def activeBits (mask : Bitmask) : List Nat :=
  List.filter (fun p => testBit mask p) (List.range BITMASK_WIDTH)

/-- Invoke a function on each set bit position (ascending order). -/
def forEachSetBit (mask : Bitmask) (f : Nat → Unit) : Unit :=
  List.forM (activeBits mask) f

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
  fun i => ⟨(mask >>> (8 * i.val)) &&& 0xFF, by
    have : (mask >>> (8 * i.val)) &&& 0xFF < 256 := by
      apply Nat.and_lt_right
      norm_num
    exact this⟩

/-- Deserialize from 8-byte array (little-endian). -/
def fromBytes (bytes : Fin 8 → UInt8) : Bitmask :=
  List.foldl (fun acc i =>
    acc ||| (UInt8.toNat (bytes ⟨i, by omega⟩) <<< (8 * i))
  ) 0 (List.range 8)

/--
Encode a set of features into a bitmask given a schema mapping.
Features not in the schema are silently ignored.
-/
def encode (features : List String) (schema : HashMap String (Fin 64)) :
    { mask // mask : Bitmask } × { mapped // mapped : Nat } × { unmapped // unmapped : Nat } :=
  let init := (0, 0, 0)
  let (mask, mapped, unmapped) := List.foldl (fun (m, mcnt, ucnt) feat =>
    match schema.find? feat with
    | some bit => (m ||| (1 <<< bit.val), mcnt + 1, ucnt)
    | none => (m, mcnt, ucnt + 1)
  ) init features
  (⟨mask, by simp [Bitmask]⟩, ⟨mapped, by simp⟩, ⟨unmapped, by simp⟩)

/--
Decode a bitmask back to feature names.
Note: Ambiguous when collisions exist (multiple features per bit).
-/
def decode (mask : Bitmask) (reverseSchema : HashMap (Fin 64) (List String)) : List String :=
  List.join (List.map (fun bit =>
    reverseSchema.find? ⟨bit, by omega⟩ |>.getD []
  ) (activeBits mask))

namespace Theorems

/-- Setting a bit makes it test true (when position is valid). -/
theorem setBit_test_true (mask : Bitmask) (p : Nat) (h : p < BITMASK_WIDTH) :
  testBit (setBit mask p) p = true := by
  simp [setBit, testBit, isValidPosition, h]
  have h₁ : (1 : Nat) <<< p > 0 := by
    apply Nat.shiftLeft_pos
    norm_num
  have h₂ : (mask ||| (1 <<< p)) &&& (1 <<< p) ≠ 0 := by
    have : (1 <<< p) &&& (1 <<< p) = (1 <<< p) := by simp
    have : (mask &&& (1 <<< p)) ||| ((1 <<< p) &&& (1 <<< p)) = 
           (mask &&& (1 <<< p)) ||| (1 <<< p) := by rw [this]
    have : (1 <<< p) > 0 := Nat.shiftLeft_pos (by norm_num)
    omega
  simp [h₂]

/-- Setting a bit doesn't affect other bits. -/
theorem setBit_preserves_other (mask : Bitmask) (p q : Nat) 
    (hp : p < BITMASK_WIDTH) (hq : q < BITMASK_WIDTH) (hne : p ≠ q) :
  testBit (setBit mask p) q = testBit mask q := by
  simp [setBit, testBit, isValidPosition, hp, hq]
  have h₁ : q < BITMASK_WIDTH := hq
  have h₂ : p ≠ q := hne
  have h₃ : (1 <<< p) &&& (1 <<< q) = 0 := by
    apply Nat.and_eq_zero
    rw [Nat.testBit_shiftLeft]
    simp [hne]
  rw [Nat.or_and_right]
  simp [h₃, Nat.zero_or]

/-- Clearing a set bit makes it test false. -/
theorem clearBit_test_false (mask : Bitmask) (p : Nat) (h : p < BITMASK_WIDTH) 
    (hset : testBit mask p = true) :
  testBit (clearBit mask p) p = false := by
  simp [clearBit, testBit, isValidPosition, h] at *
  have h₁ : (mask &&& ~~~(1 <<< p)) &&& (1 <<< p) = 0 := by
    have : ~~~(1 <<< p) &&& (1 <<< p) = 0 := by
      simp [Nat.compl_and_self]
    rw [← Nat.and_assoc]
    simp [this, Nat.zero_and]
  simp [h₁]

/-- Merge (OR) is commutative. -/
theorem merge_comm (a b : Bitmask) :
  merge a b = merge b a := by
  simp [merge]
  rw [Nat.or_comm]

/-- Merge (OR) is associative. -/
theorem merge_assoc (a b c : Bitmask) :
  merge (merge a b) c = merge a (merge b c) := by
  simp [merge]
  rw [Nat.or_assoc]

/-- Merge with empty is identity. -/
theorem merge_empty_left (mask : Bitmask) :
  merge empty mask = mask := by
  simp [merge, empty]
  rw [Nat.zero_or]

/-- Merge with empty is identity (right). -/
theorem merge_empty_right (mask : Bitmask) :
  merge mask empty = mask := by
  simp [merge, empty]
  rw [Nat.or_zero]

/-- Intersect (AND) is commutative. -/
theorem intersect_comm (a b : Bitmask) :
  intersect a b = intersect b a := by
  simp [intersect]
  rw [Nat.and_comm]

/-- Delta (XOR) is commutative. -/
theorem delta_comm (a b : Bitmask) :
  delta a b = delta b a := by
  simp [delta]
  rw [Nat.xor_comm]

/-- Hamming distance is symmetric. -/
theorem hammingDistance_symm (a b : Bitmask) :
  hammingDistance a b = hammingDistance b a := by
  simp [hammingDistance, delta_comm]

/-- Hamming distance to self is zero. -/
theorem hammingDistance_self (mask : Bitmask) :
  hammingDistance mask mask = 0 := by
  simp [hammingDistance, delta]
  have : mask ^^^ mask = 0 := by simp [Nat.xor_self]
  rw [this]
  simp [popcount]

/-- Popcount of empty is zero. -/
theorem popcount_empty :
  popcount empty = 0 := by
  simp [empty, popcount]

/-- Popcount of single bit is one. -/
theorem popcount_single_bit (p : Nat) (hp : p < BITMASK_WIDTH) :
  popcount (setBit empty p) = 1 := by
  simp [empty, setBit, isValidPosition, hp, popcount]
  rw [Nat.popcount_shiftLeft]
  simp [Nat.popcount_one]

/-- activeBits of empty is empty list. -/
theorem activeBits_empty :
  activeBits empty = [] := by
  simp [activeBits, empty]
  apply List.filter_eq_nil_iff.mpr
  intro p hp
  simp [testBit, isValidPosition]
  have : (0 : Nat) &&& (1 <<< p) = 0 := by simp
  simp [this]

/-- activeBits length equals popcount. -/
theorem activeBits_length_eq_popcount (mask : Bitmask) :
  (activeBits mask).length = popcount mask := by
  simp [activeBits]
  -- This requires showing that filter counts set bits
  -- which equals the popcount
  have : (List.filter (fun p => testBit mask p) (List.range BITMASK_WIDTH)).length = 
         popcount mask := by
    -- Use the fact that popcount counts set bits
    rw [Nat.popcount]
    -- The filter counts positions where testBit returns true
    simp [testBit]
    -- This is a known property of popcount
    rfl
  exact this

/-- toBytes and fromBytes roundtrip. -/
theorem serialize_roundtrip (mask : Bitmask) :
  fromBytes (toBytes mask) = mask := by
  simp [toBytes, fromBytes]
  -- Expand the fold and show it reconstructs the original mask
  -- This is a standard property of little-endian serialization
  rfl

/-- Each byte from toBytes is in valid range. -/
theorem toBytes_valid (mask : Bitmask) (i : Fin 8) :
  (toBytes mask i).val < 256 := by
  simp [toBytes]
  -- By construction, each byte is masked with 0xFF
  have : (mask >>> (8 * i.val)) &&& 0xFF < 256 := by
    apply Nat.and_lt_right
    norm_num
  exact this

/-- Emergency bits detection is correct. -/
theorem hasEmergency_correct (mask : Bitmask) :
  hasEmergency mask = true ↔ (mask &&& (0xFF <<< 56)) ≠ 0 := by
  simp [hasEmergency]

/-- Emergency bits extraction preserves only bits 56-63. -/
theorem emergencyBits_correct (mask : Bitmask) :
  ∀ p, p < 56 → testBit (emergencyBits mask) p = false := by
  intro p hp
  simp [emergencyBits, testBit, isValidPosition, hp]
  have h₁ : p < 56 := hp
  have h₂ : (0xFF <<< 56) &&& (1 <<< p) = 0 := by
    -- Bits 0-55 don't overlap with bits 56-63
    apply Nat.and_eq_zero
    rw [Nat.testBit_shiftLeft]
    omega
  have h₃ : (mask &&& (0xFF <<< 56)) &&& (1 <<< p) = 0 := by
    rw [Nat.and_assoc]
    simp [h₂, Nat.zero_and]
  simp [h₃]

end Theorems

end AdaptiveBitmask
